package com.boostpay.ussdpayout;

/**
 * One payout, rendered from the settings screen. The steps are the keys the
 * robot types after the service code, in order, with {number} / {amount} / {pin}
 * placeholders. Nothing about a menu path is hard-coded: the operator changes the
 * menu and the owner edits the steps, no new APK needed.
 *
 * Example (bKash send money):   1 , {number} , {amount} , 1 , {pin}
 *                              Send   receiver    amount   ref    PIN
 */
public final class Plan {

    public final String serviceCode;
    public final String number;
    public final String amount;
    public final String pin;
    public final boolean dryRun;
    public final String[] steps;
    /** index of the first step that must not run in dry-run mode (-1 = none) */
    public final int pinStep;

    public Plan(String serviceCode, String number, String amount, String pin, String stepsCsv, boolean dryRun) {
        this.serviceCode = blank(serviceCode) ? "*247#" : serviceCode.trim();
        this.number = number == null ? "" : number.trim();
        this.amount = amount == null ? "" : amount.trim();
        this.pin = pin == null ? "" : pin.trim();
        this.dryRun = dryRun;

        String[] raw = (stepsCsv == null ? "" : stepsCsv).split(",");
        java.util.List<String> out = new java.util.ArrayList<>();
        int pinIdx = -1;
        for (String s : raw) {
            String t = s.trim();
            if (t.isEmpty()) continue;
            if (t.contains("{pin}") && pinIdx < 0) pinIdx = out.size();
            out.add(t.replace("{number}", this.number).replace("{amount}", this.amount).replace("{pin}", this.pin));
        }
        this.steps = out.toArray(new String[0]);
        this.pinStep = pinIdx;
    }

    /** What the robot should type next, or null when the plan is finished. */
    public String stepAt(int i) {
        return i >= 0 && i < steps.length ? steps[i] : null;
    }

    /** True when step i carries the PIN (and must be masked in the log). */
    public boolean isSecret(int i) {
        return pinStep >= 0 && i == pinStep;
    }

    /** Dry-run stops right before the PIN, so no money can move. */
    public boolean mustStopHere(int i) {
        return dryRun && i == pinStep;
    }

    private static boolean blank(String s) { return s == null || s.trim().isEmpty(); }
}
