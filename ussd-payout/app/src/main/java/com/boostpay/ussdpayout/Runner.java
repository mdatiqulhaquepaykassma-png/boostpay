package com.boostpay.ussdpayout;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Builds a {@link Plan} from what is saved on the phone — no Activity needed.
 *
 * Both ways of sending a payout use it: pressing DRY RUN / SEND in the app, and the
 * server-queue service that sends jobs while the screen is off. One place decides
 * which SIM dials, which wallet the PIN belongs to, and how the steps read.
 */
final class Runner {

    private static final String PREFS = "bp_settings";

    static final class Setup {
        int subId;
        String simLabel = "default SIM";
        String wallet = "";
        Plan plan;
        String error = "";          // filled when the setup is not usable
        boolean ok() { return plan != null && error.isEmpty(); }
    }

    private Runner() { }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * @param providerHint "nagad"/"bkash" from the job ('' = whatever the SIM is for)
     */
    static Setup build(Context c, String providerHint, String number, String amount, String ref,
                       boolean dryRun, boolean adaptive) {
        Setup out = new Setup();
        SharedPreferences p = prefs(c);

        // ── which SIM dials ───────────────────────────────────────────────
        java.util.List<Sims.Sim> sims = Sims.list(c);
        int subId = SimStore.selected(c);
        Sims.Sim sim = Sims.bySubId(sims, subId);
        if (sim == null) {
            // No job hint (a manual run): use the SIM that is configured for this APK's
            // wallet, exactly like the app has always done.
            String want = providerHint == null || providerHint.isEmpty()
                    ? Provider.current().id : providerHint;
            int auto = SimStore.subIdFor(c, sims, want);
            if (auto > 0) { subId = auto; sim = Sims.bySubId(sims, auto); }
        }
        out.subId = subId;
        if (sim != null) out.simLabel = sim.label;

        SimStore.Cfg cfg = subId > 0 ? SimStore.get(c, subId) : new SimStore.Cfg();
        Provider provider = providerHint != null && !providerHint.isEmpty()
                ? Provider.byId(providerHint)
                : (cfg.configured() ? Provider.byId(cfg.provider) : Provider.current());
        out.wallet = provider.id;

        String pin = subId > 0 ? SimStore.pin(c, subId) : Secure.readPin(c);
        String service = !cfg.service.isEmpty() ? cfg.service
                : !p.getString("service", "").isEmpty() ? p.getString("service", "")
                : provider.serviceCode;
        String steps = !cfg.steps.isEmpty() ? cfg.steps
                : !p.getString("steps", "").isEmpty() ? p.getString("steps", "")
                : provider.steps;
        String reference = cfg.ref == null || cfg.ref.isEmpty()
                ? (ref == null || ref.isEmpty() ? p.getString("ref", "1") : ref)
                : cfg.ref;

        String cleanNumber = digits(number);
        if (cleanNumber.length() == 13 && cleanNumber.startsWith("880")) cleanNumber = "0" + cleanNumber.substring(3);
        if (!cleanNumber.matches("01[3-9][0-9]{8}")) {
            out.error = "the receiver number " + number + " is not a valid 01XXXXXXXXX";
            return out;
        }
        String cleanAmount = (amount == null ? "" : amount).replaceAll("[^0-9.]", "");
        if (cleanAmount.isEmpty() || cleanAmount.matches(".*\\..*\\..*") || parseAmount(cleanAmount) <= 0) {
            out.error = "the amount " + amount + " is not a number above zero";
            return out;
        }
        if (!dryRun && (pin == null || pin.replaceAll("[^0-9]", "").isEmpty())) {
            out.error = "no PIN is saved for this SIM — the panel job cannot be sent";
            return out;
        }

        out.plan = new Plan(service, cleanNumber, cleanAmount, pin, reference, steps, dryRun, adaptive);
        return out;
    }

    private static double parseAmount(String s) {
        try { return Double.parseDouble(s.replaceAll("\\.$", "")); } catch (Exception e) { return 0; }
    }

    private static String digits(String s) {
        return s == null ? "" : s.replaceAll("[^0-9]", "");
    }
}
