import { inflateSync } from 'node:zlib';

/**
 * Just enough PNG to compare two screenshots: 8-bit greyscale, RGB, palette and their alpha
 * forms, not interlaced, which is what Chromium writes. Anything else throws, and a comparison
 * that cannot decode reports why instead of guessing.
 */
export interface Pixels {
	width: number;
	height: number;
	/** RGBA, four bytes a pixel, row by row. */
	data: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Bytes a pixel for each colour type at 8 bits. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function decodePng(bytes: Uint8Array): Pixels {
	if (bytes.length < 8 || SIGNATURE.some((byte, index) => bytes[index] !== byte))
		throw new Error('Not a PNG file');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let width = 0;
	let height = 0;
	let type = -1;
	let palette: Uint8Array | undefined;
	let transparency: Uint8Array | undefined;
	const compressed: Uint8Array[] = [];
	for (let offset = 8; offset + 8 <= bytes.length; ) {
		const length = view.getUint32(offset);
		const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		const body = bytes.subarray(offset + 8, offset + 8 + length);
		if (kind === 'IHDR') {
			width = view.getUint32(offset + 8);
			height = view.getUint32(offset + 12);
			const depth = body[8];
			type = body[9] ?? -1;
			if (depth !== 8 || !(type in CHANNELS) || body[12] !== 0)
				throw new Error(
					`Unsupported PNG: bit depth ${depth}, colour type ${type}, interlace ${body[12]}`
				);
		} else if (kind === 'PLTE') palette = body;
		else if (kind === 'tRNS') transparency = body;
		else if (kind === 'IDAT') compressed.push(body);
		else if (kind === 'IEND') break;
		offset += 12 + length;
	}
	if (!width || !height || type < 0) throw new Error('PNG has no image header');
	const channels = CHANNELS[type] as number;
	const stride = width * channels;
	const raw = inflateSync(Buffer.concat(compressed));
	if (raw.length < (stride + 1) * height) throw new Error('PNG image data is truncated');
	const rows = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const source = y * (stride + 1) + 1;
		const target = y * stride;
		for (let x = 0; x < stride; x++) {
			const left = x >= channels ? (rows[target + x - channels] as number) : 0;
			const up = y > 0 ? (rows[target - stride + x] as number) : 0;
			const corner = y > 0 && x >= channels ? (rows[target - stride + x - channels] as number) : 0;
			const value = raw[source + x] as number;
			let predicted = 0;
			if (filter === 1) predicted = left;
			else if (filter === 2) predicted = up;
			else if (filter === 3) predicted = (left + up) >> 1;
			else if (filter === 4) {
				const estimate = left + up - corner;
				const [a, b, c] = [
					Math.abs(estimate - left),
					Math.abs(estimate - up),
					Math.abs(estimate - corner),
				];
				predicted = a <= b && a <= c ? left : b <= c ? up : corner;
			} else if (filter !== 0) throw new Error(`PNG row ${y} has unknown filter ${filter}`);
			rows[target + x] = (value + predicted) & 0xff;
		}
	}
	const data = new Uint8Array(width * height * 4);
	for (let pixel = 0; pixel < width * height; pixel++) {
		const at = pixel * channels;
		const out = pixel * 4;
		const first = rows[at] as number;
		if (type === 0 || type === 4) {
			data.set([first, first, first, type === 4 ? (rows[at + 1] as number) : 255], out);
		} else if (type === 3) {
			if (!palette || first * 3 + 2 >= palette.length)
				throw new Error('PNG palette index out of range');
			data.set(palette.subarray(first * 3, first * 3 + 3), out);
			data[out + 3] = transparency?.[first] ?? 255;
		} else {
			data.set(rows.subarray(at, at + 3), out);
			data[out + 3] = type === 6 ? (rows[at + 3] as number) : 255;
		}
	}
	return { width, height, data };
}

/** The share of pixels, 0 to 1, that differ at all between two frames; 1 when their sizes differ. */
export function changedShare(left: Pixels, right: Pixels): number {
	if (left.width !== right.width || left.height !== right.height) return 1;
	const total = left.width * left.height;
	let changed = 0;
	for (let at = 0; at < left.data.length; at += 4)
		if (
			left.data[at] !== right.data[at] ||
			left.data[at + 1] !== right.data[at + 1] ||
			left.data[at + 2] !== right.data[at + 2] ||
			left.data[at + 3] !== right.data[at + 3]
		)
			changed++;
	return total ? changed / total : 0;
}
