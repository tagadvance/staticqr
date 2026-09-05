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

import { correctDecoder } from '../tools/build.mjs';

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
// The same corrected decoder the site serves, so these tests exercise
// production rather than a decoder with a known version 23 defect.
const JSQR = correctDecoder(
	readFileSync(new URL('../node_modules/jsqr/dist/jsQR.js', import.meta.url), 'utf8'),
);

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

test('every version decodes at both extremes of error correction', options, async () => {
	// The corpus reaches versions 2 to 20 only, which is how a decoder defect
	// at version 23 went unnoticed until it was reported as a rendering fault.
	const failures = await withPage((page) =>
		page.evaluate(
			async ({ sources }) => {
				const load = (source) =>
					'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(source)));
				const glyphUrl = load(sources.glyph);
				const { encode, capacityBytes } = await import(load(sources.qr));
				const { renderCanvas, renderCanvasPlain } = await import(
					load(sources.render.replace("'./glyph.js'", JSON.stringify(glyphUrl)))
				);

				const failed = [];
				for (let version = 1; version <= 40; version++) {
					for (const ecl of ['L', 'H']) {
						const payload = 'a'.repeat(capacityBytes(version, ecl));
						const result = encode(payload, { errorCorrection: ecl, minVersion: version });
						for (const [name, draw] of [
							['poo', renderCanvas],
							['plain', renderCanvasPlain],
						]) {
							const canvas = document.createElement('canvas');
							const { extent } = draw(canvas, result, { moduleSize: 8 });
							const image = canvas.getContext('2d').getImageData(0, 0, extent, extent);
							const decoded = window.jsQR(image.data, extent, extent);
							if (!decoded || decoded.data !== payload) {
								failed.push(`version ${version} level ${ecl} ${name}`);
							}
						}
					}
				}
				return failed;
			},
			{ sources: SOURCES },
		),
	);

	assert.deepEqual(failures, []);
});

test('a fractional device pixel ratio still produces scannable codes', options, async () => {
	// Scaling by a fractional ratio used to put module edges between device
	// pixels, and the anti-aliasing broke roughly one code in three.
	const failures = await withPage((page) =>
		page.evaluate(
			async ({ sources }) => {
				const load = (source) =>
					'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(source)));
				const glyphUrl = load(sources.glyph);
				const { encode } = await import(load(sources.qr));
				const { renderCanvas, renderCanvasPlain } = await import(
					load(sources.render.replace("'./glyph.js'", JSON.stringify(glyphUrl)))
				);

				const failed = [];
				const payload = 'device pixel ratio regression check';
				for (const devicePixelRatio of [1, 1.25, 1.333, 1.5, 1.75, 2, 2.5, 3]) {
					for (const moduleSize of [4, 6, 10, 16]) {
						for (const draw of [renderCanvas, renderCanvasPlain]) {
							const canvas = document.createElement('canvas');
							const result = encode(payload, { errorCorrection: 'M', minVersion: 12 });
							const { extent } = draw(canvas, result, { moduleSize, devicePixelRatio });
							const image = canvas.getContext('2d').getImageData(0, 0, extent, extent);
							const decoded = window.jsQR(image.data, extent, extent, {
								inversionAttempts: 'dontInvert',
							});
							if (!decoded || decoded.data !== payload) {
								failed.push(`dpr ${devicePixelRatio} at ${moduleSize}px`);
							}
						}
					}
				}
				return failed;
			},
			{ sources: SOURCES },
		),
	);

	assert.deepEqual(failures, []);
});

test('the plain SVG decodes as well as the poo one', options, async () => {
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
				for (const payload of payloads.slice(0, 5)) {
					for (const moduleSize of [6, 12]) {
						const svg = renderSvg(encode(payload, { errorCorrection: 'H' }), {
							moduleSize,
							plain: true,
						});
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
							failed.push(`${payload.slice(0, 24)} at ${moduleSize}px`);
						}
					}
				}
				return failed;
			},
			{ sources: SOURCES, payloads: PAYLOADS },
		),
	);

	assert.deepEqual(failures, []);
});

test('colours cannot break out of the SVG', async () => {
	// The SVG is downloadable, and opening a downloaded file directly in a
	// browser runs whatever script it contains.
	const { encode } = await import('../src/qr.js');
	const { renderSvg } = await import('../src/render.js');
	const hostile = 'red"/><script>alert(1)</script><rect fill="';
	const result = encode('escaping', { errorCorrection: 'H' });

	for (const colours of [{ dark: hostile }, { light: hostile }]) {
		const svg = renderSvg(result, colours);
		assert.ok(!svg.includes('<script>'), 'a colour must not be able to inject an element');
		assert.ok(svg.includes('&quot;'), 'the quote should have been escaped');
	}
});
