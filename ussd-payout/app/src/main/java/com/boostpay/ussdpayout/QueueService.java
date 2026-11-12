package com.boostpay.ussdpayout;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Date;
import java.util.Deque;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Keeps asking the admin panel for payout jobs and sends them — with the screen off.
 *
 * WHY A SERVICE: the first version polled from the Activity, so locking the phone
 * stopped it and a queued job waited for ever (`QUEUED`, phone "last seen 5 h ago").
 * This is a foreground service with a partial wake lock instead: Android may kill an
 * Activity in the background, but it must keep a foreground service alive.
 *
 * Order of work for one job:
 *   ask for work → build the plan (which SIM, which PIN) → dial with the
 *   accessibility robot → report SENT / DRYRUN / FAILED → ask again.
 */
public class QueueService extends Service {

    static final String ACTION_START = "com.boostpay.ussdpayout.QUEUE_START";
    static final String ACTION_STOP = "com.boostpay.ussdpayout.QUEUE_STOP";
    private static final String CHANNEL = "bp_payout_queue";
    private static final int NOTE_ID = 4211;

    /** The UI watches this so the log is visible even when the job ran in the background. */
    interface Listener { void onQueue(String line, String status); }
    static volatile Listener listener;
    static volatile boolean running;
    static final Deque<String> LOG = new ArrayDeque<>();
    static volatile String lastStatus = "idle";
    static volatile long lastContactAt = 0;      // last successful answer from the panel
    static volatile String lastError = "";       // the panel's reason, when it refuses us

    // ── the last job, so the big card can show a status and a ↻ RETRY button ──
    static volatile String lastJobId = "";
    static volatile String lastJobLabel = "";    // "100 BDT → 017…"
    static volatile String lastJobStatus = "";   // SENDING · SENT · DRYRUN · FAILED
    static volatile String lastJobNote = "";     // why it failed, in the server's words
    static volatile String lastJobTrx = "";      // the wallet's TrxID, when the payout went through

    private static QueueService self;
    private Handler handler;
    private PowerManager.WakeLock wake;
    private Thread worker;
    private volatile boolean stop;
    private CountDownLatch jobDone;
    private volatile boolean jobOk;
    private volatile String jobSummary = "";
    private volatile String jobTrx = "";         // the wallet's TrxID for the job being sent

    // ── lifecycle ────────────────────────────────────────────────────────────

    /** Clears the "last job" line — the UI calls this when ▶ CONNECT starts a new session. */
    static void forgetLastJob() {
        lastJobId = "";
        lastJobLabel = "";
        lastJobStatus = "";
        lastJobNote = "";
    }

