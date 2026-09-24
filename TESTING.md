# Testing

---

## Feature Coverage

| Feature | Automated | Manual | Notes |
|---|---|---|---|
| 7 color modes, correct order | ✅ `app.spec.js` | — | Cycles all 7, asserts short labels in order |
| 4 brightness levels | ✅ `app.spec.js` | — | |
| Zoom pill label format | ✅ `app.spec.js` | — | Asserts ends with `×` |
| `lastAppliedZoom` guard (rapid zoom timing) | ✅ `app.spec.js` | — | 3 rapid taps < 2 s |
| Pause → draw loop stops | ✅ `app.spec.js` | — | Timestamp-based |
| Resume → draw loop restarts | ✅ `app.spec.js` | — | Timestamp-based |
| Color mode works while paused | ✅ `app.spec.js` | — | |
| Zoom pill works while paused (label) | ✅ `app.spec.js` | — | Label only; visual not tested |
| OCR reentrancy guard | ✅ `app.spec.js` | — | Cancel immediately, assert no stale blocks |
| localStorage mode persistence | ✅ `app.spec.js` | — | Restart app, assert mode restored |
| localStorage brightness persistence | ✅ `app.spec.js` | — | Restart app, assert brightness restored |
| Settings survive a kill inside the save debounce | ✅ verified via CDP | — | `flushSave()` on `visibilitychange`/`pagehide` |
| localStorage zoom persistence | ✅ `app.spec.js` | — | Restart app, assert zoom restored |
| Camera live feed | ❌ | Manual | Glance at screen on open |
| Torch LED illuminates | ❌ | Manual | Tap Torch, check physical LED |
| Tap-to-focus | ❌ | Manual | Tap label text; focus should snap there (Issue #4 gate fixed 2026-09-23) |
| Main (autofocus) camera selected | ✅ verified via CDP | Manual | Galaxy A15: `camera 0`, focusMode includes `continuous`; label text sharp with background blurred |
| Landscape layout | ❌ | Manual | Rotate device, check vertical button stack |
| OCR reads real text | ❌ | Manual | Depends on camera/text |
| TTS audio speaks | ❌ | Manual | Listen when Read tapped |
| **Zoom out while frozen (full image)** | ✅ `app.spec.js` | — | Issue #1 guard: asserts canvas coverage > 70% |
| **Pan while frozen** | ✅ `app.spec.js` | — | Synthetic touch drag; asserts canvas changed, no black bars |
| **OCR outlines track through zoom/pan** | ⚠️ `app.spec.js` (skips) | Manual | Issue #2 guard; needs printed text in frame, so it skips on an emulator |
| **Read mode: zoom out reveals full image** | ✅ via Pause test | Manual | Identical code path to the Pause case, which is now covered |
| **TTS continues through zoom changes** | ❌ | Manual | `clearOCR()` must not be called on zoom |
| **Camera recovers after backgrounding** | ⚠️ Emulator | Manual | Issue #22 — verified via CDP, needs real-device confirmation |
| **Watchdog recovers a silently dead stream** | ⚠️ Emulator | Manual | Kill the track; must self-heal within ~4 s |
| **Frozen frame survives backgrounding** | ⚠️ Emulator | Manual | Canvas pixels + "Resume" label must persist |

---

## Manual Test Protocol

### Smoke (run after every change to `app/index.html`)
1. Camera feed visible, no console errors on open
2. Cycle all 7 color modes — correct labels in order, no red/pink hue in any mode
3. Zoom 1× → 6× → 1× via pill — label updates, no crash or layout break
4. Brightness 1× → 4× → 1× — label updates
5. Rotate to landscape — buttons shift to right vertical strip; rotate back

### Freeze / Zoom / Pan (run when `freezeFrame`, `drawFrozenAtZoom`, or `cycleZoom` touched)
1. Live feed at 1×: tap Pause → image freezes
2. While paused at 1×: zoom to 3× → image zooms in to show center crop
3. While paused at 3×: zoom back to 1× → **full image must be visible** (not a tiny rectangle on black)
4. While paused and zoomed in: drag to pan → image pans smoothly without black bars
5. Tap Resume → live feed restores at correct zoom; no ghost CSS transforms
6. Live feed at 3×: tap Pause → zoom to 1× → full image visible (same as step 3 but frozen while zoomed)

### Read / OCR (run when `runOCR`, `renderOCRBlocks`, `updateOCROverlayTransform`, or `clearOCR` touched)
1. Point at printed text; tap Read → frame freezes, OCR runs, TTS starts
2. While reading, zoom in → outlines **remain visible** over the correct text; TTS **continues uninterrupted**
3. While reading, zoom out → outlines scale down and stay over text; full image revealed at 1×
4. While reading, drag to pan → outlines move with the content
5. Tap Stop → outlines clear, TTS stops, frame stays frozen
6. Tap Resume → live feed restores
7. Tap Read again immediately after it starts (reentrancy) → OCR cancels, no stale outlines after 1 s

### Color system (run when MODES array or filter logic touched)
1. Each of 7 modes: verify correct foreground/background color, no red or pink hue
2. `sepia()` absent from all computed styles (open browser devtools → Elements → Computed)

### A11y spot-check (run when any button HTML or label changes)
1. All button touch targets ≥ 44×44 px (measure in devtools)
2. ARIA labels present on Color, Zoom, Brightness, Torch, Pause, Read buttons
3. Labels readable at max brightness and in inverted color modes

---

## Automated Suite Setup

## One-Time Machine Setup

### 0. Use the right Node version
The Capacitor 8 CLI requires Node >= 22 and hard-fails on Node 20. The project pins Node 24 LTS
via `native/.nvmrc`; the machine's global default is still Node 20, so you must select it per shell:

```bash
cd web/native && nvm use     # reads .nvmrc → Node 24
```

Skip this and `npm run sync` fails with `The Capacitor CLI requires NodeJS >=22.0.0`.
The `tests/` suite is unaffected and still runs on the default Node.

### 1. Enable USB debugging on your Android device
Settings → About phone → tap Build number 7 times → Developer options → USB debugging: ON

### 2. Install Appium and the Android driver (global, one-time)
```bash
npm install -g appium
appium driver install uiautomator2
```

**ChromeDriver is no longer pinned.** It must match the *major version* of the WebView on whatever
device is attached, and that differs between phones and emulators and moves every few weeks. The
config asks Appium to fetch the matching driver automatically. If you need to work offline, point
it at a local binary instead:

```bash
CHROMEDRIVER=/path/to/chromedriver npm test
```

If the automatic download does not engage (WDIO's appium service does not reliably forward the
required server flag on Appium 3), run the server yourself and use external mode:

```bash
appium --allow-insecure=uiautomator2:chromedriver_autodownload --port 4723
APPIUM_EXTERNAL=1 npm test
```

### 3. Rebuild the Android project
The `WebView.setWebContentsDebuggingEnabled` change in `MainActivity.java` requires a rebuild before Appium can see inside the WebView. Build the debug APK in Android Studio and install it on your device.

### 4. Install test dependencies
```bash
cd web/tests
npm install
```

---

## Running the Tests

1. Plug in the Android device via USB
2. Confirm it's visible: `adb devices`
3. Make sure the app is installed on the device
4. Run:
```bash
cd web/tests
npm test
```

Appium starts automatically, runs the full suite, and prints results. Takes ~2–3 minutes.

---

## Workflow

After making changes to `web/app/index.html`:
1. `cd web/native && nvm use && npm run sync`
2. Build + install debug APK in Android Studio
3. `cd web/tests && npm test`

---

## What the Tests Don't Cover

These features require manual eyeballing — they're stable, not regression-prone:
- Camera shows a live image (glance at the screen when the app opens)
- Torch LED illuminates (tap Torch, look at the physical LED)
- OCR reads actual text correctly (depends on real text in frame)
- TTS audio speaks (listen when Read is tapped)

Crashes in any of these will still appear in the Appium logcat output.

---

## Toolchain (Capacitor / plugins / Android SDK) — 2026-08-31

**Change**: Capacitor 8.3.1 → 8.5.0 (CLI 7.6.2 → 8.5.0), text-to-speech 6.1.0 → 8.0.2, versions pinned
exactly, TTS ProGuard patch removed (fixed upstream), compileSdk/targetSdk 35 → 36, minSdk 23 → 24,
Node 24 LTS pinned via `native/.nvmrc`.
**Risk**: **High** — native/Capacitor layer, which sits upstream of torch, OCR and TTS.

**Tests run**: Build-level only.
- `./gradlew assembleDebug` — Pass
- `./gradlew bundleRelease` — Pass, including `lintVitalRelease` and the full ProGuard path
- Packaged-artifact assertions — Pass: `targetSdkVersion 36`, `minSdkVersion 24`, TextToSpeech /
  Torch / MlKitTextRecognition classes all present in the dex, web assets at `assets/public/index.html`
- `npx cap sync` — Pass for Android, all 3 plugins resolved at expected versions

**Result**: Pass (build), **Untested (runtime)**

**Gaps** — nothing on-device was exercised, because no Android device was attached. Before signing a
release build, run the full suite plus these manual protocols, in this order:
1. `npm test` (all 15 specs) — guards color modes, contrast, zoom timing, pause/resume, OCR
   reentrancy, persistence
2. **Smoke** — camera feed, 7 color modes, zoom, brightness, landscape
3. **Read / OCR** — the highest-risk area: the TTS plugin jumped two major versions. Confirm TTS
   speaks, outlines render, tap-to-replay works, and TTS survives zoom and pan
4. **Torch** — confirm the LED still fires; the torch plugin talks to the camera while the web
   stream holds it, historically fragile
5. Install on an **API 24 device or emulator** if you can — minSdk moved and the floor is now untested

**Note**: `app/index.html` was not modified. Any behavior change here comes from the plugin layer, not
application code, which narrows where to look if something regresses.

---

## Launch blockers — 2026-08-31

**Change**: Issue #22 camera-recovery fix (3-layer lifecycle handling), brand icons and splash
screens replacing the stock Capacitor artwork, `versionName` 1.0 → 1.1, landing-page and privacy-policy
corrections, TTS `locale` → `lang`, iOS deployment target 14.0 → 16.0.
**Risk**: **High** — camera lifecycle sits at the top of the dependency chain.

**Tests run** — Android emulator (Pixel_10, API 37) with the WebView debugger on `localhost:9222`:

| Check | Result |
|---|---|
| Pause → HOME → return: frame preserved, button reads "Resume" | Pass |
| Resume after backgrounding: track `live`, `currentTime` 353.5 → 355.7 over 2 s | Pass |
| Watchdog: `track.stop()` → `ended` at t+1s → `live` again by t+4s | Pass |
| 7 colour modes, documented order, wraps to Color | Pass |
| `sepia()` absent from every computed style | Pass |
| 4 contrast levels 1×–4× | Pass |
| Zoom steps 1× → 3×, all labels well-formed | Pass |
| Touch targets ≥ 44×44 px | Pass (0 violations) |
| `aria-label` on every visible button | Pass (0 missing) |
| TTS 8.0.2 `speak()` / `stop()` / 81 languages | Pass |
| ML Kit OCR of a synthesised label → "Take 2 tablets", "twice daily" | Pass |
| Debug APK + release AAB build, `lintVitalRelease` included | Pass |
| Launcher icon shows the brand mark, not the Capacitor logo | Pass (visual) |

**Result**: Pass (emulator), **real hardware still required**

**Gaps** — an emulator cannot cover:
1. **Torch LED** — no physical LED. The torch plugin binds, but nothing proves the light comes on.
2. **OCR on real print** — validated against a synthesised canvas, not a medicine bottle under
   household lighting.
3. **TTS audio** — `speak()` resolves; nobody has heard it.
4. **Real camera behaviour** — autofocus, image quality, the native-zoom pipeline, and the
   frozen-frame full-res capture all depend on a real camera HAL.
5. **The Appium suite did not run.** It needs a USB device plus a `chromedriver` matching that
   device's WebView build; `tests/drivers/chromedriver147` is pinned and gitignored.
6. **Issue #22 on real hardware.** Android's real background/kill behaviour is more aggressive than
   the emulator's. The issue is deliberately left open until confirmed on a phone.

**Before signing a release build**, plug in the phone and run: `npm test`, then the Smoke,
Freeze/Zoom/Pan, and Read/OCR protocols above — with extra attention to Read/OCR, since
text-to-speech moved two major versions.

### Driving the app without a physical device

```bash
$ANDROID_HOME/emulator/emulator -avd Pixel_10 -camera-back virtualscene &
adb install -r web/native/android/app/build/outputs/apk/debug/app-debug.apk
adb shell pm grant com.mmagnifier.app android.permission.CAMERA
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.mmagnifier.app)
```

Debug builds enable `WebView.setWebContentsDebuggingEnabled`, so the page is reachable over the
Chrome DevTools Protocol. `Runtime.evaluate` can call `window.nextMode()` and friends, read
`video.currentTime` to prove the draw loop is alive, check
`srcObject.getVideoTracks()[0].readyState` for camera liveness, and invoke the Capacitor plugins
directly to confirm TTS and ML Kit still bind.

---

## Suite green — 2026-08-31

**Change**: chromedriver autodownload replacing the pinned gitignored binary; `flushSave()` for
settings durability; persistence-test waits widened 400 ms → 1200 ms.
**Risk**: Medium (test infrastructure) + Low (an additive synchronous write).

**Result**: **15/15 passing, three consecutive runs** on the Pixel_10 emulator (API 37) — the first
recorded green run of this suite.

**On the two flaky persistence tests**: they were failing about one run in two. Before changing
anything, the app was rebuilt from the unmodified `HEAD` version of `app/index.html` and the suite
run twice against it — it failed in exactly the same pattern. The flakiness was **pre-existing**,
not introduced by the lifecycle work.

Root cause: `save()` debounces 300 ms and the WebView flushes `localStorage` to disk asynchronously
after that; `terminateApp()` is a force-stop with no flush window. Fixed on both sides — the app now
flushes synchronously on teardown, and the tests no longer race a 100 ms margin.

**Gaps unchanged** — an emulator still cannot verify the torch LED, OCR against real print, TTS
audio, real camera behaviour, or Issue #22 under Android's true memory pressure.

---

## Freeze / zoom / pan now covered — 2026-09-01

**Change**: four tests added — zoom-out-while-frozen (Issue #1), pan-while-frozen,
OCR-outlines-survive-zoom (Issue #2), and zoom persistence across restart.

**Why these**: Issues #1 and #2 both shipped to users once, and this table listed the entire
freeze/zoom/pan area as manual-only. It is the newest code in the app and was the least guarded.

**Result**: **18 passing, 1 skipped**, stable across three runs.

The skip is deliberate. The OCR test needs printed text in the camera frame; an emulator's virtual
scene has none, so it calls `this.skip()` rather than passing vacuously. Point a real device at a
medicine label and it runs for real.

**The Issue #1 assertion was validated as discriminating**, not just observed to pass: it samples an
8×8 grid of canvas points and requires >70% non-black. Measured live at **94%** on a healthy frozen
frame; when the canvas was artificially rewritten into the Issue #1 failure shape — a small image
centred on black — it dropped to **6%**. The threshold sits cleanly between the two.

## Native build/signing — 2026-09-23
**Change**: Wired release signing (`keystore.properties`-driven `signingConfig`); built first signed AAB.  **Risk**: Low (build config only)
**Tests run**: `jarsigner -verify` → "jar verified"; signer cert = `CN=mmagnifier`; package = `com.mmagnifier.app`; `versionCode 1` / `versionName 1.1`.  **Result**: Pass
**Gaps**: On-device smoke (torch / pause frame / read-aloud) not yet re-run against the signed build — do this during Step 2 screenshot capture on the real device.

## Camera selection + focus + zoom constraints — 2026-09-23
**Change**: Pick a rear camera with continuous AF (remembered); tap-to-focus gated on `single-shot`; zoom constraints limited to reported caps; frozen frame keeps native-zoom detail.  **Risk**: High
**Tests run**: full WebDriverIO suite on Galaxy A15 (SM-A156U, Android 14, WebView 153), portrait, bottle label in frame; CDP checks of selected camera, focus mode and persisted id.  **Result**: Pass — 19/19, 0 skipped
**Gaps**: tap-to-focus visual confirmation (manual); camera choice on multi-lens phones (telephoto could be kept by the browser's default — untested, no device); iOS path untested. The suite must run in **portrait** — landscape hides button labels and every label assertion reads `''`.

