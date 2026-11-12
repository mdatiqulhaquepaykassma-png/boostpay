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

        if (adaptive) {
            // A numbered menu is never a PIN prompt — even when one item is "PIN Reset"
            // (Nagad's main menu has exactly that) or "Change PIN".
            if (looksLikeMenu(l)) {
                String option = menuOptionFor(l, SEND_MENU_WORDS);
                if (option == null) option = menuOptionFor(l, SUBMENU_WORDS);
                if (option != null) return new Key(option, false, false, "menu: picked that option");
                return csvOrNull(csvIndex);
            }

            boolean asksPin = has(l, "pin", "পিন", "password", "পাসওয়ার্ড", "গোপন")
                    && !has(l, "pin reset", "reset pin", "change pin", "pin change",
                              "পিন রিসেট", "পিন পরিবর্তন", "পিন ভুলে");
            boolean asksAmount = has(l, "amount", "পরিমাণ", "টাকার পরিমাণ", "taka", "tk ");
            boolean asksRef = has(l, "reference", "রেফারেন্স", "remark");
            boolean asksNumber = has(l, "number", "নম্বর", "account", "একাউন্ট", "একাউন্টে", "mobile", "মোবাইল");

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

    // ── menu reading ─────────────────────────────────────────────────────────

    private static final String[] SEND_MENU_WORDS = {
            "send money", "sendmoney", "সেন্ড মানি", "সেন্ডমানি", "টাকা পাঠা", "পাঠান"
    };
    /** Sub-menus that ask where the money should go. */
    private static final String[] SUBMENU_WORDS = {
            "nagad account", "to nagad", "nagad number", "to account", "account number",
            "mobile number", "personal", "নগদ একাউন্ট", "একাউন্ট নম্বর", "মোবাইল নম্বর"
    };
    private static final String[] MENU_SIGNS = {
            "cash out", "send money", "mobile recharge", "recharge", "bill pay", "payment",
            "my nagad", "pin reset", "balance", "mini statement", "ক্যাশ আউট", "সেন্ড মানি"
    };

    /**
     * A USSD list looks like "1. Cash Out 2. Send Money 3. …" (the dialog joins its
     * lines with a separator, so count numbered items rather than lines).
     */
    public static boolean looksLikeMenu(String lower) {
        int numbered = countNumberedItems(lower);
        if (numbered >= 2) return true;
        int signs = 0;
        for (String w : MENU_SIGNS) if (lower.contains(w)) signs++;
        return signs >= 3;
    }

    public static int countNumberedItems(String lower) {
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("(?<![0-9])([1-9])\\s*[.)]\\s*(?=\\p{L})")
                .matcher(lower);
        int n = 0;
        while (m.find()) n++;
        return n;
    }

    /**
     * Finds the option number whose label matches one of the words, e.g. the screen
     * "1. Cash Out 2. Send Money …" answers "2" for SEND_MENU_WORDS.
     */
    public static String menuOptionFor(String lower, String[] words) {
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("(?<![0-9])([1-9])\\s*[.)]\\s*([^0-9]{0,40})")
                .matcher(lower);
        while (m.find()) {
            String label = m.group(2);
            for (String w : words) {
                if (label.contains(w)) return m.group(1);      // group 1 = the option number
            }
        }
        return null;
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
