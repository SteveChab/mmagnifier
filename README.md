# mmagnifier

A mobile-optimized magnifying glass and binoculars app for people with low vision. Provides camera-based magnification with high-contrast color modes and simple, accessible controls.

## What It Does

mmagnifier turns your phone into both a handheld video magnifier and a pair of digital binoculars. It's designed for users with cone-rod dystrophy and other low-vision conditions who need to:

- Read text up close — labels, medicine bottles, menus, fine print
- See at a distance — watching a live performance, concert, or sports event from a far seat; reading a whiteboard or screen across a room

The app works in both directions. Point it at something nearby to magnify it; point it at something distant and zoom in to bring it closer.

### Core Features

- **Live camera magnification** — zoom levels built dynamically from hardware capabilities; 0.5× steps from 1–6×, then 1× steps to the camera's native optical max (e.g. 10×) on devices that expose zoom via WebRTC.
- **7 color modes** optimized for different vision needs:
  - Color (unfiltered camera)
  - Yellow/Black
  - Black/Yellow
  - Green/Black
  - Black/Green
  - Purple/Black
  - Black/Purple
- **4 contrast levels** — cycles 1×, 2×, 3×, 4×
- **Zoom pill** — compact zoom indicator in the top-right corner; tap it to cycle levels
- **Pinch-to-zoom** — continuous zoom gesture on the viewfinder
- **Tap-to-focus** — single tap on the viewfinder locks focus to that point (on supported devices)
- **Landscape support** — buttons automatically rotate to match device orientation, even with OS rotation lock on
- **Large, simple controls** — buttons with icon + label, designed for easy use with reduced visual acuity
- **Settings persistence** — last-used color mode, brightness, and zoom level are remembered across sessions

### Native App Features (v1.1)

The paid Android app includes additional controls not available in the browser:

- **Torch** — toggle the flashlight for illuminating close-up subjects
- **Pause** — pause the live camera feed; tap Resume to continue
- **Read** — freezes the frame, scans all text on-device (ML Kit OCR), and reads it aloud (TTS); tap any yellow-outlined block to re-read that section; tap Stop or Pause to exit
- **Pan while frozen** — drag on the viewfinder while paused or reading to pan around the frozen frame; zoom and OCR outlines track correctly

## Technical Architecture

### Technology Stack

- **Vanilla HTML/CSS/JavaScript** — no frameworks, no build step (web layer)
- **Ionic Capacitor** — native iOS/Android wrapper
- **CSS filters + blend modes** for color transformations
- **getUserMedia API** for camera access
- **MediaStreamTrack.applyConstraints** for native camera zoom and torch control

### Repository Structure

