package com.boostpay.ussdpayout;

import android.accessibilityservice.AccessibilityService;
import android.telecom.PhoneAccountHandle;
import android.telephony.SubscriptionManager;
import android.telecom.TelecomManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * Method B — drive the real USSD dialog.
 *
 * The firmware shows the *247# session as a dialog owned by the phone app. This
 * service reads that dialog ("⇦" lines in the log), types the next key of the plan
 * into its input box and presses Send. Because it works on the live session, it is
 * the only method that survives operators that do not keep a session across API
 * calls — but it needs the Accessibility permission switched on by the owner.
 */
public class UssdService extends AccessibilityService {

    private static volatile UssdService instance;

    private Plan plan;
    private Sink sink;
    private int idx = 0;
    private int screens = 0;
    private String lastScreen = "";
    private volatile boolean cancelled = false;
    private int screenSeq = 0;
    private final java.util.Set<String> answered = new java.util.HashSet<>();
    private Runnable pendingTask;
    private long lastProgressAt = System.currentTimeMillis();
    private static final long STALL_MS = 12000;
    private int actions = 0;            // keystrokes typed in this run
    private long lastActionAt = 0;      // minimum gap between two keys
    private boolean pinTyped = false;   // after the PIN only the confirmation is left
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public void onServiceConnected() {
        instance = this;
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    @Override
    public void onInterrupt() { /* nothing to interrupt */ }

    // ── public bridge ────────────────────────────────────────────────────────

    public static boolean isEnabled(Context c) {
        try {
            String flat = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (flat == null) return false;
            ComponentName me = new ComponentName(c, UssdService.class);
            TextUtils.SimpleStringSplitter sp = new TextUtils.SimpleStringSplitter(':');
            sp.setString(flat);
            while (sp.hasNext()) {
                if (me.equals(ComponentName.unflattenFromString(sp.next()))) return true;
            }
        } catch (Throwable ignored) { }
        return false;
    }

    /** Starts a run: dials the service code, then walks the plan from the dialog. */
    public static boolean start(Context c, Plan p, Sink s) {
        return start(c, p, s, -1);
    }

    /**
     * @param subId subscription id of the SIM that must place the call, or -1 for the
     *              phone's default SIM.
     */
    public static boolean start(Context c, Plan p, Sink s, int subId) {
        UssdService self = instance;
        if (self == null) {
            s.finish(false, "Accessibility service is off. Settings → Accessibility → BoostPay Payout → On, then try again.");
            return false;
        }
        self.plan = p;
        self.sink = s;
        self.idx = 0;
        self.screens = 0;
        self.lastScreen = "";
        self.cancelled = false;
        self.screenSeq = 0;
        self.answered.clear();
        self.pendingTask = null;
        self.lastProgressAt = System.currentTimeMillis();
        self.handler.removeCallbacksAndMessages(null);
        self.watch();                       // stops a wedged dialog instead of hammering it
        s.log("▶ mode: Accessibility · " + (p.dryRun ? "DRY RUN (no PIN, no money)" : "LIVE")
                + (subId > 0 ? " · subId " + subId : " · default SIM"));
        try {
            Intent call = new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + Uri.encode(p.serviceCode)));
            call.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (subId > 0) {
                PhoneAccountHandle handle = handleFor(c, subId);
                if (handle != null) {
                    call.putExtra(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle);
                    s.log("· calling from SIM subId " + subId);
                } else {
                    s.log("! could not map subId " + subId + " to a phone account — the default SIM will dial");
                }
            }
            c.startActivity(call);
            return true;
        } catch (Throwable t) {
            self.finish(false, "Could not dial " + p.serviceCode + ": " + t.getMessage());
            return false;
        }
    }

    // ── which SIM places the call ────────────────────────────────────────────

    /** Finds the PhoneAccountHandle that belongs to a subscription (API 30+ is exact). */
    private static PhoneAccountHandle handleFor(Context c, int subId) {
        try {
            TelecomManager tm = (TelecomManager) c.getSystemService(Context.TELECOM_SERVICE);
            if (tm == null) return null;
            java.util.List<PhoneAccountHandle> handles = tm.getCallCapablePhoneAccounts();
            if (handles == null) return null;
            android.telephony.TelephonyManager tel =
                    (android.telephony.TelephonyManager) c.getSystemService(Context.TELEPHONY_SERVICE);
            for (PhoneAccountHandle h : handles) {
                if (android.os.Build.VERSION.SDK_INT >= 30 && tel != null) {
                    int sid = tel.getSubscriptionId(h);
                    if (sid == subId) return h;
                }
            }
            // older APIs: the list is ordered by slot on most firmwares
            SubscriptionManager sm = (SubscriptionManager) c.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
            if (sm != null && !handles.isEmpty()) {
                android.telephony.SubscriptionInfo info = null;
                if (android.os.Build.VERSION.SDK_INT >= 22) {
                    java.util.List<android.telephony.SubscriptionInfo> all = sm.getActiveSubscriptionInfoList();
                    if (all != null) for (android.telephony.SubscriptionInfo i : all) if (i.getSubscriptionId() == subId) info = i;
                }
                if (info != null && info.getSimSlotIndex() < handles.size()) return handles.get(info.getSimSlotIndex());
            }
        } catch (Throwable ignored) { }
        return null;
    }

    /** STOP pressed in the app: drop the plan and close the USSD dialog if we can. */
    public static void cancel(Context c) {
        UssdService self = instance;
        if (self == null) return;
        self.cancelRun();
    }

    private void cancelRun() {
        cancelled = true;
        handler.removeCallbacksAndMessages(null);
        Plan p = plan;
        Sink s = sink;
        plan = null;
        sink = null;
        Guard.end();
        try { performGlobalAction(GLOBAL_ACTION_BACK); } catch (Throwable ignored) { }
        if (s != null) s.finish(false, "cancelled by the operator — the USSD dialog was closed");
    }

    /** True when the accessibility path is the one currently holding the robot. */
    public static boolean busy() { return instance != null && instance.plan != null; }

    // ── dialog watching ──────────────────────────────────────────────────────

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (plan == null || sink == null || cancelled) return;
        CharSequence pkg = event.getPackageName();
        if (pkg != null && getPackageName().contentEquals(pkg)) return;   // ignore our own window
        int type = event.getEventType();
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                && type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
                && type != AccessibilityEvent.TYPE_WINDOWS_CHANGED) return;

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        consider(collect(root));
    }

    /**
     * One gate for every screen, whether it came from an event or a re-read.
     *
     * USSD dialogs re-announce themselves several times per second, and the same
     * screen can arrive with its words in a different order ("Carrier info · Enter
     * Reference:" vs "Enter Reference: · Carrier info"). Comparing the raw text made
     * the robot cancel its own pending key over and over — that is exactly why the
     * Reference prompt never got its "1". So screens are compared in a canonical
     * form (lowercase words, sorted), answered once, and never answered twice.
     */
    private void consider(final String raw) {
        if (plan == null || cancelled || raw == null || raw.isEmpty()) return;

        // 1) "USSD code running…" / "please wait" — the network is still working.
        if (Plan.isWaitingScreen(raw)) {
            lastProgressAt = System.currentTimeMillis();
            if (!raw.equals(lastScreen)) {
                lastScreen = raw;
                sink.log("⇦ " + raw + "   (waiting — nothing typed)");
            }
            return;
        }

        final String canon = Plan.canon(raw);
        if (answered.contains(canon)) return;        // already answered, never again

        // 2) A decision is already queued: it will re-read the live screen, so a
        //    re-worded duplicate must not cancel it.
        if (pendingTask != null) return;

        pendingTask = () -> {
            pendingTask = null;
            if (cancelled || plan == null) return;
            String now = collect(getRootInActiveWindow());
            if (now.isEmpty()) now = raw;
            String c2 = Plan.canon(now);
            if (answered.contains(c2)) return;
            answered.add(c2);
            lastScreen = now;
            lastProgressAt = System.currentTimeMillis();
            handle(now);
        };
        handler.postDelayed(pendingTask, 700);
    }

    /**
     * Nothing new for too long? Stop. This replaces the old "same screen N times"
     * counter, which fired while a key was still on its way to the box.
     */
    private void watch() {
        if (cancelled || plan == null) return;
        long idle = System.currentTimeMillis() - lastProgressAt;
        if (idle > STALL_MS) {
            finish(false, "nothing advanced for " + (idle / 1000) + "s — the last screen was: " + lastScreen);
            return;
        }
        handler.postDelayed(this::watch, 2500);
    }

    private void handle(String screen) {
        if (plan == null) return;
        sink.log("⇦ " + screen);

        // After the PIN the network shows a confirmation — nothing more to type.
        if (pinTyped) { finish(true, "PIN sent — confirmation screen/SMS should follow."); return; }

        if (++screens > 20) { finish(false, "20 screens seen — stopped so it cannot loop."); return; }
        if (UssdApiEngine.looksRejected(screen)) {
            finish(false, "Network said no: " + UssdApiEngine.firstLine(screen));
            return;
        }

        Plan.Key key = plan.decide(screen, idx);
        if (key == null) { finish(true, "Sequence finished — check the confirmation SMS."); return; }
        if (key.wait) { sink.log("… " + key.why); return; }
        if (key.stopBefore) {
            sink.log("⏸ DRY RUN: " + key.why);
            finish(true, "Dry run complete: the dialog path works right up to the PIN prompt.");
            return;
        }

        idx++;
        actions++;
        if (key.secret) pinTyped = true;
        // Timing follows the wallet that is answering, not the APK flavour: a Nagad
        // SIM inside the bKash build still needs the slower Nagad pace.
        final long gap = Math.max(1200, Provider.forText(screen).stepDelayMs);
        final long wait = Math.max(0, lastActionAt + gap - System.currentTimeMillis());
        sink.log("⇨ " + (key.secret ? "••••" : key.value) + "   · " + key.why);
        handler.postDelayed(() -> {
            if (cancelled || plan == null) return;
            lastActionAt = System.currentTimeMillis();
            typeVerified(key.value, 0);
        }, wait);
    }

    /**
     * Fill the reply box and only then press Send.
     *
     * Many phones report the field as empty for a few hundred milliseconds after
     * ACTION_SET_TEXT lands, which used to look like a failure and caused an extra
     * retry (and, before that, an empty Send → "Invalid account number"). So the text
     * is written, read back after a short pause, written again if it did not stick,
     * and only a field that really holds the value gets a Send.
     */
    private void typeVerified(final String value, final int attempt) {
        if (cancelled || plan == null) return;
        if (!writeField(value)) {
            if (attempt < 2) {
                sink.log("· reply box not ready, retry " + (attempt + 1) + "/2");
                handler.postDelayed(() -> typeVerified(value, attempt + 1), 700);
                return;
            }
            String onScreen = collect(getRootInActiveWindow());
            finish(false, "Could not find the USSD reply box. Screen was: "
                    + (onScreen.isEmpty() ? "(empty)" : onScreen)
                    + " — send me this line and I will adapt the reader to this phone.");
            return;
        }
        handler.postDelayed(() -> confirmLanded(value, attempt), 400);
    }

    private void confirmLanded(final String value, final int attempt) {
        if (cancelled || plan == null) return;
        String landed = currentFieldText();
        boolean ok = holds(landed, value);
        sink.log("  field now: \"" + (isSecretValue(value) ? mask(value) : landed) + "\"");
        if (ok) {
            clickSend();
            return;
        }
        if (attempt < 2) {
            sink.log("· the box did not keep the value, retry " + (attempt + 1) + "/2");
            typeVerified(value, attempt + 1);
            return;
        }
        String onScreen = collect(getRootInActiveWindow());
        finish(false, "the reply box never accepted the value — screen was: "
                + (onScreen.isEmpty() ? "(empty)" : onScreen));
    }

    /** Clearing first matters: a leftover character turns a good number into "Invalid". */
    private boolean writeField(final String value) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        AccessibilityNodeInfo field = find(root, this::isEditable);
        if (field == null) return false;

        Bundle clear = new Bundle();
        clear.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "");
        field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, clear);
        field.performAction(AccessibilityNodeInfo.ACTION_FOCUS);

        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value);
        boolean ok = field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        if (!ok) ok = field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        return ok;
    }

    private String currentFieldText() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return "";
        AccessibilityNodeInfo field = find(root, this::isEditable);
        if (field == null) return "";
        CharSequence t = field.getText();
        return t == null ? "" : t.toString();
    }

    /** A password field reports bullets, so length is the only thing to compare there. */
    private static boolean holds(String landed, String value) {
        if (landed == null) return false;
        if (landed.equals(value)) return true;
        String stripped = landed.replace("\u2022", "").replace("*", "").trim();
        return stripped.isEmpty() && landed.length() == value.length();
    }

    private boolean isSecretValue(String v) {
        return plan != null && plan.pin != null && plan.pin.equals(v);
    }

    private static String mask(String v) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < v.length(); i++) b.append('\u2022');
        return b.toString();
    }

    private void clickSend() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) { finish(false, "The dialog closed before Send was pressed."); return; }
        AccessibilityNodeInfo send = find(root, this::isSendButton);
        if (send != null && send.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return;
        AccessibilityNodeInfo any = find(root, n -> n.isClickable() && "android.widget.Button".contentEquals(n.getClassName()));
        if (any != null && any.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return;
        finish(false, "The input box was filled but this dialog has no Send button — send me a screenshot.");
    }

    // ── node helpers ─────────────────────────────────────────────────────────

    private interface Match { boolean ok(AccessibilityNodeInfo n); }

    private AccessibilityNodeInfo find(AccessibilityNodeInfo node, Match m) {
        if (node == null) return null;
        if (m.ok(node)) return node;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo hit = find(node.getChild(i), m);
            if (hit != null) return hit;
        }
        return null;
    }

    private boolean isEditable(AccessibilityNodeInfo n) {
        CharSequence cls = n.getClassName();
        if (cls == null) return false;
        String c = cls.toString();
        boolean box = c.contains("EditText") || c.contains("AutoComplete") || n.isEditable();
        return box && (n.isVisibleToUser() || n.isEnabled());
    }

    private boolean isSendButton(AccessibilityNodeInfo n) {
        CharSequence cls = n.getClassName();
        CharSequence txt = n.getText();
        if (cls == null || txt == null) return false;
        if (!cls.toString().contains("Button")) return false;
        String t = txt.toString().trim().toLowerCase();
        return t.equals("send") || t.equals("ok") || t.equals("okay") || t.equals("yes")
                || t.equals("confirm") || t.equals("reply") || t.equals("call") || t.equals("submit")
                || t.equals("done") || t.equals("next") || t.equals("enter")
                || t.contains("send") || t.contains("reply")
                || t.equals("পাঠান") || t.equals("হ্যাঁ") || t.equals("ঠিক আছে")
                || t.equals("রিপ্লাই") || t.equals("পাঠিয়ে দিন");
    }

    /** All visible text of the dialog, without the input box (so typing never fakes a new screen). */
    private String collect(AccessibilityNodeInfo node) {
        StringBuilder sb = new StringBuilder();
        walk(node, sb);
        return sb.toString().trim();
    }

    private void walk(AccessibilityNodeInfo node, StringBuilder sb) {
        if (node == null) return;
        if (isEditable(node)) return;
        CharSequence txt = node.getText();
        if (txt != null && txt.length() > 0) {
            String t = txt.toString().trim();
            if (!t.isEmpty()) {
                if (sb.length() > 0) sb.append(" · ");
                sb.append(t);
            }
        }
        for (int i = 0; i < node.getChildCount(); i++) walk(node.getChild(i), sb);
    }

    private void finish(boolean ok, String message) {
        if (cancelled && ok) ok = false;
        cancelled = false;
        plan = null;
        Sink s = sink;
        sink = null;
        Guard.end();
        if (s != null) s.finish(ok, message);
    }
}
