/**
 * Renders codes in a real browser and decodes them with an independent
 * decoder.
 *
 * The unit tests prove the module matrix is right. They cannot prove that a
 * matrix drawn as a pile of emoji is still readable, and that turns out to be
 * the harder half of the problem: the 2018 version of this project produced
 * images that no decoder could read at all.
 *
 * Requires a browser: npx playwright install chromium
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  chromium = null;
}

const SOURCES = {
  glyph: readFileSync(new URL('../src/glyph.js', import.meta.url), 'utf8'),
  qr: readFileSync(new URL('../src/qr.js', import.meta.url), 'utf8'),
  render: readFileSync(new URL('../src/render.js', import.meta.url), 'utf8'),
};
const JSQR = readFileSync(new URL('../node_modules/jsqr/dist/jsQR.js', import.meta.url), 'utf8');

const PAYLOADS = [
  'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
  'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
  'https://staticqr.com/',
  'こんにちは世界',
  'Привет, мир',
  'The quick brown fox jumps over the lazy dog. '.repeat(8),
  'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=0.001&label=Donation',
];

const MODULE_SIZES = [5, 6, 8, 10, 14, 20, 26];

async function withPage(run) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    await page.addScriptTag({ content: JSQR });
    return await run(page);
  } finally {
    await browser.close();
  }
}

const browserAvailable =
  chromium !== null &&
  (await chromium
    .launch()
    .then((browser) => browser.close().then(() => true))
    .catch(() => false));

const options = browserAvailable
  ? {}
  : { skip: 'no browser available; run: npx playwright install chromium' };

test('every rendered code decodes back to its payload', options, async () => {
  const failures = await withPage((page) =>
    page.evaluate(
      async ({ sources, payloads, moduleSizes }) => {
        const load = (source) =>
          'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(source)));
        const glyphUrl = load(sources.glyph);
        const { encode } = await import(load(sources.qr));
        const { renderCanvas } = await import(
          load(sources.render.replace("'./glyph.js'", JSON.stringify(glyphUrl)))
        );

        const failed = [];
        for (const payload of payloads) {
          for (const ecl of ['L', 'M', 'Q', 'H']) {
            for (const moduleSize of moduleSizes) {
              const canvas = document.createElement('canvas');
              const result = encode(payload, { errorCorrection: ecl });
              const { extent } = renderCanvas(canvas, result, { moduleSize });
              const image = canvas.getContext('2d').getImageData(0, 0, extent, extent);
              const decoded = window.jsQR(image.data, extent, extent);
              if (!decoded || decoded.data !== payload) {
                failed.push(`version ${result.version} level ${ecl} at ${moduleSize}px`);
              }
            }
          }
        }
        return failed;
      },
      { sources: SOURCES, payloads: PAYLOADS, moduleSizes: MODULE_SIZES },
    ),
  );

  assert.deepEqual(failures, [], `${failures.length} rendered codes did not decode`);
});

test('the downloadable SVG decodes too', options, async () => {
  const failures = await withPage((page) =>
    page.evaluate(
      async ({ sources, payloads }) => {
        const load = (source) =>
          'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(source)));
        const glyphUrl = load(sources.glyph);
        const { encode } = await import(load(sources.qr));
        const { renderSvg } = await import(
          load(sources.render.replace("'./glyph.js'", JSON.stringify(glyphUrl)))
        );

        const failed = [];
        for (const payload of payloads) {
          const result = encode(payload, { errorCorrection: 'H' });
          const svg = renderSvg(result, { moduleSize: 12 });
          const image = new Image();
          image.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
          await image.decode();

          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d');
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
          const decoded = window.jsQR(pixels.data, canvas.width, canvas.height);
          if (!decoded || decoded.data !== payload) {
            failed.push(payload.slice(0, 32));
          }
        }
        return failed;
      },
      { sources: SOURCES, payloads: PAYLOADS },
    ),
  );

  assert.deepEqual(failures, [], `${failures.length} SVG codes did not decode`);
});
