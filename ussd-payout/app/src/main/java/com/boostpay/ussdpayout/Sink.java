package com.boostpay.ussdpayout;

/** Where a run reports what it saw and how it ended. */
public interface Sink {
    void log(String line);

    void finish(boolean ok, String summary);

    /** The wallet's transaction id, as soon as the confirmation screen shows it. */
    default void trx(String trxId) { }
}
