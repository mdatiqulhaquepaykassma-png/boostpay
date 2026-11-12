package com.boostpay.smsrelay;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Setup screen for the relay. One job: hold the server address + device token,
 * prove it works, and show what the phone has forwarded so far.
 */
public class MainActivity extends Activity {

    private EditText serverInput;
    private EditText tokenInput;
    private TextView statusView;
    private TextView counterView;
    private Button startButton;
    private final Handler ticker = new Handler(Looper.getMainLooper());

    private static final int REQ_SMS = 41;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        int pad = dp(20);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.parseColor("#09090b"));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, dp(36), pad, dp(36));
        scroll.addView(root);

        TextView title = new TextView(this);
        title.setText("BoostPay SMS Relay");
        title.setTextColor(Color.WHITE);
        title.setTextSize(22);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(title);

        TextView sub = new TextView(this);
        sub.setText("Runs on the phone that holds the bKash / Nagad SIM. Every incoming SMS is forwarded to BoostPay; "
                + "a deposit is credited only when the TrxID in the SMS matches a deposit the user already submitted.");
        sub.setTextColor(Color.parseColor("#a1a1aa"));
        sub.setTextSize(12);
        sub.setPadding(0, dp(6), 0, dp(18));
        root.addView(sub);

        root.addView(label("Server address"));
        serverInput = input("https://boostpay.online", false);
        serverInput.setText(Relay.prefs(this).getString(Relay.KEY_SERVER, Relay.DEFAULT_SERVER));
        root.addView(serverInput);

        root.addView(label("Device token (from the admin console → SMS Bridge)"));
        tokenInput = input("BPX-…", false);
        tokenInput.setText(Relay.token(this));
        root.addView(tokenInput);

        startButton = new Button(this);
        startButton.setText("Save & start forwarding");
        startButton.setAllCaps(false);
        startButton.setOnClickListener(v -> saveAndStart());
        root.addView(startButton);

        Button test = new Button(this);
        test.setText("Send a test message now");
        test.setAllCaps(false);
        test.setOnClickListener(v -> sendTest());
        root.addView(test);

        Button battery = new Button(this);
        battery.setText("Allow background (battery)");
        battery.setAllCaps(false);
        battery.setOnClickListener(v -> askBattery());
        root.addView(battery);

        counterView = new TextView(this);
        counterView.setTextColor(Color.parseColor("#a1a1aa"));
        counterView.setTextSize(12);
        counterView.setPadding(0, dp(14), 0, dp(4));
        root.addView(counterView);

        statusView = new TextView(this);
        statusView.setTextColor(Color.parseColor("#d4d4d8"));
        statusView.setTextSize(12);
        root.addView(statusView);

        TextView note = new TextView(this);
        note.setText("\nThis app never reads your chats, contacts or photos. It only forwards SMS text and the sender id "
                + "to the address above, and it stops the moment you clear the token or the admin pauses the device.");
        note.setTextColor(Color.parseColor("#71717a"));
        note.setTextSize(11);
        root.addView(note);

        setContentView(scroll);
        askSmsPermission();
        refresh();
        ticker.postDelayed(new Runnable() {
            @Override
            public void run() {
                refresh();
                ticker.postDelayed(this, 2000);
            }
        }, 2000);
    }

    @Override
    protected void onDestroy() {
        ticker.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private TextView label(String text) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(Color.parseColor("#a1a1aa"));
        tv.setTextSize(11);
        tv.setPadding(0, dp(12), 0, dp(4));
        return tv;
    }

    private EditText input(String hint, boolean numeric) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setHintTextColor(Color.parseColor("#52525b"));
        e.setTextColor(Color.WHITE);
        e.setTextSize(14);
        e.setSingleLine(true);
        if (!numeric) e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        e.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return e;
    }

    private void saveAndStart() {
        String server = serverInput.getText().toString().trim();
        String token = tokenInput.getText().toString().trim();
        if (!server.startsWith("http")) {
            toast("Server must start with https://");
            return;
        }
        if (!token.startsWith("BPX-")) {
            toast("Paste the BPX-… token from the admin console");
            return;
        }
        Relay.prefs(this).edit()
                .putString(Relay.KEY_SERVER, server)
                .putString(Relay.KEY_TOKEN, token)
                .putBoolean(Relay.KEY_ENABLED, true)
                .putString(Relay.KEY_LAST_STATUS, "saved — waiting for an SMS")
                .apply();
        askSmsPermission();
        toast("Relay is ON");
        refresh();
    }

    private void sendTest() {
        String token = tokenInput.getText().toString().trim();
        if (token.isEmpty()) { toast("Enter the token first"); return; }
        Relay.prefs(this).edit()
                .putString(Relay.KEY_SERVER, serverInput.getText().toString().trim())
                .putString(Relay.KEY_TOKEN, token)
                .putBoolean(Relay.KEY_ENABLED, true)
                .apply();
        statusView.setText("sending a test…");
        new Thread(() -> {
            // a harmless line: the server parses it, finds no TrxID, and credits nothing
            String result = Relay.send(MainActivity.this, "TEST", "BoostPay relay test — no transaction", System.currentTimeMillis());
            runOnUiThread(() -> {
                statusView.setText("test result: " + result);
                refresh();
            });
        }, "bp-test").start();
    }

    private void askSmsPermission() {
        if (Build.VERSION.SDK_INT < 23) return;
        if (checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[]{
                Manifest.permission.RECEIVE_SMS,
                Manifest.permission.READ_SMS
        }, REQ_SMS);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_SMS) {
            boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            toast(ok ? "SMS permission granted" : "Without the SMS permission nothing can be forwarded");
            refresh();
        }
    }

    private void askBattery() {
        try {
            if (Build.VERSION.SDK_INT >= 23) {
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                i.setData(Uri.parse("package:" + getPackageName()));
                startActivity(i);
            }
        } catch (Throwable t) {
            try {
                startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            } catch (Throwable ignored) {
                toast("Open Settings → Apps → BoostPay SMS Relay → Battery → Unrestricted");
            }
        }
    }

    private void refresh() {
        boolean smsOk = Build.VERSION.SDK_INT < 23
                || checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;
        boolean on = Relay.enabled(this);
        startButton.setText(on ? "Relay is ON — tap to re-save" : "Save & start forwarding");

        int sent = Relay.prefs(this).getInt(Relay.KEY_SENT, 0);
        int credited = Relay.prefs(this).getInt(Relay.KEY_CREDITED, 0);
        counterView.setText("SMS forwarded: " + sent + "   ·   auto-credited deposits: " + credited
                + "\nPermission: " + (smsOk ? "granted" : "NOT granted")
                + "   ·   battery: " + (Relay.batteryOptimised(this) ? "optimised (may delay)" : "unrestricted"));

        String status = Relay.prefs(this).getString(Relay.KEY_LAST_STATUS, "nothing sent yet");
        long at = Relay.prefs(this).getLong(Relay.KEY_LAST_AT, 0);
        String when = at > 0 ? new SimpleDateFormat("dd MMM HH:mm:ss", Locale.US).format(new Date(at)) : "—";
        statusView.setText("Last result: " + status + "\nAt: " + when + "\nServer: " + Relay.server(this));
        statusView.setTextColor(on ? Color.parseColor("#d4d4d8") : Color.parseColor("#f59e0b"));
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
