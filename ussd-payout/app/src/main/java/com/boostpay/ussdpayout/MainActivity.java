package com.boostpay.ussdpayout;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.ArrayAdapter;
import android.widget.Spinner;

import java.util.ArrayList;
import java.util.List;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * BoostPay Payout (USSD) — proof-of-concept robot that walks a USSD money-transfer
 * menu on the owner's own phone.
 *
 *  · DRY RUN walks the menu and stops seconds before the PIN. No PIN is typed, no
 *    money can move. Always start here.
 *  · LIVE types the PIN too and really sends. It is fenced in by Guard: one run at
 *    a time, per-transaction ceiling, daily ceiling, cooldown, and a typed
 *    confirmation dialog with the amount and the last 4 digits of the receiver.
 */
public class MainActivity extends Activity {

    private static final String PREFS = "bp_settings";
    private static final int REQ_CALL = 51;

    private EditText serviceInput, stepsInput, numberInput, amountInput, pinInput, refInput, maxInput, capInput;
    private CheckBox adaptiveBox;
    private Provider provider = Provider.current();
    private List<Sims.Sim> sims = new ArrayList<>();
    private UssdApiEngine apiEngine;
    private String counterOrigin = "";
    private LinearLayout simRows;
    private TextView simSummary;
    private RadioButton apiRadio, a11yRadio;
    private TextView statusView, counterView, logView;
    private final StringBuilder log = new StringBuilder();
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Plan.DEFAULT_SERVICE = provider.serviceCode;
        setContentView(buildUi());
        loadSettings();
        requestCallPermission();
        refresh();
    }

    // ── UI ───────────────────────────────────────────────────────────────────

    private ScrollView buildUi() {
        int pad = dp(18);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.parseColor("#09090b"));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, dp(30), pad, dp(40));
        scroll.addView(root);

        TextView title = new TextView(this);
        title.setText("BoostPay Payout · " + provider.name);
        title.setTextColor(Color.WHITE);
        title.setTextSize(21);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);

        root.addView(note(provider.name + " build — reads the " + provider.serviceCode + " menu on this phone and types the keys.\n"
                + "Start with DRY RUN every time: it stops the moment the menu asks for the PIN, so no money can move. "
                + "Then a small real amount (10-20 BDT) to your own number.", provider.accent));

        root.addView(simSection());

        root.addView(label("Service code (falls back to the SIM's provider)"));
        serviceInput = input(provider.serviceCode, InputType.TYPE_CLASS_TEXT);
        root.addView(serviceInput);

        root.addView(label("Receiver number (the user's bKash/number)"));
        numberInput = input("01XXXXXXXXX", InputType.TYPE_CLASS_PHONE);
        root.addView(numberInput);

        root.addView(label("Amount (BDT)"));
        amountInput = input("20", InputType.TYPE_CLASS_NUMBER);
        root.addView(amountInput);

        root.addView(label("Menu steps, comma separated — {number} {amount} {pin}"));
        stepsInput = input(provider.steps, InputType.TYPE_CLASS_TEXT);
        root.addView(stepsInput);
        root.addView(note(("nagad".equals(provider.id)
                    ? "Nagad default: Send Money → receiver → amount → PIN. (If your menu also asks for a reference, add {ref} before {pin}.)"
                    : "bKash default: Send Money → receiver → amount → reference (1 = skip) → PIN. "
                      + "Read the log after a dry run and fix this line if your phone's menu differs."), "#71717a"));

        root.addView(label("Reference word (used by {ref} and by an adaptive reference prompt)"));
        refInput = input("1", InputType.TYPE_CLASS_TEXT);
        root.addView(refInput);

        adaptiveBox = new CheckBox(this);
        adaptiveBox.setText("Adaptive — read each screen and send the matching value");
        adaptiveBox.setTextColor(Color.parseColor("#d4d4d8"));
        adaptiveBox.setChecked(true);
        root.addView(adaptiveBox);
        root.addView(note("recommended: an \"enter amount\" screen gets the amount, a \"pin\" screen gets the PIN, "
                + "any number/account screen gets the receiver. Turn it off to type the steps list strictly in order.", "#71717a"));

        root.addView(label("PIN (" + provider.pinLength + " digits) — sealed with the phone's Keystore, never stored as text"));
        pinInput = input("•••••", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        root.addView(pinInput);
        Button savePin = button("Save PIN on this phone");
        savePin.setOnClickListener(v -> {
            Secure.savePin(this, pinInput.getText().toString().trim());
            pinInput.setText("");
            toast(Secure.hasPin(this) ? "PIN saved (encrypted)" : "PIN cleared");
            refresh();
        });
        root.addView(savePin);

        root.addView(label("Method"));
        RadioGroup group = new RadioGroup(this);
        group.setOrientation(RadioGroup.HORIZONTAL);
        apiRadio = new RadioButton(this);
        apiRadio.setText("USSD API (fast)");
        apiRadio.setTextColor(Color.parseColor("#d4d4d8"));
        a11yRadio = new RadioButton(this);
        a11yRadio.setText("Accessibility (works everywhere)");
        a11yRadio.setTextColor(Color.parseColor("#d4d4d8"));
        group.addView(apiRadio);
        group.addView(a11yRadio);
        root.addView(group);

        Button defaults = button("Load " + provider.name + " defaults (" + provider.serviceCode + ")");
        defaults.setOnClickListener(v -> {
            serviceInput.setText(provider.serviceCode);
            stepsInput.setText(provider.steps);
            if (refInput.getText().toString().trim().isEmpty()) refInput.setText("1");
            toast(provider.name + " defaults loaded");
        });
        root.addView(defaults);

        Button a11yOpen = button("Open Accessibility settings (needed for method B)");
        a11yOpen.setOnClickListener(v -> {
            try { startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); }
            catch (Throwable t) { toast("Settings → Accessibility → BoostPay Payout"); }
        });
        root.addView(a11yOpen);

        Button dry = button("① DRY RUN — walk the menu, stop before PIN");
        dry.setBackgroundColor(Color.parseColor("#f59e0b"));
        dry.setTextColor(Color.parseColor("#09090b"));
        dry.setOnClickListener(v -> run(false));
        root.addView(dry);

        Button live = button("② SEND REAL MONEY…");
        live.setTextColor(Color.parseColor("#fca5a5"));
        live.setOnClickListener(v -> confirmLive());
        root.addView(live);

        Button stop = button("⛔ STOP — cancel the run");
        stop.setTextColor(Color.parseColor("#fecaca"));
        stop.setBackgroundColor(Color.parseColor("#3f1d1d"));
        stop.setOnClickListener(v -> stopRun());
        root.addView(stop);

        root.addView(label("Safety limits (BDT)"));
        LinearLayout limits = new LinearLayout(this);
        limits.setOrientation(LinearLayout.HORIZONTAL);
        maxInput = input("500", InputType.TYPE_CLASS_NUMBER);
        capInput = input("3000", InputType.TYPE_CLASS_NUMBER);
        maxInput.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        capInput.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        limits.addView(maxInput);
        limits.addView(capInput);
        root.addView(limits);
        root.addView(note("left = max per payout · right = max per day (both enforced before anything is dialled)", "#71717a"));
        Button saveLimits = button("Save limits");
        saveLimits.setOnClickListener(v -> {
            try {
                Guard.setLimits(this, Long.parseLong(maxInput.getText().toString()),
                        Long.parseLong(capInput.getText().toString()), Guard.cooldownSec(this));
                toast("Limits saved"); refresh();
            } catch (NumberFormatException e) { toast("Numbers only"); }
        });
        root.addView(saveLimits);

        counterView = new TextView(this);
        counterView.setTextColor(Color.parseColor("#a1a1aa"));
        counterView.setTextSize(12);
        counterView.setPadding(0, dp(14), 0, dp(4));
        root.addView(counterView);

        statusView = new TextView(this);
        statusView.setTextColor(Color.parseColor("#d4d4d8"));
        statusView.setTextSize(12.5f);
        statusView.setPadding(0, dp(6), 0, dp(10));
        root.addView(statusView);

        TextView logTitle = new TextView(this);
        logTitle.setText("LOG — copy this and send it to me");
        logTitle.setTextColor(Color.parseColor("#71717a"));
        logTitle.setTextSize(10.5f);
        root.addView(logTitle);

        logView = new TextView(this);
        logView.setTextColor(Color.parseColor("#a1a1aa"));
        logView.setTextSize(10.5f);
        logView.setTypeface(Typeface.MONOSPACE);
        logView.setPadding(dp(8), dp(8), dp(8), dp(8));
        logView.setBackgroundColor(Color.parseColor("#111113"));
        logView.setTextIsSelectable(true);
        root.addView(logView);

        LinearLayout logButtons = new LinearLayout(this);
        logButtons.setOrientation(LinearLayout.HORIZONTAL);
        Button copy = button("Copy log");
        copy.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        copy.setOnClickListener(v -> {
            android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(android.content.ClipData.newPlainText("bp-log", log.toString()));
            toast("Log copied");
        });
        Button clear = button("Clear");
        clear.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        clear.setOnClickListener(v -> { log.setLength(0); logView.setText(""); });
        logButtons.addView(copy);
        logButtons.addView(clear);
        root.addView(logButtons);

        Button battery = button("Allow background (battery)");
        battery.setOnClickListener(v -> askBattery());
        root.addView(battery);

        root.addView(note("\nThis app talks to no server and stores nothing outside this phone. "
                + "The PIN is sealed in the Android Keystore; uninstalling wipes it.", "#52525b"));
        return scroll;
    }

    private void confirmLive() {
        final long amount;
        try { amount = Long.parseLong(amountInput.getText().toString().trim()); }
        catch (NumberFormatException e) { toast("Enter the amount first"); return; }

        String blocked = Guard.check(this, amount, true);
        if (blocked != null) { toast(blocked); return; }
        int subNow = SimStore.selected(this);
        boolean pinOk = subNow > 0 ? SimStore.hasPin(this, subNow) : Secure.hasPin(this);
        if (!pinOk) { toast("Save the PIN for the selected SIM first (or use dry run)"); return; }

        final String number = numberInput.getText().toString().trim();
        if (number.length() < 11) { toast("Enter the full 11-digit receiver number"); return; }
        final String last4 = number.substring(number.length() - 4);

        final EditText confirm = new EditText(this);
        confirm.setHint("type " + amount + " and " + last4);
        confirm.setInputType(InputType.TYPE_CLASS_TEXT);

        new AlertDialog.Builder(this)
                .setTitle("Send " + amount + " BDT to " + number + "?")
                .setMessage("Real money will leave this phone's wallet.\n\n"
                        + "Type the amount and the last 4 digits of the number, separated by a space, to confirm.")
                .setView(confirm)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Send now", (d, w) -> {
                    String typed = confirm.getText().toString().trim().replaceAll("\\s+", " ");
                    if (!typed.equals(amount + " " + last4)) { toast("Confirmation did not match — nothing sent"); return; }
                    Guard.recordSend(this, amount);   // counted up-front: a timeout must still eat the daily budget
                    run(true);
                })
                .show();
    }

    // ── stopping ─────────────────────────────────────────────────────────────

    private void stopRun() {
        boolean was = Guard.isRunning() || UssdService.busy();
        if (apiEngine != null) { apiEngine.cancel(); apiEngine = null; }
        UssdService.cancel(this);
        Guard.forceEnd();
        line("⛔ STOP pressed — run cancelled, no further keys are sent");
        statusView.setText(was ? "⛔ stopped by you" : "idle — nothing was running");
        statusView.setTextColor(Color.parseColor("#fca5a5"));
        refresh();
    }

    /** A run that died without reporting (phone killed the dialog) must not lock the app. */
    private void clearStaleRun() {
        if (Guard.stale()) {
            Guard.forceEnd();
            apiEngine = null;
            UssdService.cancel(this);
            line("· previous run was still marked as running after 2 min — cleared it");
            statusView.setText("previous run timed out — cleared. Start again.");
            statusView.setTextColor(Color.parseColor("#fca5a5"));
        }
    }

    // ── running ──────────────────────────────────────────────────────────────

    private void run(boolean live) {
        clearStaleRun();
        if (!Guard.begin()) {
            toast("A run is already in progress — press ⛔ STOP to cancel it");
            statusView.setText("a run is in progress — press ⛔ STOP to cancel");
            return;
        }
        saveSettings();

        // Which SIM? The selected one if the owner picked it, otherwise the SIM that
        // carries this app's provider.
        int subId = SimStore.selected(this);
        Sims.Sim sim = Sims.bySubId(sims, subId);
        if (sim == null) {
            int auto = SimStore.subIdFor(this, sims, provider.id);
            if (auto > 0) { subId = auto; sim = Sims.bySubId(sims, auto); }
        }
        SimStore.Cfg cfg = subId > 0 ? SimStore.get(this, subId) : new SimStore.Cfg();

        String pin = subId > 0 ? SimStore.pin(this, subId) : Secure.readPin(this);
        String service = !cfg.service.isEmpty() ? cfg.service
                : !serviceInput.getText().toString().trim().isEmpty() ? serviceInput.getText().toString()
                : provider.serviceCode;
        String steps = !cfg.steps.isEmpty() ? cfg.steps : stepsInput.getText().toString();
        String ref = cfg.ref == null || cfg.ref.isEmpty() ? refInput.getText().toString() : cfg.ref;

        line("SIM: " + (sim != null ? sim.label + " (subId " + subId + ")"
                : "default SIM (none configured)"));
        if (cfg.configured()) {
            line("wallet: " + cfg.providerName() + " · " + cfg.accountName()
                    + (cfg.number.isEmpty() ? "" : " · " + cfg.number)
                    + (SimStore.hasPin(this, subId) ? " · PIN saved" : " · no PIN"));
        }

        String rawNumber = numberInput.getText().toString();
        String cleanNumber = rawNumber.replaceAll("[^0-9]", "");
        if (cleanNumber.length() == 13 && cleanNumber.startsWith("880")) cleanNumber = "0" + cleanNumber.substring(3);
        if (cleanNumber.length() != 11 || !cleanNumber.startsWith("01")) {
            Guard.end();
            line("✗ receiver number \"" + rawNumber + "\" is not a valid 11-digit 01XXXXXXXXX number");
            toast("Receiver number must be 11 digits, starting 01 (spaces/dashes are removed automatically)");
            refresh();
            return;
        }

        Plan plan = new Plan(
                service,
                cleanNumber,
                amountInput.getText().toString(),
                pin,
                ref,
                steps,
                !live,
                adaptiveBox.isChecked());

        if (!plan.dryRun && pin.isEmpty()) {
            Guard.end();
            toast("No PIN saved — only the dry run is possible");
            return;
        }
        if (!plan.dryRun && !plan.adaptive && plan.pinStep < 0) {
            Guard.end();
            toast("The steps do not contain {pin} — add it, otherwise the plan can never finish a payout.");
            return;
        }

        statusView.setText("running…");
        log.append("\n──────────────────────────\n");
        line(plan.dryRun ? "DRY RUN start" : "LIVE START — real money");

        Sink sink = new Sink() {
            @Override public void log(String l) { line(l); }

            @Override public void finish(boolean ok, String summary) {
                ui.post(() -> {
                    Guard.end();
                    apiEngine = null;
                    line((ok ? "■ done: " : "■ stopped: ") + summary);
                    statusView.setText((ok ? "✅ " : "⚠️ ") + summary);
                    statusView.setTextColor(Color.parseColor(ok ? "#6ee7b7" : "#fca5a5"));
                    refresh();
                });
            }
        };

        boolean started;
        if (a11yRadio.isChecked()) {
            if (!UssdService.isEnabled(this)) {
                Guard.end();
                toast("Turn on Settings → Accessibility → BoostPay Payout, then retry");
                return;
            }
            started = UssdService.start(this, plan, sink, subId);
        } else {
            apiEngine = new UssdApiEngine(this, plan, sink, subId);
            apiEngine.start();
            started = true;
        }
        if (!started) Guard.end();
        refresh();
    }

    /** Used by both engines when Android refuses the USSD dial. */
    void requestCallPermission() {
        if (Build.VERSION.SDK_INT < 23) return;
        List<String> need = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.CALL_PHONE);
        if (checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.READ_PHONE_STATE);
        if (!need.isEmpty()) requestPermissions(need.toArray(new String[0]), REQ_CALL);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == REQ_CALL) { buildSimRows(); refresh(); }
    }

    // ── SIM cards ────────────────────────────────────────────────────────────

    private LinearLayout simSection() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);

        TextView head = new TextView(this);
        head.setText("SIM cards — kon SIM e kon wallet");
        head.setTextColor(Color.parseColor("#e4e4e7"));
        head.setTextSize(13);
        head.setTypeface(Typeface.DEFAULT_BOLD);
        head.setPadding(0, dp(18), 0, dp(2));
        box.addView(head);
        box.addView(note("প্রতিটা SIM-এ আলাদা করে দিন: কোনটা bKash, কোনটা Nagad, Personal না Agent, নিজের নম্বর আর সেই SIM-এর PIN। "
                + "পেমেন্ট ওই SIM থেকেই যাবে।", "#71717a"));

        simSummary = new TextView(this);
        simSummary.setTextColor(Color.parseColor("#a1a1aa"));
        simSummary.setTextSize(11);
        box.addView(simSummary);

        simRows = new LinearLayout(this);
        simRows.setOrientation(LinearLayout.VERTICAL);
        box.addView(simRows);

        Button again = button("Refresh SIM list");
        again.setOnClickListener(v -> { buildSimRows(); refresh(); });
        box.addView(again);

        Button perm = button("Allow phone / SIM access");
        perm.setOnClickListener(v -> requestCallPermission());
        box.addView(perm);

        buildSimRows();
        return box;
    }

    /** One editor per active SIM subId. */
    private void buildSimRows() {
        if (simRows == null) return;
        sims = Sims.list(this);
        simRows.removeAllViews();

        if (sims.isEmpty()) {
            simSummary.setText(Sims.canRead(this)
                    ? "এই ফোনে সক্রিয় SIM পাওয়া যায়নি (সিম আছে তো?)"
                    : "SIM পড়ার অনুমতি নেই — Allow phone / SIM access চাপুন");
            return;
        }
        simSummary.setText("SIM পাওয়া গেছে: " + sims.size() + "টা · বদলাতে হলে অপশন বেছে নিন");

        for (Sims.Sim sim : sims) {
            SimStore.Cfg cfg = SimStore.get(this, sim.subId);

            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(10), dp(10), dp(10), dp(10));
            card.setBackgroundColor(Color.parseColor("#111113"));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.topMargin = dp(8);
            card.setLayoutParams(lp);

            TextView title = new TextView(this);
            title.setText(sim.label + (cfg.configured()
                    ? "  →  " + cfg.providerName() + " · " + cfg.accountName()
                    : "  →  not set"));
            title.setTextColor(Color.WHITE);
            title.setTextSize(12.5f);
            title.setTypeface(Typeface.DEFAULT_BOLD);
            card.addView(title);

            // provider spinner
            Spinner providerSpinner = new Spinner(this);
            ArrayAdapter<String> provAdapter = new ArrayAdapter<>(this,
                    android.R.layout.simple_spinner_dropdown_item,
                    new String[]{"not used", "bKash", "Nagad"});
            providerSpinner.setAdapter(provAdapter);
            providerSpinner.setSelection("bkash".equals(cfg.provider) ? 1 : "nagad".equals(cfg.provider) ? 2 : 0);
            card.addView(labelled("এই SIM দিয়ে পেমেন্ট", providerSpinner));

            // account type spinner
            Spinner accountSpinner = new Spinner(this);
            ArrayAdapter<String> accAdapter = new ArrayAdapter<>(this,
                    android.R.layout.simple_spinner_dropdown_item,
                    new String[]{"Personal account", "Agent account"});
            accountSpinner.setAdapter(accAdapter);
            accountSpinner.setSelection("agent".equals(cfg.account) ? 1 : 0);
            card.addView(labelled("অ্যাকাউন্টের ধরন", accountSpinner));

            EditText ownNumber = input("017XXXXXXXX", InputType.TYPE_CLASS_PHONE);
            ownNumber.setText(cfg.number);
            card.addView(labelled("এই SIM-এর ওয়ালেট নম্বর", ownNumber));

            EditText simPin = input("••••", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
            card.addView(labelled("এই SIM-এর PIN", simPin));

            Button savePinBtn = button("Save PIN for this SIM");
            savePinBtn.setOnClickListener(v -> {
                String pin = simPin.getText().toString().trim();
                SimStore.savePin(this, sim.subId, pin);
                simPin.setText("");
                toast(SimStore.hasPin(this, sim.subId) ? sim.label + ": PIN saved" : sim.label + ": PIN cleared");
                buildSimRows();
                refresh();
            });
            card.addView(savePinBtn);

            Button useBtn = button(SimStore.selected(this) == sim.subId
                    ? "✔ এই SIM দিয়ে পাঠানো হবে"
                    : "এই SIM বেছে নিন");
            useBtn.setOnClickListener(v -> {
                SimStore.setSelected(this, sim.subId);
                buildSimRows();
                refresh();
                toast(sim.label + " selected");
            });
            card.addView(useBtn);

            Button saveBtn = button("Save this SIM's settings");
            saveBtn.setTextColor(Color.parseColor("#fcd34d"));
            saveBtn.setOnClickListener(v -> {
                SimStore.Cfg n = new SimStore.Cfg();
                n.subId = sim.subId;
                int pi = providerSpinner.getSelectedItemPosition();
                n.provider = pi == 1 ? "bkash" : pi == 2 ? "nagad" : "";
                n.account = accountSpinner.getSelectedItemPosition() == 1 ? "agent" : "personal";
                n.number = ownNumber.getText().toString().trim();
                SimStore.Cfg old = SimStore.get(this, sim.subId);
                n.service = old.provider.equals(n.provider) ? old.service : "";
                n.steps = old.provider.equals(n.provider) ? old.steps : "";
                n.ref = old.ref;
                SimStore.save(this, n);
                buildSimRows();
                refresh();
                toast(sim.label + " → " + n.providerName() + " · " + n.accountName());
            });
            card.addView(saveBtn);

            simRows.addView(card);
        }
    }

    private LinearLayout labelled(String text, android.view.View field) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        TextView l = new TextView(this);
        l.setText(text);
        l.setTextColor(Color.parseColor("#a1a1aa"));
        l.setTextSize(10.5f);
        l.setPadding(0, dp(8), 0, 0);
        row.addView(l);
        row.addView(field);
        return row;
    }

    private void askBattery() {
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + getPackageName()));
            startActivity(i);
        } catch (Throwable t) {
            try { startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); }
            catch (Throwable ignored) { toast("Settings → Apps → BoostPay Payout → Battery → Unrestricted"); }
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private void refresh() {
        long sent = Guard.sentToday(this);
        counterOrigin = Guard.isRunning()
                ? "running for " + (Guard.runningForMs() / 1000) + "s — ⛔ STOP is available\n"
                : "";
        counterView.setText(counterOrigin + "SIMs: " + sims.size() + "   ·   selected: "
                + (SimStore.selected(this) > 0 ? Sims.bySubId(sims, SimStore.selected(this)) != null
                    ? Sims.bySubId(sims, SimStore.selected(this)).label : "subId " + SimStore.selected(this)
                    : "auto")
                + "   ·   adaptive: " + (adaptiveBox.isChecked() ? "on" : "off")
                + "\n" + provider.name + " · " + provider.serviceCode
                + "\nsent today: " + sent + " / " + Guard.dailyCap(this) + " BDT"
                + "   ·   per payout max: " + Guard.maxPerTx(this) + " BDT"
                + "   ·   PIN saved: " + (Secure.hasPin(this) ? "yes" : "no")
                + "\naccessibility service: " + (UssdService.isEnabled(this) ? "ON" : "off")
                + "   ·   method: " + (a11yRadio.isChecked() ? "B" : "A"));
        if (!Guard.isRunning() && statusView.getText().length() == 0) {
            statusView.setText("idle — start with DRY RUN");
        }
    }

    private void line(String s) {
        String ts = new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date());
        ui.post(() -> {
            if (log.length() > 40_000) log.delete(0, 20_000);
            log.append(ts).append("  ").append(s).append('\n');
            logView.setText(log.toString());
        });
    }

    private TextView label(String t) {
        TextView tv = new TextView(this);
        tv.setText(t);
        tv.setTextColor(Color.parseColor("#a1a1aa"));
        tv.setTextSize(11);
        tv.setPadding(0, dp(12), 0, dp(4));
        return tv;
    }

    private TextView note(String t, String color) {
        TextView tv = new TextView(this);
        tv.setText(t);
        tv.setTextColor(Color.parseColor(color));
        tv.setTextSize(10.5f);
        tv.setPadding(0, dp(6), 0, dp(6));
        return tv;
    }

    private EditText input(String hint, int type) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setHintTextColor(Color.parseColor("#52525b"));
        e.setTextColor(Color.WHITE);
        e.setTextSize(14);
        e.setSingleLine(true);
        e.setInputType(type);
        e.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return e;
    }

    private Button button(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextSize(13);
        b.setTextColor(Color.parseColor("#e4e4e7"));
        b.setBackgroundColor(Color.parseColor("#27272a"));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(6);
        b.setLayoutParams(lp);
        return b;
    }

    private void toast(String s) { Toast.makeText(this, s, Toast.LENGTH_LONG).show(); }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    // ── settings ─────────────────────────────────────────────────────────────

    private void loadSettings() {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        serviceInput.setText(p.getString("service", provider.serviceCode));
        String savedSteps = p.getString("steps", provider.steps);
        // v1.3: Nagad's Send Money is option 2 — upgrade an untouched old list
        if ("nagad".equals(provider.id) && "1,{number},{amount},{pin}".equals(savedSteps)) {
            savedSteps = provider.steps;
            p.edit().putString("steps", savedSteps).apply();
            p.edit().putString("service", provider.serviceCode).apply();
        }
        stepsInput.setText(savedSteps);
        numberInput.setText(p.getString("number", ""));
        amountInput.setText(p.getString("amount", "20"));
        refInput.setText(p.getString("ref", "1"));
        adaptiveBox.setChecked(p.getBoolean("adaptive", true));
        maxInput.setText(String.valueOf(Guard.maxPerTx(this)));
        capInput.setText(String.valueOf(Guard.dailyCap(this)));
        boolean a11y = "a11y".equals(p.getString("mode", "api"));
        a11yRadio.setChecked(a11y);
        apiRadio.setChecked(!a11y);
        serviceInput.setSelection(serviceInput.getText().length());
    }

    private void saveSettings() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putString("service", serviceInput.getText().toString().trim())
                .putString("steps", stepsInput.getText().toString().trim())
                .putString("number", numberInput.getText().toString().trim())
                .putString("amount", amountInput.getText().toString().trim())
                .putString("ref", refInput.getText().toString().trim())
                .putBoolean("adaptive", adaptiveBox.isChecked())
                .putString("mode", a11yRadio.isChecked() ? "a11y" : "api")
                .apply();
    }
}
