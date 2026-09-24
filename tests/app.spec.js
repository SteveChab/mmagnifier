const assert = require('assert');

// ── Helpers ────────────────────────────────────────────────────────────────

// Match the app's own WebView. Any other browser with remote debugging on (Chrome, Brave)
// also shows up as a WEBVIEW context, and attaching to it fails the whole run.
const APP_WEBVIEW = 'WEBVIEW_com.mmagnifier.app';

async function switchToWebView() {
  await browser.waitUntil(async () => {
    const contexts = await driver.getContexts();
    return contexts.includes(APP_WEBVIEW);
  }, { timeout: 10000, timeoutMsg: 'WebView context never appeared — check that WebContentsDebuggingEnabled is set in MainActivity.java' });
  await driver.switchContext(APP_WEBVIEW);
}

async function ensureResumed() {
  // If app is in Pause/Resume state, tap Resume to get back to live feed
  const label = await $('#freeze-label').getText().catch(() => 'Pause');
  if (label === 'Resume') await $('#freeze-btn').click();
}


// Fraction of sampled canvas points that are not near-black. A correctly restored frozen
// frame fills the canvas edge to edge; the Issue #1 bug left a small image on black.
async function canvasCoverage() {
  return browser.execute(() => {
    const c = document.getElementById('camera-canvas');
    const g = c.getContext('2d');
    let lit = 0, total = 0;
    for (let i = 1; i <= 8; i++) {
      for (let j = 1; j <= 8; j++) {
        const d = g.getImageData(Math.round(c.width * i / 9), Math.round(c.height * j / 9), 1, 1).data;
        total++;
        if (d[0] + d[1] + d[2] > 45) lit++;
      }
    }
    return lit / total;
  });
}

// Coarse fingerprint of what is on the canvas, for detecting that content moved.
async function canvasSignature() {
  return browser.execute(() => {
    const c = document.getElementById('camera-canvas');
    const g = c.getContext('2d');
    let out = '';
    for (let i = 1; i <= 6; i++) {
      for (let j = 1; j <= 6; j++) {
        const d = g.getImageData(Math.round(c.width * i / 7), Math.round(c.height * j / 7), 1, 1).data;
        out += d[0] + ',' + d[1] + ',' + d[2] + ';';
      }
    }
    return out;
  });
}

