/**
 * Build the static site into dist/.
 *
 * One real HTML file per language per page. The translated text is in the
 * markup rather than swapped in by script, because search engines index
 * rendered JavaScript unevenly and some barely at all, and Russian and
 * Japanese are two of the languages this site is meant to reach.
 */
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');

export const ORIGIN = 'https://staticqr.com';
export const DEFAULT_LANGUAGE = 'en';

/** Locale codes for Open Graph, which wants the underscored form. */
const OG_LOCALES = {
	en: 'en_US',
	es: 'es_ES',
	pt: 'pt_PT',
	ru: 'ru_RU',
	ja: 'ja_JP',
	fr: 'fr_FR',
};

const PAGES = ['index', 'verify', 'safety'];

const escapeHtml = (value) =>
	String(value).replace(
		/[&<>"']/g,
		(character) =>
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
	);

/** Path of a page within the site, always with a trailing slash. */
export function pagePath(lang, page) {
	const prefix = lang === DEFAULT_LANGUAGE ? '/' : `/${lang}/`;
	return page === 'index' ? prefix : `${prefix}${page}/`;
}

const pageUrl = (lang, page) => `${ORIGIN}${pagePath(lang, page)}`;

const CSP = [
	"default-src 'none'",
	"script-src 'self'",
	"style-src 'self'",
	"img-src 'self' data: blob:",
	"media-src 'self' blob:",
	// Nothing in this site talks to the network. Saying so in the policy means
	// the browser enforces it, rather than asking anyone to take our word.
	"connect-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join('; ');

function head({ lang, page, strings, languages, title, description }) {
	const canonical = pageUrl(lang, page);
	const alternates = languages
		.map((other) => `<link rel="alternate" hreflang="${other}" href="${pageUrl(other, page)}">`)
		.join('');

	const ogAlternates = languages
		.filter((other) => other !== lang)
		.map((other) => `<meta property="og:locale:alternate" content="${OG_LOCALES[other]}">`)
		.join('');

	return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${escapeHtml(title)} — ${escapeHtml(strings.site.name)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
${alternates}<link rel="alternate" hreflang="x-default" href="${pageUrl(DEFAULT_LANGUAGE, page)}">
<meta name="theme-color" content="#6b4423">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(strings.site.name)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ORIGIN}/assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${OG_LOCALES[lang]}">
${ogAlternates}<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/styles.css">`;
}

function masthead(lang, page, strings) {
	const link = (target, label) =>
		`<a href="${pagePath(lang, target)}"${target === page ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`;

	return `<header class="masthead"><div class="shell">
<a class="brand" href="${pagePath(lang, 'index')}"><span aria-hidden="true">💩</span>${escapeHtml(strings.site.name)}</a>
<nav class="primary" aria-label="${escapeHtml(strings.nav.generate)}">
${link('index', strings.nav.generate)}
${link('verify', strings.nav.verify)}
${link('safety', strings.nav.safety)}
</nav>
</div></header>`;
}

function footer(lang, page, strings, catalogue) {
	const languages = Object.entries(catalogue)
		.map(([code, other]) =>
			code === lang
				? `<li><span aria-current="true">${escapeHtml(other.name)}</span></li>`
				: `<li><a href="${pagePath(code, page)}" hreflang="${code}" lang="${code}">${escapeHtml(other.name)}</a></li>`,
		)
		.join('');

	return `<footer class="site"><div class="shell">
<span>${escapeHtml(strings.footer.licence)} <a href="https://github.com/tagadvance/Crappy-QR">${escapeHtml(strings.footer.sourceOn)}</a></span>
<ul class="langs" aria-label="${escapeHtml(strings.nav.language)}">${languages}</ul>
</div></footer>`;
}

function jsonLd(data) {
	// JSON-LD is data, not script, but angle brackets inside it would still end
	// the element early.
	return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function indexBody(lang, strings) {
	const { index } = strings;
	const option = (value, label, selected) =>
		`<option value="${value}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;

	return `<h1>${escapeHtml(index.h1)}</h1>
<p class="lead">${escapeHtml(index.intro)}</p>

<form class="panel" id="generator">
<label for="data">${escapeHtml(index.inputLabel)}</label>
<textarea id="data" name="data" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="${escapeHtml(index.inputPlaceholder)}"></textarea>

<div class="controls">
<div>
<label for="level">${escapeHtml(index.errorCorrectionLabel)}</label>
<select id="level">${option('L', 'L — 7%')}${option('M', 'M — 15%')}${option('Q', 'Q — 25%')}${option('H', 'H — 30%', true)}</select>
<p class="hint">${escapeHtml(index.errorCorrectionHelp)}</p>
</div>
<div>
<label for="size">${escapeHtml(index.moduleSizeLabel)}</label>
<select id="size">${option('6', 'S')}${option('10', 'M', true)}${option('16', 'L')}${option('24', 'XL')}</select>
</div>
<div>
<label for="style">${escapeHtml(index.styleLabel)}</label>
<select id="style">${option('poo', index.stylePoo, true)}${option('plain', index.stylePlain)}</select>
</div>
</div>
</form>

<div id="warning" class="notice danger" role="alert" hidden></div>

<h2>${escapeHtml(index.resultHeading)}</h2>
<div class="output" id="output"><p id="placeholder">${escapeHtml(index.emptyState)}</p></div>
<p class="meta" id="meta"></p>

<div id="readback" class="notice" role="status" aria-live="polite" hidden></div>

<div class="actions">
<button type="button" id="download-png" disabled>${escapeHtml(index.downloadPng)}</button>
<button type="button" class="secondary" id="download-svg" disabled>${escapeHtml(index.downloadSvg)}</button>
</div>

<h2>${escapeHtml(index.whyPoo)}</h2>
<p>${escapeHtml(index.whyPooBody)}</p>
<p>${escapeHtml(strings.common.offlineProof)}</p>

<script type="module" src="/assets/generate.js"></script>
<script src="/assets/jsQR.js" defer></script>`;
}

function verifyBody(lang, strings) {
	const { verify } = strings;
	return `<h1>${escapeHtml(verify.h1)}</h1>
<p class="lead">${escapeHtml(verify.intro)}</p>

<div class="panel">
<div class="dropzone" id="dropzone">
<p>${escapeHtml(verify.dropLabel)}</p>
<p><label class="button secondary" for="file">${escapeHtml(verify.chooseFile)}</label>
<input type="file" id="file" accept="image/*" class="visually-hidden">
<button type="button" class="secondary" id="camera">${escapeHtml(verify.useCamera)}</button></p>
<p class="hint">${escapeHtml(verify.pasteHint)}</p>
</div>
<video id="preview" playsinline muted hidden></video>

<p><label for="expected">${escapeHtml(verify.expectedLabel)}</label>
<input type="text" id="expected" spellcheck="false" autocomplete="off" placeholder="${escapeHtml(verify.expectedPlaceholder)}"></p>
</div>

<div id="result" role="status" aria-live="polite"></div>

<script type="module" src="/assets/check.js"></script>
<script src="/assets/jsQR.js" defer></script>`;
}

function safetyBody(lang, strings) {
	const { safety } = strings;
	const list = (items) =>
		`<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;

	const faq = safety.faq
		.map((entry) => `<h3>${escapeHtml(entry.q)}</h3><p>${escapeHtml(entry.a)}</p>`)
		.join('');

	return `<article>
<h1>${escapeHtml(safety.h1)}</h1>
<p class="lead">${escapeHtml(safety.lead)}</p>

<h2>${escapeHtml(safety.originHeading)}</h2>
<p>${escapeHtml(safety.originBody)}</p>

<h2>${escapeHtml(safety.attackHeading)}</h2>
<p>${escapeHtml(safety.attackBody)}</p>

<h2>${escapeHtml(safety.whyWorksHeading)}</h2>
${list(safety.whyWorksPoints)}

<h2>${escapeHtml(safety.protectHeading)}</h2>
${list(safety.protectPoints)}

<h2>${escapeHtml(safety.thisSiteHeading)}</h2>
${list(safety.thisSitePoints)}

<h2>${escapeHtml(safety.trustHeading)}</h2>
<p>${escapeHtml(safety.trustBody)}</p>

<h2>${escapeHtml(safety.faqHeading)}</h2>
${faq}
</article>`;
}

const BODIES = { index: indexBody, verify: verifyBody, safety: safetyBody };

function structuredData(lang, page, strings) {
	if (page === 'index') {
		return jsonLd({
			'@context': 'https://schema.org',
			'@type': 'SoftwareApplication',
			name: strings.site.name,
			applicationCategory: 'UtilitiesApplication',
			operatingSystem: 'Any',
			url: pageUrl(lang, 'index'),
			description: strings.index.description,
			inLanguage: lang,
			offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
		});
	}
	if (page === 'safety') {
		return jsonLd({
			'@context': 'https://schema.org',
			'@type': 'FAQPage',
			inLanguage: lang,
			mainEntity: strings.safety.faq.map((entry) => ({
				'@type': 'Question',
				name: entry.q,
				acceptedAnswer: { '@type': 'Answer', text: entry.a },
			})),
		});
	}
	return '';
}

function renderPage(lang, page, strings, catalogue, languages) {
	const copy = strings[page];
	return `<!doctype html>
<html lang="${lang}" dir="${strings.dir}">
<head>
${head({ lang, page, strings, languages, title: copy.title, description: copy.description })}
${structuredData(lang, page, strings)}
</head>
<body>
<a class="skip" href="#main">${escapeHtml(strings.common.skipToContent)}</a>
${masthead(lang, page, strings)}
<main id="main"><div class="shell">
${BODIES[page](lang, strings)}
</div></main>
${footer(lang, page, strings, catalogue)}
</body>
</html>
`;
}

function sitemap(languages) {
	const entries = [];
	for (const page of PAGES) {
		for (const lang of languages) {
			const alternates = languages
				.map(
					(other) =>
						`<xhtml:link rel="alternate" hreflang="${other}" href="${pageUrl(other, page)}"/>`,
				)
				.join('');
			entries.push(
				`<url><loc>${pageUrl(lang, page)}</loc>${alternates}` +
					`<xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl(DEFAULT_LANGUAGE, page)}"/>` +
					`<changefreq>monthly</changefreq></url>`,
			);
		}
	}
	return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`;
}

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="0.9em" font-size="90">💩</text></svg>`;

async function main() {
	await rm(dist, { recursive: true, force: true });
	await mkdir(join(dist, 'assets'), { recursive: true });

	const files = (await readdir(join(root, 'i18n'))).filter((name) => name.endsWith('.json'));
	const catalogue = {};
	for (const file of files) {
		const strings = JSON.parse(await readFile(join(root, 'i18n', file), 'utf8'));
		catalogue[strings.lang] = strings;
	}
	// English first, then the rest in a stable order.
	const languages = [
		DEFAULT_LANGUAGE,
		...Object.keys(catalogue)
			.filter((lang) => lang !== DEFAULT_LANGUAGE)
			.sort(),
	];

	for (const lang of languages) {
		const strings = catalogue[lang];
		for (const page of PAGES) {
			const path = pagePath(lang, page);
			const directory = join(dist, path);
			await mkdir(directory, { recursive: true });
			await writeFile(
				join(directory, 'index.html'),
				renderPage(lang, page, strings, catalogue, languages),
			);
		}

		// The runtime string table, as a module so no inline script is needed and
		// the content security policy can stay at script-src 'self'.
		const runtime = {
			...strings,
			safetyHref: pagePath(lang, 'safety'),
			verifyHref: pagePath(lang, 'verify'),
		};
		await writeFile(
			join(dist, 'assets', `strings.${lang}.js`),
			`export const strings = ${JSON.stringify(runtime)};\n`,
		);
	}

	for (const [from, to] of [
		['src/qr.js', 'qr.js'],
		['src/render.js', 'render.js'],
		['src/glyph.js', 'glyph.js'],
		['src/addresses.js', 'addresses.js'],
		['site/generate.js', 'generate.js'],
		['site/check.js', 'check.js'],
		['site/decode.js', 'decode.js'],
		['site/format.js', 'format.js'],
		['site/styles.css', 'styles.css'],
		['node_modules/jsqr/dist/jsQR.js', 'jsQR.js'],
		['site/og.png', 'og.png'],
	]) {
		await copyFile(join(root, from), join(dist, 'assets', to));
	}

	// The bare specifiers in src/ resolve from the site root once served.
	for (const name of ['render.js', 'generate.js', 'check.js']) {
		const path = join(dist, 'assets', name);
		const source = await readFile(path, 'utf8');
		await writeFile(path, source.replace(/from '\.\/([\w.]+)'/g, "from '/assets/$1'"));
	}

	await writeFile(join(dist, 'assets', 'icon.svg'), ICON);
	await writeFile(join(dist, 'sitemap.xml'), sitemap(languages));
	await writeFile(
		join(dist, 'robots.txt'),
		`User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`,
	);
	await writeFile(join(dist, 'CNAME'), 'staticqr.com\n');
	// Tells GitHub Pages not to run the output through Jekyll.
	await writeFile(join(dist, '.nojekyll'), '');

	console.log(`built ${languages.length} languages × ${PAGES.length} pages into dist/`);
}

await main();
