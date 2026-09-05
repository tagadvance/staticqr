/**
 * Regenerate test/fixtures/golden.json.
 *
 * These digests are a regression pin, not a proof. They were originally
 * produced by encoding each case with src/qr.js and confirming the resulting
 * matrix was byte-identical to the one produced by the Python `qrcode`
 * library, for all 40 versions at 4 error correction levels and 3 masks.
 *
 * Only regenerate after re-running that cross-check against an independent
 * implementation, otherwise the fixtures merely pin whatever the encoder
 * currently does, including any bug it has just acquired.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { capacityBytes, encode } from '../src/qr.js';

const PAYLOAD_UNIT = 'Az9 ';

const cases = [];
for (let version = 1; version <= 40; version++) {
	for (const ecl of ['L', 'M', 'Q', 'H']) {
		for (const mask of [0, 3, 7]) {
			const repeat = Math.max(1, Math.floor((capacityBytes(version, ecl) - 4) / 4));
			const result = encode(PAYLOAD_UNIT.repeat(repeat), {
				errorCorrection: ecl,
				minVersion: version,
				maxVersion: version,
				mask,
			});
			const canonical = result.modules
				.map((row) => row.map((module) => (module ? '1' : '0')).join(''))
				.join('\n');
			cases.push({
				version,
				ecl,
				mask,
				repeat,
				sha256: createHash('sha256').update(canonical).digest('hex'),
			});
		}
	}
}

writeFileSync(
	new URL('../test/fixtures/golden.json', import.meta.url),
	JSON.stringify(
		{
			note: 'Matrix digests verified byte-identical to the Python qrcode library across all 40 versions, 4 error correction levels and 3 masks. See tools/golden.mjs before regenerating.',
			payloadUnit: PAYLOAD_UNIT,
			cases,
		},
		null,
		2,
	) + '\n',
);

console.log(`wrote ${cases.length} fixtures`);