The git repository root is the web app itself, with the native project nested inside it. The landing page lives at the root; the web app is served from `/app/`; the native Capacitor wrapper lives in `/native/` and syncs from `app/index.html` into `native/www/`. End-to-end tests live in `/tests/` (see [Testing](#testing)). Native-only features (torch, freeze) are gated behind `Capacitor.isNativePlatform()` and invisible in the browser. `native/` is excluded from the GitHub Pages deployment via rsync in the workflow.

### Zoom Pipeline

The app uses a two-tier zoom strategy, auto-detected at startup:

1. **Tier A — Native track zoom** (when the platform exposes it): `track.applyConstraints(zoomConstraints(z))` drives the camera's own zoom, so the ISP crops the full sensor readout instead of the canvas upscaling the stream. `zoomConstraints()` sends only keys present in `track.getCapabilities()` — Chromium rejects the *entire* advanced set with `OverconstrainedError` if any one key is unsupported, which is how a bundled `sharpness: 8` silently disabled native zoom until Sept 2026. **Android WebView never exposes `zoom`**: it hard-denies the camera pan/tilt/zoom permission (`aw_permission_manager.cc`), so in the Android app this tier is always inactive. It does work in Android Chrome and on iOS Safari 17.4+.

2. **Tier B — Canvas crop from high-res stream** (always active): The `<video>` element is a hidden data source; the `<canvas>` is the visible display layer. `drawCurrentFrame()` crops a sub-region of the video frame to apply any zoom beyond the native hardware cap. The app asks for 4K, but what it gets is device- and browser-dependent — Chromium on a Galaxy A15 caps at 2336×1440 (delivered as 1080×2336 in portrait), and `ImageCapture.takePhoto()` is capped the same way, so it offers no extra detail for frozen frames.

`drawCurrentFrame()` lives at the outer IIFE scope so it can be called from four sites: the live draw loop, `render()` (zoom-while-frozen), `resize()` (rotate-while-frozen), and the initial camera start. Canvas `imageSmoothingQuality` is set dynamically per draw: `'high'` (Lanczos) when frozen for maximum detail, `'low'` (bilinear) during the live 30 fps feed for performance — a canvas resize resets this to the default so it must be re-applied on every draw call.

`lastAppliedZoom` guards `applyNativeZoom()` — it returns immediately when zoom hasn't changed, preventing a hardware `applyConstraints` call (which can stall the Android camera pipeline for ~1 s) on every color-mode or brightness button press.

The zoom level array is built dynamically from device capabilities so the app never promises a level it can't deliver crisply.

### How Color Modes Work

The app uses a two-layer approach to achieve color modes without hue distortion:

1. **Base layer** (`<video>` or `<canvas>`) with CSS filters:
   - `grayscale(1)` for dark-text modes
   - `invert(1) grayscale(1)` for light-text-on-dark modes
   - No filter for Color mode
   - User-controlled `contrast()` appended

2. **Tint overlay** positioned absolutely over the base layer:
   - `mix-blend-mode: multiply`
   - Background color set per mode (yellow `#ffff00`, white `#ffffff`)
   - Multiply math: `white × tint = tint`, `black × tint = black`

3. **Isolation context** on the viewfinder container (`isolation: isolate`) scopes the blend mode so it doesn't affect UI controls.

This approach avoids the red hue shift that comes from using `sepia()` filters.

### Torch Implementation

The torch uses `track.applyConstraints({ advanced: [{ torch: bool }] })` as the primary method — this works while the camera is already open via WebRTC. The Capacitor torch plugin is used as a fallback. Calling the plugin directly (which uses `CameraManager.setTorchMode()`) can throw a `CameraAccessException` on Android when the camera is already in use by the web stream.

### Autofocus

`facingMode: 'environment'` does not guarantee the main camera. On the Galaxy A15, Chromium picks a fixed-focus rear lens (`focusMode: ['manual']`), which can never autofocus. On first start `preferAutofocusCamera()` checks the chosen camera's `focusMode` capability; if it lacks `continuous`, it probes the other cameras for a rear one that has it. The winning `deviceId` is stored under the `mmagnifier-camera` localStorage key so later starts (and camera recovery) open it directly, falling back to a fresh probe if it disappears.

Tap-to-focus sends `pointsOfInterest` + `focusMode: 'single-shot'`, then reverts to continuous after 2 seconds. It is enabled when the camera offers `single-shot` focus. `pointsOfInterest` itself is a *setting*, never a capability, so the original `'pointsOfInterest' in caps` gate was always false on Android (Issue #4).

## Running Locally

### Web app
```bash
python3 -m http.server 8000
# Expose over HTTPS for camera access:
ngrok http 8000
```
Open on a mobile browser and allow camera access.

### Native app (requires Xcode + Android Studio)
```bash
cd native
nvm use               # .nvmrc pins Node 24 LTS — the Capacitor 8 CLI requires Node >= 22
npm run sync          # copies app/index.html + app/mmagnifier-logo.svg into www/, then cap sync
npx cap open android  # open in Android Studio
npx cap open ios      # open in Xcode (see note below)
```

Android targets `compileSdk`/`targetSdk` 36 with `minSdk` 24, matching Capacitor 8 and Google Play's
target-API requirement effective 31 August 2026.

> **iOS note:** `pod install` currently fails — GoogleMLKit/TextRecognition 8.0.0 requires a higher
> deployment target than the project's `platform :ios, '15.0'`. Use `npx cap sync android` to sync
> Android alone until the iOS deployment target is raised.

After editing `app/index.html`, run `npm run sync` from `native/` to push changes into both native projects.

## Testing

End-to-end Android tests live in `tests/` (WebDriverIO + Mocha via Appium). With a USB-attached Android device, run `cd tests && npm test`. Full setup, workflow, and coverage notes: see [TESTING.md](TESTING.md).

## Deployment

### Web Version — free, always will be

Live at **[mmagnifier.com/app](https://mmagnifier.com/app)**. Push to `main` and GitHub Actions deploys automatically via the custom domain (`CNAME: mmagnifier.com`). Can also be self-hosted on any static host (Netlify, Vercel, Cloudflare Pages, etc.).

### Native Apps — paid

iOS and Android apps are built with Ionic Capacitor. The native projects live in `native/` and use `native/www/` as the web asset staging directory (auto-populated by `npm run sync`). The native apps are distributed through the App Store and Google Play at a one-time price.

## Controls

### Web + native
- **Color button** (left) — Cycles through 7 color modes
- **Brightness button** (right) — Cycles through 4 contrast levels (1×, 2×, 3×, 4×)
- **Zoom pill** (top-right) — Tap to cycle zoom levels (1× to 6×)
- **Pinch gesture** (viewfinder) — Continuous zoom
- **Tap gesture** (viewfinder) — Tap-to-focus (on supported devices)

### Native app only
- **Torch button** — Toggle flashlight on/off
- **Pause button** — Pause/resume the live camera feed
- **Read button** — Scan the frozen frame with on-device OCR and read detected text aloud; tap any highlighted block to replay that section; tap Stop or Pause to exit

All buttons show their current state in the label beside the icon.

## Browser Compatibility

- **iOS Safari** — Full support (17.4+ for native zoom; 14+ for canvas fallback)
- **Android Chrome** — Full support (90+)
- **Desktop Chrome/Edge** — Works; native zoom varies by device
- **Firefox** — Mix-blend-mode support required (115+)

The app is mobile-first. Desktop use is not the primary target.

## Accessibility

- **Large touch targets** — 72px tall buttons with 38px icons and side-by-side labels
- **High contrast UI** — White on black, 2px borders
- **Bold serif labels** — 15px Times New Roman for readability
- **ARIA labels** — All buttons properly labeled for screen readers
- **No time-based interactions** — Everything is tap/click based

The UI itself is designed to be readable even when viewed through the app's own filters and magnification.

## License

All Rights Reserved © 2025–2026

This code is source-available for review but not open source. You may view it, but you may not copy, modify, distribute, or use it for commercial purposes without explicit permission.

The web version is free to use. The native apps are paid.

## Roadmap

### Native app v1.2
- Macro lens access (iPhone 13 Pro+ / recent Android flagships)

### Under consideration
- Optical zoom lens selector (ultra-wide / main / telephoto)
- Bookmarklet for browser injection
- Desktop browser extension

## Contact

For questions, feature requests, or collaboration: [contact@mmagnifier.com](mailto:contact@mmagnifier.com)
