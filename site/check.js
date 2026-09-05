import { inspect } from '/assets/addresses.js';
import { decodeImageData, decoderAvailable, imageDataFromBlob } from '/assets/decode.js';
import { loadStrings } from '/assets/format.js';

const strings = await loadStrings();

const dropzone = document.querySelector('#dropzone');
const fileInput = document.querySelector('#file');
const expected = document.querySelector('#expected');
const cameraButton = document.querySelector('#camera');
const video = document.querySelector('#preview');
const result = document.querySelector('#result');

let stream = null;
let scanning = false;
let startingCamera = false;
let lastDecoded = null;

/**
 * Every request to display something takes a number, and only the newest one
 * is allowed to write to the page.
 *
 * Decoding a large image takes long enough that two of them overlap easily,
 * and they finish in whatever order they finish. Without this, dropping a big
 * image and then a small one leaves the big one's payload on screen — which on
 * a page whose entire job is telling you what a code contains is the worst
 * thing it could do.
 */
let requestId = 0;

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

function notice(kind, title, body) {
	const box = element('div', `notice ${kind}`);
	box.append(element('h2', null, title));
	if (body) {
		box.append(element('p', null, body));
	}
	return box;
}

/** Replace whatever is on screen, and invalidate anything still in flight. */
function showNotice(kind, title, body) {
	requestId += 1;
	lastDecoded = null;
	result.replaceChildren(notice(kind, title, body));
}

async function describe(text) {
	const nodes = [element('h2', null, strings.verify.decodedHeading)];
	nodes.push(element('code', 'code', text));

	const report = await inspect(text);
	if (report !== null) {
		const facts = element('dl', 'facts');
		const add = (term, value) => {
			facts.append(element('dt', null, term), element('dd', null, value));
		};
		add(strings.verify.factKind, report.kind ?? report.family);
		if (report.network) {
			add(strings.verify.factNetwork, report.network);
		}
		add(
			strings.verify.factChecksum,
			report.valid === true
				? strings.verify.checksumValid
				: report.valid === false
					? strings.verify.checksumInvalid
					: strings.verify.checksumNotChecked,
		);
		nodes.push(facts);
	}
	return nodes;
}

/**
 * Build the whole result offscreen, then swap it in as one operation, so a
 * half-written panel is never visible and a superseded request writes nothing.
 */
async function present(text, id) {
	const children = [];

	if (text === null) {
		children.push(notice('danger', strings.verify.noCode));
	} else {
		const wanted = expected.value.trim();
		if (wanted !== '') {
			if (wanted === text.trim()) {
				children.push(notice('ok', strings.verify.matchTitle, strings.verify.matchBody));
			} else {
				const box = notice('danger', strings.verify.mismatchTitle, strings.verify.mismatchBody);
				box.append(
					element('h3', null, strings.verify.yours),
					element('code', 'code', wanted),
					element('h3', null, strings.verify.theirs),
					element('code', 'code', text),
				);
				children.push(box);
			}
		}

		const panel = element('div', 'panel');
		panel.append(...(await describe(text)));
		children.push(panel);
	}

	if (id !== requestId) {
		return;
	}
	lastDecoded = text;
	result.replaceChildren(...children);
}

async function handleBlob(blob) {
	const id = ++requestId;

	if (!decoderAvailable()) {
		showNotice('danger', strings.readback.unsupported);
		return;
	}

	try {
		const imageData = await imageDataFromBlob(blob);
		if (id !== requestId) {
			return;
		}
		await present(decodeImageData(imageData), id);
	} catch {
		// A text file, a truncated image, or an SVG, which Chromium will not
		// decode. Leaving the previous file's result on screen would be read as
		// belonging to this one.
		if (id !== requestId) {
			return;
		}
		showNotice('danger', strings.verify.unreadable);
	}
}

dropzone.addEventListener('dragover', (event) => {
	event.preventDefault();
	dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (event) => {
	event.preventDefault();
	dropzone.classList.remove('dragover');
	const file = event.dataTransfer?.files?.[0];
	if (file) {
		handleBlob(file);
	}
});

fileInput.addEventListener('change', () => {
	const file = fileInput.files?.[0];
	if (file) {
		handleBlob(file);
	}
	// Cleared so that choosing the same file twice fires change twice; the
	// first attempt may have failed and retrying it is the obvious response.
	fileInput.value = '';
});

// Pasting a screenshot is how most people will have the code to hand.
window.addEventListener('paste', (event) => {
	for (const item of event.clipboardData?.items ?? []) {
		if (item.type.startsWith('image/')) {
			handleBlob(item.getAsFile());
			return;
		}
	}
});

expected.addEventListener('input', () => {
	if (lastDecoded !== null) {
		present(lastDecoded, ++requestId);
	}
});

function stopCamera() {
	scanning = false;
	if (stream !== null) {
		for (const track of stream.getTracks()) {
			track.stop();
		}
		stream = null;
	}
	video.srcObject = null;
	video.hidden = true;
	cameraButton.textContent = strings.verify.useCamera;
}

async function scanLoop() {
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d', { willReadFrequently: true });

	while (scanning) {
		if (video.videoWidth > 0) {
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
			context.drawImage(video, 0, 0);
			const decoded = decodeImageData(context.getImageData(0, 0, canvas.width, canvas.height));
			if (decoded !== null) {
				stopCamera();
				await present(decoded, ++requestId);
				return;
			}
		}
		await new Promise((resolve) => requestAnimationFrame(resolve));
	}
}

async function startCamera() {
	if (!navigator.mediaDevices?.getUserMedia) {
		showNotice('danger', strings.verify.cameraUnsupported);
		return;
	}

	// Both flags matter: the button is disabled for the pointer, and the guard
	// covers a second click that is already queued. Without them a double click
	// starts a second stream, and the first one is left running with nothing
	// holding a reference to stop it.
	startingCamera = true;
	cameraButton.disabled = true;
	try {
		stream = await navigator.mediaDevices.getUserMedia({
			video: { facingMode: 'environment' },
		});
		video.srcObject = stream;
		video.hidden = false;
		await video.play();
		cameraButton.textContent = strings.verify.stopCamera;
		scanning = true;
		scanLoop();
	} catch {
		const denied = stream === null;
		stopCamera();
		if (denied) {
			showNotice('danger', strings.verify.cameraDenied);
		}
	} finally {
		startingCamera = false;
		cameraButton.disabled = false;
	}
}

cameraButton.addEventListener('click', () => {
	if (startingCamera) {
		return;
	}
	if (scanning) {
		stopCamera();
		return;
	}
	startCamera();
});

window.addEventListener('pagehide', stopCamera);
