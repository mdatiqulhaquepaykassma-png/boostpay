package com.boostpay.smsrelay;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a reboot, just report that the relay is alive (the SMS receiver is manifest-registered). */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Relay.enabled(context)) return;
        Relay.prefs(context).edit()
                .putString(Relay.KEY_LAST_STATUS, "ready after reboot")
                .apply();
    }
}
