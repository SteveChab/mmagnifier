# Changelog

---

## 2026-09-23 — Autofocus camera selection, tap-to-focus, native-zoom constraint fix
**Type**: Fix
**Changed**: Diagnosed on a Galaxy A15 (SM-A156U, Android 14, Chromium 153) over CDP after reports
of blurry, grainy text, no autofocus and no tap-to-focus. Three root causes:

*Wrong lens.* `facingMode: 'environment'` gave `camera 2` — a fixed-focus rear lens whose only
focus mode is `manual`. The app could never autofocus. New `preferAutofocusCamera()` checks the
chosen camera's `focusMode` capability and, if `continuous` is missing, probes the other cameras
for a rear one that has it (here `camera 0`, the main camera: continuous + single-shot, 10 cm
minimum focus). The choice is stored under the `mmagnifier-camera` localStorage key, so the probe
runs once; a vanished id falls back to a fresh probe.

*Tap-to-focus gate was always false.* It required `'pointsOfInterest' in caps`, but
`pointsOfInterest` is a setting, never a capability. It now also enables when the camera offers
`single-shot` focus. The `pointsOfInterest` + `single-shot` call resolves on-device (Issue #4).

*Native zoom was always rejected.* Every zoom call bundled `sharpness: 8`; Android cameras don't
expose `sharpness`, and Chromium rejects the whole advanced set (`OverconstrainedError:
Unsupported constraint`, swallowed by `.catch`). New `zoomConstraints()` sends only supported
keys. This restores native zoom in browsers — **but not in the Android app**: Android WebView
hard-denies the pan/tilt/zoom permission, so the app never sees a `zoom` capability and all
zoom remains a canvas crop of the ~1080×2336 stream (recorded in ADR 0002). `takePhoto()` was
tested as a higher-res source for frozen frames; Chromium caps it at the same 2336×1440.

Freeze now keeps the frame shown at the live native zoom (`frozenDetailFrame`) and draws from it
whenever the paused view fits inside it, so pausing does not drop to a crop of the zoomed-out
capture. Inactive on Android WebView (no native zoom); applies on iOS and browsers.

**Regression checked**: yes — on-device via CDP: main camera selected and remembered, continuous
AF active, tap-to-focus call accepted, draw loop live. Label text on a supplement bottle sharp
at 1× with background defocused (previously soft across the frame).
**Tests**: Pass — **19 passing, 0 skipped** on the Galaxy A15 (first full run on real hardware; the
OCR/Issue #2 test ran instead of skipping because real print was in frame). Remembered camera
confirmed after the suite's app restarts. Tap-to-focus and close-range refocus still need a
manual eyeball check. `switchToWebView()` now targets `WEBVIEW_com.mmagnifier.app` explicitly —
with Brave's remote debugging on, the suite had attached to Brave and failed before any test.

---

## 2026-09-23 — Release signing wired for Play upload
**Type**: Build/Ops
**Changed**: Added a guarded `signingConfigs.release` to `native/android/app/build.gradle` that
loads the upload keystore path + credentials from `keystore.properties` at the project root
(alongside `web/`, outside the git repo). When that file is absent, release stays unsigned —
identical to prior behavior. No app runtime code changed. Produced the first signed release AAB
(`versionCode 1` / `versionName 1.1`, `com.mmagnifier.app`), verified signed with the mmagnifier
upload key (SHA-256 36:35:A7:…:F4:B0).
**Regression checked**: N/A — build config only; no runtime/color/camera/UI code touched.
**Tests**: WebDriverIO suite not run (no behavior change; needs a USB device). Signature and
package verified on the built artifact; on-device smoke test to follow during Step 2 screenshots.

---

## 2026-09-01 — Freeze/Zoom/Pan Test Coverage

**Type**: Feature (test coverage)

**Changed**: Added four end-to-end tests covering the area `TESTING.md` had flagged as entirely
manual — the freeze, zoom and pan subsystem rewritten on 29 May, which is the newest code in the app
and was the least guarded. Two of the behaviours it covers had already shipped as bugs once:

- **Issue #1 guard** — zoom out while paused must reveal the full image, not a small rect on black.
- **Pan while frozen** — a synthetic touch drag must move the frozen frame without introducing
  black bars.
- **Issue #2 guard** — a zoom change must not clear the OCR outlines, and the overlay must rescale.
- **Zoom persistence** across an app restart, the last uncovered row in the persistence group.

Helpers added: `canvasCoverage()` (fraction of sampled canvas points that are not near-black),
`canvasSignature()` (coarse fingerprint for detecting that content moved), and `setZoom(label)`
(taps the pill to a target level rather than assuming a fixed ladder, since levels are built from
the camera's reported capabilities).

**Regression checked**: yes — full suite run three times, no failures and no flakiness.

**Tests**: **18 passing, 1 skipped.** The skip is the OCR test: it needs printed text in frame, which
an emulator's virtual scene lacks, so it calls `this.skip()` rather than passing vacuously.

The Issue #1 assertion was verified to be discriminating rather than merely green: measured 94%
coverage on a healthy frozen frame, and 6% when the canvas was artificially rewritten into the
Issue #1 failure shape. The 70% threshold separates them cleanly.

---

## 2026-08-31 — Test Suite Green, and a Real Settings-Durability Bug

**Type**: Fix (test infrastructure + persistence)

**Changed**:

*The suite runs again, and it is reproducible.* `wdio.conf.js` pinned
`./drivers/chromedriver147`, a gitignored binary. ChromeDriver must match the target WebView's
major version, so the suite only ran on one machine against one device — and a fresh clone could
not run it at all. It now requests Appium's automatic chromedriver download instead, with
`CHROMEDRIVER=/path` as an offline escape hatch. Appium 3 requires the insecure-feature name in
`<automationName>:<feature>` form (`uiautomator2:chromedriver_autodownload`); the bare name that
Appium 2 accepted is now a hard error. WDIO's appium service does not reliably forward that flag,
so `APPIUM_EXTERNAL=1 npm test` was added to run against a server you start yourself:
`appium --allow-insecure=uiautomator2:chromedriver_autodownload --port 4723`.

*Settings could be silently lost.* `save()` debounces its `localStorage` write by 300 ms, and the
WebView flushes to disk asynchronously after that. Any preference changed inside that window was
lost if the process died — which is exactly what Android does to backgrounded apps. Added
`flushSave()`, a synchronous write, called on `visibilitychange` (hidden) and on `pagehide`. The
debounce still absorbs rapid button-mashing; the flush guarantees the last value survives teardown.

*The persistence tests were racing.* Both waited 400 ms against that 300 ms debounce plus an async
disk flush, then called `terminateApp()` — a force-stop, which grants no flush window at all. They
failed roughly one run in two. Widened to 1200 ms.

**Regression checked**: yes, and the flaky persistence failures were **proved pre-existing** rather
than assumed. The app was rebuilt from the unmodified `HEAD` version of `app/index.html` and the
suite run twice against it: it failed identically (one run 1 failure, the next 2) — the same pattern
as the modified build. The lifecycle work introduced no regression.

**Tests**: **Pass — 15/15, three consecutive runs**, on the Pixel_10 emulator (API 37). This is the
first recorded green run of the suite. Separately verified over the DevTools Protocol:
- Camera self-heal still intact after the `save()` refactor: killing the track leaves it `ended` at
  t+1s and `live` again by t+5s.
- The durability fix does what it claims: with a change still inside the debounce the on-disk value
  is stale, and dispatching `pagehide` commits it immediately (`modeIndex` 1 → 2).

**Still not covered**: torch LED, OCR against real print, TTS audio quality, real camera behaviour,
and Issue #22 under Android's real memory pressure. All need physical hardware.

---

## 2026-08-31 — Launch Blockers: Resume Bug, Brand Icons, Store Copy

**Type**: Fix + Feature (launch readiness)

**Changed**:

*Issue #22 — the app froze permanently after backgrounding.* Backgrounding let the OS reclaim the
camera; the `MediaStreamTrack` was left dead, no frames were delivered, and the draw loop (driven by
`requestVideoFrameCallback`) stopped ticking forever. The old handler was gated behind `if (!isNative)`
on the assumption the OS handled the native case — it does not. Replaced with a unified lifecycle
block covering both platforms, in three layers: (1) `visibilitychange` releases the camera on hide and
re-acquires on show; (2) a `track` `'ended'` listener catches the OS revoking the camera directly;
(3) a 1 Hz watchdog re-acquires if the draw loop has been silent for more than 2.5 s while visible.
The draw loop now stamps `lastFrameAt` on every tick *including while frozen* — the stream is still
live when paused, so a stalled tick means the camera died rather than that the user pressed Pause.
`requestCamera()` sets its own re-entry guard so every entry point is covered. A frozen frame survives
all three paths: the canvas keeps its pixels and `drawCurrentFrame()` is a no-op while frozen, so
someone mid-read returns to the same text and Resume works normally.

*Brand icons.* The app shipped the stock Capacitor logo as its launcher icon and splash screen. All
launcher icons (5 densities × legacy square, legacy round, and adaptive foreground), all 11 splash
screens, and the Play Store's 512×512 icon and 1024×500 feature graphic were regenerated from
`assets/logo-wordmark.svg`. The adaptive-icon background moved from white to brand black `#000000`.
Store assets live in `assets/play-store/`. Removed the leftover stock Capacitor icon vectors.

*Version.* `versionCode 1` (first Play upload) and `versionName "1.1"`, matching the feature set
the README documents. Previously `1.0`, which contradicted the docs.

*Landing page honesty.* The live site claimed "5 color modes" (there are 7) and "Tap to focus" for
the Android app — which per Issue #4 never fires on Android, because Chromium never wired
`pointsOfInterest` to Camera2. Corrected to 7 and to "Continuous autofocus", which is true on both.
The "Get it on Google Play" badge linked to a listing that returns 404; it is now a "Coming soon"
state, with the real badge preserved in a comment marked `LAUNCH DAY`.

*Privacy policy.* It listed two permissions; the built manifest declares four. Added `INTERNET` and
`ACCESS_NETWORK_STATE`, explaining that they come from ML Kit fetching its language model from Play
on first install, and noting that only Camera is ever user-prompted.

*TTS option key.* `app/index.html` passed `{ text, locale: 'en-US' }`, but the plugin's option is
`lang`. The key was silently ignored and the engine defaulted to `en-US`, so it worked by
coincidence and would have broken on the first non-English locale. Now `lang`.

*iOS unblocked.* `pod install` had never succeeded with OCR or TTS — `Podfile.lock` (5 May) contained
only Capacitor, CapacitorCordova and Torch. GoogleMLKit 8.0.0 needs a higher deployment target than
the project's `platform :ios, '15.0'` / `IPHONEOS_DEPLOYMENT_TARGET = 14.0`. Both raised to 16.0;
all 17 pods now resolve and `npm run sync` completes cleanly for both platforms for the first time.

*Repo hygiene.* `CLAUDE.md` was gitignored, so a fresh clone had no orientation file — un-ignored.
The engineering health-check skill lived only in the Claude application-support folder; copied to
`web/.claude/skills/` and corrected against the code (it described three buttons where the native
build has six, a fixed 11-level 1–6× zoom where levels are rebuilt from camera capabilities, and
"chartreuse" where the tint is `#00ff00`). Added the Node 24 and JDK 21 toolchain floors.

**Regression checked**: yes, on an Android emulator (Pixel_10, API 37) with the WebView debugger
attached. All 7 colour modes cycle in documented order and wrap correctly; `sepia()` absent from all
computed styles; 4 contrast levels; zoom steps 1×→3× all well-formed; every visible button ≥ 44×44 px
with an `aria-label`. No application logic outside the lifecycle block and the one TTS key was touched.

**Tests**: Pass (emulator + build). Verified directly:
- Issue #22 reproduction — pause → HOME → return: frozen frame preserved, button reads "Resume",
  and after tapping Resume the track is `live` with `video.currentTime` advancing 353.5 → 355.7 over
  two seconds. Before the fix this state was terminal.
- Watchdog — killing the track with `stop()` (which fires no `'ended'` event, so only the watchdog can
  catch it) left the track `ended` at t+1s and fully recovered to `live` by t+4s.
- TTS 8.0.2 — `speak()` and `stop()` both resolve; 81 supported languages enumerated.
- ML Kit 8.0.0 — OCR of a synthesised label returned 2 blocks reading "Take 2 tablets" / "twice daily".
- Debug APK and release AAB both build clean, `lintVitalRelease` included.

**Not covered**: torch LED (no LED on an emulator), OCR against real-world print, TTS audio quality,
real camera image quality, and the 15-spec Appium suite (not run — it needs a USB device and a
`chromedriver` matching that device's WebView). Issue #22 is deliberately left **open** pending
confirmation on real hardware.

---

## 2026-08-31 — Dependency, Capacitor, and Android SDK Modernization

**Type**: Refactor (toolchain / dependencies)

**Changed**: Brought the native toolchain current ahead of the Play Store launch. Capacitor core/android/ios 8.3.1 → 8.5.0, and the Capacitor CLI 7.6.2 → 8.5.0 (it had been a full major behind core, an unsupported combination). `@capacitor-community/text-to-speech` 6.1.0 → 8.0.2, which brings the last mismatched plugin in line with Capacitor 8's `>=8.0.0` peer requirement; torch (8.0.1) and ML Kit text recognition (8.0.0) were already current and are unchanged. All dependency versions are now **pinned exactly** rather than caret ranges, because the `patches/` files target exact versions and a floating range could silently install a version the patch cannot apply to. The TTS ProGuard patch was **deleted** rather than regenerated — version 8.0.2 fixed `proguard-android.txt` → `proguard-android-optimize.txt` upstream, so the patch is no longer needed. The ML Kit patch remains and still applies.

Android SDK levels moved to meet Google Play's requirement that took effect **31 August 2026**: `compileSdk` and `targetSdk` 35 → **36** (Android 16), and `minSdk` 23 → **24** to match Capacitor 8's floor. Dropping API 23 removes Android 6.0 devices, roughly 0.1% of the install base.

The Capacitor 8 CLI requires Node >= 22 and hard-fails on Node 20 (which reached end-of-life in April 2026). Node 24.20.0 LTS was installed via nvm and pinned to the native project with `native/.nvmrc`; the machine's global default Node is deliberately left at 20 so other projects are unaffected. **Run `nvm use` in `native/` before `npm run sync`.**

`npm audit` in `native/` went from 1 critical + 2 high (tar, tmp, brace-expansion) to zero. Three moderate advisories remain in `uuid` → `xcode` → `@capacitor/cli`; they are unfixable without downgrading the CLI, are build-time only, and never ship in the APK.

**Regression checked**: yes, at build level. Debug APK and release AAB both build clean, including `lintVitalRelease` and the full ProGuard path (the exact thing the patches existed to protect). Verified in the packaged APK: `targetSdkVersion 36`, `minSdkVersion 24`, all three plugin classes present (TextToSpeech, Torch, MlKitTextRecognition), and the web assets packaged at `assets/public/index.html`. `cap sync` reports all three plugins at the expected versions. No application source was modified — `app/index.html` is untouched.

**Tests**: Untested at runtime. No Android device was attached, so the 15-spec Appium suite could not run and no on-device behavior was exercised. Torch, OCR, TTS, camera, and the frozen-frame zoom/pan paths are unverified against the upgraded plugins. See TESTING.md for the required protocol before signing a release.

**Known issue, pre-existing**: iOS `pod install` fails — GoogleMLKit/TextRecognition 8.0.0 requires a higher deployment target than the project's `platform :ios, '15.0'` / `IPHONEOS_DEPLOYMENT_TARGET = 14.0`. `Podfile.lock` (5 May 2026) contains only Capacitor, CapacitorCordova and Torch — the TTS and ML Kit pods have never successfully resolved. This predates the upgrade and does not affect Android. Use `npx cap sync android` to sync Android alone.

---

## 2026-05-29 — Zoom/Pan/OCR Freeze Overhaul

**Type**: Fix (multiple bugs + regressions)

**Changed**: Rewrote the freeze-frame zoom and pan subsystem to support full zoom-in/out on paused images and to preserve OCR text outlines during zoom and pan. Previously, zooming out while paused showed a tiny image surrounded by black (the frozen canvas was CSS-scaled below 1×). The core fix: at freeze time, the native camera zoom is silently reset to minimum in the background, a full-resolution video frame (`frozenVideoFrame`) is captured asynchronously (~250 ms), and all subsequent zoom operations redraw the canvas directly from that full-res frame via `drawFrozenAtZoom()`. Pan is implemented as a source-crop offset inside `drawFrozenAtZoom` rather than a CSS transform, so it works correctly at any zoom level. OCR text-outline boxes are kept alive during zoom and pan via `updateOCROverlayTransform()`, which applies a CSS `translate + scale` to the overlay proportional to how much the zoom changed from when OCR ran (`ocrBlockZoom`). TTS is never interrupted by zoom or pan changes. Pause and Read share identical freeze/zoom/pan logic — the only difference is Read also triggers OCR.

**Fixes**: Issue #1 (zoom out while paused), Issue #2 (zoom stops TTS / clears OCR outlines)

**Regressions fixed in same session**: pan broken after canvas-redraw switch; OCR outlines disappearing on zoom in Read mode; Read mode zoom-out still showing black bars.

**Regression checked**: yes — color mode cycling, brightness cycling, Pause/Resume draw loop, OCR reentrancy guard, localStorage persistence all unaffected. Zoom and pan behavior verified by hand on device.

**Tests**: Partial — existing automated suite (color, brightness, Pause/Resume, OCR reentrancy, persistence) passes. New zoom-while-frozen, pan-while-frozen, and OCR-overlay-on-zoom behaviors are not yet covered by automated tests (tracked as a gap).

---

## 2026-05-29 — Automated Test Suite Added

**Type**: Feature (testing infrastructure)

**Changed**: Added WebDriverIO + Mocha end-to-end test suite (`tests/`) driven by Appium against the Android Capacitor build. Covers: color mode cycling (all 7 modes, correct order), brightness cycling (all 4 levels), zoom pill responsiveness (label format + `lastAppliedZoom` guard timing), Pause/Resume draw loop (timestamp-based), color mode while paused, zoom while paused (label only), OCR reentrancy (stale result discard), localStorage persistence across app restart (mode + brightness).

**Regression checked**: yes — suite was written alongside the fixes it guards.

**Tests**: Pass

---

## Prior work (pre-changelog)

See `git log` for earlier history. Notable commits:
- `8bc97e4` — add Purple/Black and Black/Purple modes; sharpen image; fix rotation bug
- `38f14a8` — OCR + TTS (Read button)
- `5281a6a` — always-canvas mode with native zoom as quality supplement (two-tier zoom pipeline)
