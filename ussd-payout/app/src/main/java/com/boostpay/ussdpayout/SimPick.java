package com.boostpay.ussdpayout;

import java.util.List;

/**
 * Pure decision logic (no Android types, unit-tested on the JVM): which SIM should
 * send a given payout?
 *
 * Rules, in order:
 *   1. an explicitly selected SIM wins (the owner tapped "use this SIM");
 *   2. otherwise a SIM configured for that provider, personal account first when both
 *      SIMs carry the same provider (agent lines are for cash-in, not payouts);
 *   3. otherwise -1 — the caller must ask, never guess, because dialling a wallet
 *      payout from the wrong SIM is a real money mistake.
 */
public final class SimPick {

    public static final class Entry {
        public final int subId;
        public final int slot;
        public final String provider;   // "bkash" | "nagad" | ""
        public final String account;    // "personal" | "agent"

        public Entry(int subId, int slot, String provider, String account) {
            this.subId = subId;
            this.slot = slot;
            this.provider = provider == null ? "" : provider;
            this.account = account == null ? "personal" : account;
        }
    }

    private SimPick() {}

    public static int pick(List<Entry> entries, String provider) {
        return pick(entries, provider, -1);
    }

    /**
     * @param selectedSubId the SIM the owner picked in the UI, or -1
     * @return the subscription id to dial from, or -1 when nothing fits
     */
    public static int pick(List<Entry> entries, String provider, int selectedSubId) {
        if (entries == null || entries.isEmpty()) return -1;

        if (selectedSubId > 0) {
            for (Entry e : entries) {
                if (e.subId == selectedSubId) {
                    // the chosen SIM is only acceptable when it can actually do this provider
                    if (e.provider.isEmpty() || provider == null || provider.equals(e.provider)) return e.subId;
                    return -1;
                }
            }
            return -1;
        }

        int personal = -1, agent = -1;
        for (Entry e : entries) {
            if (provider == null || !provider.equals(e.provider)) continue;
            if ("agent".equals(e.account)) { if (agent < 0) agent = e.subId; }
            else if (personal < 0) personal = e.subId;
        }
        if (personal > 0) return personal;
        if (agent > 0) return agent;
        return -1;
    }

    /** Human line for the log: "SIM 2 · Nagad · Agent · 017…". */
    public static String describe(Entry e, String number) {
        String p = "bkash".equals(e.provider) ? "bKash" : "nagad".equals(e.provider) ? "Nagad" : "not set";
        return "SIM " + (e.slot + 1) + " · " + p + " · " + ("agent".equals(e.account) ? "Agent" : "Personal")
                + (number == null || number.isEmpty() ? "" : " · " + number);
    }
}
