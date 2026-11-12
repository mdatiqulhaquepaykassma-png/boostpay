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
        // one fresh plan per case: a value is sent once and the plan remembers it
        check("nagad adaptive: amount prompt -> amount",
                "50".equals(nagad(false, true).decide("Enter the amount you want to send", 1).value), "amount");

        check("nagad adaptive: account prompt -> receiver",
                "01712345678".equals(nagad(false, true).decide("Enter Nagad Account Number", 0).value), "number");

        Plan.Key kp = nagad(false, true).decide("Enter your PIN to confirm", 2);
        check("nagad adaptive: PIN prompt -> pin (secret)", "1234".equals(kp.value) && kp.secret, String.valueOf(kp.value));

        check("nagad adaptive: 'Enter your PIN to confirm' is NOT a confirm screen",
                !Plan.looksLikeConfirm("enter your pin to confirm"), "not confirm");

        check("nagad adaptive: reference prompt -> ref",
                "1".equals(nagad(false, true).decide("Reference (optional)", 2).value), "ref");

        // ── Bangla menus ──────────────────────────────────────────────
        Plan.Key kb = nagad(false, true).decide("আপনার পিন দিন", 2);
        check("bangla: পিন prompt -> pin", "1234".equals(kb.value) && kb.secret, String.valueOf(kb.value));

        check("bangla: পরিমাণ prompt -> amount",
                "50".equals(nagad(false, true).decide("টাকার পরিমাণ লিখুন", 1).value), "amount");

        check("bangla: নম্বর prompt -> receiver",
                "01712345678".equals(nagad(false, true).decide("মোবাইল নম্বর দিন", 0).value), "number");

        // ── DRY RUN must stop exactly at the PIN, both providers ──────
        Plan.Key k = nagad(true, true).decide("Enter your PIN", 2);
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

        // ── the "shall I send it?" screen must get Confirm, never the amount ──
        String confirm1 = "Send Money to 01780240277. Amount Tk 100. 1. Confirm 2. Cancel";
        Plan pc = nagad(false, true);
        pc.numberSent = true; pc.amountSent = true;
        Plan.Key ck = pc.decide(confirm1.toLowerCase(), 2);
        check("confirm screen -> option 1 (Confirm), never the amount",
                "1".equals(ck.value) && !ck.secret, String.valueOf(ck.value) + " secret=" + ck.secret);

        // a summary line with no question never takes a value
        Plan ps = nagad(false, true);
        ps.numberSent = true; ps.amountSent = true;
        Plan.Key sk = ps.decide("send money to 01780240277 amount 100 taka", 2);
        check("summary screen (no 'enter') -> wait, nothing typed", sk != null && sk.wait, "wait=" + (sk != null && sk.wait));

        // ── amount is typed once, PIN is typed once ───────────────────
        Plan po = nagad(false, true);
        Plan.Key n1 = po.decide("enter receiver account number:", 0);
        Plan.Key a1 = po.decide("enter amount:", 1);
        Plan.Key a2 = po.decide("enter amount:", 2);      // same question again
        Plan.Key p1 = po.decide("enter pin:", 3);
        Plan.Key p2 = po.decide("enter your pin:", 4);    // re-asked
        check("number/amount/pin each typed exactly once",
                "01712345678".equals(n1.value) && "50".equals(a1.value)
                        && a2.wait && "1234".equals(p1.value) && p1.secret && p2.wait,
                n1.value + "/" + a1.value + "/a2wait=" + a2.wait + "/" + p1.value + "/p2wait=" + p2.wait);

        // ── the owner's live log: "Enter Reference:" must get 1 ───────
        Plan pr = nagad(false, true);
        pr.numberSent = true; pr.amountSent = true;
        Plan.Key rk = pr.decide("Carrier info · Enter Reference: · Cancel · Send", 3);
        check("reference prompt -> 1 (owner: reference number 1 hobe)",
                "1".equals(rk.value) && !rk.wait && !rk.stopBefore, String.valueOf(rk.value));

        Plan.Key rk2 = nagad(false, true).decide("Enter Reference", 3);
        check("reference prompt without a colon -> 1", "1".equals(rk2.value), String.valueOf(rk2.value));

        // the same dialog announced with its words in another order = one screen
        check("re-announced screen is the same screen (canonical form)",
                Plan.canon("Carrier info · Enter Reference: · Cancel · Send")
                        .equals(Plan.canon("Cancel · Send · Enter Reference: · Carrier info")), "canon");

        check("a different prompt is still a different screen",
                !Plan.canon("Enter Amount:").equals(Plan.canon("Enter Reference:")), "canon2");

        // the whole live path: menu -> number -> amount -> reference -> PIN
        Plan walk = nagad(false, true);
        String[][] script = {
                {"Carrier info · Nagad 1. Cash Out 2. Send Money 3. Mobile Recharge", "2"},
                {"Carrier info · Enter Receiver Account Number: · Cancel · Send", "01712345678"},
                {"Carrier info · Enter Amount: · Cancel · Send", "50"},
                {"Carrier info · Enter Reference: · Cancel · Send", "1"},
        };
        StringBuilder got = new StringBuilder();
        for (int i = 0; i < script.length; i++) {
            Plan.Key wk = walk.decide(script[i][0], i);
            got.append(wk == null ? "null" : String.valueOf(wk.value))
               .append(wk != null && wk.value != null && wk.value.equals(script[i][1]) ? "✓" : "✗");
        }
        Plan.Key pinK = walk.decide("Carrier info · Enter PIN: · Cancel · Send", 4);
        check("full nagad walk: 2 · number · amount · 1 · PIN", got.toString().equals("2✓01712345678✓50✓1✓")
                && "1234".equals(pinK.value) && pinK.secret, got + " pin=" + pinK.value);

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
