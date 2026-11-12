import com.boostpay.ussdpayout.Plan;

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
        check("adaptive: unrecognised screen -> next list step", "1".equals(k.value), String.valueOf(k.value));

        // ── provider defaults ─────────────────────────────────────────
        Plan.DEFAULT_SERVICE = "*167#";
        Plan n2 = new Plan("", "01712345678", "50", "1234", "", "", false, true);
        check("empty service code -> *167# default", "*167#".equals(n2.serviceCode), n2.serviceCode);
        check("empty reference -> 1", "1".equals(n2.ref), n2.ref);

        System.out.println("\n" + pass + " pass / " + fail + " fail");
        if (fail > 0) System.exit(1);
    }
}
