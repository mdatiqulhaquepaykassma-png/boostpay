# ussd-payout — the *247# robot (test build)

A native Android app that walks a USSD money-transfer menu on the owner's own phone
and types the keys. Two engines, one plan:

| Method | What it does | Needs |
| --- | --- | --- |
| **A · USSD API** | `TelephonyManager.sendUssdRequest()` per key | Android 8+, Phone permission. Some phones/operators restart the session → engine stops and says so |
| **B · Accessibility** | dials the code, reads the dialog, fills its input box, presses Send | Settings → Accessibility → BoostPay Payout → On. Works on the live session, so it survives menu restarts |

## Safety, by design

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
  Guard.java          limits, cooldown, single-flight, daily counter
  Secure.java         Keystore-sealed PIN
```

## Build

```bash
JAVA_HOME=/home/user/jdk-17.0.12+7 ANDROID_HOME=/home/user/android-sdk \
GRADLE_USER_HOME=/home/user/.gradle-cache /home/user/bt/gradle-8.7/bin/gradle assembleRelease
# signed with the shared BoostPay key (keystore.b64), package com.boostpay.ussdpayout
cp app/build/outputs/apk/release/app-release.apk ../apk-portal/apks/boostpay-ussd-payout.apk
```

Download: `https://app.boostpay.online/ussdpayout`
