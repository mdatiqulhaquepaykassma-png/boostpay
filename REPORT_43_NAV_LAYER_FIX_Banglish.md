# REPORT 43 — Nav bar-er upore "dark layer" (boost button dhaka) — FIX

**Commit:** `cace469` · **Live:** `v1.2.1793609209` · **Tarikh:** 2 Nov 2026

## 1. Apnar report ta ki chilo

> "navigation bar er opore ekta extra dark layer hoye ache, layer ta navigation er moto fixed hoye ache" — Android installed PWA.

Thik dhorechen — oi "layer" ta kono overlay/modal chilo na, **layout-er faka space** chilo.

## 2. Asol cause

`src/App.tsx`-e bottom nav-er jonno clearance ta **scroll area-r baire** deya chilo:

```
<div className="... pb-[calc(7rem+env(safe-area-inset-bottom))]">   ← 112px faka
   <main className="flex-1 overflow-y-auto"> … </main>
</div>
<nav className="fixed bottom-0 z-40"> … </nav>
```

Tai: `<main>` 112px age sesh hoto → 112px-er moddhe nav 57px, ar **baki ~55px ekdom faka, kalo, fixed dekhte** — mane nav bar-er moto-i ekta extra dark layer. Phone-e safe-area inset (gesture bar) thakle ei faka aro boro hoto, ar page-er sesh card/boost button oi band-er dhare "harie" jeto.

**Proof (browser-e naapa):** `main.bottom = 732`, `nav.top = 787` → 55px dead gap.

## 3. Fix

- Outer container theke `pb-[7rem…]` **bad** diyechi.
- Padding ta ekhon **scroll area-r vitore**: `<main class="… pb-[calc(4.75rem+env(safe-area-inset-bottom))]">`.
- Mane: content nav-er niche diye scroll hoy, ar sesh content nav-er thik upore (~19px faka) giye thame.

Messenger tab-er nijossho padding (58px) age-r motoi rakha hoyeche — sekhane composer thik ache.

## 4. Verify (Playwright + local `:3901`, asol app, real login)

| Test | Age | Ekhon |
|---|---|---|
| `main.bottom` vs `nav.top` | -55px gap (dead band) | **-57px → content nav-er niche porjonto, kono band nei** |
| 320×568 / 360×640 / 390×844 / 414×896 | — | char tai-te-last card nav-er upore thame |
| "Start/Resume Boosting" button — element hit-test | top position-e `covered: true` (viewport-er baire) | bottom-scroll-e **`covered: false`** (tap kora jay) |
| Wallet / Leaders / Refer tab | — | `padBottom: 76px`, gap 0 |
| Chat tab (composer) | thik | **thik** (change hoyni) |
| `user-journey.py` | 65/65 | **65/65** |
| `regression.cjs` | 42/42 | **42/42** |
| `system-check.py` | no problems | **no problems** |
| `tsc --noEmit` + `vite build` | clean | **clean** |

Live bundle-e-o confirm: `4.75rem` padding class ar "paused ·" / "after 12am" string — deployed build-e ache.

## 5. Sathe choto polish (strip)

Paused obosthay strip age `0/0 · 0 left · $0/$0` dekhacchilo — orthohin. Ekhon:
- cycles group: `paused`
- money group: `paused · $2.29 held`

## 6. Screenshot

`shots/nav-band-before-after.png` — bame age (faka kalo band), dane ekhon (band nei).

## 7. Note

Ei layout change shudhu **spacing** — kono financial logic, API ba data touched hoyni. Tai risk zero; cha ile ek commit revert korlei purono obostha ferot.
