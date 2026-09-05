/**
 * Rasterise a module matrix to RGBA pixels so that a decoder can read it back.
 * Test support only; the browser reads pixels straight off the canvas.
 */
export function rasterise(modules, { scale = 4, border = 4 } = {}) {
	const size = modules.length;
	const width = (size + border * 2) * scale;
	const data = new Uint8ClampedArray(width * width * 4).fill(255);

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (!modules[y][x]) {
				continue;
			}
			for (let dy = 0; dy < scale; dy++) {
				for (let dx = 0; dx < scale; dx++) {
					const px = (x + border) * scale + dx;
					const py = (y + border) * scale + dy;
					const offset = (py * width + px) * 4;
					data[offset] = 0;
					data[offset + 1] = 0;
					data[offset + 2] = 0;
				}
			}
		}
	}

	return { data, width, height: width };
}
