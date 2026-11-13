package com.boostpay.ussdpayout;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

/**
 * Keeps the payout queue alive on a real phone.
 *
 * Why this file exists: a foreground service alone is not enough on Android 12+.
 * MIUI / ColorOS / FuntouchOS / EMUI kill a background process even with the
 * battery setting on "Unrestricted", and Doze freezes it on every phone. So:
 *
 *   1. an exact-ish alarm every few minutes re-starts the service if it died,
 *   2. a BOOT receiver starts it again after a reboot or an app update,
 *   3. a watchdog inside the service restarts the polling thread if it stopped,
 *   4. the owner gets one button that opens the two screens that matter.
 */
final class KeepAlive {

    private KeepAlive() { }

    static final String ACTION_WAKE = "com.boostpay.ussdpayout.KEEPALIVE";
    private static final int REQ = 4211;
    /** 15 minutes is the smallest gap Android honours in Doze. */
    static final long EVERY_MS = 15 * 60 * 1000L;

    /** True when the owner pressed ▶ CONNECT at least once and never pressed DISCONNECT. */
    static boolean wanted(Context c) {
        return Runner.prefs(c).getBoolean("queueWanted", false);
    }

    static void setWanted(Context c, boolean on) {
        Runner.prefs(c).edit().putBoolean("queueWanted", on).apply();
        if (on) schedule(c); else cancel(c);
    }

    /** Arms the next wake-up (re-armed by every wake-up, so it survives reboots too). */
    static void schedule(Context c) {
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            PendingIntent pi = pending(c);
            long at = System.currentTimeMillis() + EVERY_MS;
            if (Build.VERSION.SDK_INT >= 23) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.set(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (Throwable ignored) { }
    }

    static void cancel(Context c) {
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.cancel(pending(c));
        } catch (Throwable ignored) { }
    }

    private static PendingIntent pending(Context c) {
        Intent i = new Intent(c, KeepAliveReceiver.class).setAction(ACTION_WAKE);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(c, REQ, i, flags);
    }

    /** Restarts the queue if the owner wants it and it is not running. */
    static void ensureRunning(Context c) {
        try {
            if (!wanted(c)) return;
            if (QueueService.isRunning()) { schedule(c); return; }
            String server = Queue.fixServer(Runner.prefs(c).getString("server", "")).url;
            String token = Runner.prefs(c).getString("token", "");
            if (server.isEmpty() || token.isEmpty()) return;
            QueueService.start(c);
            schedule(c);
        } catch (Throwable ignored) { }
    }

    /** Battery optimisation off for this app? (The first of the two OEM screens.) */
    static boolean batteryUnrestricted(Context c) {
        try {
            PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName());
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * The vendor screens that actually matter on Chinese ROMs. Each entry is tried in
     * turn; whatever the phone supports opens, the rest are skipped silently.
     */
    static final String[][] OEM_AUTOSTART = {
            {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
            {"com.letv.android.letvsafe", "com.letv.android.letvsafe.AutobootManageActivity"},
            {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
            {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
            {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
            {"com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"},
            {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
            {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
            {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"},
            {"com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"},
            {"com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"},
            {"com.asus.mobilemanager", "com.asus.mobilemanager.entry.FunctionActivity"},
    };
}
