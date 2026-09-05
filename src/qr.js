/**
 * A QR Code encoder, per ISO/IEC 18004.
 *
 * This is deliberately hand-written and dependency-free. The whole point of
 * this site is that you should not have to trust someone else's code with a
 * payment address, and vendoring a third-party encoder from a package
 * registry would put exactly that trust back in the chain. The tables below
 * are from the specification; everything else is checked against an
 * independent decoder in the test suite.
 */

export const ERROR_CORRECTION_LEVELS = ['L', 'M', 'Q', 'H'];

// Format-info bit pattern for each level, which is not the same as its index.
const ECL_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
const ECL_INDEX = { L: 0, M: 1, Q: 2, H: 3 };

const MODE_NUMERIC = { bits: 0x1, charCountBits: [10, 12, 14] };
const MODE_ALPHANUMERIC = { bits: 0x2, charCountBits: [9, 11, 13] };
const MODE_BYTE = { bits: 0x4, charCountBits: [8, 16, 16] };

const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const MIN_VERSION = 1;
const MAX_VERSION = 40;

// Number of error-correction codewords per block, indexed [ecl][version].
// Index 0 is unused so that the version number indexes directly.
const ECC_CODEWORDS_PER_BLOCK = [
	// 0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26  27  28  29  30  31  32  33  34  35  36  37  38  39  40
	[
		0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30,
		30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
	], // L
	[
		0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
		28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
	], // M
	[
		0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30,
		30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
	], // Q
	[
		0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30,
		30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
	], // H
];

// Number of error-correction blocks, indexed [ecl][version].
const NUM_ERROR_CORRECTION_BLOCKS = [
	// 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40
	[
		0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14,
		15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
	], // L
	[
		0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
		26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
	], // M
	[
		0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34,
		34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
	], // Q
	[
		0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37,
		40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
	], // H
];

/** Total number of data and error-correction modules, before function patterns. */
function numRawDataModules(version) {
	let result = (16 * version + 128) * version + 64;
	if (version >= 2) {
		const numAlign = Math.floor(version / 7) + 2;
		result -= (25 * numAlign - 10) * numAlign - 55;
		if (version >= 7) {
			result -= 36;
		}
	}
	return result;
}

function numDataCodewords(version, ecl) {
	const ecl_ = ECL_INDEX[ecl];
	return (
		Math.floor(numRawDataModules(version) / 8) -
		ECC_CODEWORDS_PER_BLOCK[ecl_][version] * NUM_ERROR_CORRECTION_BLOCKS[ecl_][version]
	);
}

/** Row and column centres of the alignment patterns for a version. */
export function alignmentPatternPositions(version) {
	if (version === 1) {
		return [];
	}
	const numAlign = Math.floor(version / 7) + 2;
	const size = version * 4 + 17;
	// Version 32 is the single version whose spacing the general formula gets
	// wrong; the specification's table gives 26 rather than the computed 28.
	const step = version === 32 ? 26 : Math.ceil((size - 13) / (2 * numAlign - 2)) * 2;
	const positions = [6];
	for (let pos = size - 7; positions.length < numAlign; pos -= step) {
		positions.splice(1, 0, pos);
	}
	return positions;
}

class BitBuffer {
	constructor() {
		this.bits = [];
	}

	append(value, length) {
		for (let i = length - 1; i >= 0; i--) {
			this.bits.push((value >>> i) & 1);
		}
	}

	get length() {
		return this.bits.length;
	}
}

function isNumeric(text) {
	return /^[0-9]*$/.test(text);
}

function isAlphanumeric(text) {
	for (const character of text) {
		if (!ALPHANUMERIC_CHARSET.includes(character)) {
			return false;
		}
	}
	return true;
}

/**
 * Pick the most compact mode that can represent the whole string.
 *
 * Mixed-mode segmentation could occasionally shave a version off, but a
 * single mode is always correct and much easier to reason about.
 */
