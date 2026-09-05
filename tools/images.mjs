/**
 * Generate the raster images that ship with the site: the social card and the
 * example QR code in the README.
 *
 * Run with `npm run images` after changing the branding or the renderer. The
 * output is committed, so the normal build does not need a browser.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const sources = {
	glyph: await read('../src/glyph.js'),
	qr: await read('../src/qr.js'),
	render: await read('../src/render.js'),
};

const REPO = 'https://github.com/tagadvance/static-qr';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto('about:blank');

const codes = await page.evaluate(
	async ({ sources, REPO }) => {
		const load = (source) =>
			'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(source)));
		const glyphUrl = load(sources.glyph);
		const { encode } = await import(load(sources.qr));
		const { renderCanvas } = await import(
			load(sources.render.replace("'./glyph.js'", JSON.stringify(glyphUrl)))
		);

		const draw = (text, moduleSize) => {
			const canvas = document.createElement('canvas');
			renderCanvas(canvas, encode(text, { errorCorrection: 'H' }), { moduleSize });
			return canvas.toDataURL();
		};

		return { card: draw(REPO, 12), readme: draw(REPO, 10) };
	},
	{ sources, REPO },
);

await writeFile(
	new URL('../images/qr-test.png', import.meta.url),
	Buffer.from(codes.readme.split(',')[1], 'base64'),
);

await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:630px;width:1200px}
  body{display:flex;align-items:center;gap:64px;padding:0 72px;box-sizing:border-box;
       background:linear-gradient(135deg,#fbf9f6,#f0e6d8);
       font:400 16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#241c14}
  img{width:340px;height:340px;flex:none;border-radius:16px;background:#fff;
      box-shadow:0 18px 50px rgba(60,40,20,.22)}
  h1{font-size:62px;line-height:1.05;margin:0 0 20px;letter-spacing:-.03em}
  p{font-size:28px;line-height:1.35;margin:0;color:#5f5347;max-width:16ch}
  .domain{margin-top:28px;font-size:24px;font-weight:700;color:#6b4423;letter-spacing:.02em}
</style></head><body>
  <img src="${codes.card}" alt="">
  <div>
    <h1>Static QR</h1>
    <p>A QR code generator that never sends your data anywhere.</p>
    <div class="domain">staticqr.com</div>
  </div>
</body></html>`);
await page.waitForLoadState('load');
await page.screenshot({
	path: fileURLToPath(new URL('../site/og.png', import.meta.url)),
	type: 'png',
});

await browser.close();
console.log('wrote site/og.png and images/qr-test.png');
