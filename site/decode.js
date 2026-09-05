/**
 * Decoding is done with jsQR, a separate implementation from the encoder in
 * this repository.
 *
 * That is deliberate. A check is only worth something if it can disagree with
 * the thing it is checking, and our own encoder would agree with itself no
 * matter what it got wrong.
 */
export function decodeImageData(imageData) {
  if (typeof window.jsQR !== 'function') {
    return null;
  }
  const decoded = window.jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  });
  return decoded === null ? null : decoded.data;
}

export function decoderAvailable() {
  return typeof window.jsQR === 'function';
}

/** Read an image file into ImageData, scaled down if it is very large. */
export async function imageDataFromBlob(blob, maxEdge = 1600) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  // Photographs of screens and transparent PNGs both need a known background.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return context.getImageData(0, 0, width, height);
}
