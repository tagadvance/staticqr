/**
 * Loads every built page in a real browser.
 *
 * Six languages multiplied by three pages is eighteen chances for a broken
 * asset path or an untranslated control to go unnoticed, and none of that is
 * visible to a unit test.
 *
 * Requires a build (npm run build) and a browser (npx playwright install chromium).
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { listen } from '../tools/serve.mjs';
import { DEFAULT_LANGUAGE, ORIGIN, pagePath } from '../tools/build.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	chromium = null;
}

const dist = new URL('../dist/', import.meta.url);
const built = existsSync(dist);

const browserAvailable =
	chromium !== null &&
	(await chromium
		.launch()
		.then((browser) => browser.close().then(() => true))
		.catch(() => false));

const options = !built
	? { skip: 'dist/ not built; run: npm run build' }
	: !browserAvailable
		? { skip: 'no browser available; run: npx playwright install chromium' }
		: {};

const LANGUAGES = readdirSync(new URL('../i18n/', import.meta.url))
	.filter((name) => name.endsWith('.json'))
	.map((name) => name.replace('.json', ''));
const PAGES = ['index', 'verify', 'safety'];

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

async function withSite(run, launchOptions = {}) {
	const site = await listen();
	const browser = await chromium.launch(launchOptions);
	try {
		return await run(browser, site.origin);
	} finally {
		await browser.close();
		await site.stop();
	}
}

/** Draw a code inside the page and hand it back as PNG bytes. */
async function makeCode(page, text, moduleSize) {
	const base64 = await page.evaluate(
		async ({ text, moduleSize }) => {
			const { encode } = await import('/assets/qr.js');
			const { renderCanvas } = await import('/assets/render.js');
			const canvas = document.createElement('canvas');
			renderCanvas(canvas, encode(text, { errorCorrection: 'H' }), { moduleSize });
			return canvas.toDataURL().split(',')[1];
		},
		{ text, moduleSize },
	);
	return { name: 'code.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}

/** Load a page and fail on any console error, page error or failed request. */
async function open(browser, url) {
	const page = await browser.newPage();
	const problems = [];
	page.on('console', (message) => {
		if (message.type() === 'error') {
			problems.push(`console: ${message.text()}`);
		}
	});
	page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
	page.on('requestfailed', (request) =>
		problems.push(`request failed: ${request.url()} ${request.failure()?.errorText}`),
	);
	const response = await page.goto(url, { waitUntil: 'networkidle' });
	return { page, problems, status: response.status() };
}

test('every page loads cleanly in every language', options, async () => {
	const failures = await withSite(async (browser, origin) => {
		const found = [];
		for (const lang of LANGUAGES) {
			for (const name of PAGES) {
				const path = pagePath(lang, name);
				const { page, problems, status } = await open(browser, origin + path);
				if (status !== 200) {
					found.push(`${path} returned ${status}`);
				}
				const documentLang = await page.getAttribute('html', 'lang');
				if (documentLang !== lang) {
					found.push(`${path} declares lang="${documentLang}"`);
				}
				const canonical = await page.getAttribute('link[rel=canonical]', 'href');
				if (canonical !== ORIGIN + path) {
					found.push(`${path} has canonical ${canonical}`);
				}
				const title = await page.title();
				if (title.trim() === '') {
					found.push(`${path} has no title`);
				}
				found.push(...problems.map((problem) => `${path}: ${problem}`));
				await page.close();
			}
		}
		return found;
	});

	assert.deepEqual(failures, []);
});

test('the generator works in every language', options, async () => {
	const failures = await withSite(async (browser, origin) => {
		const found = [];
		for (const lang of LANGUAGES) {
			const { page, problems } = await open(browser, origin + pagePath(lang, 'index'));
			await page.fill('#data', ADDRESS);
			await page.waitForSelector('#output canvas', { timeout: 5000 });
			await page.waitForFunction(() => !document.querySelector('#readback').hidden, {
				timeout: 5000,
			});

			const state = await page.evaluate(() => ({
				readbackClass: document.querySelector('#readback').className,
				warningShown: !document.querySelector('#warning').hidden,
				meta: document.querySelector('#meta').textContent,
				downloadEnabled: !document.querySelector('#download-png').disabled,
			}));

			if (!state.readbackClass.includes('ok')) {
				found.push(`${lang}: readback did not pass (${state.readbackClass})`);
			}
			if (!state.warningShown) {
				found.push(`${lang}: no warning for a bitcoin address`);
			}
			if (!/\d/.test(state.meta)) {
				found.push(`${lang}: metadata line is empty`);
			}
			if (!state.downloadEnabled) {
				found.push(`${lang}: downloads stayed disabled`);
			}
			// A placeholder that survived into the rendered page means a string was
			// interpolated with the wrong keys.
			if (/\{\w+\}/.test(await page.textContent('body'))) {
				found.push(`${lang}: an unsubstituted placeholder is visible`);
			}
			found.push(...problems.map((problem) => `${lang}: ${problem}`));
			await page.close();
		}
		return found;
	});

	assert.deepEqual(failures, []);
});

test('the checker decodes an uploaded code and spots a mismatch', options, async () => {
	const failures = await withSite(async (browser, origin) => {
		const found = [];
		const { page, problems } = await open(browser, origin + pagePath(DEFAULT_LANGUAGE, 'verify'));

		// Build a code in the page itself, then feed it back through the uploader.
		const png = await page.evaluate(async (address) => {
			const { encode } = await import('/assets/qr.js');
			const { renderCanvas } = await import('/assets/render.js');
			const canvas = document.createElement('canvas');
			renderCanvas(canvas, encode(address, { errorCorrection: 'H' }), { moduleSize: 10 });
			return canvas.toDataURL().split(',')[1];
		}, ADDRESS);

		await page.setInputFiles('#file', {
			name: 'code.png',
			mimeType: 'image/png',
			buffer: Buffer.from(png, 'base64'),
		});
		await page.waitForSelector('#result .code', { timeout: 5000 });

		const decoded = await page.textContent('#result .code');
		if (decoded !== ADDRESS) {
			found.push(`decoded ${decoded} instead of the address`);
		}

		await page.fill('#expected', 'bc1qsomethingelseentirely');
		await page.waitForSelector('#result .notice.danger', { timeout: 5000 });
		const mismatch = await page.textContent('#result .notice.danger');
		if (!mismatch.includes('does not match')) {
			found.push('the mismatch warning did not appear');
		}

		await page.fill('#expected', ADDRESS);
		await page.waitForSelector('#result .notice.ok', { timeout: 5000 });

		found.push(...problems);
		await page.close();
		return found;
	});

	assert.deepEqual(failures, []);
});

test(
	'an unreadable file replaces the previous result rather than leaving it',
	options,
	async () => {
		await withSite(async (browser, origin) => {
			const { page } = await open(browser, origin + pagePath(DEFAULT_LANGUAGE, 'verify'));
			await page.setInputFiles('#file', await makeCode(page, 'https://example.com', 8));
			await page.waitForSelector('#result .code');

			await page.setInputFiles('#file', {
				name: 'notes.txt',
				mimeType: 'text/plain',
				buffer: Buffer.from('not an image at all'),
			});
			await page.waitForSelector('#result .notice.danger', { timeout: 5000 });

			assert.equal(
				await page.$('#result .code'),
				null,
				"the previous file's decoded value must not survive",
			);
			await page.close();
		});
	},
);

test('the newest image wins when two decodes overlap', options, async () => {
	await withSite(async (browser, origin) => {
		const { page } = await open(browser, origin + pagePath(DEFAULT_LANGUAGE, 'verify'));
		const dense = await makeCode(page, 'A'.repeat(1200), 20);
		const small = await makeCode(page, 'https://example.com', 8);

		// The dense one takes far longer to decode, so without a guard it
		// finishes last and overwrites the result the user actually asked for.
		await page.setInputFiles('#file', dense);
		await page.waitForTimeout(15);
		await page.setInputFiles('#file', small);
		await page.waitForTimeout(2000);

		assert.equal(await page.textContent('#result .code'), 'https://example.com');
		await page.close();
	});
});

test('repeated camera clicks never leave a track running', options, async () => {
	await withSite(
		async (browser, origin) => {
			const { page } = await open(browser, origin + pagePath(DEFAULT_LANGUAGE, 'verify'));
			await page.evaluate(() => {
				window.openedStreams = [];
				const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
				navigator.mediaDevices.getUserMedia = async (constraints) => {
					const stream = await original(constraints);
					window.openedStreams.push(stream);
					return stream;
				};
			});

			// Synchronous clicks, which is what a double click actually is. The
			// stream is acquired across two awaits, so a second start used to
			// orphan the first one with nothing left holding a reference to it.
			await page.evaluate(() => {
				const button = document.querySelector('#camera');
				button.click();
				button.click();
				button.click();
				button.click();
			});
			await page.waitForTimeout(1500);

			const opened = await page.evaluate(() => window.openedStreams.length);
			assert.equal(opened, 1, `expected one stream, got ${opened}`);

			await page.evaluate(() => {
				const button = document.querySelector('#camera');
				if (button.textContent.trim() !== 'Use camera') {
					button.click();
				}
			});
			await page.waitForTimeout(500);
			const live = await page.evaluate(
				() =>
					window.openedStreams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live')
						.length,
			);
			assert.equal(live, 0, 'every track must be stopped');
			await page.close();
		},
		{ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
	);
});

test('the warning and readback do not outlive the text they describe', options, async () => {
	await withSite(async (browser, origin) => {
		const { page } = await open(browser, origin + pagePath(DEFAULT_LANGUAGE, 'index'));
		const type = (value) =>
			page.evaluate((value) => {
				const field = document.querySelector('#data');
				field.value = value;
				field.dispatchEvent(new Event('input'));
			}, value);

		await page.selectOption('#size', '24');
		await page.selectOption('#style', 'poo');
		await type('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
		await page.waitForFunction(() => !document.querySelector('#warning').hidden, { timeout: 8000 });

		await type('');
		let stale = 0;
		for (let i = 0; i < 40; i++) {
			if (
				await page.evaluate(
					() =>
						document.querySelector('#data').value === '' &&
						(!document.querySelector('#warning').hidden ||
							!document.querySelector('#readback').hidden),
				)
			) {
				stale += 1;
			}
			await page.waitForTimeout(16);
		}
		assert.equal(stale, 0, 'a panel described text that was no longer in the box');
		await page.close();
	});
});

test('a code that fails its own readback cannot be downloaded', options, async () => {
	await withSite(async (browser, origin) => {
		const { page } = await open(browser, origin + pagePath(DEFAULT_LANGUAGE, 'index'));
		await page.evaluate(() => {
			window.jsQR = () => ({ data: 'something else entirely' });
		});
		await page.fill('#data', 'https://staticqr.com/');
		await page.waitForFunction(
			() => document.querySelector('#readback').className.includes('danger'),
			{ timeout: 8000 },
		);

		assert.equal(await page.isDisabled('#download-png'), true);
		assert.equal(await page.isDisabled('#download-svg'), true);
		await page.close();
	});
});
