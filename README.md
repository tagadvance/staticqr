# Crappy QR

[![CI](https://github.com/tagadvance/Crappy-QR/actions/workflows/ci.yml/badge.svg)](https://github.com/tagadvance/Crappy-QR/actions/workflows/ci.yml)
[![Deploy to Pages](https://github.com/tagadvance/Crappy-QR/actions/workflows/pages.yml/badge.svg)](https://github.com/tagadvance/Crappy-QR/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Site](https://img.shields.io/badge/site-staticqr.com-6b4423)](https://staticqr.com)

A QR code generator that runs entirely in your browser and draws the data
modules as piles of poo. Live at **[staticqr.com](https://staticqr.com)**.

![A QR code drawn with the pile of poo emoji](/images/qr-test.png?raw=true "QR code to this repository")

## Why it exists

Search for a QR code generator, take the top few results, paste in a Bitcoin
address, and compare what comes back. Several of them return a code that does
not contain the address you typed. It contains somebody else's.

The attack works because a QR code is not human readable. You paste in your
address, you get a picture, you cannot read the picture, so you put it on an
invoice and throw away the original text. Everyone who scans it pays the
attacker.

So this generator has no server. Nothing you type is transmitted, because
there is nowhere to transmit it to. The content security policy sets
`connect-src 'none'`, which means the browser enforces that rather than asking
you to believe it. Disconnect from the network, reload, and the page keeps
working.

## What it does

- **Generates** codes in the browser, then decodes the image it just drew and
  shows you what it reads back.
- **Checks** any QR code image, from anywhere, and diffs it against the address
  or link you were expecting.
- **Validates** Bitcoin addresses properly: base58check with a double SHA-256,
  and bech32/bech32m with the BIP-173 and BIP-350 polymod. A shape-matching
  regular expression cannot tell a real address from a corrupted one.
- **Speaks** English, Spanish, Portuguese, French, Russian and Japanese, each
  at its own URL.

## Does it actually scan?

Yes, and that took some work. Two things are load-bearing:

**Function patterns are solid squares.** A scanner locates a code by measuring
the 1:1:3:1:1 run-length ratio across a finder pattern. Emoji-shaped corners
destroy that ratio at every glyph size. The 2018 version of this project drew
them with poo, which is why the example image in this README was, until
recently, unreadable by any decoder.

**Glyphs are centred on their ink, not their bounding box.** The pile is a
triangle, so its ink sits well below the middle of its box. Centring the box
leaves a pale strip along the top of every cell, and a grid of those reads as
light to a binariser. That alone failed about one code in seven. Neither
darker ink nor bigger glyphs fixed it; moving the centre did, completely.

Both were found by decoding the rendered output rather than by reasoning about
it, and `test/render.browser.test.js` now renders 252 codes plus an SVG per
payload and decodes every one.

## Development

```shell
npm install
npx playwright install chromium   # for the browser tests
npm run build                     # writes dist/
npm run serve                     # http://localhost:8080
npm run lint
npm test
```

Formatting is Prettier with tabs, following `~/git/.editorconfig`. ESLint
carries only rules that catch bugs or dead code; anything stylistic is left to
Prettier via `eslint-config-prettier`.

| Command | Does |
| --- | --- |
| `npm run build` | Build the static site into `dist/` |
| `npm run serve` | Serve `dist/` locally |
| `npm test` | Unit, translation and browser tests |
| `npm run lint` | ESLint plus a Prettier formatting check |
| `npm run format` | Rewrite with Prettier, then apply ESLint's safe fixes |
| `npm run images` | Regenerate `site/og.png` and the README example |
| `npm run golden` | Regenerate the encoder fixtures — read `tools/golden.mjs` first |

## The encoder

`src/qr.js` implements ISO/IEC 18004 from scratch. Vendoring an encoder from a
package registry would put third-party code back in the one place this project
argues it does not belong.

Hand-written code needs proving, so every matrix was compared against the
Python `qrcode` library across all 40 versions, 4 error correction levels and
3 masks. All 480 came out byte-identical, and those digests are pinned in
`test/fixtures/golden.json` so CI catches drift without needing Python. The
suite also round-trips a corpus through jsQR, an independent decoder.

That cross-check paid for itself immediately: the general alignment-pattern
spacing formula disagrees with the specification at version 32, the one
version where it does.

Decoding, unlike encoding, deliberately uses jsQR. A check is only worth
something if it can disagree with the thing it is checking, and our own
encoder would agree with itself no matter what it got wrong.

## Deployment

GitHub Pages, from `.github/workflows/pages.yml` on every push to `master`.
The build writes a `CNAME` for `staticqr.com`.

DNS needs an `ALIAS`/`ANAME` at the apex, or these four `A` records:

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

Add a `CNAME` for `www` pointing at `tagadvance.github.io`, then enable
**Enforce HTTPS** in the repository's Pages settings once the certificate has
been issued.

## Licence

MIT, see [LICENSE](LICENSE). The poo outline is derived from
[Noto Emoji](https://github.com/googlefonts/noto-emoji), used under the SIL
Open Font License; see [licenses/NotoEmoji-OFL.txt](licenses/NotoEmoji-OFL.txt).