    static void start(Context c) {
        Intent i = new Intent(c, QueueService.class).setAction(ACTION_START);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void stop(Context c) {
        c.startService(new Intent(c, QueueService.class).setAction(ACTION_STOP));
    }

    static boolean isRunning() { return running; }

    @Override
    public void onCreate() {
        super.onCreate();
        self = this;
        handler = new Handler(Looper.getMainLooper());
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : (intent.getAction() == null ? ACTION_START : intent.getAction());
        if (ACTION_STOP.equals(action)) {
            stop = true;
            running = false;
            try { UssdService.cancel(this); } catch (Throwable ignored) { }
            notify("Payout queue stopped", "Nothing is being sent from this phone.");
            releaseWake();
            stopForeground(true);
            stopSelf();
            say("queue: stopped", "stopped");
            return START_NOT_STICKY;
        }

        if (!running) {
            running = true;
            stop = false;
            startForeground(NOTE_ID, notification("Queue running", "Waiting for a job from the panel…"));
            acquireWake();
            say("queue: started — asking the panel for jobs", "running");
            worker = new Thread(this::loop, "bp-payout-queue");
            worker.start();
        }
        return START_STICKY;      // Android restarts it if it kills the process
    }

    @Override
    public void onDestroy() {
        running = false;
        stop = true;
        releaseWake();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ── the loop ─────────────────────────────────────────────────────────────

    private void loop() {
        while (!stop) {
            Queue.Fixed fixed = Queue.fixServer(Runner.prefs(this).getString("server", ""));
            String server = fixed.url;
            if (!fixed.note.isEmpty()) {                 // wrong address saved → repair it once
                say("queue: " + fixed.note, "fixed address");
                Runner.prefs(this).edit().putString("server", server).apply();
            }
            String token = Runner.prefs(this).getString("token", "");
            boolean dryRun = Runner.prefs(this).getBoolean("queueDryRun", false);
            if (server.isEmpty() || token.isEmpty()) {
                say("queue: no server/token saved — open the app and fill section 4", "needs setup");
                sleep(15000);
                continue;
            }

            Queue.Reply reply = Queue.next(server, token, dryRun);
            if (reply.ok) {
                lastContactAt = System.currentTimeMillis();
                lastError = "";
            } else {
                lastError = reply.error;
            }
            if (!reply.ok) {
                say("queue: " + reply.error, "server error");
                if (!reply.hint.isEmpty()) say("queue: → " + reply.hint, "hint");
                updateNotification("Queue: " + reply.error, "Retrying in 15 s…");
                sleep(15000);
                continue;
            }
            if (reply.job == null) {
                updateNotification("Queue running", "Waiting for a job… (" + (dryRun ? "dry run" : "live") + ")");
                sleep(Math.max(3000, reply.pollAfterMs));
                continue;
            }

            Queue.Job job = reply.job;
            lastJobId = job.id;
            lastJobLabel = job.amount + " BDT → " + job.number;
            lastJobStatus = "SENDING";
            lastJobNote = "";
            say("queue: job " + job.id + " · " + lastJobLabel
                    + " (" + job.kind + (dryRun ? ", dry run" : ", LIVE") + ")", "sending");
            updateNotification("Sending " + job.amount + " BDT", job.number + " · " + job.id);

            LOG.clear();                      // each job carries only its own screens
            String failure = send(job, dryRun);
            String status;
            String note;
            boolean pinRejected = failure != null && failure.startsWith("PIN_REJECTED:");
            boolean staleScreen = failure != null && failure.contains("stale PIN screen");
            if (failure == null) {
                if (dryRun) {
                    status = "DRYRUN";
                    note = jobSummary;
                } else if (!jobTrx.isEmpty()) {
                    status = "SENT";
                    note = "TrxID " + jobTrx + " · " + jobSummary;
                } else {
                    // Owner's rule: no TrxID means we cannot show the customer a receipt,
                    // so it is not counted as sent.
                    status = "FAILED";
                    note = "NO_TRXID the wallet showed no TrxID — " + jobSummary;
                }
            } else if (staleScreen) {
                // the wallet never saw this job: no money moved, so it is not a payment failure
                status = "DRYRUN";
                note = failure;
            } else {
                status = "FAILED";
                note = pinRejected
                        ? "PIN rejected by " + job.provider + " for SIM " + simLabelOf() + " — save that SIM's PIN again (⚙ Advanced settings → SIM cards)"
                        : failure;
            }
            String err = Queue.report(server, token, job.id, status, note, logText(), jobTrx);
            lastJobStatus = status;
            lastJobTrx = jobTrx;
            lastJobNote = "FAILED".equals(status) ? (failure == null ? err : failure)
                    : ("SENT".equals(status) ? "TrxID " + jobTrx : "");
            say("queue: job " + job.id + " → " + status + (err.isEmpty() ? "" : " (report failed: " + err + ")"), status.toLowerCase());
            updateNotification("Queue running", "Last job " + job.id + " → " + status);
            if (pinRejected) {
                // Three wrong PINs lock the wallet. Stop asking for jobs until the owner
                // fixes the PIN and presses ▶ CONNECT again.
                lastError = "PIN rejected — queue paused. Fix the PIN in ⚙ Advanced settings → SIM cards, then press ▶ CONNECT.";
                say("queue: ⏸ PAUSED — the wallet said the PIN is wrong. Nothing will be sent until you fix it.", "paused");
                updateNotification("Queue paused", "The wallet rejected the PIN — fix it in the app");
                stop = true;
                break;
            }
            sleep(2500);
        }
    }

    /** @return null when the run finished cleanly, otherwise the reason it did not. */
    private String send(Queue.Job job, boolean dryRun) {
        if (!UssdService.isEnabled(this)) return "accessibility service is off on this phone";
        if (Guard.isRunning()) { sleep(4000); if (Guard.isRunning()) return "another run is still in progress"; }
        if (!Guard.begin()) return "the daily limit check refused this job";

        Runner.Setup setup = Runner.build(this, job.provider, job.number, job.amount, job.ref, dryRun, true);
        if (!setup.ok()) { Guard.end(); return setup.error; }

        say("queue: SIM " + setup.simLabel + " · wallet " + setup.wallet, "sending");
        jobDone = new CountDownLatch(1);
        jobOk = false;
        jobSummary = "";
        jobTrx = "";
        final Sink sink = new Sink() {
            @Override public void log(String line) { say("  " + line, "sending"); }
            @Override public void trx(String trxId) { if (trxId != null && !trxId.isEmpty()) jobTrx = trxId; }
            @Override public void finish(boolean ok, String summary) {
                jobOk = ok;
                jobSummary = summary;
                Guard.end();
                if (jobDone != null) jobDone.countDown();
            }
        };
        boolean started = UssdService.start(this, setup.plan, sink, setup.subId);
        if (!started) {
            Guard.end();
            return "the phone could not start the USSD run";
        }
        try {
            if (!jobDone.await(150, TimeUnit.SECONDS)) {
                UssdService.cancel(this);
                return "the USSD run did not finish within 150 s";
            }
        } catch (InterruptedException e) {
            return "interrupted";
        }
        return jobOk ? null : (jobSummary.isEmpty() ? "the run stopped without a reason" : jobSummary);
    }

    // ── log + notification helpers ───────────────────────────────────────────

    /** "2 · Banglalink" for the SIM the last job used, or "this SIM". */
    private static String simLabelOf() {
        try {
            int subId = SimStore.selected(instance());
            Sims.Sim sim = subId > 0 ? Sims.bySubId(Sims.list(instance()), subId) : null;
            if (sim != null) return sim.label;
        } catch (Throwable ignored) { }
        return "this SIM";
    }

    private static android.content.Context instance() { return self; }

    static String logText() {
        StringBuilder b = new StringBuilder();
        synchronized (LOG) { for (String l : LOG) b.append(l).append('\n'); }
        return b.length() > 3800 ? b.substring(b.length() - 3800) : b.toString();
    }

    static String tail() {
        StringBuilder b = new StringBuilder();
        synchronized (LOG) {
            int n = 0;
            for (String l : LOG) { if (n++ >= 25) break; b.append(l).append('\n'); }
        }
        return b.toString();
    }

    private void say(String line, String status) {
        String ts = new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date());
        synchronized (LOG) {
            LOG.addFirst(ts + "  " + line);
            while (LOG.size() > 120) LOG.removeLast();
        }
        lastStatus = status;
        Listener l = listener;
        if (l != null) handler.post(() -> l.onQueue(line, status));
    }

    private void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) { }
    }

    // ── foreground notification ──────────────────────────────────────────────

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Payout queue", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Keeps the payout robot connected to the panel");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private Notification notification(String title, String text) {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return b.setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setOngoing(true)
                .setContentIntent(pi)
                .build();
    }

    private void updateNotification(String title, String text) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(NOTE_ID, notification(title, text));
        } catch (Throwable ignored) { }
    }

    private void notify(String title, String text) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(NOTE_ID + 1, notification(title, text));
        } catch (Throwable ignored) { }
    }

    private void acquireWake() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "boostpay:payoutqueue");
            wake.acquire();
        } catch (Throwable ignored) { }
    }

    private void releaseWake() {
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Throwable ignored) { }
        wake = null;
    }
}
