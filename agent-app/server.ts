import express from 'express';
import path from 'path';

const API_TARGET = (process.env.API_PROXY_TARGET || 'http://boostpay-l2q4ry:3000').replace(/\/+$/, '');
const PORT = Number(process.env.PORT || 3000);
const APP_NAME = process.env.APP_NAME || 'boostpay-agent-app';

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
app.use(express.static(distDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

// Keep the console alive through per-request hiccups (proxy socket errors,
// upstream restarts, client aborts). Without this one SSE disconnect killed
// the whole admin console task.
process.on('uncaughtException', (err: any) => {
  console.error('[boostpay-agent-app] uncaughtException (kept alive):', String(err?.message || err));
});
process.on('unhandledRejection', (err: any) => {
  console.error('[boostpay-agent-app] unhandledRejection (kept alive):', String(err?.message || err));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${APP_NAME}] listening on :${PORT} (api -> ${API_TARGET})`);
});
