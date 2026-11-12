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
        int http = 0;
        boolean ok;
        String error = "";
        String hint = "";
        Job job;                // null when the queue is empty
        long pollAfterMs = 4000;
    }

    /** Ask for the next job. Blocking — call it off the UI thread. */
    static Reply next(String server, String token, boolean dryRun) {
        Reply out = new Reply();
        try {
            JSONObject body = new JSONObject();
            body.put("dryRun", dryRun);
            body.put("mode", "queue");
            // the panel shows this, so the owner can see which build is on the phone
            try { body.put("appVersion", BuildConfig.VERSION_NAME); } catch (Throwable ignored) { }
            Res r = post(server, "/api/payout/next", token, body.toString());
            if (r == null || r.http == 0) {
                out.error = "the server did not answer — check the phone's internet and the address";
                out.hint = "correct address: " + CANONICAL;
                return out;
            }
            out.http = r.http;
            JSONObject res = r.json;
            if (res == null) {
                out.error = "the server answered " + r.http + " but not with JSON";
                out.hint = "correct address: " + CANONICAL;
                return out;
            }
            if (res.has("error")) {
                out.error = explain(r.http, res.optString("error"));
                out.hint = res.optString("hint", "");
                if (out.hint.isEmpty() && (r.http == 404 || r.http == 405)) {
                    out.hint = "use " + CANONICAL + " — the APK download site cannot take payouts";
                }
                return out;
            }
            if (r.http >= 400) {
                out.error = "the server refused the request (" + r.http + ")";
                return out;
            }
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
        return report(server, token, jobId, status, note, screenLog, "");
    }

    /** v2.1.6: the report carries the wallet's TrxID, so the panel and the customer see it. */
    static String report(String server, String token, String jobId, String status,
                         String note, String screenLog, String trxId) {
        try {
            JSONObject body = new JSONObject();
            body.put("status", status);
            body.put("note", note == null ? "" : note);
            body.put("log", screenLog == null ? "" : screenLog);
            if (trxId != null && !trxId.isEmpty()) body.put("trxId", trxId);
            Res r = post(server, "/api/payout/" + jobId + "/result", token, body.toString());
            if (r == null || r.json == null) return "the server did not answer";
            if (r.json.has("error")) return explain(r.http, r.json.optString("error"));
            return "";
        } catch (Throwable t) {
            return t.getClass().getSimpleName() + ": " + t.getMessage();
        }
    }

    /**
     * v2.1.3: the ↻ RETRY button. The phone asks the panel to put the SAME failed job
     * back in the queue — the server decides whether that is safe (a job that already
     * paid, or a withdrawal that was refunded, is refused).
     *
     * @return "" when the job is queued again, otherwise the server's reason.
     */
    static String retry(String server, String token, String jobId) {
        try {
            if (jobId == null || jobId.trim().isEmpty()) return "no failed job to retry";
            JSONObject body = new JSONObject();
            body.put("mode", "queue");
            Res r = post(server, "/api/payout/" + jobId + "/retry", token, body.toString());
            if (r == null || r.json == null) return "the server did not answer";
            if (r.json.has("error")) return explain(r.http, r.json.optString("error"));
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

    /** The one address that serves the payout API. */
    static final String CANONICAL = "https://management.boostpay.online";

    /** Hosts that look plausible but do NOT serve the payout API (they answer "GET only"). */
    private static final String[] NOT_THE_API = {
            "app.boostpay.online",          // the APK download portal
            "admin.72-60-42-18.sslip.io",   // the admin panel
    };

    /** Result of looking at what the owner typed. */
    static final class Fixed {
        String url = "";
        String note = "";                   // non-empty when the address had to be corrected
    }

    /**
     * v2.1.2: 2.1.1 asked the APK portal for jobs and got 405 "GET only".
     * Any known-wrong host is swapped for the real API address, and the owner is told.
     */
    static Fixed fixServer(String input) {
        Fixed f = new Fixed();
        f.url = cleanServer(input);
        if (f.url.isEmpty()) return f;
        for (String bad : NOT_THE_API) {
            if (f.url.contains(bad)) {
                f.note = bad + " is not the payout server → using " + CANONICAL;
                f.url = CANONICAL;
                break;
            }
        }
        return f;
    }

    /** Short, actionable text for the two mistakes that actually happen on a phone. */
    private static String explain(int http, String error) {
        String e = error == null ? "" : error.trim();
        if (http == 405 || "GET only".equalsIgnoreCase(e)) {
            return "this address is not the payout server (" + e + ")";
        }
        if (http == 404) return "no payout server at this address (404)";
        if (http == 502 || http == 503 || http == 504) return "the server is restarting (" + http + ") — try again in a minute";
        return e;
    }

    static String hint(String token) {
        if (token == null || token.length() < 4) return "••••";
        return "••••" + token.substring(token.length() - 4);
    }

    private static final class Res {
        int http = 0;
        JSONObject json;
    }

    private static Res post(String server, String path, String token, String json) {
        HttpURLConnection c = null;
        Res out = new Res();
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
            out.http = code;
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in == null) return out;
            StringBuilder sb = new StringBuilder();
            BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            r.close();
            String text = sb.toString();
            if (text.isEmpty()) return out;
            try { out.json = new JSONObject(text); } catch (Throwable ignored) { }
            return out;
        } catch (Throwable t) {
            return out;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
