package com.boostpay.smsrelay;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Everything the relay needs: settings, the HTTP call, and a tiny status log the
 * screen can show. Deliberately dependency-free (no Retrofit/OkHttp) so the APK
 * stays small and builds with nothing but the Android SDK.
 */
public final class Relay {

    public static final String TAG = "BoostPaySmsRelay";
    private static final String PREFS = "boostpay_sms_relay";

    public static final String KEY_SERVER = "server";
    public static final String KEY_TOKEN = "token";
    public static final String KEY_ENABLED = "enabled";
    public static final String KEY_LAST_STATUS = "last_status";
    public static final String KEY_LAST_AT = "last_at";
    public static final String KEY_SENT = "sent";
    public static final String KEY_CREDITED = "credited";

    public static final String DEFAULT_SERVER = "https://boostpay.online";

    private Relay() {}

    public static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static String server(Context c) {
        String s = prefs(c).getString(KEY_SERVER, DEFAULT_SERVER);
        if (s == null || s.trim().isEmpty()) s = DEFAULT_SERVER;
        s = s.trim();
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    public static String token(Context c) {
        return prefs(c).getString(KEY_TOKEN, "");
    }

    public static boolean enabled(Context c) {
        return prefs(c).getBoolean(KEY_ENABLED, false) && !token(c).isEmpty();
    }

    /** true when Android is likely to delay our broadcasts because of battery saving. */
    public static boolean batteryOptimised(Context c) {
        try {
            android.os.PowerManager pm = (android.os.PowerManager) c.getSystemService(Context.POWER_SERVICE);
            return pm != null && !pm.isIgnoringBatteryOptimizations(c.getPackageName());
        } catch (Throwable t) {
            return false;
        }
    }

    static String deviceLabel(Context c) {
        String model = (Build.MANUFACTURER + " " + Build.MODEL).trim();
        return model.length() > 40 ? model.substring(0, 40) : model;
    }

    /** POST one SMS to the server. Network work — never call on the main thread. */
    public static String send(Context c, String sender, String message, long receivedAt) {
        if (!enabled(c)) return "PAUSED (open the app and tap Save & start)";
        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put("sender", sender == null ? "" : sender);
            body.put("message", message == null ? "" : message);
            body.put("receivedAt", receivedAt);
            body.put("appVersion", "1.0.0");
            body.put("batteryOk", !batteryOptimised(c));
            body.put("deviceLabel", deviceLabel(c));

            URL url = new URL(server(c) + "/api/sms/ingest");
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("x-sms-token", token(c));
            conn.setDoOutput(true);
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            OutputStream os = conn.getOutputStream();
            os.write(payload);
            os.flush();
            os.close();

            int code = conn.getResponseCode();
            BufferedReader br = new BufferedReader(new InputStreamReader(
                    code >= 400 ? conn.getErrorStream() : conn.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            br.close();

            String text = sb.toString();
            String status;
            try {
                JSONObject j = new JSONObject(text);
                status = j.optString("status", code >= 400 ? ("HTTP " + code) : "SENT");
                if (j.has("error")) status = "HTTP " + code + " · " + j.optString("error");
                if (j.optBoolean("credit", false)) {
                    prefs(c).edit()
                            .putInt(KEY_CREDITED, prefs(c).getInt(KEY_CREDITED, 0) + 1)
                            .apply();
                }
            } catch (Exception e) {
                status = code >= 400 ? ("HTTP " + code) : "SENT";
            }
            note(c, status, true);
            Log.i(TAG, "ingest → " + status);
            return status;
        } catch (Throwable t) {
            note(c, "offline · " + t.getClass().getSimpleName(), false);
            Log.w(TAG, "ingest failed", t);
            return "offline · " + t.getMessage();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static void note(Context c, String status, boolean sent) {
        SharedPreferences.Editor e = prefs(c).edit();
        e.putString(KEY_LAST_STATUS, status);
        e.putLong(KEY_LAST_AT, System.currentTimeMillis());
        if (sent) e.putInt(KEY_SENT, prefs(c).getInt(KEY_SENT, 0) + 1);
        e.apply();
    }
}
