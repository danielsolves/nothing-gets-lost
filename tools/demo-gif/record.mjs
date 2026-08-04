#!/usr/bin/env node
// tools/demo-gif/record.mjs
//
// where: run by hand against a local stack, not in CI.
// what: drives the demo the way a first-time visitor does and writes the frames that
//   become docs/demo.gif.
// why: the GIF in the README is the first thing anybody sees, and it goes stale every
//   time the page changes. It went stale once already, showing a counter bar that had
//   been removed. A script means the next redesign is a rerun rather than an
//   afternoon of screen recording.
//
// Usage:
//   docker compose up -d --wait          # the stack has to be running
//   node tools/demo-gif/record.mjs       # writes frames, calls ffmpeg, clears frames
//
// KEEP_FRAMES=1 leaves the frames on disk for inspection. They are not small.
//
// Playwright is not a dependency of this repository. It is only needed to refresh the
// GIF, and adding a browser download to every `npm ci` for that is a bad trade. So it
// is resolved the ordinary way and, when it is not there, PLAYWRIGHT points at an
// installation elsewhere:
//   PLAYWRIGHT=/path/to/node_modules/playwright node tools/demo-gif/record.mjs
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const PLAYWRIGHT = process.env.PLAYWRIGHT || 'playwright';
const URL = process.env.DEMO_URL || 'http://localhost:2520/';
const OUT = process.env.OUT_DIR || path.join(HERE, 'frames');
const GIF = process.env.OUT_GIF || path.join(HERE, '..', '..', 'docs', 'demo.gif');

// 10 frames a second. Fast enough that the retry counters do not stutter, slow enough
// that the file stays inside what GitHub will render inline.
const FPS = 10;
const FRAME_MS = 1000 / FPS;

// createRequire rather than import(), because Playwright is CommonJS and a bare
// import() of a package directory is not something ESM resolves.
//
// The failure is caught and named. Playwright is deliberately absent from this
// repository, so "cannot find module" is the expected first run for anybody who
// clones it, and an unhandled resolution error is a poor way to say "install this".
const load = createRequire(import.meta.url);
let pw;
try {
  pw = load(PLAYWRIGHT);
} catch {
  console.error(
    `Playwright could not be loaded from "${PLAYWRIGHT}".\n` +
    'It is not a dependency of this repository, because a browser download on every\n' +
    'npm ci is a bad trade for a script that refreshes one GIF. Either\n' +
    '  npm i -D playwright && npx playwright install chromium\n' +
    'or point PLAYWRIGHT at an existing installation:\n' +
    '  PLAYWRIGHT=/path/to/node_modules/playwright node tools/demo-gif/record.mjs',
  );
  process.exit(1);
}

/**
 * Captures frames for a while, so a wait is never a dead frame.
 *
 * The whole viewport, deliberately, not the element. Screenshotting the board
 * directly produces frames of different sizes the moment the order builder opens and
 * the panel grows, and ffmpeg's palette filter cannot join a sequence that changes
 * shape: it fails with "Internal bug, should not have happened", which is a
 * spectacularly unhelpful way of saying the frames do not match. The viewport is
 * sized around the board once, up front, and never moves again.
 */
async function film(page, ms, state) {
  const until = state.clock + ms;
  while (state.clock < until) {
    await page.screenshot({ path: path.join(OUT, `f${String(state.n).padStart(4, '0')}.png`) });
    state.n += 1;
    state.clock += FRAME_MS;
    await page.waitForTimeout(FRAME_MS);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await pw.chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  reducedMotion: 'no-preference',
});

// networkidle never fires here: the live log holds an SSE connection open for as
// long as the page is on screen. domcontentloaded plus a settle is the way in.
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

// Frame the board once and then hold still. Everything after this point is filmed
// through a viewport that never scrolls and never resizes, which is what keeps
// every frame the same shape.
//
// Measured with the order builder closed, which is the shape the clip is filmed
// in: the builder is opened to send and closed again straight after, so the machine
// stays framed and the aspect ratio stays readable in a README. Filming with it open
// gives a tall strip in which the interesting half is a thumbnail.
const box = await page.locator('section.board').first().boundingBox();
const MARGIN = 20;
await page.setViewportSize({
  width: 1280,
  height: Math.min(1400, Math.round(box.height) + MARGIN * 2),
});
await page.evaluate((top) => window.scrollTo(0, top), Math.round(box.y) - MARGIN);
await page.waitForTimeout(1200);

const state = { n: 0, clock: 0 };
const step = async (label, ms) => {
  console.log(`  ${String(state.n).padStart(4)}  ${label}`);
  await film(page, ms, state);
};

// Orders are placed through the API, not through the form.
//
// The form is a fine thing for a visitor and a bad thing for a camera: opening it
// adds several hundred pixels above the machine, so a frame measured around the
// machine either loses it off the bottom or has to be sized for a layout that only
// exists while the builder is open. Posting the order leaves the page exactly where
// it was, and what this clip is about is what the machine does next, not where the
// button is.
//
// Same origin, so the ui container proxies it to the api container.
const order = () => page.evaluate(
  () => fetch('/api/demo-order', { method: 'POST' }).then((r) => r.status),
);

await step('idle, so the eye lands before anything moves', 1200);

// An ordinary order, every line up.
await order();
await step('an ordinary order runs through', 5500);

// Cut one line. Each tile's menu carries that system's reachability, and the
// toggle is labelled for what it does rather than by the glyph on it.
// force, because a per-system note can drift over the tile while deliveries are
// still settling. The label is unique, so the target is not in doubt; what would
// otherwise happen is a thirty second wait for a floating element to move.
await page.getByRole('button', { name: 'Break HubSpot on purpose' })
  .click({ force: true });
await page.waitForTimeout(500);
await step('the menu on HubSpot', 900);

// Reachable, Slow, Unreachable. Unreachable is the one worth showing: the system
// is fine, the line to it is dead, and that is the case a queue exists for.
// Matched on text rather than accessible name: the option's label is a heading and
// a sentence in one control, so the computed name is the two run together.
await page.locator('button:has-text("Unreachable")').first().click({ force: true });
await page.keyboard.press('Escape');
await step('the line is cut', 1600);

// A second order into a broken world. waiting climbs, lost stays at zero.
await order();
await step('it holds, retries, and loses nothing', 9500);

await browser.close();

const frames = fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length;
console.log(`\n${frames} frames -> ${GIF}`);

// Two passes. One shared palette for the whole clip, otherwise the accent colour
// shifts from frame to frame and the counters shimmer.
const filters = 'scale=900:-1:flags=lanczos';
const palette = path.join(OUT, 'palette.png');
const input = path.join(OUT, 'f%04d.png');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-vf', `${filters},palettegen=stats_mode=diff`, palette]);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', input, '-i', palette,
  '-lavfi', `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`, GIF]);

const kb = Math.round(fs.statSync(GIF).size / 1024);
console.log(`done, ${kb} KB`);

// The frames are an intermediate and a heavy one: a run leaves roughly 190 PNGs at
// device scale 2, and two runs in one afternoon were enough to fill a boot disk to
// the point where no command would start.
//
// The wipe at the top of this file does not cover it. That one clears the previous
// run when a new one begins, so the last run of the day always stays on disk, which
// is exactly the run nobody comes back to.
//
// Kept when KEEP_FRAMES is set, because the one occasion they are worth having is a
// clip that came out wrong and the question of which frame it went wrong on.
if (process.env.KEEP_FRAMES) {
  console.log(`frames kept in ${OUT}`);
} else {
  fs.rmSync(OUT, { recursive: true, force: true });
}