function selectMode(text) {
	if (isNumeric(text)) {
		return MODE_NUMERIC;
	}
	if (isAlphanumeric(text)) {
		return MODE_ALPHANUMERIC;
	}
	return MODE_BYTE;
}

function charCountBits(mode, version) {
	const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
	return mode.charCountBits[group];
}

function utf8Bytes(text) {
	return Array.from(new TextEncoder().encode(text));
}

/** Number of bits the payload itself occupies, excluding mode and count headers. */
function payloadBitLength(mode, text, bytes) {
	if (mode === MODE_NUMERIC) {
		const groups = Math.floor(text.length / 3);
		const remainder = text.length % 3;
		return groups * 10 + (remainder === 0 ? 0 : remainder === 1 ? 4 : 7);
	}
	if (mode === MODE_ALPHANUMERIC) {
		return Math.floor(text.length / 2) * 11 + (text.length % 2) * 6;
	}
	return bytes.length * 8;
}

function writePayload(buffer, mode, text, bytes) {
	if (mode === MODE_NUMERIC) {
		for (let i = 0; i < text.length; i += 3) {
			const chunk = text.slice(i, i + 3);
			buffer.append(parseInt(chunk, 10), chunk.length * 3 + 1);
		}
		return;
	}
	if (mode === MODE_ALPHANUMERIC) {
		for (let i = 0; i + 1 < text.length; i += 2) {
			const value =
				ALPHANUMERIC_CHARSET.indexOf(text[i]) * 45 + ALPHANUMERIC_CHARSET.indexOf(text[i + 1]);
			buffer.append(value, 11);
		}
		if (text.length % 2 !== 0) {
			buffer.append(ALPHANUMERIC_CHARSET.indexOf(text[text.length - 1]), 6);
		}
		return;
	}
	for (const byte of bytes) {
		buffer.append(byte, 8);
	}
}

/** Multiply two field elements of GF(2^8), modulo the QR primitive polynomial. */
function gfMultiply(x, y) {
	let z = 0;
	for (let i = 7; i >= 0; i--) {
		z = (z << 1) ^ ((z >>> 7) * 0x11d);
		z ^= ((y >>> i) & 1) * x;
	}
	return z & 0xff;
}

/** Coefficients of the divisor polynomial, highest power first, monic term omitted. */
function reedSolomonDivisor(degree) {
	const result = new Array(degree).fill(0);
	result[degree - 1] = 1;
	let root = 1;
	for (let i = 0; i < degree; i++) {
		for (let j = 0; j < result.length; j++) {
			result[j] = gfMultiply(result[j], root);
			if (j + 1 < result.length) {
				result[j] ^= result[j + 1];
			}
		}
		root = gfMultiply(root, 0x02);
	}
	return result;
}

function reedSolomonRemainder(data, divisor) {
	const result = new Array(divisor.length).fill(0);
	for (const byte of data) {
		const factor = byte ^ result.shift();
		result.push(0);
		divisor.forEach((coefficient, i) => {
			result[i] ^= gfMultiply(coefficient, factor);
		});
	}
	return result;
}

/** Split the data codewords into blocks, add error correction, and interleave. */
function addErrorCorrection(data, version, ecl) {
	const ecl_ = ECL_INDEX[ecl];
	const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl_][version];
	const blockEccLength = ECC_CODEWORDS_PER_BLOCK[ecl_][version];
	const rawCodewords = Math.floor(numRawDataModules(version) / 8);
	const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
	const shortBlockLength = Math.floor(rawCodewords / numBlocks);

	const divisor = reedSolomonDivisor(blockEccLength);
	const blocks = [];
	for (let i = 0, offset = 0; i < numBlocks; i++) {
		const length = shortBlockLength - blockEccLength + (i < numShortBlocks ? 0 : 1);
		const block = data.slice(offset, offset + length);
		offset += length;
		const ecc = reedSolomonRemainder(block, divisor);
		// Short blocks get a placeholder so every block has the same length; the
		// interleaver skips that position rather than emitting it.
		if (i < numShortBlocks) {
			block.push(0);
		}
		blocks.push(block.concat(ecc));
	}

	const result = [];
	for (let i = 0; i < blocks[0].length; i++) {
		blocks.forEach((block, j) => {
			if (i !== shortBlockLength - blockEccLength || j >= numShortBlocks) {
				result.push(block[i]);
			}
		});
	}
	return result;
}

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

