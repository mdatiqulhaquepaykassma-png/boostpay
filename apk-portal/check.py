#!/usr/bin/env python3
"""apk-portal smoke test — every link the user will click must work."""
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request

PORT = int(os.environ.get("PORT", "3998"))
BASE = f"http://127.0.0.1:{PORT}"
HERE = os.path.dirname(os.path.abspath(__file__))
PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def get(path):
    req = urllib.request.Request(BASE + path, method="GET")
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status, dict(r.headers), r.read()


def sha16(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]


def main():
    srv = subprocess.Popen([sys.executable and "node", "server.mjs"], cwd=HERE,
                           env={**os.environ, "PORT": str(PORT)},
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try:
                get("/api/health")
                break
            except Exception:
                time.sleep(0.25)

        status, _, body = get("/api/health")
        check("health 200", status == 200 and b'"ok"' in body, body[:40].decode())
        check("health names the service", b"apk-portal" in body)

        status, _, body = get("/")
        html = body.decode()
        check("index 200", status == 200)
        for slug in ("userapk", "agentapk", "managementapk", "adminapk", "relayapk", "ussdpayout"):
            check(f"index links /{slug}", f'href="/{slug}"' in html)
            check(f"index has a download button for {slug}", f'href="/{slug}/download"' in html)

        status, _, body = get("/api/apks")
        data = json.loads(body)
        check("api/apks lists every app", len(data["apps"]) == 6, str(len(data["apps"])))
        check("api/apks flags every file ready", all(a["ready"] for a in data["apps"]))

        for a in data["apps"]:
            slug = a["slug"]
            st, hdrs, page = get(f"/{slug}")
            check(f"/{slug} 200", st == 200, str(st))
            check(f"/{slug} shows its title", a["title"] in page.decode())
            check(f"/{slug} shows size", ("MB" in page.decode()) or ("KB" in page.decode()))

            st, hdrs, blob = get(f"/{slug}/download")
            check(f"/{slug}/download 200", st == 200, str(st))
            check(f"/{slug}/download mime",
                  hdrs.get("Content-Type") == "application/vnd.android.package-archive",
                  hdrs.get("Content-Type", ""))
            check(f"/{slug}/download is an APK zip", blob[:2] == b"PK", blob[:4].hex())
            check(f"/{slug}/download size matches api/apks", len(blob) == a["size"],
                  f"{len(blob)} vs {a['size']}")
            check(f"/{slug}/download sha256 matches api/apks", hashlib.sha256(blob).hexdigest()[:16] == a["sha256"])
            check(f"/{slug}/download filename header", 'attachment' in hdrs.get("Content-Disposition", ""))
            check(f"/{slug}/download nosniff", hdrs.get("X-Content-Type-Options") == "nosniff")

            st, _, __ = get(f"/apks/{a['file']}")
            check(f"/apks/{a['file']} direct link 200", st == 200, str(st))

        st = None
        try:
            get("/nope")
        except urllib.error.HTTPError as e:
            st = e.code
        check("/nope is 404", st == 404, str(st))

        st = None
        try:
            get("/nosuchapk/download")
        except urllib.error.HTTPError as e:
            st = e.code
        check("/nosuchapk/download is 404", st == 404, str(st))

        # POST is refused
        try:
            req = urllib.request.Request(BASE + "/api/apks", data=b"x", method="POST")
            urllib.request.urlopen(req, timeout=10)
            code = 200
        except urllib.error.HTTPError as e:
            code = e.code
        check("POST refused 405", code == 405, str(code))

        # nothing secret-leaking in the page
        _, _, home = get("/")
        low = home.decode().lower()
        check("index does not leak a token/key", "api_key" not in low and "secret" not in low)
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=10)
        except Exception:
            srv.kill()

    print(f"\n{len(PASS)} pass / {len(FAIL)} fail")
    if FAIL:
        print("failed: " + ", ".join(FAIL))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
