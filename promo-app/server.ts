import express from 'express';
import path from 'path';

const API_TARGET = (process.env.API_PROXY_TARGET || 'http://boostpay-l2q4ry:3000').replace(/\/+$/, '');
const PORT = Number(process.env.PORT || 3000);
const APP_NAME = process.env.APP_NAME || 'boostpay-promotion';

const app = express();
app.use(express.json({ limit: '20mb' }));

// Proxy all API calls to the main BoostPay API (same-origin for the browser)
app.use('/api', async (req, res) => {
  try {
    const targetUrl = API_TARGET + req.originalUrl;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const key = k.toLowerCase();
      if (['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding'].includes(key)) continue;
      // PROXY-CT-NORMALISE: a header sent twice arrives as "a, a" and express
      // refuses to parse the body. Keep only the first value.
      if (key === 'content-type' && typeof v === 'string' && v.includes(',')) { headers[key] = v.split(',')[0].trim(); continue; }
      if (typeof v === 'string') headers[key] = v;
      else if (Array.isArray(v)) headers[key] = v.join(', ');
    }
    const method = (req.method || 'GET').toUpperCase();
    const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const resp = await fetch(targetUrl, {
      method,
      headers,
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
      redirect: 'manual'
    });
    const outHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      const key = k.toLowerCase();
      if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) return;
      outHeaders[key] = v;
    });
    res.status(resp.status).set(outHeaders);
    // Server-Sent Events (chat live feed, admin notifications) never end, so
    // buffering the body made the proxy hang and answer 502. Stream those
    // responses straight through instead.
    const ctype = String(resp.headers.get('content-type') || '');
    if (ctype.includes('text/event-stream') && resp.body) {
      // @ts-ignore - Readable.fromWeb is available in Node 18+
      const { Readable } = await import('stream');
      // @ts-ignore
      const rs = Readable.fromWeb(resp.body as any);
      // A browser tab closing mid-stream must never crash the console process
      rs.on('error', () => { try { res.end(); } catch { /* already closed */ } });
      res.on('close', () => { try { rs.destroy(); } catch { /* ignore */ } });
      res.flushHeaders?.();
      rs.pipe(res);
      return;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    res.end(buf);
  } catch (err: any) {
    res.status(502).json({ error: 'API proxy error', detail: String(err?.message || err) });
  }
});

const distDir = path.resolve(process.cwd(), 'dist');

/**
 * GET /app — the installable entry point (owner request 2026-11-10).
 *
 * Opening https://<host>/app gives the phone's native "Install app" sheet: the
 * page is this app's normal SPA, and /app-manifest.json is a copy of the real
 * manifest whose start_url is /app, so the installed icon opens /app. The scope
 * stays "/" and the existing service worker (/sw.js) already covers it, so an
 * older install keeps working and nothing else on the host changes.
 */
app.get('/app', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  // app.html is index.html with the manifest link pointed at /app/manifest.json
  res.sendFile(path.join(distDir, 'app.html'));
});
app.get('/app/manifest.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(distDir, 'app-manifest.json'));
});

app.use(express.static(distDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

// Keep the console alive through per-request hiccups (proxy socket errors,
// upstream restarts, client aborts). Without this one SSE disconnect killed
// the whole admin console task.
process.on('uncaughtException', (err: any) => {
  console.error('[admin-console] uncaughtException (kept alive):', String(err?.message || err));
});
process.on('unhandledRejection', (err: any) => {
  console.error('[admin-console] unhandledRejection (kept alive):', String(err?.message || err));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${APP_NAME}] listening on :${PORT} (api -> ${API_TARGET})`);
});
