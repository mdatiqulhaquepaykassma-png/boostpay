package com.boostpay.smsrelay;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.util.Log;

/**
 * Receives every incoming SMS and forwards it to the BoostPay server.
 *
 * All bKash / Nagad money messages are READ; the server decides whether the text
 * is a "money received" message and whether it matches a pending deposit. OTPs
 * and promos are dropped server-side and never credit anything.
 */
public class SmsReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        if (!android.provider.Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        if (!Relay.enabled(context)) return;

        Bundle bundle = intent.getExtras();
        if (bundle == null) return;

        Object[] pdus = (Object[]) bundle.get("pdus");
        String format = bundle.getString("format");
        if (pdus == null || pdus.length == 0) return;

        StringBuilder body = new StringBuilder();
        String sender = "";
        long receivedAt = System.currentTimeMillis();
        for (Object pdu : pdus) {
            try {
                SmsMessage msg = SmsMessage.createFromPdu((byte[]) pdu, format);
                if (msg == null) continue;
                if (sender.isEmpty() && msg.getOriginatingAddress() != null) {
                    sender = msg.getOriginatingAddress();
                }
                body.append(msg.getMessageBody() == null ? "" : msg.getMessageBody());
            } catch (Throwable t) {
                Log.w(Relay.TAG, "cannot read a pdu", t);
            }
        }
        final String text = body.toString().trim();
        if (text.isEmpty()) return;
        final String from = sender;
        final long at = receivedAt;

        // network on a worker thread — the main thread must never block here
        new Thread(() -> Relay.send(context.getApplicationContext(), from, text, at), "bp-sms-forward").start();
    }
}
