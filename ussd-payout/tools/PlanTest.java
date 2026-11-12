import com.boostpay.ussdpayout.Plan;
import com.boostpay.ussdpayout.SimPick;

/** Plain-JVM checks for the menu reader (no Android needed): javac + java. */
public class PlanTest {
    static int pass = 0, fail = 0;

    static void check(String name, boolean ok, String detail) {
        if (ok) { pass++; System.out.println("PASS " + name); }
        else { fail++; System.out.println("FAIL " + name + "  [" + detail + "]"); }
    }

    static Plan nagad(boolean dryRun, boolean adaptive) {
        return new Plan("*167#", "01712345678", "50", "1234", "1", "1,{number},{amount},{pin}", dryRun, adaptive);
    }

    static Plan bkash(boolean dryRun, boolean adaptive) {
        return new Plan("*247#", "01812345678", "50", "12345", "1", "1,{number},{amount},1,{pin}", dryRun, adaptive);
    }

    public static void main(String[] a) {
        // ── adaptive, Nagad menu wording ───────────────────────────────
        Plan p = nagad(false, true);
        Plan.Key k = p.decide("Enter the amount you want to send", 1);
        check("nagad adaptive: amount prompt -> amount", "50".equals(k.value) && !k.secret, String.valueOf(k.value));

        k = p.decide("Enter Nagad Account Number", 0);
        check("nagad adaptive: account prompt -> receiver", "01712345678".equals(k.value), String.valueOf(k.value));

        k = p.decide("Enter your PIN to confirm", 2);
        check("nagad adaptive: PIN prompt -> pin (secret)", "1234".equals(k.value) && k.secret, String.valueOf(k.value));

        k = p.decide("Reference (optional)", 2);
        check("nagad adaptive: reference prompt -> ref", "1".equals(k.value), String.valueOf(k.value));

        // ── Bangla menus ──────────────────────────────────────────────
        k = p.decide("আপনার পিন দিন", 2);
        check("bangla: পিন prompt -> pin", "1234".equals(k.value) && k.secret, String.valueOf(k.value));

        k = p.decide("টাকার পরিমাণ লিখুন", 1);
        check("bangla: পরিমাণ prompt -> amount", "50".equals(k.value), String.valueOf(k.value));

        k = p.decide("মোবাইল নম্বর দিন", 0);
        check("bangla: নম্বর prompt -> receiver", "01712345678".equals(k.value), String.valueOf(k.value));

        // ── DRY RUN must stop exactly at the PIN, both providers ──────
        k = nagad(true, true).decide("Enter your PIN", 2);
        check("nagad dry-run: stops before PIN", k.stopBefore && k.value == null, "stop=" + k.stopBefore);

        k = bkash(true, true).decide("Enter PIN (5 digits)", 3);
        check("bkash dry-run: stops before PIN", k.stopBefore, "stop=" + k.stopBefore);

        k = bkash(true, false).decide("anything", 4);   // index 4 is the {pin} step in the csv
        check("bkash dry-run (list mode): stops at {pin} step", k.stopBefore, "stop=" + k.stopBefore);

        // ── list mode types in order ──────────────────────────────────
        Plan b = bkash(false, false);
        check("list mode step 0 -> 1", "1".equals(b.decide("main menu", 0).value), b.decide("main menu", 0).value);
        check("list mode step 1 -> receiver", "01812345678".equals(b.decide("x", 1).value), b.decide("x", 1).value);
        check("list mode step 4 -> pin", "12345".equals(b.decide("x", 4).value) && b.decide("x", 4).secret, "pin");
        check("list mode past the end -> null", b.decide("x", 5) == null, "null");

        // ── unknown screen in adaptive mode falls back to the list ─────
        k = nagad(false, true).decide("Welcome to Nagad · 1 Send Money · 2 Cash Out", 0);
        check("adaptive: unrecognised screen -> wait, nothing typed (v1.5)", k != null && k.wait, String.valueOf(k == null ? null : k.value));

        // ── provider defaults ─────────────────────────────────────────
        Plan.DEFAULT_SERVICE = "*167#";
        Plan n2 = new Plan("", "01712345678", "50", "1234", "", "", false, true);
        check("empty service code -> *167# default", "*167#".equals(n2.serviceCode), n2.serviceCode);
        check("empty reference -> 1", "1".equals(n2.ref), n2.ref);

        // ── the owner's real Nagad main menu (log 2026-11-12 14:00) ────
        String nagadMenu = "Carrier info · Nagad · 1. Cash Out  2. Send Money  3. Mobile Recharge  "
                + "4. Payment  5. Bill Pay  6. EMI Payment  7. My Nagad  8. PIN Reset · Cancel · Send";
        check("menu: recognised as a menu", Plan.looksLikeMenu(nagadMenu.toLowerCase()), "menu");
        check("menu: PIN Reset does NOT look like a PIN prompt",
                Plan.menuOptionFor(nagadMenu.toLowerCase(), new String[]{"send money"}).equals("2"), "option");
        Plan.Key mk = nagad(false, true).decide(nagadMenu, 0);
        check("menu: dry run picks Send Money (2) instead of stopping", "2".equals(mk.value) && !mk.stopBefore,
                String.valueOf(mk.value) + " stop=" + mk.stopBefore);

        String nagadSub = "Send Money · 1. To Nagad Account  2. To Bank Account · Cancel · Send";
        check("submenu: picks 'To Nagad Account' (1)",
                "1".equals(nagad(false, true).decide(nagadSub, 1).value),
                String.valueOf(nagad(false, true).decide(nagadSub, 1).value));

        String pinPrompt = "Enter your Nagad PIN · Cancel · Send";
        Plan.Key pk = nagad(true, true).decide(pinPrompt, 3);
        check("dry run still stops at a real PIN prompt", pk.stopBefore, "stop=" + pk.stopBefore);
        check("live: real PIN prompt gets the PIN", "1234".equals(nagad(false, true).decide(pinPrompt, 3).value), "pin");

        check("change-PIN prompt is not treated as a payout PIN",
                !Plan.looksLikeMenu("change pin · enter new pin".toLowerCase()), "no menu");
        check("menu counter: 8 items", Plan.countNumberedItems(nagadMenu.toLowerCase()) >= 8,
                "" + Plan.countNumberedItems(nagadMenu.toLowerCase()));

        // ── waiting screens must never be typed into (log 14:09:57) ───
        check("waiting: 'USSD code running…'", Plan.isWaitingScreen("Initiated USSD session · USSD code running…"), "wait");
        check("waiting: 'Please wait'", Plan.isWaitingScreen("Please wait"), "wait");
        check("waiting: normal menu is not waiting", !Plan.isWaitingScreen(nagadMenu.toLowerCase()), "menu");
        check("waiting: receiver prompt is not waiting",
                !Plan.isWaitingScreen("Enter Receiver Account Number: · Cancel · Send"), "prompt");

        // ── repeated identical screen: the plan must not type again ───
        Plan p5 = nagad(false, true);
        Plan.Key first = p5.decide(nagadMenu.toLowerCase(), 0);
        Plan.Key again = p5.decide(nagadMenu.toLowerCase(), 1);   // index no longer matters
        check("menu: same screen always yields the same single key",
                "2".equals(first.value) && "2".equals(again.value), first.value + "/" + again.value);

        // ── invalid-number screen is a rejection, and it re-asks the number ─
        String invalid = "Carrier info · Invalid account number. Enter Receiver Account Number: · Cancel · Send";
        check("invalid number triggers the rejection check",
                Plan.looksRejected(invalid), "rejected");

        // ── unknown screen in adaptive mode waits instead of guessing ──
        Plan.Key unk = nagad(false, true).decide("Something new happened", 0);
        check("adaptive: unknown screen -> wait, nothing typed", unk != null && unk.wait, "wait=" + (unk != null && unk.wait));

        // ── which SIM sends a payout ──────────────────────────────────
        java.util.List<SimPick.Entry> two = java.util.Arrays.asList(
                new SimPick.Entry(11, 0, "bkash", "personal"),   // SIM 1 · bKash personal
                new SimPick.Entry(22, 1, "nagad", "agent"));     // SIM 2 · Nagad agent
        check("dual SIM: bkash goes out of SIM 1", SimPick.pick(two, "bkash") == 11, "" + SimPick.pick(two, "bkash"));
        check("dual SIM: nagad goes out of SIM 2", SimPick.pick(two, "nagad") == 22, "" + SimPick.pick(two, "nagad"));
        check("dual SIM: unknown provider -> -1 (never guess)", SimPick.pick(two, "rocket") == -1, "" + SimPick.pick(two, "rocket"));
        check("dual SIM: explicit selection wins", SimPick.pick(two, "bkash", 11) == 11, "" + SimPick.pick(two, "bkash", 11));
        check("dual SIM: selection for another wallet is refused", SimPick.pick(two, "bkash", 22) == -1, "" + SimPick.pick(two, "bkash", 22));

        java.util.List<SimPick.Entry> sameProvider = java.util.Arrays.asList(
                new SimPick.Entry(31, 0, "nagad", "agent"),
                new SimPick.Entry(32, 1, "nagad", "personal"));
        check("same provider twice: personal SIM preferred", SimPick.pick(sameProvider, "nagad") == 32, "" + SimPick.pick(sameProvider, "nagad"));

        check("single SIM not configured -> -1", SimPick.pick(java.util.Collections.singletonList(
                new SimPick.Entry(41, 0, "", "personal")), "bkash") == -1, "unset");
        check("empty SIM list -> -1", SimPick.pick(java.util.Collections.emptyList(), "bkash") == -1, "empty");
        check("describe: SIM 2 · Nagad · Agent", "SIM 2 · Nagad · Agent".equals(
                SimPick.describe(two.get(1), null)), SimPick.describe(two.get(1), null));

        System.out.println("\n" + pass + " pass / " + fail + " fail");
        if (fail > 0) System.exit(1);
    }
}
