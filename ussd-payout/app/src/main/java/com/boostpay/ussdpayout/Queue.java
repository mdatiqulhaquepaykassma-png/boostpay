package com.boostpay.ussdpayout;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * The "server queue" mode: the admin panel writes a payout job, this phone asks for
 * it, sends it, and reports what happened.
 *
 *   admin panel  ▸ POST /api/payout/next   (this app, every few seconds)
 *                ▸ POST /api/payout/{id}/result
 *
 * Two rules this class keeps, on purpose:
 *   · The token never appears in the log; only its last four characters are shown.
 *   · A phone in DRY RUN asks only for TEST jobs, so a mistake in the panel cannot
 *     make a real withdrawal leave the wallet while the owner is watching the menu.
 *
 * Plain HttpURLConnection + org.json: no libraries, nothing to keep up to date.
 */
final class Queue {

    private Queue() { }

    /** One job as the server describes it. */
    static final class Job {
        String id = "";
        String kind = "TEST";
        String provider = "nagad";
        String number = "";
        String amount = "";     // BDT, as text so "100.5" survives untouched
        String ref = "1";
        String note = "";
    }

    static final class Reply {
        boolean ok;
        String error = "";
        Job job;                // null when the queue is empty
        long pollAfterMs = 4000;
    }

    /** Ask for the next job. Blocking — call it off the UI thread. */
    static Reply next(String server, String token, boolean dryRun) {
        Reply out = new Reply();
        try {
            JSONObject body = new JSONObject();
            body.put("dryRun", dryRun);
            JSONObject res = post(server, "/api/payout/next", token, body.toString());
            if (res == null) { out.error = "the server did not answer"; return out; }
            if (res.has("error")) { out.error = res.optString("error"); return out; }
            out.ok = true;
            out.pollAfterMs = Math.max(2000, res.optLong("pollAfterMs", 4000));
            JSONObject j = res.optJSONObject("job");
            if (j != null && j.optString("id", "").length() > 0) {
                Job job = new Job();
                job.id = j.optString("id");
                job.kind = j.optString("kind", "TEST");
                job.provider = j.optString("provider", "nagad");
                job.number = j.optString("number");
                job.amount = j.optString("amountBdt");
                job.ref = j.optString("ref", "1");
                job.note = j.optString("note", "");
                out.job = job;
            }
            return out;
        } catch (Throwable t) {
            out.error = t.getClass().getSimpleName() + ": " + t.getMessage();
            return out;
        }
    }

    /** "SENT" (live, wait for the SMS), "DRYRUN" (nothing left the wallet) or "FAILED". */
    static String report(String server, String token, String jobId, String status,
                         String note, String screenLog) {
        try {
            JSONObject body = new JSONObject();
            body.put("status", status);
            body.put("note", note == null ? "" : note);
            body.put("log", screenLog == null ? "" : screenLog);
            JSONObject res = post(server, "/api/payout/" + jobId + "/result", token, body.toString());
            if (res == null) return "the server did not answer";
            if (res.has("error")) return res.optString("error");
            return "";
        } catch (Throwable t) {
            return t.getClass().getSimpleName() + ": " + t.getMessage();
        }
    }

    /** Normalises what the owner types: "app.boostpay.online" → "https://app.boostpay.online". */
    static String cleanServer(String input) {
        String s = input == null ? "" : input.trim();
        if (s.isEmpty()) return "";
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://" + s;
        return s;
    }

    static String hint(String token) {
        if (token == null || token.length() < 4) return "••••";
        return "••••" + token.substring(token.length() - 4);
    }

    private static JSONObject post(String server, String path, String token, String json) {
        HttpURLConnection c = null;
        try {
            URL url = new URL(cleanServer(server) + path);
            c = (HttpURLConnection) url.openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(12000);
            c.setReadTimeout(20000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            c.setRequestProperty("x-payout-token", token == null ? "" : token);
            c.setRequestProperty("Accept", "application/json");
            byte[] payload = json.getBytes(StandardCharsets.UTF_8);
            OutputStream os = c.getOutputStream();
            os.write(payload);
            os.flush();
            os.close();
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in == null) return null;
            StringBuilder sb = new StringBuilder();
            BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            r.close();
            String text = sb.toString();
            if (text.isEmpty()) return null;
            return new JSONObject(text);
        } catch (Throwable t) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
