package com.boostpay.ussdpayout;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Hard safety rails for a money-sending USSD robot. The point is that a bug can
 * never drain the wallet: one payout at a time, a per-transaction ceiling, a
 * daily ceiling, and a cooldown between runs.
 */
public final class Guard {

    private static final String PREFS = "bp_guard";

    public static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static long maxPerTx(Context c) {
        return prefs(c).getLong("maxPerTx", 500);      // BDT
    }

    public static long dailyCap(Context c) {
        return prefs(c).getLong("dailyCap", 3000);     // BDT
    }

    public static int cooldownSec(Context c) {
        return prefs(c).getInt("cooldownSec", 15);
    }

    public static void setLimits(Context c, long maxPerTx, long dailyCap, int cooldownSec) {
        prefs(c).edit()
                .putLong("maxPerTx", maxPerTx)
                .putLong("dailyCap", dailyCap)
                .putInt("cooldownSec", cooldownSec)
                .apply();
    }

    /** BDT already sent today (successful runs only). */
    public static long sentToday(Context c) {
        SharedPreferences p = prefs(c);
        long day = System.currentTimeMillis() / 86_400_000L;
        if (p.getLong("day", -1) != day) return 0;
        return p.getLong("sentToday", 0);
    }

    public static void recordSend(Context c, long amount) {
        SharedPreferences p = prefs(c);
        long day = System.currentTimeMillis() / 86_400_000L;
        long base = p.getLong("day", -1) == day ? p.getLong("sentToday", 0) : 0;
        p.edit().putLong("day", day).putLong("sentToday", base + amount)
                .putLong("lastRunAt", System.currentTimeMillis())
                .putInt("runs", p.getInt("runs", 0) + 1)
                .apply();
    }

    public static long lastRunAt(Context c) {
        return prefs(c).getLong("lastRunAt", 0);
    }

    /**
     * @return null when the run may proceed, otherwise the reason it must not.
     */
    public static String check(Context c, long amount, boolean live) {
        if (!live) return null;
        if (amount <= 0) return "Amount must be more than 0.";
        if (amount < 10) return "Minimum 10 BDT — smaller amounts are not worth a test.";
        if (amount > maxPerTx(c)) return "Amount " + amount + " is over the per-payout limit (" + maxPerTx(c) + " BDT).";
        if (sentToday(c) + amount > dailyCap(c)) return "Daily cap reached: already sent " + sentToday(c) + " of " + dailyCap(c) + " BDT today.";
        long wait = cooldownSec(c) * 1000L - (System.currentTimeMillis() - lastRunAt(c));
        if (wait > 0) return "Cooldown: wait " + (wait / 1000 + 1) + "s before the next run.";
        return null;
    }

    /** One robot at a time — a second tap must never start a parallel session. */
    private static volatile boolean running = false;
    private static volatile long startedAt = 0;

    /** A run that never reported back must not block the app forever. */
    private static final long STALE_AFTER_MS = 120_000;

    public static boolean begin() {
        synchronized (Guard.class) {
            if (running && !stale()) return false;
            running = true;
            startedAt = System.currentTimeMillis();
            return true;
        }
    }

    public static void end() {
        synchronized (Guard.class) { running = false; startedAt = 0; }
    }

    public static boolean isRunning() { return running; }

    /** True when a run has been "in progress" for over two minutes — i.e. it is dead. */
    public static boolean stale() {
        return running && startedAt > 0 && System.currentTimeMillis() - startedAt > STALE_AFTER_MS;
    }

    public static long runningForMs() {
        return running && startedAt > 0 ? System.currentTimeMillis() - startedAt : 0;
    }

    /** Emergency release used by the STOP button. */
    public static void forceEnd() { end(); }
}
