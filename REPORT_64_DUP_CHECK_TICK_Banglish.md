# REPORT 64 — Duplicate check tick (same IP / same device) — Banglish

**Date:** 2026-11-08
**Commit:** `11b0081` (push: `bea4068..11b0081`)
**Live:** `v1.2.1794169960`, promo console bundle `assets/index-BKK0LdgD.js`

---

## 1. Ki hoise (short)

User **#185** welcome bonus pailo (o nijei backfill chalaisilo), kintu **#186** paay nai.
Kaaron dhora porse — anti-fraud **same-IP check**:

- #185 ar #186 dui jon er IP ek: `59.152.4.164` (mobile **CG-NAT**, ek IP er pichone hazar hazar real user)
- #186 er bonus **hold** hoise → review row `RV-43696471`, status `PENDING`, reason `DUPLICATE_ACCOUNT`
- mane: bonus take "fraud" mone kore atke rekhe dise, actually o legitimate user

Ei karone ekhon **per-campaign tick** add kora hoise — kon kon duplicate signal dekha hobe, admin nijei select korbe.

## 2. Notun tick (campaign editor e)

Campaign editor e duita notun select:

| Tick | Options | Default |
|---|---|---|
| **Duplicate account check — same IP** | Hold for review / **Ignore the IP** | Hold (on) |
| **Duplicate account check — same device** | Hold for review / **Ignore the device** | Hold (on) |

Campaign card e ekta choto pill dekha jay: `dup: IP · device` (ba `dup: device` / `dup: no IP · device` etc.) — mane kon signal watch hocche.

Behaviour:
- Duita **on** → purono behaviour (same IP hole hold) — kono change nai
- **IP off, device on** → shared mobile IP er user ra pass, kintu ek device theke 2nd account dhora porbe ← **apnar problem er fix**
- **Duita off** → kichui hold hobe na (sudhu jodi apni iccha koren)

Server side `creditCampaignBonus` ei duita flag maney (`watchIp` / `watchDevice`), fraud bypass kore na — sudhu signal komay.

## 3. #186 er bonus ekhon ki korte hobe (1 click)

Bonus ta **review queue te already ache** (`RV-43696471`). Ami production admin hisebe login korte pari na, tai apnar ek click lagbe — duitar jekono ekta:

**(a) Fraud reviews panel (sohoj, recommended)**
Promo console → **Fraud reviews** → `RV-43696471` (#186, DUPLICATE_ACCOUNT) → **Approve & pay**
→ #186 er bonus balance e **$1** chole jabe, campaign `used` 1 → 2.

**(b) Backfill diye**
Promo console → WELCOME card → **Give to existing users** → user id: `186` → run (dry-run dekhabe 1, tarpor confirm)।

**Duita tei ek e jinis** — approve hole server `REVIEW_APPROVED` reason diye grant kore, idempotent.

## 4. Er pore — future e ei problem jeno na hoy

WELCOME campaign ta edit koren ar ei tick ta din:

> **Duplicate account check — same IP → "Ignore the IP"**
> (device check ta **on** rekhe din)

Tarpor theke mobile er shared IP er karone kono real user hold hobe na, kintu ek device theke bar bar account khulle seta dhora porbe.

## 5. Test (local, sob pass)

| Suite | Result |
|---|---|
| User journey (notun **§26** — 8 check) | **320 pass / 0 fail** |
| Regression | 42 pass / 0 fail |
| System check | no problems |
| tsc (server, user, admin, promo) + promo vite build | clean |

§26 jeita proof kore:
1. IP check on → 1st user paid, 2nd **PENDING_REVIEW**
2. **IP check off → ek shared IP er dui jon real user duijonei paid** ✅ (eta apnar #186 case)
3. IP off holeo **same device** dhora pore
4. duita off → kichui hold hoy na
5. Review queue te held row ase, **Approve & pay** korle paid
6. Campaign list e `dupIp` / `dupDevice` report hoy (console tick dekhay)

## 6. Deploy verify (live)

```
GET /api/health            → {"status":"ok","version":"v1.2.1794169960"}
promotion.boostpay.online  → assets/index-BKK0LdgD.js  (notun console)
VPS DB (read-only)         → #186: RV-43696471 still PENDING, grants 0   ← apnar click baki
```

## 7. Note

- Purono campaign (`CMP-20818670`) e duita tick **on** e ache — mane ekhono same-IP hold hobe. Tick flip na korle #187, #188... shared IP hole abar hold hobe.
- Ami production DB te directly write kori nai (safety rule) — sudhu read-only check korechi.
- Revert path: `git revert 11b0081` — tick default on, tai revert korleo purono behaviour e fire jabe.

---
**Kortabbo (apnar panel theke):**
1. Fraud reviews → `RV-43696471` → **Approve & pay** → #186 pabe $1
2. WELCOME campaign edit → **same IP → Ignore the IP** (device on)
