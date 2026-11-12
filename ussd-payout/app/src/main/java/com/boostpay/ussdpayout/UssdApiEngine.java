package com.boostpay.ussdpayout;

import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.telephony.TelephonyManager;

/**
 * Method A — the official Android USSD API (TelephonyManager.sendUssdRequest).
 *
 * The first call dials the service code; every later call carries the next key of
 * the menu. Whether the network keeps the SAME session alive across calls depends
 * on the phone and the operator: when it does not, the reply is the main menu again
 * and this engine stops instead of typing money commands into a fresh session.
 */
public final class UssdApiEngine {

    private static final long STEP_TIMEOUT_MS = 45_000;

    private final Context ctx;
    private final Plan plan;
    private final Sink sink;
    private final int subId;          // -1 = whatever the phone's default SIM is
    private final Handler h = new Handler(Looper.getMainLooper());

    private int idx = 0;
    private boolean started = false;
    private boolean over = false;
    private Runnable timer;

    public UssdApiEngine(Context ctx, Plan plan, Sink sink) {
        this(ctx, plan, sink, -1);
    }

    public UssdApiEngine(Context ctx, Plan plan, Sink sink, int subId) {
        this.ctx = ctx.getApplicationContext();
        this.plan = plan;
        this.sink = sink;
        this.subId = subId;
    }

    public void start() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            finish(false, "USSD API needs Android 8+ — use the Accessibility method on this phone.");
            return;
        }
        sink.log("▶ mode: USSD API · " + (plan.dryRun ? "DRY RUN (no PIN, no money)" : "LIVE")
                + (subId > 0 ? " · subId " + subId : " · default SIM"));
        send(plan.serviceCode, "service code");
    }

    private void send(final String input, String what) {
        if (over) return;
        armTimer(what);
        try {
            TelephonyManager tm = (TelephonyManager) ctx.getSystemService(Context.TELEPHONY_SERVICE);
            if (tm == null) { finish(false, "No telephony service on this device."); return; }
            TelephonyManager bound = tm;
            if (subId > 0) {
                try {
                    // API 24+: a manager bound to one subscription routes the USSD call
                    // from that SIM on most devices.
                    bound = tm.createForSubscriptionId(subId);
                } catch (Throwable t) {
                    sink.log("! this phone cannot target a SIM for USSD — using the default SIM");
                }
            }
            bound.sendUssdRequest(input, new TelephonyManager.UssdResponseCallback() {
                @Override
                public void onReceiveUssdResponse(TelephonyManager t, String request, CharSequence response) {
                    cancelTimer();
                    onScreen(response == null ? "" : response.toString());
                }

                @Override
                public void onReceiveUssdResponseFailed(TelephonyManager t, String request, int code) {
                    cancelTimer();
                    finish(false, "The network refused \"" + what + "\" (code " + code + "). "
                            + (code == TelephonyManager.USSD_RETURN_FAILURE
                            ? "This phone blocks third-party USSD — switch to the Accessibility method."
                            : "Check the service code and that the SIM is in the phone."));
                }
            }, h);
        } catch (SecurityException se) {
            cancelTimer();
            finish(false, "Android blocked USSD (SecurityException). Grant the Phone permission, or use the Accessibility method.");
        } catch (Throwable t) {
            cancelTimer();
            finish(false, "USSD call failed: " + t.getMessage());
        }
    }

    private void onScreen(String screen) {
        String clean = screen.replace('\n', ' ').replace('\r', ' ').trim();
        sink.log("⇦ " + clean);

        if (looksRejected(clean)) { finish(false, "Network said no: " + firstLine(clean)); return; }

        if (started && looksLikeMainMenu(clean)) {
            finish(false, "The session restarted (main menu came back instead of the next step). "
                    + "This phone/operator does not keep a USSD session across API calls — use the Accessibility method, "
                    + "which types into the live dialog instead.");
            return;
        }

        Plan.Key key = plan.decide(clean, idx);
        if (key == null) { finish(true, "Sequence finished — read the screens above."); return; }
        if (key.stopBefore) {
            sink.log("⏸ DRY RUN: " + key.why);
            finish(true, "Dry run complete: reached the PIN prompt, nothing was sent.");
            return;
        }

        sink.log("⇨ " + (key.secret ? "••••" : key.value) + "   · " + key.why);
        idx++;
        started = true;
        final String value = key.value;
        // operators with a slow menu (Nagad) get a moment before the next key
        h.postDelayed(() -> send(value, "step " + idx), Provider.current().stepDelayMs);
    }

    private void armTimer(String what) {
        cancelTimer();
        timer = () -> finish(false, "No reply within 45s after \"" + what + "\". The transaction is UNKNOWN — "
                + "check the confirmation SMS before trying again (a blind retry can pay twice).");
        h.postDelayed(timer, STEP_TIMEOUT_MS);
    }

    private void cancelTimer() {
        if (timer != null) { h.removeCallbacks(timer); timer = null; }
    }

    private void finish(boolean ok, String msg) {
        if (over) return;
        over = true;
        cancelTimer();
        Guard.end();
        sink.finish(ok, msg);
    }

    static boolean looksRejected(String s) {
        String l = s.toLowerCase();
        return l.contains("invalid") || l.contains("wrong") || l.contains("failed")
                || l.contains("sorry") || l.contains("insufficient") || l.contains("not enough")
                || l.contains("denied") || l.contains("ভুল") || l.contains("ব্যর্থ");
    }

    static boolean looksLikeMainMenu(String s) {
        String l = s.toLowerCase();
        boolean send = l.contains("send money") || l.contains("সেন্ড মানি");
        boolean other = l.contains("cash out") || l.contains("payment") || l.contains("recharge")
                || l.contains("ক্যাশ আউট");
        return send && other;
    }

    static String firstLine(String s) {
        int i = s.indexOf('\n');
        return i > 0 ? s.substring(0, i) : s;
    }
}
