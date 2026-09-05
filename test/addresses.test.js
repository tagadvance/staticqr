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
