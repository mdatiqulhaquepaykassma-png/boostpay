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
import android.view.View;
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
    private TextView numberState, amountState, pinState;
    private CheckBox queueBox;
    private EditText serverInput, tokenInput;
    private Button queueStart;
    private TextView queueState;
    private LinearLayout statusCard, advancedBox, logBox;
    private TextView statusTitle, statusDetail;
    private Button advButton, logButton;
    private boolean queueRunning;
    private boolean queueLive;                       // the mode the queue is running in

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
        ui.post(statusTicker);
        requestCallPermission();
        requestNotifyPermission();
        refresh();
    }

    /** Android 13+ hides the queue's foreground notification without this. */
    private void requestNotifyPermission() {
        try {
            if (android.os.Build.VERSION.SDK_INT >= 33
                    && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != 0) {
                requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 52);
            }
        } catch (Throwable ignored) { }
    }

    // ── UI ───────────────────────────────────────────────────────────────────

    private ScrollView buildUi() {
        int pad = dp(18);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.parseColor("#09090b"));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, dp(26), pad, dp(40));
        scroll.addView(root);

        TextView title = new TextView(this);
        title.setText("BoostPay Payout");
        title.setTextColor(Color.WHITE);
        title.setTextSize(22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);
        TextView subtitle = new TextView(this);
        subtitle.setText(provider.name + " · " + provider.serviceCode);
        subtitle.setTextColor(Color.parseColor(provider.accent));
        subtitle.setTextSize(12);
        root.addView(subtitle);

        // ── 1 · the one thing the owner must see: CONNECTED or NOT ───────────
        statusCard = new LinearLayout(this);
        statusCard.setOrientation(LinearLayout.VERTICAL);
        statusCard.setPadding(dp(16), dp(14), dp(16), dp(16));
        android.graphics.drawable.GradientDrawable sbg = new android.graphics.drawable.GradientDrawable();
        sbg.setColor(Color.parseColor("#111113"));
        sbg.setCornerRadius(dp(16));
        sbg.setStroke(dp(2), Color.parseColor("#3f3f46"));
        statusCard.setBackground(sbg);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        slp.topMargin = dp(16);
        statusCard.setLayoutParams(slp);

        statusTitle = new TextView(this);
        statusTitle.setText("CHECKING…");
        statusTitle.setTextColor(Color.parseColor("#a1a1aa"));
        statusTitle.setTextSize(26);
        statusTitle.setTypeface(Typeface.DEFAULT_BOLD);
        statusCard.addView(statusTitle);

        statusDetail = new TextView(this);
        statusDetail.setText("server status appears here");
        statusDetail.setTextColor(Color.parseColor("#a1a1aa"));
        statusDetail.setTextSize(12);
        statusDetail.setPadding(0, dp(4), 0, dp(10));
        statusCard.addView(statusDetail);

        LinearLayout mainButtons = new LinearLayout(this);
        mainButtons.setOrientation(LinearLayout.HORIZONTAL);
        queueStart = button("▶ CONNECT");
        queueStart.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 2f));
        queueStart.setBackgroundColor(Color.parseColor("#10b981"));
        queueStart.setTextColor(Color.parseColor("#04170f"));
        queueStart.setOnClickListener(v -> toggleQueue());
        queueBox.setOnCheckedChangeListener((b, on) -> {
            saveSettings();
            if (QueueService.isRunning()) {      // restart so the new mode takes effect at once
                QueueService.stop(this);
                queueBox.postDelayed(() -> QueueService.start(this), 700);
            }
        });
        mainButtons.addView(queueStart);

        Button stopBtn = button("⛔ STOP");
        stopBtn.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        stopBtn.setBackgroundColor(Color.parseColor("#3f1d1d"));
        stopBtn.setTextColor(Color.parseColor("#fecaca"));
        stopBtn.setOnClickListener(v -> stopRun());
        mainButtons.addView(stopBtn);
        statusCard.addView(mainButtons);
        root.addView(statusCard);

        // ── 2 · connection details (only needed once) ───────────────────────
        LinearLayout conn = card("Server connection", "the admin panel queues a payout · this phone sends it");
        serverInput = input("https://boostpay.online", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        conn.addView(serverInput);
        tokenInput = input("device token (BPX-…)", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        conn.addView(tokenInput);

        LinearLayout connRow = new LinearLayout(this);
        connRow.setOrientation(LinearLayout.HORIZONTAL);
        queueBox = new CheckBox(this);
        queueBox.setText("Dry run only (test jobs)");
        queueBox.setTextColor(Color.parseColor("#d4d4d8"));
        queueBox.setTextSize(12.5f);
        queueBox.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        connRow.addView(queueBox);
        Button testConn = button("Test");
        testConn.setLayoutParams(new LinearLayout.LayoutParams(dp(96), ViewGroup.LayoutParams.WRAP_CONTENT));
        testConn.setOnClickListener(v -> testQueueConnection());
        connRow.addView(testConn);
        conn.addView(connRow);

        queueState = state();
        conn.addView(queueState);
        root.addView(conn);

        // ── 3 · what to send (three separate boxes) ─────────────────────────
        LinearLayout numberCard = card("1 · Receiver number", "whose " + provider.name + " account gets the money");
        numberInput = input("01XXXXXXXXX", InputType.TYPE_CLASS_PHONE);
        numberCard.addView(numberInput);
        numberState = state();
        numberCard.addView(numberState);
        Button saveNumber = button("Save receiver number");
        saveNumber.setOnClickListener(v -> { saveOne("number", numberInput.getText().toString()); refresh(); });
        numberCard.addView(saveNumber);
        root.addView(numberCard);

        LinearLayout amountCard = card("2 · Amount (BDT)", "digits only, e.g. 100 or 500.50");
        amountInput = input("20", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        amountCard.addView(amountInput);
        amountState = state();
        amountCard.addView(amountState);
        Button saveAmount = button("Save amount");
        saveAmount.setOnClickListener(v -> {
            String a = amountInput.getText().toString().trim().replaceAll("[^0-9.]", "");
            if (a.isEmpty() || a.matches(".*\\..*\\..*")) { toast("Amount must be a number, e.g. 100"); return; }
            saveOne("amount", a);
            amountInput.setText(a);
            refresh();
        });
        amountCard.addView(saveAmount);
        root.addView(amountCard);

        LinearLayout pinCard = card("3 · PIN (" + provider.pinLength + " digits)",
                "sealed with the phone's Keystore — never stored as text, never logged");
        pinInput = input("•••••", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        pinCard.addView(pinInput);
        pinState = state();
        pinCard.addView(pinState);
        CheckBox showPin = new CheckBox(this);
        showPin.setText("Show digits while typing");
        showPin.setTextColor(Color.parseColor("#d4d4d8"));
        showPin.setTextSize(12);
        showPin.setOnCheckedChangeListener((b, on) -> pinInput.setInputType(on
                ? InputType.TYPE_CLASS_NUMBER
                : InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD));
        pinCard.addView(showPin);
        LinearLayout pinRow = new LinearLayout(this);
        pinRow.setOrientation(LinearLayout.HORIZONTAL);
        Button savePin = button("Save PIN");
        savePin.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        savePin.setOnClickListener(v -> {
            String typed = pinInput.getText().toString().trim();
            if (!typed.isEmpty() && !typed.matches("[0-9]+")) { toast("PIN must be digits only"); return; }
            if (!typed.isEmpty() && typed.length() != provider.pinLength) {
                toast("Note: " + provider.name + " PIN is usually " + provider.pinLength + " digits — saved anyway");
            }
            Secure.savePin(this, typed);
            pinInput.setText("");
            toast(Secure.hasPin(this) ? "PIN saved (encrypted)" : "PIN cleared");
            refresh();
        });
        pinRow.addView(savePin);
        Button clearPin = button("Clear");
        clearPin.setLayoutParams(new LinearLayout.LayoutParams(dp(96), ViewGroup.LayoutParams.WRAP_CONTENT));
        clearPin.setOnClickListener(v -> { Secure.savePin(this, ""); pinInput.setText(""); toast("PIN cleared"); refresh(); });
        pinRow.addView(clearPin);
        pinCard.addView(pinRow);
        root.addView(pinCard);

        // ── 4 · everything else lives behind one toggle ─────────────────────
        advancedBox = new LinearLayout(this);
        advancedBox.setOrientation(LinearLayout.VERTICAL);
        advancedBox.setVisibility(View.GONE);

        advancedBox.addView(simSection());

        advancedBox.addView(label("Service code"));
        serviceInput = input(provider.serviceCode, InputType.TYPE_CLASS_TEXT);
        advancedBox.addView(serviceInput);

        advancedBox.addView(label("Menu steps — {number} {amount} {ref} {pin}"));
        stepsInput = input(provider.steps, InputType.TYPE_CLASS_TEXT);
        advancedBox.addView(stepsInput);
        advancedBox.addView(note("nagad: Send Money → number → amount → reference → PIN · bkash: 1,{number},{amount},1,{pin}", "#71717a"));

        advancedBox.addView(label("Reference value"));
        refInput = input("1", InputType.TYPE_CLASS_TEXT);
        advancedBox.addView(refInput);

        adaptiveBox = new CheckBox(this);
        adaptiveBox.setText("Adaptive — read each screen and answer only what it asks");
        adaptiveBox.setTextColor(Color.parseColor("#d4d4d8"));
        adaptiveBox.setTextSize(12.5f);
        adaptiveBox.setChecked(true);
        advancedBox.addView(adaptiveBox);

        RadioGroup group = new RadioGroup(this);
        group.setOrientation(RadioGroup.HORIZONTAL);
        apiRadio = new RadioButton(this);
        apiRadio.setText("USSD API");
        apiRadio.setTextColor(Color.parseColor("#d4d4d8"));
        a11yRadio = new RadioButton(this);
        a11yRadio.setText("Accessibility");
        a11yRadio.setTextColor(Color.parseColor("#d4d4d8"));
        group.addView(apiRadio);
        group.addView(a11yRadio);
        advancedBox.addView(label("Method (Accessibility is the one that works on Nagad)"));
        advancedBox.addView(group);

        Button a11yOpen = button("Open Accessibility settings");
        a11yOpen.setOnClickListener(v -> {
            try { startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); }
            catch (Throwable t) { toast("Settings → Accessibility → BoostPay Payout"); }
        });
        advancedBox.addView(a11yOpen);

        advancedBox.addView(label("Safety limits (BDT) — per payout · per day"));
        LinearLayout limits = new LinearLayout(this);
        limits.setOrientation(LinearLayout.HORIZONTAL);
        maxInput = input("500", InputType.TYPE_CLASS_NUMBER);
        capInput = input("3000", InputType.TYPE_CLASS_NUMBER);
        maxInput.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        capInput.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        limits.addView(maxInput);
        limits.addView(capInput);
        advancedBox.addView(limits);
        Button saveLimits = button("Save limits");
        saveLimits.setOnClickListener(v -> {
            try {
                Guard.setLimits(this, Long.parseLong(maxInput.getText().toString()),
                        Long.parseLong(capInput.getText().toString()), Guard.cooldownSec(this));
                toast("Limits saved"); refresh();
            } catch (NumberFormatException e) { toast("Numbers only"); }
        });
        advancedBox.addView(saveLimits);

        Button defaults = button("Load " + provider.name + " defaults");
        defaults.setOnClickListener(v -> {
            serviceInput.setText(provider.serviceCode);
            stepsInput.setText(provider.steps);
            if (refInput.getText().toString().trim().isEmpty()) refInput.setText("1");
            toast(provider.name + " defaults loaded");
        });
        advancedBox.addView(defaults);

        Button dry = button("Manual DRY RUN (one payout, stop before PIN)");
        dry.setOnClickListener(v -> run(false));
        advancedBox.addView(dry);
        Button live = button("Manual SEND real money…");
        live.setTextColor(Color.parseColor("#fca5a5"));
        live.setOnClickListener(v -> confirmLive());
        advancedBox.addView(live);

        Button battery = button("Allow background (battery)");
        battery.setOnClickListener(v -> askBattery());
        advancedBox.addView(battery);

        advButton = button("⚙ Advanced settings");
        advButton.setOnClickListener(v -> {
            boolean show = advancedBox.getVisibility() != View.VISIBLE;
            advancedBox.setVisibility(show ? View.VISIBLE : View.GONE);
            advButton.setText(show ? "⚙ Hide advanced settings" : "⚙ Advanced settings");
        });
        root.addView(advButton);
        root.addView(advancedBox);

        // ── 5 · log behind a toggle ─────────────────────────────────────────
        logBox = new LinearLayout(this);
        logBox.setOrientation(LinearLayout.VERTICAL);
        logBox.setVisibility(View.GONE);

        counterView = new TextView(this);
        counterView.setTextColor(Color.parseColor("#a1a1aa"));
        counterView.setTextSize(11.5f);
        counterView.setPadding(0, dp(10), 0, dp(4));
        logBox.addView(counterView);

        statusView = new TextView(this);
        statusView.setTextColor(Color.parseColor("#d4d4d8"));
        statusView.setTextSize(12);
        statusView.setPadding(0, dp(2), 0, dp(8));
        logBox.addView(statusView);

        logView = new TextView(this);
        logView.setTextColor(Color.parseColor("#a1a1aa"));
        logView.setTextSize(10.5f);
        logView.setTypeface(Typeface.MONOSPACE);
        logView.setPadding(dp(8), dp(8), dp(8), dp(8));
        logView.setBackgroundColor(Color.parseColor("#111113"));
        logView.setTextIsSelectable(true);
        logBox.addView(logView);

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
        logBox.addView(logButtons);

        logButton = button("📄 Log");
        logButton.setOnClickListener(v -> {
            boolean show = logBox.getVisibility() != View.VISIBLE;
            logBox.setVisibility(show ? View.VISIBLE : View.GONE);
            logButton.setText(show ? "📄 Hide log" : "📄 Log");
        });
        root.addView(logButton);
        root.addView(logBox);

        return scroll;
    }

    /** The big green/red card: is this phone connected to the panel right now? */
    private void paintStatus() {
        boolean service = QueueService.isRunning();
        long lastContact = QueueService.lastContactAt;
        String err = QueueService.lastError;
        long age = lastContact == 0 ? -1 : (System.currentTimeMillis() - lastContact) / 1000;
        boolean online = service && age >= 0 && age < 20;

        String head;
        String colour;
        if (online) {
            head = "CONNECTED";
            colour = queueBox.isChecked() ? "#fbbf24" : "#34d399";
        } else if (service) {
            head = "CONNECTING…";
            colour = "#fbbf24";
        } else {
            head = "DISCONNECTED";
            colour = "#f87171";
        }
        if (!err.isEmpty() && !online) head = "DISCONNECTED";
        statusTitle.setText(head);
        statusTitle.setTextColor(Color.parseColor(colour));
        ((android.graphics.drawable.GradientDrawable) statusCard.getBackground())
                .setStroke(dp(2), Color.parseColor(online ? (queueBox.isChecked() ? "#fbbf24" : "#10b981") : "#7f1d1d"));

        StringBuilder d = new StringBuilder();
        if (online) {
            d.append(queueBox.isChecked() ? "DRY RUN — the panel sends TEST jobs only" : "LIVE — real money can be sent");
            d.append(" · last check ").append(age).append("s ago");
            if (!QueueService.lastStatus.isEmpty()) d.append("\n").append(QueueService.lastStatus);
        } else if (service) {
            d.append("asking the panel… ").append(age >= 0 ? (age + "s since the last answer") : "no answer yet");
        } else {
            d.append("Not talking to the admin panel. Press ▶ CONNECT.");
        }
        if (!err.isEmpty()) d.append("\n✗ ").append(err);
        statusDetail.setText(d.toString());
        queueStart.setText(service ? "■ DISCONNECT" : "▶ CONNECT");
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

        // Amount: digits (and at most one dot) only — "1,000", "Tk 500" or "" would
        // reach the network as garbage and come back as a refusal.
        String rawAmount = amountInput.getText().toString();
        String cleanAmount = rawAmount.trim().replaceAll("[^0-9.]", "");
        if (cleanAmount.isEmpty() || cleanAmount.equals(".") || cleanAmount.matches(".*\\..*\\..*")
                || cleanAmount.matches("^\\.0*$")) {
            Guard.end();
            line("✗ amount \"" + rawAmount + "\" is not a number — enter the amount like 100 or 500.50");
            toast("Amount must be a number (spaces, commas and Tk are removed automatically)");
            refresh();
            return;
        }
        try {
            if (Double.parseDouble(cleanAmount.replaceAll("\\.$", "")) <= 0) throw new NumberFormatException();
        } catch (NumberFormatException e) {
            Guard.end();
            line("✗ amount \"" + rawAmount + "\" must be greater than zero");
            toast("Amount must be greater than zero");
            refresh();
            return;
        }
        amountInput.setText(cleanAmount);

        // PIN: digits only. A PIN with a stray space or letter is what the network
        // answers with "Invalid PIN" — check it before dialling.
        String cleanPin = pin == null ? "" : pin.replaceAll("[^0-9]", "");
        if (!cleanPin.equals(pin == null ? "" : pin.trim())) {
            Guard.end();
            line("✗ the saved PIN contains something other than digits — save it again in SIM settings");
            toast("PIN must be digits only");
            refresh();
            return;
        }
        // Judge the PIN length by the wallet this SIM is configured for, not by the
        // APK flavour — a Nagad SIM inside the bKash build is still a Nagad PIN.
        Provider pinProvider = cfg.configured() ? Provider.byId(cfg.provider) : provider;
        if (!cleanPin.isEmpty() && pinProvider.pinLength > 0 && cleanPin.length() != pinProvider.pinLength) {
            line("! PIN has " + cleanPin.length() + " digits, " + pinProvider.name
                    + " usually uses " + pinProvider.pinLength + " — check SIM settings");
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
        numberState.setText("receiver: " + (numberInput.getText().toString().trim().isEmpty()
                ? "not set" : numberInput.getText().toString().trim()));
        amountState.setText("amount: " + (amountInput.getText().toString().trim().isEmpty()
                ? "not set" : amountInput.getText().toString().trim() + " BDT"));
        pinState.setText("PIN on this phone: " + (Secure.hasPin(this) ? "saved (encrypted)" : "not saved"));
        pinState.setTextColor(Color.parseColor(Secure.hasPin(this) ? "#4ade80" : "#fca5a5"));
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

    /** A bordered box that holds one value (number / amount / PIN). */
    private LinearLayout card(String title, String help) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(12), dp(10), dp(12), dp(12));
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setColor(Color.parseColor("#111113"));
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), Color.parseColor("#27272a"));
        box.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(14);
        box.setLayoutParams(lp);

        TextView h = new TextView(this);
        h.setText(title);
        h.setTextColor(Color.WHITE);
        h.setTextSize(15);
        h.setTypeface(Typeface.DEFAULT_BOLD);
        box.addView(h);
        TextView sub = new TextView(this);
        sub.setText(help);
        sub.setTextColor(Color.parseColor("#71717a"));
        sub.setTextSize(11);
        sub.setPadding(0, dp(2), 0, dp(6));
        box.addView(sub);
        return box;
    }

    private TextView state() {
        TextView tv = new TextView(this);
        tv.setTextColor(Color.parseColor("#a1a1aa"));
        tv.setTextSize(11);
        tv.setPadding(0, dp(6), 0, dp(6));
        return tv;
    }

    /** Saves one field on its own, without touching the others. */
    private void saveOne(String key, String value) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(key, value.trim()).apply();
        toast("Saved (" + key + ")");
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
        queueBox.setChecked(p.getBoolean("queueDryRun", false));
        serverInput.setText(p.getString("server", "https://boostpay.online"));
        tokenInput.setText(p.getString("token", ""));
    }

    // ── server queue (admin panel → this phone) ──────────────────────────────
    // The actual polling lives in QueueService (a foreground service), so a job is
    // still sent with the screen off. This Activity only starts/stops it and shows
    // the log.

    private void toggleQueue() {
        if (QueueService.isRunning()) {
            QueueService.stop(this);
            queueRunning = false;
            queueStart.setText("▶ Start picking jobs from the panel");
            queueState.setText("stopped");
            line("queue: stopped");
            return;
        }
        String server = Queue.cleanServer(serverInput.getText().toString());
        String token = tokenInput.getText().toString().trim();
        if (server.isEmpty() || !server.startsWith("https://")) {
            toast("Enter the server address, e.g. https://boostpay.online");
            return;
        }
        if (token.length() < 10) {
            toast("Paste the device token from the admin panel (SMS Bridge → the phone's token)");
            return;
        }
        if (!UssdService.isEnabled(this)) {
            toast("Turn on Settings → Accessibility → BoostPay Payout, otherwise a job cannot be sent");
        }
        saveSettings();
        queueRunning = true;
        queueStart.setText("■ Stop picking jobs");
        queueState.setText("starting the queue service…");
        QueueService.listener = (l, status) -> {
            queueState.setText(status + "  ·  " + QueueService.tail().split("\n")[0]);
            line("queue│ " + l);
        };
        QueueService.start(this);
    }

    /** One-shot check: is the token right and is the panel reachable? */
    private void testQueueConnection() {
        final String server = Queue.cleanServer(serverInput.getText().toString());
        final String token = tokenInput.getText().toString().trim();
        if (server.isEmpty() || token.length() < 10) { toast("Fill the server and the token first"); return; }
        queueState.setText("checking the panel…");
        new Thread(() -> {
            Queue.Reply r = Queue.next(server, token, true);
            ui.post(() -> {
                if (!r.ok) {
                    queueState.setText("✗ " + r.error + (r.hint.isEmpty() ? "" : "\n→ " + r.hint));
                    line("queue test: ✗ " + r.error);
                    if (!r.hint.isEmpty()) line("queue test: → " + r.hint);
                } else if (r.job == null) {
                    queueState.setText("✓ connected — the queue is empty (dry run only)");
                    line("queue test: ✓ connected, no job waiting");
                } else {
                    queueState.setText("✓ connected — a job is waiting: " + r.job.id);
                    line("queue test: ✓ connected, job " + r.job.id + " waiting");
                }
            });
        }).start();
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
                .putBoolean("queueMode", queueBox.isChecked())
                .putBoolean("queueDryRun", queueBox.isChecked())
                .putString("server", serverInput.getText().toString().trim())
                .putString("token", tokenInput.getText().toString().trim())
                .apply();
    }

    /** Once a second: keep the green/red card honest. */
    private final Runnable statusTicker = new Runnable() {
        @Override public void run() {
            try { paintStatus(); } catch (Throwable ignored) { }
            ui.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onDestroy() {
        ui.removeCallbacks(statusTicker);
        QueueService.listener = null;
        super.onDestroy();
    }

    @Override
    protected void onResume() {
        super.onResume();
        queueRunning = QueueService.isRunning();
        queueStart.setText(queueRunning ? "■ Stop queue" : "▶ Start queue");
        if (queueRunning) {
            QueueService.listener = (l, status) -> {
                queueState.setText(status + "  ·  " + QueueService.tail().split("\n")[0]);
                line("queue│ " + l);
            };
            queueState.setText("running (background service) · " + QueueService.lastStatus);
        }
        refresh();
    }

}
