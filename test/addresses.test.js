import assert from 'node:assert/strict';
import test from 'node:test';

import { inspect, isSensitive } from '../src/addresses.js';

const VALID = [
	['P2PKH mainnet', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', { kind: 'P2PKH', network: 'mainnet' }],
	['P2SH mainnet', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', { kind: 'P2SH', network: 'mainnet' }],
	[
		'P2WPKH mainnet',
		'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
		{ kind: 'P2WPKH', network: 'mainnet' },
	],
	[
		'P2WSH mainnet',
		'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
		{ kind: 'P2WSH', network: 'mainnet' },
	],
	[
		'P2TR mainnet',
		'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
		{ kind: 'P2TR', network: 'mainnet' },
	],
	[
		'P2WPKH testnet',
		'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
		{ kind: 'P2WPKH', network: 'testnet' },
	],
];

for (const [name, address, expected] of VALID) {
	test(`accepts a valid ${name} address`, async () => {
		const result = await inspect(address);
		assert.equal(result.valid, true);
		assert.equal(result.kind, expected.kind);
		assert.equal(result.network, expected.network);
	});

	test(`rejects ${name} with a single corrupted character`, async () => {
		// Flip one payload character to a different but still legal one. Only the
		// checksum can catch this, which is exactly the point.
		const index = address.length - 8;
		const original = address[index];
		const replacement = original === 'q' ? 'p' : original === '5' ? '4' : 'q';
		const corrupted = address.slice(0, index) + replacement + address.slice(index + 1);
		assert.notEqual(corrupted, address);

		const result = await inspect(corrupted);
		assert.notEqual(result, null, 'a corrupted address should still be recognised as one');
		assert.equal(result.valid, false, `expected ${corrupted} to fail its checksum`);
	});

	test(`rejects ${name} with a truncated tail`, async () => {
		const result = await inspect(address.slice(0, -1));
		assert.ok(result === null || result.valid === false);
	});
}

const TESTNET = [
	['P2PKH testnet', 'mfvRD51Mp4xiLK7w6YJ8Q19Y3qJCMroaq6', 'P2PKH'],
	['P2PKH testnet, n prefix', 'n2eMqTT929pb1RDNuqEnxdaLau1rxy3efi', 'P2PKH'],
	['P2SH testnet', '2Mz9E2g7jqtVDkUtcfbJajGV58gdDBFkjWV', 'P2SH'],
];

for (const [name, address, kind] of TESTNET) {
	test(`accepts a valid ${name} address`, async () => {
		// The router regex used to admit only 1 and 3, which made every testnet
		// base58 address invisible and the testnet version bytes dead code.
		const result = await inspect(address);
		assert.notEqual(result, null, `${address} should be recognised`);
		assert.equal(result.valid, true);
		assert.equal(result.kind, kind);
		assert.equal(result.network, 'testnet');
	});
}

test('still warns when the version character itself is corrupted', async () => {
	// Corrupting the first character used to drop the string out of the router
	// entirely, so the user saw nothing at all rather than a checksum warning.
	for (const corrupted of [
		'2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
		'mA1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
	]) {
		const result = await inspect(corrupted);
		assert.notEqual(result, null, `${corrupted} should still be recognised as address-shaped`);
		assert.equal(result.valid, false);
	}
});

test('does not claim a currency it cannot check is corrupted', async () => {
	// Reporting valid:false here told people holding a perfectly good Litecoin
	// address that it was corrupt, which is this project's own warning inverted.
	const result = await inspect('litecoin:LfNCnyUMewGQz9c9kN6pnbTZ88pawyrnMU');
	assert.equal(result.family, 'litecoin');
	assert.equal(result.kind, 'uri');
	assert.equal(result.valid, null, 'unchecked is not the same as invalid');
});

test('every report carries what the warning needs to name it', async () => {
	// The warning interpolates kind and network. A report that has neither and
	// is not flagged another way rendered as "a undefined on undefined".
	const inputs = [
		'1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
		'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdp',
		'2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
		'litecoin:LfNCnyUMewGQz9c9kN6pnbTZ88pawyrnMU',
		'0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
		'6a9013b8684862e9ccfb527bf8f5ea5eb213e77e3970ff2cd8bbc22beb7cebfb',
	];
	for (const input of inputs) {
		const report = await inspect(input);
		const nameable =
			report.kind === 'uri' ||
			report.kind === 'hash' ||
			report.family === 'ethereum' ||
			(report.kind !== undefined && report.network !== undefined) ||
			(report.kind === undefined && report.network === undefined);
		assert.ok(nameable, `no way to describe the report for ${input}`);
	}
});

test('does not recurse indefinitely on nested payment URIs', async () => {
	const nested = 'bitcoin:'.repeat(5000) + '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
	const result = await inspect(nested);
	assert.equal(result.kind, 'uri');
	assert.equal(result.valid, null);
});

test('accepts an uppercase hex prefix', async () => {
	const result = await inspect('0X742d35Cc6634C0532925a3b844Bc454e4438f44e');
	assert.equal(result.family, 'ethereum');
});

test('treats non-string input as not an address', async () => {
	for (const value of [null, undefined, 42, {}, []]) {
		assert.equal(await inspect(value), null);
		assert.equal(await isSensitive(value), false);
	}
});

test('rejects a mixed case bech32 address', async () => {
	const result = await inspect('bc1QW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
	assert.equal(result.valid, false);
	assert.equal(result.reason, 'mixedCase');
});

test('rejects an unknown human readable prefix', async () => {
	const result = await inspect('zz1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
	assert.equal(result, null);
});

test('unwraps a payment URI', async () => {
	const result = await inspect('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=0.001');
	assert.equal(result.valid, true);
	assert.equal(result.kind, 'P2PKH');
	assert.equal(result.wrappedInUri, true);
});

test('flags an Ethereum account by shape without claiming to have checked it', async () => {
	const result = await inspect('0x742d35Cc6634C0532925a3b844Bc454e4438f44e');
	assert.equal(result.family, 'ethereum');
	assert.equal(result.valid, null);
});

test('flags a bare 64 character hash', async () => {
	const result = await inspect('6a9013b8684862e9ccfb527bf8f5ea5eb213e77e3970ff2cd8bbc22beb7cebfb');
	assert.equal(result.kind, 'hash');
	assert.equal(result.valid, null);
});

test('ignores ordinary text', async () => {
	for (const text of ['', '   ', 'hello world', 'https://example.com', 'Wi-Fi password: hunter2']) {
		assert.equal(await inspect(text), null, `${text} should not look like an address`);
	}
});

test('trims surrounding whitespace before deciding', async () => {
	const result = await inspect('  1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa\n');
	assert.equal(result.valid, true);
});

test('isSensitive fires for anything address shaped', async () => {
	assert.equal(await isSensitive('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'), true);
	assert.equal(await isSensitive('0x742d35Cc6634C0532925a3b844Bc454e4438f44e'), true);
	assert.equal(await isSensitive('just some text'), false);
});
