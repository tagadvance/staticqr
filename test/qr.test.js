import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import jsQR from 'jsqr';

import {
  DataTooLongError,
  ERROR_CORRECTION_LEVELS,
  alignmentPatternPositions,
  capacityBytes,
  encode,
} from '../src/qr.js';
import { rasterise } from './support/raster.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/golden.json', import.meta.url)));

/**
 * jsQR cannot decode version 23 symbols. This was confirmed to be a decoder
 * fault rather than an encoder one: our version 23 matrices are byte-identical
 * to those produced by the Python `qrcode` library, and jsQR fails on both.
 * The golden fixtures still cover version 23.
 */
const VERSIONS_JSQR_CANNOT_DECODE = new Set([23]);

function decode(result) {
  const { data, width, height } = rasterise(result.modules);
  const decoded = jsQR(data, width, height);
  return decoded === null ? null : decoded.data;
}

function canonical(modules) {
  return modules.map((row) => row.map((module) => (module ? '1' : '0')).join('')).join('\n');
}

test('matrix digests match the cross-verified fixtures', () => {
  for (const { version, ecl, mask, repeat, sha256 } of golden.cases) {
    const result = encode(golden.payloadUnit.repeat(repeat), {
      errorCorrection: ecl,
      minVersion: version,
      maxVersion: version,
      mask,
    });
    const digest = createHash('sha256').update(canonical(result.modules)).digest('hex');
    assert.equal(digest, sha256, `matrix changed for version ${version}-${ecl} mask ${mask}`);
  }
});

test('places alignment patterns where the specification says', () => {
  assert.deepEqual(alignmentPatternPositions(1), []);
  assert.deepEqual(alignmentPatternPositions(2), [6, 18]);
  assert.deepEqual(alignmentPatternPositions(7), [6, 22, 38]);
  // Version 32 is the exception the general spacing formula gets wrong.
  assert.deepEqual(alignmentPatternPositions(32), [6, 34, 60, 86, 112, 138]);
  assert.deepEqual(alignmentPatternPositions(40), [6, 30, 58, 86, 114, 142, 170]);
});

test('draws the mandatory function patterns', () => {
  const { modules, size } = encode('structure', { errorCorrection: 'H' });
  const finder = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];
  for (const [originY, originX] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        assert.equal(
          modules[originY + y][originX + x] ? 1 : 0,
          finder[y][x],
          `finder pattern wrong at ${originY + y},${originX + x}`,
        );
      }
    }
  }

  for (let i = 8; i < size - 8; i++) {
    assert.equal(modules[6][i], i % 2 === 0, `horizontal timing wrong at column ${i}`);
    assert.equal(modules[i][6], i % 2 === 0, `vertical timing wrong at row ${i}`);
  }

  assert.equal(modules[size - 8][8], true, 'the dark module must always be set');
});

const CORPUS = [
  ['single character', 'a'],
  ['numeric mode', '01234567'],
  ['long numeric', '1'.repeat(200)],
  ['alphanumeric mode', 'HELLO WORLD'],
  ['alphanumeric punctuation', 'HTTP://EXAMPLE.COM/A+B$C%D*E-F.G/H:I'],
  ['byte mode ascii', 'Hello, world!'],
  ['url', 'https://staticqr.com/'],
  ['legacy bitcoin address', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
  ['p2sh bitcoin address', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
  ['bech32 bitcoin address', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
  ['taproot bitcoin address', 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr'],
  ['bitcoin uri', 'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=0.001&label=Donation'],
  ['japanese', 'こんにちは世界'],
  ['russian', 'Привет, мир'],
  ['portuguese accents', 'Verifique sempre o código antes de partilhar'],
  ['emoji payload', 'poop \u{1F4A9} code'],
  ['long text', 'The quick brown fox jumps over the lazy dog. '.repeat(12)],
];

for (const [name, payload] of CORPUS) {
  for (const errorCorrection of ERROR_CORRECTION_LEVELS) {
    test(`round-trips ${name} at level ${errorCorrection}`, () => {
      const result = encode(payload, { errorCorrection });
      assert.equal(decode(result), payload);
    });
  }
}

test('round-trips every explicit mask', () => {
  const payload = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
  for (let mask = 0; mask < 8; mask++) {
    const result = encode(payload, { mask });
    assert.equal(result.mask, mask);
    assert.equal(decode(result), payload);
  }
});

test('round-trips a full payload at every version', () => {
  for (let version = 1; version <= 40; version++) {
    if (VERSIONS_JSQR_CANNOT_DECODE.has(version)) {
      continue;
    }
    const payload = 'A'.repeat(capacityBytes(version, 'H') - 3);
    const result = encode(payload, { errorCorrection: 'H', minVersion: version });
    assert.equal(result.version, version);
    assert.equal(decode(result), payload, `failed to decode version ${version}`);
  }
});

test('picks the smallest version that fits', () => {
  assert.equal(encode('a', { errorCorrection: 'L' }).version, 1);
  assert.equal(encode('a'.repeat(17), { errorCorrection: 'L' }).version, 1);
  assert.equal(encode('a'.repeat(18), { errorCorrection: 'L' }).version, 2);
});

test('chooses the most compact mode available', () => {
  // 41 digits fit in a version 1-L symbol only in numeric mode.
  assert.equal(encode('1'.repeat(41), { errorCorrection: 'L' }).version, 1);
  // The same length in lowercase drops out of alphanumeric into byte mode.
  assert.equal(encode('a'.repeat(41), { errorCorrection: 'L' }).version, 3);
});

test('rejects data that cannot fit', () => {
  assert.throws(() => encode('a'.repeat(3000), { errorCorrection: 'H' }), DataTooLongError);
});

test('rejects an unknown error correction level', () => {
  assert.throws(() => encode('a', { errorCorrection: 'X' }), RangeError);
});

test('rejects an out of range mask', () => {
  assert.throws(() => encode('a', { mask: 8 }), RangeError);
});
