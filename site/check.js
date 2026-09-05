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
let lastDecoded = null;

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

async function present(text) {
  lastDecoded = text;
  result.replaceChildren();

  if (text === null) {
    result.append(notice('danger', strings.verify.noCode));
    return;
  }

  const wanted = expected.value.trim();
  if (wanted !== '') {
    if (wanted === text.trim()) {
      result.append(notice('ok', strings.verify.matchTitle, strings.verify.matchBody));
    } else {
      const box = notice('danger', strings.verify.mismatchTitle, strings.verify.mismatchBody);
      box.append(
        element('h3', null, strings.verify.yours),
        element('code', 'code', wanted),
        element('h3', null, strings.verify.theirs),
        element('code', 'code', text),
      );
      result.append(box);
    }
  }

  const panel = element('div', 'panel');
  panel.append(...(await describe(text)));
  result.append(panel);
}

async function handleBlob(blob) {
  if (!decoderAvailable()) {
    result.replaceChildren(notice('danger', strings.readback.unsupported));
    return;
  }
  const imageData = await imageDataFromBlob(blob);
  await present(decodeImageData(imageData));
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
    present(lastDecoded);
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
        await present(decoded);
        stopCamera();
        return;
      }
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

cameraButton.addEventListener('click', async () => {
  if (scanning) {
    stopCamera();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    result.replaceChildren(notice('danger', strings.verify.cameraUnsupported));
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
  } catch {
    result.replaceChildren(notice('danger', strings.verify.cameraDenied));
    return;
  }
  video.srcObject = stream;
  video.hidden = false;
  await video.play();
  cameraButton.textContent = strings.verify.stopCamera;
  scanning = true;
  scanLoop();
});

window.addEventListener('pagehide', stopCamera);