const MASK_FUNCTIONS = [
	(x, y) => (x + y) % 2 === 0,
	(x, y) => y % 2 === 0,
	(x, y) => x % 3 === 0,
	(x, y) => (x + y) % 3 === 0,
	(x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
	(x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
	(x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
	(x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function getBit(value, index) {
	return ((value >>> index) & 1) !== 0;
}

class Matrix {
	constructor(version, ecl) {
		this.version = version;
		this.ecl = ecl;
		this.size = version * 4 + 17;
		this.modules = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
		this.isFunction = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
	}

	setFunctionModule(x, y, isDark) {
		this.modules[y][x] = isDark;
		this.isFunction[y][x] = true;
	}

	drawFunctionPatterns() {
		for (let i = 0; i < this.size; i++) {
			this.setFunctionModule(6, i, i % 2 === 0);
			this.setFunctionModule(i, 6, i % 2 === 0);
		}

		this.drawFinderPattern(3, 3);
		this.drawFinderPattern(this.size - 4, 3);
		this.drawFinderPattern(3, this.size - 4);

		const positions = alignmentPatternPositions(this.version);
		for (let i = 0; i < positions.length; i++) {
			for (let j = 0; j < positions.length; j++) {
				// The three corners are occupied by finder patterns.
				const isCorner =
					(i === 0 && j === 0) ||
					(i === 0 && j === positions.length - 1) ||
					(i === positions.length - 1 && j === 0);
				if (!isCorner) {
					this.drawAlignmentPattern(positions[i], positions[j]);
				}
			}
		}

		// Drawn with a placeholder mask; the real value is written once the mask
		// has been chosen.
		this.drawFormatBits(0);
		this.drawVersionBits();
	}

	drawFinderPattern(x, y) {
		for (let dy = -4; dy <= 4; dy++) {
			for (let dx = -4; dx <= 4; dx++) {
				const distance = Math.max(Math.abs(dx), Math.abs(dy));
				const xx = x + dx;
				const yy = y + dy;
				if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
					this.setFunctionModule(xx, yy, distance !== 2 && distance !== 4);
				}
			}
		}
	}

	drawAlignmentPattern(x, y) {
		for (let dy = -2; dy <= 2; dy++) {
			for (let dx = -2; dx <= 2; dx++) {
				this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
			}
		}
	}

	drawFormatBits(mask) {
		const data = (ECL_FORMAT_BITS[this.ecl] << 3) | mask;
		let remainder = data;
		for (let i = 0; i < 10; i++) {
			remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
		}
		const bits = (((data << 10) | remainder) ^ 0x5412) & 0x7fff;

		for (let i = 0; i <= 5; i++) {
			this.setFunctionModule(8, i, getBit(bits, i));
		}
		this.setFunctionModule(8, 7, getBit(bits, 6));
		this.setFunctionModule(8, 8, getBit(bits, 7));
		this.setFunctionModule(7, 8, getBit(bits, 8));
		for (let i = 9; i < 15; i++) {
			this.setFunctionModule(14 - i, 8, getBit(bits, i));
		}

		for (let i = 0; i < 8; i++) {
			this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
		}
		for (let i = 8; i < 15; i++) {
			this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
		}
		this.setFunctionModule(8, this.size - 8, true);
	}

	drawVersionBits() {
		if (this.version < 7) {
			return;
		}
		let remainder = this.version;
		for (let i = 0; i < 12; i++) {
			remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
		}
		const bits = (this.version << 12) | remainder;
		for (let i = 0; i < 18; i++) {
			const bit = getBit(bits, i);
			const a = this.size - 11 + (i % 3);
			const b = Math.floor(i / 3);
			this.setFunctionModule(a, b, bit);
			this.setFunctionModule(b, a, bit);
		}
	}

	/** Lay the interleaved codewords out in the two-module-wide zigzag. */
	drawCodewords(codewords) {
		let index = 0;
		for (let right = this.size - 1; right >= 1; right -= 2) {
			if (right === 6) {
				right = 5; // The vertical timing pattern is not part of the zigzag.
			}
			for (let vertical = 0; vertical < this.size; vertical++) {
				for (let j = 0; j < 2; j++) {
					const x = right - j;
					const upward = ((right + 1) & 2) === 0;
					const y = upward ? this.size - 1 - vertical : vertical;
					if (!this.isFunction[y][x] && index < codewords.length * 8) {
						this.modules[y][x] = getBit(codewords[index >>> 3], 7 - (index & 7));
						index++;
					}
				}
			}
		}
	}

	applyMask(mask) {
		const isMasked = MASK_FUNCTIONS[mask];
		for (let y = 0; y < this.size; y++) {
			for (let x = 0; x < this.size; x++) {
				if (!this.isFunction[y][x] && isMasked(x, y)) {
					this.modules[y][x] = !this.modules[y][x];
				}
			}
		}
	}

	finderPenaltyAddHistory(runLength, history) {
		if (history[0] === 0) {
			runLength += this.size; // Counts the quiet zone as part of the leading run.
		}
		history.pop();
		history.unshift(runLength);
	}

	finderPenaltyCountPatterns(history) {
		const n = history[1];
		const core =
			n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
		return (
			(core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
			(core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
		);
	}

	finderPenaltyTerminateAndCount(runColor, runLength, history) {
		if (runColor) {
			this.finderPenaltyAddHistory(runLength, history);
			runLength = 0;
		}
		runLength += this.size;
		this.finderPenaltyAddHistory(runLength, history);
		return this.finderPenaltyCountPatterns(history);
	}

	penaltyScore() {
		let result = 0;

		for (let y = 0; y < this.size; y++) {
			let runColor = false;
			let runLength = 0;
			const history = [0, 0, 0, 0, 0, 0, 0];
			for (let x = 0; x < this.size; x++) {
				if (this.modules[y][x] === runColor) {
					runLength++;
					if (runLength === 5) {
						result += PENALTY_N1;
					} else if (runLength > 5) {
						result++;
					}
				} else {
					this.finderPenaltyAddHistory(runLength, history);
					if (!runColor) {
						result += this.finderPenaltyCountPatterns(history) * PENALTY_N3;
					}
					runColor = this.modules[y][x];
					runLength = 1;
				}
			}
			result += this.finderPenaltyTerminateAndCount(runColor, runLength, history) * PENALTY_N3;
		}

		for (let x = 0; x < this.size; x++) {
			let runColor = false;
			let runLength = 0;
			const history = [0, 0, 0, 0, 0, 0, 0];
			for (let y = 0; y < this.size; y++) {
				if (this.modules[y][x] === runColor) {
					runLength++;
					if (runLength === 5) {
						result += PENALTY_N1;
					} else if (runLength > 5) {
						result++;
					}
				} else {
					this.finderPenaltyAddHistory(runLength, history);
					if (!runColor) {
						result += this.finderPenaltyCountPatterns(history) * PENALTY_N3;
					}
					runColor = this.modules[y][x];
					runLength = 1;
				}
			}
			result += this.finderPenaltyTerminateAndCount(runColor, runLength, history) * PENALTY_N3;
		}

		for (let y = 0; y < this.size - 1; y++) {
			for (let x = 0; x < this.size - 1; x++) {
				const color = this.modules[y][x];
				if (
					color === this.modules[y][x + 1] &&
					color === this.modules[y + 1][x] &&
					color === this.modules[y + 1][x + 1]
				) {
					result += PENALTY_N2;
				}
			}
		}

		let dark = 0;
		for (const row of this.modules) {
			for (const module of row) {
				if (module) {
					dark++;
				}
			}
		}
		const total = this.size * this.size;
		const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
		result += k * PENALTY_N4;

		return result;
	}
}

export class DataTooLongError extends Error {
	constructor(message) {
		super(message);
		this.name = 'DataTooLongError';
	}
}

/**
 * Encode text as a QR Code.
 *
 * Returns the module matrix without a quiet zone, plus the version and mask
 * that were chosen, so that callers can render it however they like.
 */
export function encode(text, options = {}) {
	const {
		errorCorrection = 'H',
		minVersion = MIN_VERSION,
		maxVersion = MAX_VERSION,
		mask: requestedMask = -1,
	} = options;

	if (!ERROR_CORRECTION_LEVELS.includes(errorCorrection)) {
		throw new RangeError(`Unknown error correction level: ${errorCorrection}`);
	}
	if (requestedMask < -1 || requestedMask > 7) {
		throw new RangeError(`Mask must be between 0 and 7, or -1 to choose automatically`);
	}

	const mode = selectMode(text);
	const bytes = mode === MODE_BYTE ? utf8Bytes(text) : [];
	const payloadBits = payloadBitLength(mode, text, bytes);

	let version = 0;
	for (let candidate = minVersion; candidate <= maxVersion; candidate++) {
		const capacity = numDataCodewords(candidate, errorCorrection) * 8;
		if (4 + charCountBits(mode, candidate) + payloadBits <= capacity) {
			version = candidate;
			break;
		}
	}
	if (version === 0) {
		throw new DataTooLongError(
			`Data does not fit in a version ${maxVersion} code at error correction level ${errorCorrection}`,
		);
	}

	const capacityBits = numDataCodewords(version, errorCorrection) * 8;
	const buffer = new BitBuffer();
	buffer.append(mode.bits, 4);
	buffer.append(mode === MODE_BYTE ? bytes.length : text.length, charCountBits(mode, version));
	writePayload(buffer, mode, text, bytes);

	buffer.append(0, Math.min(4, capacityBits - buffer.length));
	buffer.append(0, (8 - (buffer.length % 8)) % 8);
	for (let pad = 0xec; buffer.length < capacityBits; pad ^= 0xec ^ 0x11) {
		buffer.append(pad, 8);
	}

	const dataCodewords = [];
	for (let i = 0; i < buffer.length; i += 8) {
		let byte = 0;
		for (let j = 0; j < 8; j++) {
			byte = (byte << 1) | buffer.bits[i + j];
		}
		dataCodewords.push(byte);
	}

	const matrix = new Matrix(version, errorCorrection);
	matrix.drawFunctionPatterns();
	matrix.drawCodewords(addErrorCorrection(dataCodewords, version, errorCorrection));

	let mask = requestedMask;
	if (mask === -1) {
		let lowestPenalty = Infinity;
		for (let candidate = 0; candidate < 8; candidate++) {
			matrix.drawFormatBits(candidate);
			matrix.applyMask(candidate);
			const penalty = matrix.penaltyScore();
			if (penalty < lowestPenalty) {
				lowestPenalty = penalty;
				mask = candidate;
			}
			matrix.applyMask(candidate); // XOR is its own inverse.
		}
	}
	matrix.drawFormatBits(mask);
	matrix.applyMask(mask);

	return {
		version,
		errorCorrection,
		mask,
		size: matrix.size,
		modules: matrix.modules,
		// Renderers need this: finder, timing and alignment patterns have to stay
		// legible for a scanner to lock on, whatever is done with the data modules.
		isFunction: matrix.isFunction,
	};
}

/** Largest string length that still fits, useful for input validation. */
export function capacityBytes(version, errorCorrection) {
	return numDataCodewords(version, errorCorrection);
}
