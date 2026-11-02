/**
 * WCAG 2 contrast for the theme's color values: `#rgb`, `#rrggbb`, `#rrggbbaa` and `rgb()` or
 * `rgba()` with comma-separated channels, the forms the tree uses.
 */

export type Rgba = readonly [number, number, number, number];

export function parseColor(value: string): Rgba {
	const text = value.trim().toLowerCase();
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
	if (hex?.[1]) {
		const digits =
			hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : (hex[1] as string);
		const channel = (index: number) => Number.parseInt(digits.slice(index, index + 2), 16);
		return [channel(0), channel(2), channel(4), digits.length === 8 ? channel(6) / 255 : 1];
	}
	const rgb = /^rgba?\(([^)]*)\)$/.exec(text);
	if (rgb?.[1]) {
		const parts = rgb[1].split(',').map((part) => Number(part.trim()));
		if ((parts.length === 3 || parts.length === 4) && parts.every(Number.isFinite)) {
			const [r = 0, g = 0, b = 0, a = 1] = parts;
			return [r, g, b, a];
		}
	}
	throw new Error(`Not a color the contrast check reads: '${value}'`);
}

/** `top` drawn over an opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
	const alpha = top[3];
	const mix = (index: 0 | 1 | 2) => top[index] * alpha + bottom[index] * (1 - alpha);
	return [mix(0), mix(1), mix(2), 1];
}

function luminance([r, g, b]: Rgba): number {
	const linear = (channel: number) => {
		const value = channel / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * The contrast of `foreground` on `background`. A translucent background is first drawn over
 * `backdrop` (the page), and a translucent foreground over the result.
 */
export function contrastRatio(foreground: string, background: string, backdrop: string): number {
	const base = parseColor(backdrop);
	if (base[3] !== 1) throw new Error(`The backdrop must be opaque: '${backdrop}'`);
	const back = composite(parseColor(background), base);
	const front = composite(parseColor(foreground), back);
	const [lighter, darker] = [luminance(front), luminance(back)].sort((a, b) => b - a) as [
		number,
		number,
	];
	return (lighter + 0.05) / (darker + 0.05);
}