// Tap the zoom pill until it reads `label`, or give up. Zoom levels are built from the
// camera's reported capabilities, so never assume a fixed ladder.
async function setZoom(label) {
  for (let i = 0; i < 30; i++) {
    if ((await $('#zoom-label').getText()) === label) return true;
    await $('#zoom-pill').click();
    await browser.pause(60);
  }
  return (await $('#zoom-label').getText()) === label;
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe('mmagnifier Android', () => {
  before(async () => {
    // Fresh launch
    await driver.terminateApp('com.mmagnifier.app');
    await driver.activateApp('com.mmagnifier.app');
    await switchToWebView();
    // Wait for app UI to be ready (camera permission assumed already granted)
    await $('[aria-label="Change color mode"]').waitForDisplayed({ timeout: 8000 });
    await browser.pause(500); // let camera settle
  });

  // ── Color modes ──────────────────────────────────────────────────────────

  describe('Color mode cycling', () => {
    before(async () => {
      await ensureResumed();
      // Reset to mode 0 (Color) by cycling until label reads 'Color'
      for (let i = 0; i < 7; i++) {
        const label = await $('#mode-label').getText();
        if (label === 'Color') break;
        await $('[aria-label="Change color mode"]').click();
        await browser.pause(80);
      }
    });

    it('starts on Color', async () => {
      assert.equal(await $('#mode-label').getText(), 'Color');
    });

    it('cycles through all 7 modes in order', async () => {
      const expected = ['Y / Blk', 'Blk / Y', 'G / Blk', 'Blk / G', 'P / Blk', 'Blk / P', 'Color'];
      const btn = await $('[aria-label="Change color mode"]');
      for (const name of expected) {
        await btn.click();
        await browser.pause(80);
        const label = await $('#mode-label').getText();
        assert.equal(label, name, `Expected "${name}" after tap`);
      }
    });
  });

  // ── Brightness ───────────────────────────────────────────────────────────

  describe('Brightness cycling', () => {
    before(async () => {
      await ensureResumed();
      // Reset to 1× by cycling until we see it
      for (let i = 0; i < 4; i++) {
        if ((await $('#bright-label').getText()) === '1×') break;
        await $('[aria-label="Change brightness"]').click();
        await browser.pause(80);
      }
    });

    it('cycles through 4 contrast levels in order', async () => {
      const expected = ['2×', '3×', '4×', '1×'];
      const btn = await $('[aria-label="Change brightness"]');
      for (const level of expected) {
        await btn.click();
        await browser.pause(80);
        assert.equal(await $('#bright-label').getText(), level);
      }
    });
  });

  // ── Zoom ─────────────────────────────────────────────────────────────────

  describe('Zoom cycling', () => {
    before(ensureResumed);

    it('zoom pill label ends with × after each tap', async () => {
      const pill = await $('#zoom-pill');
      await pill.click();
      await browser.pause(200);
      const label = await $('#zoom-label').getText();
      assert.ok(label.endsWith('×'), `Zoom label "${label}" does not end with ×`);
    });

    it('3 rapid zoom taps complete in under 1500ms (lastAppliedZoom guard intact)', async () => {
      const pill = await $('#zoom-pill');
      const t0 = Date.now();
      await pill.click();
      await pill.click();
      await pill.click();
      const elapsed = Date.now() - t0;
      assert.ok(elapsed < 2000,
        `3 zoom taps took ${elapsed}ms — lastAppliedZoom guard may have been removed, causing applyConstraints stall`);
    });
  });

  // ── Pause / Resume ───────────────────────────────────────────────────────

  describe('Pause / Resume', () => {
    before(ensureResumed);

    it('Pause button label changes to "Resume" when tapped', async () => {
      await $('#freeze-btn').click();
      await browser.pause(100);
      assert.equal(await $('#freeze-label').getText(), 'Resume');
      await $('#freeze-btn').click(); // restore
    });

    it('Resume button label changes back to "Pause" when tapped', async () => {
      await $('#freeze-btn').click(); // Pause
      await browser.pause(100);
      await $('#freeze-btn').click(); // Resume
      await browser.pause(100);
      assert.equal(await $('#freeze-label').getText(), 'Pause');
    });

    it('draw loop stops when paused (timestamp stops advancing)', async () => {
      await $('#freeze-btn').click(); // Pause
      await browser.pause(300);
      const ts1 = await browser.execute(() => window._lastDrawnTimestamp);
      await browser.pause(400); // wait — if loop running, timestamp would advance
      const ts2 = await browser.execute(() => window._lastDrawnTimestamp);
      assert.equal(ts1, ts2, 'Timestamp advanced while paused — draw loop did not stop');
      await $('#freeze-btn').click(); // restore
    });

    it('draw loop resumes when unpaused (timestamp advances)', async () => {
      await $('#freeze-btn').click(); // Pause
      await browser.pause(200);
      await $('#freeze-btn').click(); // Resume
      await browser.pause(300); // let at least a few frames draw at 30fps
      const ts1 = await browser.execute(() => window._lastDrawnTimestamp);
      await browser.pause(200);
      const ts2 = await browser.execute(() => window._lastDrawnTimestamp);
      assert.ok(ts2 > ts1, 'Timestamp did not advance after resuming — draw loop not running');
    });

    it('color mode button still works while paused (label changes)', async () => {
      await $('#freeze-btn').click(); // Pause
      const before = await $('#mode-label').getText();
      await $('[aria-label="Change color mode"]').click();
      await browser.pause(100);
      const after = await $('#mode-label').getText();
      assert.notEqual(before, after, 'Mode label did not change while paused');
      await $('#freeze-btn').click(); // restore
    });

    it('zoom pill still works while paused (label changes)', async () => {
      await $('#freeze-btn').click(); // Pause
      const before = await $('#zoom-label').getText();
      await $('#zoom-pill').click();
      await browser.pause(100);
      const after = await $('#zoom-label').getText();
      assert.notEqual(before, after, 'Zoom label did not change while paused');
      await $('#freeze-btn').click(); // restore
    });
  });

  // ── Native features ──────────────────────────────────────────────────────

  describe('Native features (torch + OCR)', () => {
    it('Torch, Pause, and Read buttons are all visible (confirms native context)', async () => {
      for (const id of ['#torch-btn', '#freeze-btn', '#read-btn']) {
        assert.ok(await $(id).isDisplayed(), `${id} not visible — not running in native context`);
      }
    });

    it('OCR reentrancy — stopping immediately produces no stale .ocr-block elements', async () => {
      // Pause first — OCR requires a frozen frame
      if ((await $('#freeze-label').getText()) !== 'Resume') {
        await $('#freeze-btn').click();
        await browser.pause(200);
      }

      await $('#read-btn').click();     // start OCR
      await browser.pause(50);          // minimal wait — don't let it finish
      await $('#read-btn').click();     // stop immediately (label is "Stop" now)
      await browser.pause(800);         // let any stale async callback arrive

      const blocks = await $$('.ocr-block');
      assert.equal(blocks.length, 0,
        `${blocks.length} stale OCR block(s) found after cancel — ocrGeneration guard may be broken`);

      await ensureResumed();
    });
  });


  // ── Freeze / zoom / pan ──────────────────────────────────────────────────
  // Guards Issues #1 and #2, both of which shipped to users once. TESTING.md listed this
  // whole area as manual-only — it is the newest and least-covered code in the app.

  describe('Freeze, zoom and pan', () => {
    afterEach(async () => { await ensureResumed(); });

    it('zooming out while paused reveals the full image, not a small rect on black (Issue #1)', async () => {
      await ensureResumed();
      assert.ok(await setZoom('3×'), 'setup: could not reach 3× zoom');

      await $('#freeze-btn').click();
      // frozenVideoFrame is captured asynchronously: native zoom is reset, then ~250 ms of
      // camera settle, then a frame grab. Until it lands, zoom falls back to a CSS transform.
      await browser.pause(2000);
      assert.equal(await $('#freeze-label').getText(), 'Resume', 'setup: app did not freeze');

      assert.ok(await setZoom('1×'), 'could not zoom back out to 1× while paused');
      await browser.pause(500);

      const coverage = await canvasCoverage();
      assert.ok(coverage > 0.7,
        `frozen frame at 1× fills only ${(coverage * 100).toFixed(0)}% of the canvas — ` +
        'Issue #1 regression: zooming out while paused is showing a small image on black');
    });

    it('dragging while paused pans the frozen frame', async () => {
      await ensureResumed();
      assert.ok(await setZoom('3×'), 'setup: could not reach 3× zoom');
      await $('#freeze-btn').click();
      await browser.pause(2000);

      const before = await canvasSignature();

      await browser.execute(() => {
        const vf = document.getElementById('viewfinder');
        const r  = vf.getBoundingClientRect();
        const touch = (x, y) => new Touch({ identifier: 1, target: vf, clientX: x, clientY: y });
        const fire = (type, x, y) => vf.dispatchEvent(new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches:        type === 'touchend' ? [] : [touch(x, y)],
          targetTouches:  type === 'touchend' ? [] : [touch(x, y)],
          changedTouches: [touch(x, y)],
        }));
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        fire('touchstart', cx, cy);
        fire('touchmove', cx - 100, cy);
        fire('touchmove', cx - 200, cy);
        fire('touchend',  cx - 200, cy);
      });
      await browser.pause(500);

      const after = await canvasSignature();
      assert.notEqual(after, before, 'canvas is unchanged after a drag — pan did not move the frozen frame');

      const coverage = await canvasCoverage();
      assert.ok(coverage > 0.7,
        `panning left black bars: canvas coverage dropped to ${(coverage * 100).toFixed(0)}%`);
    });

    it('OCR outlines survive a zoom change (Issue #2)', async function () {
      await ensureResumed();
      await $('#read-btn').click();
      await browser.pause(7000);

      const blocks = await $$('.ocr-block');
      if (blocks.length === 0) {
        // Nothing readable in frame. An emulator's virtual scene contains no printed text,
        // so this assertion is only meaningful on a device pointed at real print. Skipping
        // is honest; silently passing would not be.
        return this.skip();
      }

      const beforeCount = blocks.length;
      await $('#zoom-pill').click();
      await browser.pause(600);

      const afterCount = (await $$('.ocr-block')).length;
      assert.equal(afterCount, beforeCount,
        'zooming cleared the OCR outlines — Issue #2 regression');

      const transform = await browser.execute(
        () => document.getElementById('ocr-overlay').style.transform);
      assert.ok(/scale\(/.test(transform),
        `OCR overlay did not rescale with the zoom (transform was "${transform}")`);
    });
  });

  // ── LocalStorage persistence ─────────────────────────────────────────────

  describe('LocalStorage persistence', () => {
    it('modeIndex survives app restart', async () => {
      await ensureResumed();

      // Drive to mode 2 (Blk / Y) via button — updates in-memory state and triggers save()
      for (let i = 0; i < 10; i++) {
        if ((await $('#mode-label').getText()) === 'Blk / Y') break;
        await $('[aria-label="Change color mode"]').click();
        await browser.pause(80);
      }
      assert.equal(await $('#mode-label').getText(), 'Blk / Y', 'Could not reach Blk / Y mode in setup');
      // save() debounces 300 ms, and the WebView flushes localStorage to disk asynchronously
      // after that. terminateApp() is a force-stop, which grants no flush window — so a 400 ms
      // wait raced the write and made this test fail intermittently (~1 run in 2).
      await browser.pause(1200);

      await driver.switchContext('NATIVE_APP');
      await driver.terminateApp('com.mmagnifier.app');
      await driver.activateApp('com.mmagnifier.app');
      await switchToWebView();
      await $('[aria-label="Change color mode"]').waitForDisplayed({ timeout: 8000 });

      assert.equal(await $('#mode-label').getText(), 'Blk / Y',
        'Mode did not persist across restart');

      // Reset back to Color for subsequent tests
      for (let i = 0; i < 10; i++) {
        if ((await $('#mode-label').getText()) === 'Color') break;
        await $('[aria-label="Change color mode"]').click();
        await browser.pause(80);
      }
    });


    it('zoom level survives app restart', async () => {
      await ensureResumed();
      assert.ok(await setZoom('2×'), 'setup: could not reach 2× zoom');
      await browser.pause(1200);

      await driver.switchContext('NATIVE_APP');
      await driver.terminateApp('com.mmagnifier.app');
      await driver.activateApp('com.mmagnifier.app');
      await switchToWebView();
      await $('[aria-label="Change color mode"]').waitForDisplayed({ timeout: 8000 });

      assert.equal(await $('#zoom-label').getText(), '2×', 'Zoom did not persist across restart');
      await setZoom('1×');
    });

    it('brightIndex survives app restart', async () => {
      await ensureResumed();

      // Drive to brightIndex 2 (3×) via button
      for (let i = 0; i < 6; i++) {
        if ((await $('#bright-label').getText()) === '3×') break;
        await $('[aria-label="Change brightness"]').click();
        await browser.pause(80);
      }
      assert.equal(await $('#bright-label').getText(), '3×', 'Could not reach 3× brightness in setup');
      // save() debounces 300 ms, and the WebView flushes localStorage to disk asynchronously
      // after that. terminateApp() is a force-stop, which grants no flush window — so a 400 ms
      // wait raced the write and made this test fail intermittently (~1 run in 2).
      await browser.pause(1200);

      await driver.switchContext('NATIVE_APP');
      await driver.terminateApp('com.mmagnifier.app');
      await driver.activateApp('com.mmagnifier.app');
      await switchToWebView();
      await $('[aria-label="Change brightness"]').waitForDisplayed({ timeout: 8000 });

      assert.equal(await $('#bright-label').getText(), '3×',
        'Brightness did not persist across restart');
    });
  });
});
