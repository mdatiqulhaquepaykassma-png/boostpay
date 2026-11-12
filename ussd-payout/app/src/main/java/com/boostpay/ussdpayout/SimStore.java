package com.boostpay.ussdpayout;

import android.content.Context;

/**
 * What each SIM is for. Stored per subscription id, so moving a SIM to the other slot
 * (or swapping SIMs) keeps its settings attached to the SIM, not to the slot.
 *
 *   SIM 1 · Grameenphone → bKash   · personal · 01711… · own PIN
 *   SIM 2 · Robi          → Nagad   · agent    → own PIN
 */
public final class SimStore {

    private static final String PREFS = "bp_sims";

    public static final class Cfg {
        public int subId;
        public String provider = "";     // "bkash" | "nagad" | "" (not set)
        public String account = "personal"; // "personal" | "agent"
        public String number = "";       // the SIM's own wallet number
        public String service = "";      // empty → provider default
        public String steps = "";        // empty → provider default
        public String ref = "1";

        public boolean configured() { return !provider.isEmpty(); }

        public String providerName() {
            if ("bkash".equals(provider)) return "bKash";
            if ("nagad".equals(provider)) return "Nagad";
            return "—";
        }

        public String accountName() { return "agent".equals(account) ? "Agent" : "Personal"; }
    }

    private SimStore() {}

    public static Cfg get(Context c, int subId) {
        android.content.SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Cfg cfg = new Cfg();
        cfg.subId = subId;
        cfg.provider = p.getString(k(subId, "provider"), "");
        cfg.account = p.getString(k(subId, "account"), "personal");
        cfg.number = p.getString(k(subId, "number"), "");
        cfg.service = p.getString(k(subId, "service"), "");
        cfg.steps = p.getString(k(subId, "steps"), "");
        cfg.ref = p.getString(k(subId, "ref"), "1");
        return cfg;
    }

    public static void save(Context c, Cfg cfg) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(k(cfg.subId, "provider"), cfg.provider)
                .putString(k(cfg.subId, "account"), cfg.account)
                .putString(k(cfg.subId, "number"), cfg.number)
                .putString(k(cfg.subId, "service"), cfg.service)
                .putString(k(cfg.subId, "steps"), cfg.steps)
                .putString(k(cfg.subId, "ref"), cfg.ref)
                .apply();
    }

    /** PIN is sealed per SIM — bKash and Nagad PINs never overwrite each other. */
    public static void savePin(Context c, int subId, String pin) { Secure.savePin(c, "pin_" + subId, pin); }

    public static String pin(Context c, int subId) { return Secure.readPin(c, "pin_" + subId); }

    public static boolean hasPin(Context c, int subId) { return !pin(c, subId).isEmpty(); }

    /** The SIM the next payout should leave from (-1 = none selected). */
    public static int selected(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("selected", -1);
    }

    public static void setSelected(Context c, int subId) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt("selected", subId).apply();
    }

    /**
     * The SIM that carries a given provider, if the owner has set one up.
     * Used to answer "which SIM sends this bKash payout?" without asking every time.
     */
    public static int subIdFor(Context c, java.util.List<Sims.Sim> sims, String provider) {
        for (Sims.Sim s : sims) {
            Cfg cfg = get(c, s.subId);
            if (cfg.configured() && provider.equals(cfg.provider)) return s.subId;
        }
        return -1;
    }

    private static String k(int subId, String field) { return "sub" + subId + "_" + field; }
}
