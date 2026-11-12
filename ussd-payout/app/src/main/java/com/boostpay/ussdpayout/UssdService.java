package com.boostpay.ussdpayout;

import android.accessibilityservice.AccessibilityService;
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
        s.log("▶ mode: Accessibility · " + (p.dryRun ? "DRY RUN (no PIN, no money)" : "LIVE"));
        try {
            Intent call = new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + Uri.encode(p.serviceCode)));
            call.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(call);
            return true;
        } catch (Throwable t) {
            self.finish(false, "Could not dial " + p.serviceCode + ": " + t.getMessage());
            return false;
        }
    }

    // ── dialog watching ──────────────────────────────────────────────────────

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (plan == null || sink == null) return;
        CharSequence pkg = event.getPackageName();
        if (pkg != null && getPackageName().contentEquals(pkg)) return;   // ignore our own window
        int type = event.getEventType();
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                && type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return;

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        String screen = collect(root);
        if (screen.isEmpty() || screen.equals(lastScreen)) return;
        lastScreen = screen;
        final String captured = screen;
        handler.postDelayed(() -> handle(captured), 550);   // let the dialog finish drawing
    }

    private void handle(String screen) {
        if (plan == null) return;
        if (++screens > 16) { finish(false, "16 screens seen — stopped so it cannot loop."); return; }
        sink.log("⇦ " + screen);
        if (UssdApiEngine.looksRejected(screen)) {
            finish(false, "Network said no: " + UssdApiEngine.firstLine(screen));
            return;
        }
        Plan.Key key = plan.decide(screen, idx);
        if (key == null) { finish(true, "Sequence finished — check the confirmation SMS."); return; }
        if (key.stopBefore) {
            sink.log("⏸ DRY RUN: " + key.why);
            finish(true, "Dry run complete: the dialog path works right up to the PIN prompt.");
            return;
        }
        idx++;
        sink.log("⇨ " + (key.secret ? "••••" : key.value) + "   · " + key.why);
        handler.postDelayed(() -> {
            if (!type(key.value)) {
                finish(false, "Could not find the USSD input box in this dialog. Take a screenshot of it and send it over — "
                        + "I will adapt the reader to this phone.");
            }
        }, Provider.current().stepDelayMs);
    }

    private boolean type(final String value) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        AccessibilityNodeInfo field = find(root, this::isEditable);
        if (field == null) return false;
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value);
        boolean ok = field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        if (!ok) {
            field.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
            ok = field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        }
        if (!ok) return false;
        handler.postDelayed(this::clickSend, 800);
        return true;
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
        return cls != null && cls.toString().contains("EditText") && n.isVisibleToUser();
    }

    private boolean isSendButton(AccessibilityNodeInfo n) {
        CharSequence cls = n.getClassName();
        CharSequence txt = n.getText();
        if (cls == null || txt == null) return false;
        if (!cls.toString().contains("Button")) return false;
        String t = txt.toString().trim().toLowerCase();
        return t.equals("send") || t.equals("ok") || t.equals("okay") || t.equals("yes")
                || t.equals("confirm") || t.equals("পাঠান") || t.equals("হ্যাঁ") || t.equals("ঠিক আছে");
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
        plan = null;
        Sink s = sink;
        sink = null;
        Guard.end();
        if (s != null) s.finish(ok, message);
    }
}
