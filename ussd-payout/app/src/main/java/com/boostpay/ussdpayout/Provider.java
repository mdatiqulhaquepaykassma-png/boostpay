package com.boostpay.ussdpayout;

/**
 * The two operators this robot knows about. The build flavour decides which one is
 * the default (see app/build.gradle), and everything stays editable on the phone —
 * so a menu change never needs a new APK.
 */
public final class Provider {

    public final String id;
    public final String name;
    public final String serviceCode;
    public final String steps;
    public final int pinLength;
    public final String accent;
    /** USSD sessions on some operators drop if keys are sent too fast. */
    public final int stepDelayMs;

    private Provider(String id, String name, String serviceCode, String steps,
                     int pinLength, String accent, int stepDelayMs) {
        this.id = id;
        this.name = name;
        this.serviceCode = serviceCode;
        this.steps = steps;
        this.pinLength = pinLength;
        this.accent = accent;
        this.stepDelayMs = stepDelayMs;
    }

    private static final Provider BKASH = new Provider(
            "bkash", "bKash", "*247#",
            "1,{number},{amount},1,{pin}",     // 1 Send Money · number · amount · 1 reference · PIN
            5, "#f59e0b", 900);

    private static final Provider NAGAD = new Provider(
            "nagad", "Nagad", "*167#",
            "2,{number},{amount},{pin}",       // 2 Send Money · number · amount · PIN (owner-verified menu)
            4, "#e11d48", 1600);

    /** The flavour this APK was built for. */
    public static Provider current() {
        try {
            String p = BuildConfig.PROVIDER;
            return "nagad".equalsIgnoreCase(p) ? NAGAD : BKASH;
        } catch (Throwable t) {
            return NAGAD;
        }
    }

    /** The wallet a SIM is configured for ("bkash" / "nagad"), or the build default. */
    public static Provider byId(String id) {
        if ("nagad".equalsIgnoreCase(id)) return NAGAD;
        if ("bkash".equalsIgnoreCase(id)) return BKASH;
        return current();
    }

    /**
     * The wallet a USSD screen belongs to — "Carrier info · Nagad …" is enough. Used
     * for key timing, so a Nagad SIM in the bKash build still waits Nagad's 1.6 s.
     */
    public static Provider forText(String screen) {
        String l = screen == null ? "" : screen.toLowerCase();
        if (l.contains("nagad")) return NAGAD;
        if (l.contains("bkash")) return BKASH;
        return current();
    }

    public static Provider other(Provider p) {
        return "nagad".equals(p.id) ? BKASH : NAGAD;
    }
}
