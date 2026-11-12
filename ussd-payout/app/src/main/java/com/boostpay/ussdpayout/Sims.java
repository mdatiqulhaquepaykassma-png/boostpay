package com.boostpay.ussdpayout;

import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;

import java.util.ArrayList;
import java.util.List;

/**
 * The two SIM slots of the phone, as the payout robot sees them.
 *
 * A dual-SIM phone usually has bKash on one SIM and Nagad on the other, so the SIM
 * (not the app) is what decides which wallet a payout leaves from. The list below is
 * only discovery — what each SIM is used for lives in {@link SimStore}.
 */
public final class Sims {

    public static final class Sim {
        public final int subId;        // subscription id — what the OS uses to route USSD
        public final int slot;         // 0 = SIM 1, 1 = SIM 2
        public final String carrier;   // "Grameenphone", "Robi", …
        public final String number;    // often empty: operators hide it from the OS
        public final String label;     // "SIM 1 · Grameenphone"

        Sim(int subId, int slot, String carrier, String number, String label) {
            this.subId = subId;
            this.slot = slot;
            this.carrier = carrier;
            this.number = number;
            this.label = label;
        }
    }

    private Sims() {}

    public static boolean canRead(Context c) {
        if (Build.VERSION.SDK_INT < 22) return false;
        return c.checkSelfPermission(android.Manifest.permission.READ_PHONE_STATE)
                == PackageManager.PERMISSION_GRANTED;
    }

    public static List<Sim> list(Context c) {
        List<Sim> out = new ArrayList<>();
        if (Build.VERSION.SDK_INT < 22 || !canRead(c)) return out;
        try {
            SubscriptionManager sm = (SubscriptionManager) c.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
            if (sm == null) return out;
            List<SubscriptionInfo> infos = sm.getActiveSubscriptionInfoList();
            if (infos == null) return out;
            for (SubscriptionInfo i : infos) {
                String carrier = i.getCarrierName() == null ? "SIM" : i.getCarrierName().toString();
                String number = i.getNumber() == null ? "" : i.getNumber();
                int slot = i.getSimSlotIndex();
                out.add(new Sim(i.getSubscriptionId(), slot, carrier, number,
                        "SIM " + (slot + 1) + " · " + carrier));
            }
        } catch (Throwable ignored) { }
        // stable order: slot 1 first
        out.sort((a, b) -> Integer.compare(a.slot, b.slot));
        return out;
    }

    public static Sim bySubId(List<Sim> sims, int subId) {
        for (Sim s : sims) if (s.subId == subId) return s;
        return null;
    }
}
