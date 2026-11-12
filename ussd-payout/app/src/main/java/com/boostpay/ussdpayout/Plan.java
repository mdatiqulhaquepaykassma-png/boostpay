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

    // ── per-run memory: a value is sent once and never repeated ──────────────
    public boolean numberSent;
    public boolean amountSent;
    public boolean pinSent;

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
        public final boolean wait;        // screen seen, but nothing safe to type
        public final String why;

        Key(String value, boolean secret, boolean stopBefore, boolean wait, String why) {
            this.value = value;
            this.secret = secret;
            this.stopBefore = stopBefore;
            this.wait = wait;
            this.why = why;
        }

        public static Key stop(String why) { return new Key(null, false, true, false, why); }

        public static Key wait(String why) { return new Key(null, false, false, true, why); }
    }

    /** "Invalid PIN" / "Sorry, failed" — the network refused the last key. */
    public static boolean looksRejected(String screen) {
        String l = screen == null ? "" : screen.toLowerCase();
        return l.contains("invalid") || l.contains("wrong") || l.contains("failed")
                || l.contains("sorry") || l.contains("insufficient") || l.contains("not enough")
                || l.contains("denied") || l.contains("ভুল") || l.contains("ব্যর্থ");
    }

    /** The robot must not type into these — the network is still working. */
    public static boolean isWaitingScreen(String screen) {
        String l = screen == null ? "" : screen.toLowerCase();
        return l.contains("ussd code running") || l.contains("initiated ussd")
                || l.contains("please wait") || l.contains("requesting")
                || l.contains("processing") || l.contains("sending your")
                || l.contains("loading") || l.contains("do not close")
                || l.contains("অপেক্ষা") || l.contains("প্রক্রিয়া চলছে");
    }

    public Key decide(String screen, int csvIndex) {
        String l = screen == null ? "" : screen.toLowerCase();

        if (adaptive) {
            // (a) The "Send money to 01X… amount 100? 1. Confirm 2. Cancel" screen.
            //     It mentions the amount and the number, so a keyword reader would
            //     re-type the amount here and the network refuses it. Answer the
            //     confirm option instead — never a money value.
            if (looksLikeConfirm(l)) {
                String opt = menuOptionFor(l, CONFIRM_WORDS);
                if (opt != null) return new Key(opt, false, false, false, "confirm screen: option " + opt + " = Confirm");
                if (looksLikeMenu(l)) return Key.wait("confirm screen but I cannot read its options — waiting");
                return new Key("1", false, false, false, "confirm screen: 1 = Confirm");
            }

            // A numbered menu is never a PIN prompt — even when one item is "PIN Reset"
            // (Nagad's main menu has exactly that) or "Change PIN".
            if (looksLikeMenu(l)) {
                String option = menuOptionFor(l, SEND_MENU_WORDS);
                if (option == null) option = menuOptionFor(l, SUBMENU_WORDS);
                if (option != null) return new Key(option, false, false, false, "menu: picked that option");
                return Key.wait("menu seen but no Send Money option matched — waiting");
            }

            boolean asksPin = has(l, "pin", "পিন", "password", "পাসওয়ার্ড", "গোপন")
                    && !has(l, "pin reset", "reset pin", "change pin", "pin change",
                              "পিন রিসেট", "পিন পরিবর্তন", "পিন ভুলে");
            boolean asksAmount = has(l, "amount", "পরিমাণ", "টাকার পরিমাণ");
            boolean asksRef = has(l, "reference", "রেফারেন্স", "remark");
            boolean asksNumber = has(l, "number", "নম্বর", "account", "একাউন্ট", "একাউন্টে", "mobile", "মোবাইল");
            // Only a real question accepts input: "Enter…", "Type…", "লিখুন", "দিন".
            // A summary screen that merely prints "Amount 100" must never be typed into.
            boolean question = isQuestion(l);

            if (asksPin) {
                if (pinSent) return Key.wait("PIN already sent — waiting for the confirmation");
                if (!question) return Key.wait("screen mentions PIN but is not asking for it — waiting");
                if (dryRun) return Key.stop("this screen asks for the PIN — a dry run stops here, nothing is sent");
                pinSent = true;
                return new Key(pin, true, false, false, "PIN prompt");
            }
            if (asksAmount) {
                if (amountSent) return Key.wait("amount already sent — waiting for the next screen");
                if (!question) return Key.wait("screen shows the amount but is not asking for it — waiting");
                amountSent = true;
                return new Key(amount, false, false, false, "amount prompt");
            }
            if (asksNumber) {
                if (numberSent) return Key.wait("receiver number already sent — waiting for the next screen");
                if (!question) return Key.wait("screen mentions a number but is not asking for it — waiting");
                numberSent = true;
                return new Key(number, false, false, false, "receiver prompt");
            }
            if (asksRef) return new Key(ref, false, false, false, "reference prompt");
            // Not recognised: wait for the next screen instead of typing a guess.
            return Key.wait("this screen is not recognised — waiting (no keys typed)");
        }

        // fixed list mode
        String next = csvIndex >= 0 && csvIndex < steps.length ? steps[csvIndex] : null;
        if (next == null) return null;
        boolean secret = pinStep >= 0 && csvIndex == pinStep;
        if (secret && dryRun) return Key.stop("the next list step is the PIN — a dry run stops here, nothing is sent");
        return new Key(next, secret, false, false, secret ? "PIN step" : "list step " + (csvIndex + 1));
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
    /** Options that carry a "yes, do it" meaning. */
    private static final String[] CONFIRM_WORDS = {
            "confirm", "proceed", "yes", "ok", "continue", "submit",
            "নিশ্চিত", "হ্যাঁ", "সম্মত", "চালিয়ে"
    };
    /** Screens that ask "shall I send it?" — they take the confirm option, never a value. */
    public static boolean looksLikeConfirm(String lower) {
        if (lower == null) return false;
        // "Enter your PIN to confirm" is a PIN prompt, not a confirmation.
        if (isQuestion(lower)) return false;
        if (has(lower, "are you sure", "do you want to", "please confirm",
                     "নিশ্চিত করুন", "আপনি কি")) return true;
        // "1. Confirm 2. Cancel" — a menu whose only real option is Confirm.
        String opt = menuOptionFor(lower, CONFIRM_WORDS);
        if (opt == null) return false;
        // The main menu always carries several unrelated services — a confirmation does not.
        return looksLikeMenu(lower) && has(lower, "cancel")
                && !has(lower, "cash out", "pin reset", "mobile recharge", "bill pay",
                            "my nagad", "ক্যাশ আউট", "পিন রিসেট", "মোবাইল রিচার্জ");
    }

    /** Does the screen actually ask for input (rather than just printing a summary)? */
    public static boolean isQuestion(String lower) {
        return has(lower, "enter", "type", "input", "provide", "give",
                        "লিখুন", "দিন", "প্রদান", "ইনপুট");
    }

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
        return new Key(steps[i], secret, false, false, "fallback step " + (i + 1));
    }

    private static boolean has(String haystack, String... needles) {
        for (String n : needles) if (haystack.contains(n)) return true;
        return false;
    }

    private static boolean blank(String s) { return s == null || s.trim().isEmpty(); }
}
