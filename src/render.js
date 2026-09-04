/**
 * Turn a module matrix into something you can look at: an SVG string, or
 * pixels on a canvas.
 */
import { GLYPH_PATH, glyphTransform } from './glyph.js';

export const DEFAULT_MODULE_SIZE = 12;
export const DEFAULT_BORDER = 4;
export const DEFAULT_DARK = '#6b4423';
export const DEFAULT_LIGHT = '#ffffff';

/**
 * How much of its cell each glyph covers. A little over 1 lets neighbouring
 * piles touch without smearing them into an unrecognisable blob. Measured
 * against a decoder, anything from 1.0 to 2.0 scans, so this is chosen for
 * looks rather than for legibility.
 */
export const DEFAULT_COVERAGE = 1.15;

/**
 * Finder, timing and alignment patterns are drawn as solid squares.
 *
 * This is not an aesthetic choice. A scanner locates a code by looking for
 * the 1:1:3:1:1 run-length ratio of the finder patterns along a scan line,
 * and emoji-shaped modules leave gaps that destroy that ratio. Drawing the
 * function patterns with poo produces a code that no decoder can find at any
 * glyph size, which is exactly what the 2018 version of this project did.
 */

function escapeXml(text) {
  return text.replace(/[<>&"]/g, (character) => {
    return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[character];
  });
}

export function renderSvg(result, options = {}) {
  const {
    moduleSize = DEFAULT_MODULE_SIZE,
    border = DEFAULT_BORDER,
    dark = DEFAULT_DARK,
    light = DEFAULT_LIGHT,
    coverage = DEFAULT_COVERAGE,
    title = 'QR code',
  } = options;

  const extent = (result.size + border * 2) * moduleSize;
  const transform = glyphTransform(0, 0, moduleSize, coverage)
    .map((value) => Number(value.toFixed(6)))
    .join(' ');

  const uses = [];
  const rects = [];
  for (let row = 0; row < result.size; row++) {
    for (let col = 0; col < result.size; col++) {
      if (!result.modules[row][col]) {
        continue;
      }
      const x = (col + border) * moduleSize;
      const y = (row + border) * moduleSize;
      if (result.isFunction[row][col]) {
        rects.push(`<rect x="${x}" y="${y}" width="${moduleSize}" height="${moduleSize}"/>`);
      } else {
        uses.push(`<use href="#m" x="${x}" y="${y}"/>`);
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}"`,
    ` width="${extent}" height="${extent}" role="img" aria-label="${escapeXml(title)}">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect width="100%" height="100%" fill="${light}"/>`,
    `<defs><g id="m" transform="matrix(${transform})"><path d="${GLYPH_PATH}"/></g></defs>`,
    `<g fill="${dark}">${rects.join('')}${uses.join('')}</g>`,
    '</svg>',
  ].join('');
}

/**
 * Draw onto a canvas, sizing it to fit. Every dark module is added to a single
 * path so the whole code is one fill call rather than several thousand.
 */
export function renderCanvas(canvas, result, options = {}) {
  const {
    moduleSize = DEFAULT_MODULE_SIZE,
    border = DEFAULT_BORDER,
    dark = DEFAULT_DARK,
    light = DEFAULT_LIGHT,
    coverage = DEFAULT_COVERAGE,
    devicePixelRatio = 1,
  } = options;

  const extent = (result.size + border * 2) * moduleSize;
  canvas.width = Math.round(extent * devicePixelRatio);
  canvas.height = Math.round(extent * devicePixelRatio);

  const context = canvas.getContext('2d');
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  context.fillStyle = light;
  context.fillRect(0, 0, extent, extent);

  const glyph = new Path2D(GLYPH_PATH);
  const combined = new Path2D();
  context.fillStyle = dark;
  for (let row = 0; row < result.size; row++) {
    for (let col = 0; col < result.size; col++) {
      if (!result.modules[row][col]) {
        continue;
      }
      const x = (col + border) * moduleSize;
      const y = (row + border) * moduleSize;
      if (result.isFunction[row][col]) {
        context.fillRect(x, y, moduleSize, moduleSize);
      } else {
        const [a, b, c, d, e, f] = glyphTransform(x, y, moduleSize, coverage);
        combined.addPath(glyph, new DOMMatrix([a, b, c, d, e, f]));
      }
    }
  }
  context.fill(combined);

  return { extent };
}

/**
 * Draw the matrix as plain squares.
 *
 * Used for the readback check, and as the fallback the page offers when a
 * poo-drawn code turns out not to scan.
 */
export function renderCanvasPlain(canvas, result, options = {}) {
  const {
    moduleSize = DEFAULT_MODULE_SIZE,
    border = DEFAULT_BORDER,
    dark = '#000000',
    light = DEFAULT_LIGHT,
    devicePixelRatio = 1,
  } = options;

  const extent = (result.size + border * 2) * moduleSize;
  canvas.width = Math.round(extent * devicePixelRatio);
  canvas.height = Math.round(extent * devicePixelRatio);

  const context = canvas.getContext('2d');
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  context.fillStyle = light;
  context.fillRect(0, 0, extent, extent);
  context.fillStyle = dark;
  for (let row = 0; row < result.size; row++) {
    for (let col = 0; col < result.size; col++) {
      if (result.modules[row][col]) {
        context.fillRect(
          (col + border) * moduleSize,
          (row + border) * moduleSize,
          moduleSize,
          moduleSize,
        );
      }
    }
  }

  return { extent };
}
