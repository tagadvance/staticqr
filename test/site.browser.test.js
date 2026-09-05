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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

async function withSite(run) {
	const site = await listen();
	const browser = await chromium.launch();
	try {
		return await run(browser, site.origin);
	} finally {
		await browser.close();
		await site.stop();
	}
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
