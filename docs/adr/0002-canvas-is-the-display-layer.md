# 0002 — Canvas is always the display layer; native zoom is a quality supplement

**Status**: Accepted

## Context

The app must zoom well beyond the hardware's optical limit, on a huge range of devices, and stay
sharp — its users are reading fine print. Two obvious approaches: CSS-transform the `<video>`, or
drive the camera's own zoom via `applyConstraints`.

## Decision

The `<video>` element is a hidden data source (`#camera { opacity: 0 }`). A `<canvas>` is the only
visible layer. Every frame is drawn by cropping a sub-region of the video. Native track zoom, when
the device exposes it, pre-zooms the *stream* as a quality supplement; the canvas crop supplies any
remaining factor.

## Why

- CSS upscaling of a `<video>` interpolates from the *displayed* resolution and goes soft fast.
  Cropping a 4K source stays sharp far longer.
- Native zoom alone caps at the hardware limit and varies wildly across devices.
- One display path means colour filters, freeze, pan, and OCR overlays all compose against a single
  surface instead of two code paths that drift apart.

`imageSmoothingQuality` is set per draw: `'high'` when frozen (detail matters, cost does not),
`'low'` during the live 30 fps feed. A canvas resize resets it, so it must be re-applied on every
draw call.

`applyNativeZoom()` is guarded by `lastAppliedZoom`: on Android an `applyConstraints` call can stall
the camera pipeline for ~1 s, and `render()` fires on every button press.

## Consequences

- `drawCurrentFrame()` must stay callable from all four sites (live loop, `render()`, `resize()`,
  camera start).
- Anything that clears the canvas must restore the frozen frame — see `resize()`.
- **Android WebView never exposes native zoom** — it hard-denies the pan/tilt/zoom permission, so
  in the Android app every zoom level is a canvas crop of the stream (≈1080×2336 on a Galaxy A15).
  Real optical detail beyond that would need a native camera layer (e.g. CameraX), which would
  supersede this record. Confirmed on-device 2026-09-23.
- Constraint sets sent with `applyConstraints` must contain only capabilities the track reports —
  one unsupported key rejects the whole set. Use `zoomConstraints()`.
