import { inspect } from '/assets/addresses.js';
import { encode, DataTooLongError } from '/assets/qr.js';
import { renderCanvas, renderCanvasPlain, renderSvg } from '/assets/render.js';
import { decodeImageData, decoderAvailable } from '/assets/decode.js';
import { format, loadStrings } from '/assets/format.js';

const strings = await loadStrings();

const form = document.querySelector('#generator');
const input = document.querySelector('#data');
const levelSelect = document.querySelector('#level');
const sizeSelect = document.querySelector('#size');
const styleSelect = document.querySelector('#style');
const output = document.querySelector('#output');
const placeholder = document.querySelector('#placeholder');
const meta = document.querySelector('#meta');
const warning = document.querySelector('#warning');
const readback = document.querySelector('#readback');
const downloadPng = document.querySelector('#download-png');
const downloadSvg = document.querySelector('#download-svg');

const canvas = document.createElement('canvas');
canvas.setAttribute('role', 'img');
let current = null;

function element(tag, className, text) {
	const node = document.createElement(tag);
	if (className) {
		node.className = className;
	}
	if (text !== undefined) {
		node.textContent = text;
	}
	return node;
}

const STOP_SIGN = 'M7.7 1h8.6L23 7.7v8.6L16.3 23H7.7L1 16.3V7.7zM12 6.5v7m0 3.2v.3';

function stopSign() {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('class', 'stop');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '2');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', STOP_SIGN);
	svg.append(path);
	return svg;
}

function describeAddress(report) {
	const { warning: copy } = strings;
	if (report.kind === 'uri') {
		return format(copy.uriDetected, { family: report.family });
	}
	if (report.family === 'ethereum') {
		return copy.ethDetected;
	}
	if (report.kind === 'hash') {
		return copy.hashDetected;
	}
	// A failed checksum tells us the string is address-shaped but not what
	// kind or network it was meant to be, so there is nothing to name.
	if (!report.kind || !report.network) {
		return copy.addressDetectedUnknown;
	}
	return format(copy.addressDetected, { kind: report.kind, network: report.network });
}

function checksumLine(report) {
	const { warning: copy } = strings;
	if (report.valid === true) {
		return copy.checksumOk;
	}
	if (report.valid === false) {
		return copy.checksumBad;
	}
	return copy.checksumUnknown;
}

async function renderWarning(text, id) {
	const report = await inspect(text);
	if (id !== generation) {
		return;
	}
	warning.replaceChildren();
	if (report === null) {
		warning.hidden = true;
		return;
	}

	const heading = element('h2');
	heading.append(stopSign(), document.createTextNode(strings.warning.title));

	const link = element('a', null, strings.warning.learnMore);
	link.href = strings.safetyHref;
	const linkParagraph = element('p');
	linkParagraph.append(link);

	warning.append(
		heading,
		element('p', null, `${describeAddress(report)} ${checksumLine(report)}`),
		element('p', null, strings.warning.body),
		element('h3', null, strings.warning.why),
		element('p', null, strings.warning.whyBody),
		linkParagraph,
	);
	warning.hidden = false;
}

/** Returns 'pass', 'fail' or 'unknown'. */
function renderReadback(text) {
	readback.replaceChildren();
	readback.hidden = false;
	const { readback: copy } = strings;

	if (!decoderAvailable()) {
		readback.className = 'notice';
		readback.append(element('h2', null, copy.heading), element('p', null, copy.unsupported));
		return 'unknown';
	}

	// Decode the picture that was just drawn, rather than the matrix it came
	// from. A matrix that is correct can still be drawn unreadably.
	const context = canvas.getContext('2d', { willReadFrequently: true });
	const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
	const decoded = decodeImageData(pixels);

	if (decoded === text) {
		readback.className = 'notice ok';
		readback.append(element('h2', null, copy.passTitle), element('p', null, copy.passBody));
		return 'pass';
	}

	readback.className = 'notice danger';
	readback.append(element('h2', null, copy.failTitle), element('p', null, copy.failBody));
	if (decoded !== null) {
		readback.append(element('p', null, copy.decodedLabel), element('code', 'code', decoded));
	}
	if (styleSelect.value !== 'plain') {
		const fallback = element('button', 'secondary', copy.failFallback);
		fallback.type = 'button';
		fallback.addEventListener('click', () => {
			styleSelect.value = 'plain';
			scheduleUpdate();
		});
		readback.append(fallback);
	}
	return 'fail';
}

function setDownloads(enabled) {
	downloadPng.disabled = !enabled;
	downloadSvg.disabled = !enabled;

	downloadPng.onclick = () => {
		canvas.toBlob((blob) => saveBlob(blob, 'qr.png'));
	};
	downloadSvg.onclick = () => {
		const svg = renderSvg(current, {
			moduleSize: Number(sizeSelect.value),
			title: strings.index.resultHeading,
			plain: styleSelect.value === 'plain',
		});
		saveBlob(new Blob([svg], { type: 'image/svg+xml' }), 'qr.svg');
	};
}

function saveBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	// Revoked on the next turn so the download has certainly started.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

function clear(message) {
	generation += 1;
	renderedFor = null;
	output.replaceChildren(placeholder);
	placeholder.textContent = message;
	placeholder.hidden = false;
	meta.textContent = '';
	warning.hidden = true;
	readback.hidden = true;
	downloadPng.disabled = true;
	downloadSvg.disabled = true;
	current = null;
}

// Bumped by every update so a result that arrives late can tell it is stale.
let generation = 0;

// The exact text the warning and readback panels currently describe. Rendering
// is debounced, so without this they keep making claims about a string the
// user has already edited or deleted.
let renderedFor = null;

async function update() {
	const id = ++generation;
	const text = input.value;
	if (text.trim() === '') {
		clear(strings.index.emptyState);
		return;
	}

	const level = levelSelect.value;
	const moduleSize = Number(sizeSelect.value);

	try {
		current = encode(text, { errorCorrection: level });
	} catch (error) {
		if (error instanceof DataTooLongError) {
			clear(strings.index.tooLong);
			return;
		}
		throw error;
	}

	const draw = styleSelect.value === 'plain' ? renderCanvasPlain : renderCanvas;
	draw(canvas, current, { moduleSize, devicePixelRatio: 1 });
	canvas.setAttribute('aria-label', strings.index.resultHeading);

	placeholder.hidden = true;
	output.replaceChildren(canvas);
	meta.textContent = format(strings.index.metaVersion, {
		version: current.version,
		size: current.size,
		level,
	});

	const verdict = renderReadback(text);
	setDownloads(verdict !== 'fail');
	await renderWarning(text, id);
	renderedFor = text;
}

let pending = null;
function scheduleUpdate() {
	clearTimeout(pending);
	pending = setTimeout(() => {
		update().catch((error) => {
			console.error(error);
			clear(strings.index.emptyState);
		});
	}, 120);
}

form.addEventListener('submit', (event) => event.preventDefault());

input.addEventListener('input', () => {
	// These two panels make claims about a specific string. The moment it stops
	// being what is in the box they are wrong, and the debounce means they
	// would otherwise stay wrong for a tenth of a second.
	if (renderedFor !== null && input.value !== renderedFor) {
		warning.hidden = true;
		readback.hidden = true;
	}
	scheduleUpdate();
});
for (const control of [levelSelect, sizeSelect, styleSelect]) {
	control.addEventListener('change', scheduleUpdate);
}

clear(strings.index.emptyState);
if (input.value.trim() !== '') {
	scheduleUpdate();
}
