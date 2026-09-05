/**
 * The pile-of-poo glyph as a plain vector outline.
 *
 * Taken from Noto Emoji, converted to a path once at build time and used
 * under the SIL Open Font License, served alongside this file at
 * /licenses/NotoEmoji-OFL.txt.
 *
 * Drawing it as a path rather than as text means
 * the code renders identically whether or not the visitor's device has an
 * emoji font installed. A missing font would otherwise leave blank or
 * tofu-boxed modules, producing a QR code that silently fails to scan.
 */
export const GLYPH_PATH =
	'M1162 1783 1184 1792Q1207 1801 1239.5 1809.5Q1272 1818 1295 1818Q1315 1818 1329.0 1810.0Q1343 1802 1343 1780Q1343 1737 1293.0 1684.5Q1243 1632 1243 1591Q1243 1492 1420.5 1489.5Q1598 1487 1675.0 1415.0Q1752 1343 1752 1239Q1752 1114 1646.0 1024.5Q1540 935 1336 935Q1137 935 970.0 1032.0Q803 1129 803 1294Q803 1443 899.0 1573.5Q995 1704 1162 1783ZM1156 358Q923 376 754.0 499.5Q585 623 585 826Q585 933 633.0 1023.5Q681 1114 737 1114Q776 1114 776.0 1066.0Q776 1018 835.0 955.5Q894 893 1032.0 848.0Q1170 803 1315 803Q1447 803 1556.5 846.0Q1666 889 1735.0 955.0Q1804 1021 1823.5 1058.5Q1843 1096 1869 1096Q1921 1096 1954.5 1015.5Q1988 935 1988 841Q1988 609 1783.5 480.5Q1579 352 1274 352Q1244 352 1215 354ZM1291 -294Q1085 -294 836.0 -232.0Q587 -170 459.5 -13.5Q332 143 332 318Q332 442 386.5 534.0Q441 626 499 626Q508 626 521.0 620.5Q534 615 559.5 551.0Q585 487 681.0 414.5Q777 342 931.5 293.0Q1086 244 1286 244Q1581 244 1783.0 346.0Q1985 448 2051 643L2058 662Q2064 679 2074.0 689.0Q2084 699 2099 699Q2145 699 2206.0 600.5Q2267 502 2267 369Q2267 175 2143.0 26.0Q2019 -123 1786.5 -208.5Q1554 -294 1291 -294Z';

/** Bounding box of the outline, in the font's own units. */
const BOUNDS = { minX: 332, minY: -294, maxX: 2267, maxY: 1818 };

/**
 * Centre of the glyph's ink, not of its bounding box.
 *
 * The pile is a triangle: thin at the top, wide at the bottom, so its ink sits
 * well below the middle of its bounding box. Centring the box instead of the
 * ink leaves a pale strip along the top of every cell, and a grid of those
 * strips reads as light to a decoder's binariser. Measured against a real
 * decoder that mistake fails roughly one code in seven; aligning the ink
 * centroid instead makes every code scan.
 *
 * Measured by rasterising the outline at 256x256 and averaging the position of
 * every inked pixel.
 */
const CENTRE_X = 1281;
const CENTRE_Y = 564;

const EXTENT = Math.max(BOUNDS.maxX - BOUNDS.minX, BOUNDS.maxY - BOUNDS.minY);

/**
 * Matrix mapping the outline onto a cell of the given size at the given
 * origin, as the six values of an affine transform. The vertical flip is
 * because font outlines have y pointing up and screens have it pointing down.
 */
export function glyphTransform(x, y, size, coverage = 1) {
	const scale = (size * coverage) / EXTENT;
	return [scale, 0, 0, -scale, x + size / 2 - CENTRE_X * scale, y + size / 2 + CENTRE_Y * scale];
}
