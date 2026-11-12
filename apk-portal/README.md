# apk-portal — app.boostpay.online

One tiny Node server (no dependencies) that hands out every BoostPay Android build.
It is its own Dokploy application so a broken main site never takes the download
links down with it.

| Link | What it serves |
| --- | --- |
| `/` | gallery page, one card per app |
| `/userapk` | BoostPay (user app) page + big Download button |
| `/agentapk` | BoostPay Agent |
| `/managementapk` | BoostPay Management |
| `/adminapk` | BoostPay Admin (private) |
| `/relayapk` | BoostPay SMS Relay |
| `/<slug>/download` | the APK itself (`application/vnd.android.package-archive`) |
| `/apks/<file>.apk` | direct file link (what the buttons use) |
| `/api/apks` | JSON: name, slug, size, sha256, build date |
| `/api/health` | `{"status":"ok"}` |

## How a new build gets here

```bash
npm run build            # or the sub-app: cd agent-app && npm run build
cd mobile
node scripts/prepare.mjs user          # user | agent | management | admin
npx cap sync android
cd android && ./gradlew assembleDebug  # or assembleRelease when signed
cp app/build/outputs/apk/debug/app-debug.apk ../../apk-portal/apks/boostpay-user.apk
```

or just `sh apk-portal/publish.sh user` (same thing, from the repo root).
Then commit `apk-portal/apks/*.apk` and push `main` — Dokploy's autoDeploy
rebuilds this app in ~1 minute and the new file is live.

The SMS relay APK additionally stays at `https://boostpay.online/download/boostpay-sms-relay.apk`
for the admin panel's existing button.
