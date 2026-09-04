/**
 * Recognise cryptocurrency payment addresses and verify their checksums.
 *
 * Checksums matter here. A regular expression can tell you a string is
 * address-shaped, but only the checksum tells you it is the address someone
 * actually meant to give you, which is the whole failure this site is about.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

/** Mainnet and testnet version bytes for pay-to-pubkey-hash and pay-to-script-hash. */
const BASE58_VERSIONS = new Map([
  [0x00, { network: 'mainnet', kind: 'P2PKH' }],
  [0x05, { network: 'mainnet', kind: 'P2SH' }],
  [0x6f, { network: 'testnet', kind: 'P2PKH' }],
  [0xc4, { network: 'testnet', kind: 'P2SH' }],
]);

const SEGWIT_PREFIXES = new Map([
  ['bc', 'mainnet'],
  ['tb', 'testnet'],
  ['bcrt', 'regtest'],
]);

function base58Decode(text) {
  const bytes = [0];
  for (const character of text) {
    const value = BASE58_ALPHABET.indexOf(character);
    if (value === -1) {
      return null;
    }
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < text.length && text[i] === '1'; i++) {
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function bech32Polymod(values) {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) {
        checksum ^= BECH32_GENERATOR[i];
      }
    }
  }
  return checksum >>> 0;
}

function bech32HrpExpand(hrp) {
  const high = [];
  const low = [];
  for (const character of hrp) {
    high.push(character.charCodeAt(0) >> 5);
    low.push(character.charCodeAt(0) & 31);
  }
  return [...high, 0, ...low];
}

/** Regroup a bit stream, used to turn 5-bit bech32 data into 8-bit bytes. */
function convertBits(data, fromBits, toBits, pad) {
  let accumulator = 0;
  let bits = 0;
  const result = [];
  const maxValue = (1 << toBits) - 1;
  for (const value of data) {
    if (value < 0 || value >>> fromBits !== 0) {
      return null;
    }
    accumulator = (accumulator << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >>> bits) & maxValue);
    }
  }
  if (pad) {
    if (bits > 0) {
      result.push((accumulator << (toBits - bits)) & maxValue);
    }
  } else if (bits >= fromBits || ((accumulator << (toBits - bits)) & maxValue) !== 0) {
    return null;
  }
  return result;
}

function decodeBech32(text) {
  // Mixed case is forbidden precisely so that a case-mangled address cannot
  // silently pass as valid.
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) {
    return { error: 'mixedCase' };
  }
  const lowered = text.toLowerCase();
  const separator = lowered.lastIndexOf('1');
  if (separator < 1 || separator + 7 > lowered.length || lowered.length > 90) {
    return { error: 'malformed' };
  }

  const hrp = lowered.slice(0, separator);
  const data = [];
  for (const character of lowered.slice(separator + 1)) {
    const value = BECH32_CHARSET.indexOf(character);
    if (value === -1) {
      return { error: 'malformed' };
    }
    data.push(value);
  }

  const checksum = bech32Polymod([...bech32HrpExpand(hrp), ...data]);
  const encoding =
    checksum === BECH32_CONST ? 'bech32' : checksum === BECH32M_CONST ? 'bech32m' : null;
  if (encoding === null) {
    return { error: 'checksum' };
  }
  return { hrp, encoding, data: data.slice(0, -6) };
}

function inspectSegwit(text) {
  const decoded = decodeBech32(text);
  if (decoded.error) {
    return {
      family: 'bitcoin',
      encoding: 'bech32',
      valid: false,
      reason: decoded.error,
    };
  }

  const network = SEGWIT_PREFIXES.get(decoded.hrp);
  if (network === undefined) {
    return { family: 'bitcoin', encoding: decoded.encoding, valid: false, reason: 'prefix' };
  }

  const [witnessVersion, ...rest] = decoded.data;
  const program = convertBits(rest, 5, 8, false);
  if (program === null || witnessVersion > 16) {
    return { family: 'bitcoin', encoding: decoded.encoding, valid: false, reason: 'program' };
  }
  // Version 0 uses bech32; every later version uses bech32m.
  const expected = witnessVersion === 0 ? 'bech32' : 'bech32m';
  if (decoded.encoding !== expected) {
    return { family: 'bitcoin', encoding: decoded.encoding, valid: false, reason: 'encoding' };
  }
  if (program.length < 2 || program.length > 40) {
    return { family: 'bitcoin', encoding: decoded.encoding, valid: false, reason: 'program' };
  }
  if (witnessVersion === 0 && program.length !== 20 && program.length !== 32) {
    return { family: 'bitcoin', encoding: decoded.encoding, valid: false, reason: 'program' };
  }

  const kind =
    witnessVersion === 0
      ? program.length === 20
        ? 'P2WPKH'
        : 'P2WSH'
      : witnessVersion === 1 && program.length === 32
        ? 'P2TR'
        : `witness v${witnessVersion}`;

  return { family: 'bitcoin', encoding: decoded.encoding, network, kind, valid: true, reason: null };
}

async function inspectBase58(text) {
  const decoded = base58Decode(text);
  if (decoded === null || decoded.length !== 25) {
    return { family: 'bitcoin', encoding: 'base58check', valid: false, reason: 'malformed' };
  }

  const payload = decoded.slice(0, 21);
  const checksum = decoded.slice(21);
  const digest = await sha256(await sha256(payload));
  for (let i = 0; i < 4; i++) {
    if (digest[i] !== checksum[i]) {
      return { family: 'bitcoin', encoding: 'base58check', valid: false, reason: 'checksum' };
    }
  }

  const version = BASE58_VERSIONS.get(payload[0]);
  if (version === undefined) {
    return { family: 'bitcoin', encoding: 'base58check', valid: false, reason: 'version' };
  }

  return {
    family: 'bitcoin',
    encoding: 'base58check',
    network: version.network,
    kind: version.kind,
    valid: true,
    reason: null,
  };
}

/**
 * Look at a string and report whether it appears to be a payment address or
 * transaction hash, and whether its checksum actually holds up.
 *
 * Returns null when the input does not resemble one at all.
 */
export async function inspect(input) {
  const text = input.trim();
  if (text === '') {
    return null;
  }

  // A payment URI carries the address in its path.
  const uri = /^(bitcoin|litecoin|ethereum|bitcoincash):([^?]+)/i.exec(text);
  if (uri !== null) {
    const inner = await inspect(uri[2]);
    return inner === null
      ? { family: uri[1].toLowerCase(), encoding: 'uri', valid: false, reason: 'malformed' }
      : { ...inner, wrappedInUri: true };
  }

  if (/^(bc|tb|bcrt)1[a-z0-9]+$/i.test(text)) {
    return inspectSegwit(text);
  }
  if (/^[13][1-9A-HJ-NP-Za-km-z]{25,39}$/.test(text)) {
    return inspectBase58(text);
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(text)) {
    // Deliberately shape-only. Verifying EIP-55 needs keccak256, which is a
    // lot of code to add for a warning that already fires on the shape.
    return { family: 'ethereum', encoding: 'hex', kind: 'account', valid: null, reason: null };
  }
  if (/^[0-9a-fA-F]{64}$/.test(text)) {
    // A transaction id or block hash carries no checksum of its own.
    return { family: 'bitcoin', encoding: 'hex', kind: 'hash', valid: null, reason: null };
  }

  return null;
}

/** True when the input is worth warning the user about before they share it. */
export async function isSensitive(input) {
  return (await inspect(input)) !== null;
}
