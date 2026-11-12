# ussd-payout — the USSD payout robot

A native Android app that walks a USSD money-transfer menu on the owner's own phone
and types the keys. **One codebase, two APKs** (product flavours):

| Flavour | appId | Service code | Default steps |
| --- | --- | --- | --- |
| `bkash` | `com.boostpay.ussdpayout` | `*247#` | `1,{number},{amount},1,{pin}` |
| `nagad` | `com.boostpay.ussdpayout.nagad` | `*167#` | `1,{number},{amount},{pin}` |

```bash
gradle assembleBkashRelease assembleNagadRelease
# apk/bkash/release/app-bkash-release.apk  → boostpay-ussd-payout.apk
# apk/nagad/release/app-nagad-release.apk  → boostpay-ussd-nagad.apk
```

Two engines, one plan:

| Method | What it does | Needs |
| --- | --- | --- |
| **A · USSD API** | `TelephonyManager.sendUssdRequest()` per key | Android 8+, Phone permission. Some phones/operators restart the session → engine stops and says so |
| **B · Accessibility** | dials the code, reads the dialog, fills its input box, presses Send | Settings → Accessibility → BoostPay Payout → On. Works on the live session, so it survives menu restarts |

## Safety, by design

* **Adaptive reading** (`Plan.decide`): each screen is matched to the value it asks
  for — pin / amount / number / reference — in English **and Bangla**, with the steps
  list as the fallback. A renumbered or reworded menu needs no new APK.
* **DRY RUN is the default path**: it walks the menu and stops before the key that
  contains `{pin}`. No PIN typed, no money can move.
* Live mode is gated by `Guard`: one run at a time, per-payout ceiling (default 500
  BDT), daily ceiling (default 3000 BDT), 15 s cooldown, and a typed confirmation
  (`amount` + last 4 digits of the receiver) in a dialog.
* A run that times out is reported as **UNKNOWN** and the daily budget is already
  spent — a blind retry can pay twice, so the app never retries on its own.
* The PIN is sealed with an AES-GCM key in the Android Keystore (`Secure.java`);
  the prefs file alone is useless on another phone.
* The app has no INTERNET permission: it cannot phone home, and nothing leaves the
  phone.

## Files

```
app/src/main/java/com/boostpay/ussdpayout/
  MainActivity.java   settings, limits, dry-run / live buttons, log (copyable)
  Plan.java           steps CSV → keys, {number} {amount} {pin} placeholders
  UssdApiEngine.java  method A state machine
  UssdService.java    method B: AccessibilityService that drives the dialog
  Provider.java       bKash/nagad presets (code, steps, PIN length, pacing)
  Guard.java          limits, cooldown, single-flight, daily counter
  Secure.java         Keystore-sealed PIN
```

## Test the menu reader without a phone

`Plan.java` is plain Java, so the reader is unit-tested on the JVM:

```bash
javac -encoding UTF-8 -d /tmp/pt com/boostpay/ussdpayout/Plan.java tools/PlanTest.java
java -cp /tmp/pt PlanTest      # 17 pass / 0 fail
```

## Build

```bash
JAVA_HOME=… ANDROID_HOME=… GRADLE_USER_HOME=… /home/user/bt/gradle-8.7/bin/gradle \
  assembleBkashRelease assembleNagadRelease
cp app/build/outputs/apk/bkash/release/app-bkash-release.apk ../apk-portal/apks/boostpay-ussd-payout.apk
cp app/build/outputs/apk/nagad/release/app-nagad-release.apk ../apk-portal/apks/boostpay-ussd-nagad.apk
```

Download: `https://app.boostpay.online/ussdpayout` · `https://app.boostpay.online/nagadpayout`
