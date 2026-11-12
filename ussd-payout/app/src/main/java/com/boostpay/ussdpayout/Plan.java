package com.boostpay.ussdpayout;

/**
 * One payout, rendered from the settings screen.
 *
 * Two ways to answer a menu:
 *   · ADAPTIVE (default) — the screen text is read and the right value is chosen:
 *     a prompt that asks for the amount gets the amount, a prompt that asks for the
 *     PIN gets the PIN, and a prompt that asks for the PIN is also where a DRY RUN
 *     stops. Works when the operator renumbers or rewording its menu.
 *   · STEPS — the comma list is typed in order, with {number} {amount} {ref} {pin}
 *     substituted. Use it when the screen text is too terse for the reader.
 *
 * Nothing about a provider's menu is compiled in: the defaults come from
 * {@link Provider} and the owner can edit the steps on the phone.
 */
public final class Plan {

    /** Used when the service-code field is left empty; the activity sets it per flavour. */
    public static String DEFAULT_SERVICE = "*167#";

    public final String serviceCode;
    public final String number;
    public final String amount;
    public final String pin;
    public final String ref;
    public final boolean dryRun;
    public final boolean adaptive;
    public final String[] steps;
    /** index of the first CSV step that carries the PIN (-1 = none) */
    public final int pinStep;

    public Plan(String serviceCode, String number, String amount, String pin, String ref,
                String stepsCsv, boolean dryRun, boolean adaptive) {
        this.serviceCode = blank(serviceCode) ? DEFAULT_SERVICE : serviceCode.trim();
        this.number = number == null ? "" : number.trim();
        this.amount = amount == null ? "" : amount.trim();
        this.pin = pin == null ? "" : pin.trim();
        this.ref = blank(ref) ? "1" : ref.trim();
        this.dryRun = dryRun;
        this.adaptive = adaptive;

        String[] raw = (stepsCsv == null ? "" : stepsCsv).split(",");
        java.util.List<String> out = new java.util.ArrayList<>();
        int pinIdx = -1;
        for (String s : raw) {
            String t = s.trim();
            if (t.isEmpty()) continue;
            if (t.contains("{pin}") && pinIdx < 0) pinIdx = out.size();
            out.add(t.replace("{number}", this.number)
                    .replace("{amount}", this.amount)
                    .replace("{ref}", this.ref)
                    .replace("{pin}", this.pin));
        }
        this.steps = out.toArray(new String[0]);
        this.pinStep = pinIdx;
    }

    /** What to type next, given what the menu is asking. */
    public static final class Key {
        public final String value;
        public final boolean secret;
        public final boolean stopBefore;
        public final String why;

        Key(String value, boolean secret, boolean stopBefore, String why) {
            this.value = value;
            this.secret = secret;
            this.stopBefore = stopBefore;
            this.why = why;
        }

        public static Key stop(String why) { return new Key(null, false, true, why); }
    }

    public Key decide(String screen, int csvIndex) {
        String l = screen == null ? "" : screen.toLowerCase();
        boolean asksPin = has(l, "pin", "পিন", "password", "পাসওয়ার্ড", "গোপন");
        boolean asksAmount = has(l, "amount", "পরিমাণ", "টাকার পরিমাণ", "taka", "tk ");
        boolean asksRef = has(l, "reference", "রেফারেন্স");
        boolean asksNumber = has(l, "number", "নম্বর", "account", "একাউন্ট", "একাউন্টে", "mobile", "মোবাইল");

        if (adaptive) {
            if (asksPin) {
                if (dryRun) return Key.stop("this screen asks for the PIN — a dry run stops here, nothing is sent");
                return new Key(pin, true, false, "PIN prompt");
            }
            if (asksAmount) return new Key(amount, false, false, "amount prompt");
            if (asksNumber) return new Key(number, false, false, "receiver prompt");
            if (asksRef) return new Key(ref, false, false, "reference prompt");
            return csvOrNull(csvIndex);           // screen text not recognised → fall back to the list
        }

        // fixed list mode
        String next = csvIndex >= 0 && csvIndex < steps.length ? steps[csvIndex] : null;
        if (next == null) return null;
        boolean secret = pinStep >= 0 && csvIndex == pinStep;
        if (secret && dryRun) return Key.stop("the next list step is the PIN — a dry run stops here, nothing is sent");
        return new Key(next, secret, false, secret ? "PIN step" : "list step " + (csvIndex + 1));
    }

    private Key csvOrNull(int i) {
        if (i < 0 || i >= steps.length) return null;
        boolean secret = pinStep >= 0 && i == pinStep;
        if (secret && dryRun) return Key.stop("the next list step is the PIN — a dry run stops here, nothing is sent");
        return new Key(steps[i], secret, false, "fallback step " + (i + 1));
    }

    private static boolean has(String haystack, String... needles) {
        for (String n : needles) if (haystack.contains(n)) return true;
        return false;
    }

    private static boolean blank(String s) { return s == null || s.trim().isEmpty(); }
}
