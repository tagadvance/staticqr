/**
 * Structural checks on the translations.
 *
 * These cannot judge whether a translation reads well, but they do catch the
 * ways a translated site actually breaks: a key that was never translated, a
 * placeholder that was dropped so a sentence renders with a literal {kind} in
 * it, or a list that lost an item.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const directory = new URL('../i18n/', import.meta.url);
const catalogue = {};
for (const file of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
  const strings = JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
  catalogue[strings.lang] = strings;
  assert.equal(`${strings.lang}.json`, file, 'the lang field must match the filename');
}

const reference = catalogue.en;
const others = Object.keys(catalogue).filter((lang) => lang !== 'en');

/** Every leaf path in an object, with array indices included. */
function paths(value, prefix = '') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => paths(item, `${prefix}[${index}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      paths(item, prefix === '' ? key : `${prefix}.${key}`),
    );
  }
  return [prefix];
}

function placeholders(value) {
  return [...String(value).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

function at(object, path) {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .reduce((node, key) => (node === undefined ? undefined : node[key]), object);
}

test('english is present and is the reference', () => {
  assert.ok(reference, 'i18n/en.json is required');
  assert.ok(others.length > 0, 'expected at least one translation');
});

for (const lang of others) {
  const strings = catalogue[lang];

  test(`${lang} has exactly the same keys as english`, () => {
    const expected = paths(reference).sort();
    const actual = paths(strings).sort();
    const missing = expected.filter((path) => !actual.includes(path));
    const extra = actual.filter((path) => !expected.includes(path));
    assert.deepEqual(missing, [], `${lang} is missing keys`);
    assert.deepEqual(extra, [], `${lang} has keys english does not`);
  });

  test(`${lang} keeps every placeholder`, () => {
    for (const path of paths(reference)) {
      const expected = placeholders(at(reference, path));
      if (expected.length === 0) {
        continue;
      }
      assert.deepEqual(
        placeholders(at(strings, path)),
        expected,
        `placeholders differ at ${path} in ${lang}`,
      );
    }
  });

  test(`${lang} leaves nothing empty`, () => {
    for (const path of paths(strings)) {
      const value = at(strings, path);
      assert.equal(typeof value, 'string', `${path} in ${lang} should be a string`);
      assert.notEqual(value.trim(), '', `${path} in ${lang} is empty`);
    }
  });

  test(`${lang} translates the prose rather than copying english`, () => {
    // Short labels legitimately coincide across languages, and the site name
    // is deliberately the same everywhere. Long sentences should not match.
    const copied = paths(reference).filter((path) => {
      const source = at(reference, path);
      return typeof source === 'string' && source.length > 60 && at(strings, path) === source;
    });
    assert.deepEqual(copied, [], `${lang} still has untranslated sentences`);
  });
}
