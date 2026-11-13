package com.boostpay.ussdpayout;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Wakes up every ~15 minutes (and after a reboot / app update) and makes sure the
 * payout queue is still asking the panel for jobs.
 *
 * Android is allowed to kill a background process at any time; this receiver is the
 * net that brings it back without the owner touching the phone.
 */
public class KeepAliveReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            String action = intent == null ? "" : String.valueOf(intent.getAction());
            boolean boot = Intent.ACTION_BOOT_COMPLETED.equals(action)
                    || "android.intent.action.QUICKBOOT_POWERON".equals(action)
                    || "android.intent.action.LOCKED_BOOT_COMPLETED".equals(action)
                    || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action);
            if (boot && KeepAlive.wanted(context)) {
                // give the system a moment after a boot before becoming a foreground service
                new android.os.Handler(android.os.Looper.getMainLooper())
                        .postDelayed(() -> KeepAlive.ensureRunning(context), 8000);
            } else {
                KeepAlive.ensureRunning(context);
            }
            KeepAlive.schedule(context);
        } catch (Throwable ignored) { }
    }
}
