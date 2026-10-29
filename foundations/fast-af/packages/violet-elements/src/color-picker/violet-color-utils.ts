export interface VioletRgbColor {
    r: number;
    g: number;
    b: number;
}

export interface VioletHslColor {
    h: number;
    s: number;
    l: number;
}

const HEX_PATTERN = /^#?([\da-f]{3}|[\da-f]{6})$/i;

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function normalizeHexColor(value: string): string | null {
    const trimmed = value.trim();
    const match = HEX_PATTERN.exec(trimmed);

    if (!match) {
        return null;
    }

    const digits = match[1].toLowerCase();

    if (digits.length === 3) {
        return `#${digits
            .split("")
            .map(part => `${part}${part}`)
            .join("")}`;
    }

    return `#${digits}`;
}

export function rgbToHex(color: VioletRgbColor): string {
    return `#${[color.r, color.g, color.b]
        .map(channel => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0"))
        .join("")}`;
}

export function hexToRgb(value: string): VioletRgbColor | null {
    const normalized = normalizeHexColor(value);

    if (!normalized) {
        return null;
    }

    return {
        r: Number.parseInt(normalized.slice(1, 3), 16),
        g: Number.parseInt(normalized.slice(3, 5), 16),
        b: Number.parseInt(normalized.slice(5, 7), 16),
    };
}

export function rgbToHsl(color: VioletRgbColor): VioletHslColor {
    const r = clamp(color.r, 0, 255) / 255;
    const g = clamp(color.g, 0, 255) / 255;
    const b = clamp(color.b, 0, 255) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let hue = 0;
    const lightness = (max + min) / 2;

    if (delta > 0) {
        switch (max) {
            case r:
                hue = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
                break;
            case g:
                hue = ((b - r) / delta + 2) * 60;
                break;
            default:
                hue = ((r - g) / delta + 4) * 60;
                break;
        }
    }

    const saturation =
        delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

    return {
        h: Math.round(((hue % 360) + 360) % 360),
        s: Math.round(saturation * 100),
        l: Math.round(lightness * 100),
    };
}

function hueToRgb(p: number, q: number, t: number): number {
    let normalized = t;

    if (normalized < 0) {
        normalized += 1;
    }

    if (normalized > 1) {
        normalized -= 1;
    }

    if (normalized < 1 / 6) {
        return p + (q - p) * 6 * normalized;
    }

    if (normalized < 1 / 2) {
        return q;
    }

    if (normalized < 2 / 3) {
        return p + (q - p) * (2 / 3 - normalized) * 6;
    }

    return p;
}

export function hslToRgb(color: VioletHslColor): VioletRgbColor {
    const hue = (((color.h % 360) + 360) % 360) / 360;
    const saturation = clamp(color.s, 0, 100) / 100;
    const lightness = clamp(color.l, 0, 100) / 100;

    if (saturation === 0) {
        const channel = Math.round(lightness * 255);
        return { r: channel, g: channel, b: channel };
    }

    const q =
        lightness < 0.5
            ? lightness * (1 + saturation)
            : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;

    return {
        r: Math.round(hueToRgb(p, q, hue + 1 / 3) * 255),
        g: Math.round(hueToRgb(p, q, hue) * 255),
        b: Math.round(hueToRgb(p, q, hue - 1 / 3) * 255),
    };
}

export function hexToHsl(value: string): VioletHslColor | null {
    const rgb = hexToRgb(value);
    return rgb ? rgbToHsl(rgb) : null;
}

export function hslToHex(color: VioletHslColor): string {
    return rgbToHex(hslToRgb(color));
}

export function hueColor(value: number): string {
    return hslToHex({ h: value, s: 100, l: 50 });
}

export function saturationGradient(hue: number, lightness: number): string {
    return `linear-gradient(90deg, ${hslToHex({ h: hue, s: 0, l: lightness })} 0%, ${hslToHex({
        h: hue,
        s: 100,
        l: lightness,
    })} 100%)`;
}

export function lightnessGradient(hue: number, saturation: number): string {
    return `linear-gradient(90deg, ${hslToHex({ h: hue, s: saturation, l: 0 })} 0%, ${hslToHex({
        h: hue,
        s: saturation,
        l: 50,
    })} 50%, ${hslToHex({ h: hue, s: saturation, l: 100 })} 100%)`;
}

