/**
 * @fileoverview The resize handle's arithmetic (section 7): steps, clamping and the presets a
 * click steps through, the single-pointer alternative to dragging (WCAG 2.5.7).
 */

/** Arrow-key step, in CSS pixels. */
export const HANDLE_STEP = 16;
/** How far a pointer moves before a press becomes a drag, in CSS pixels. */
export const DRAG_THRESHOLD = 3;

/** Which way the part grows: `start` and `end` are inline directions, `up` is block-start. */
export type HandleGrowth = 'end' | 'start' | 'up';

export interface ResizeDetail {
	value: number;
}

export function clampSize(value: number, min: number, max: number): number {
	return Math.round(Math.min(max, Math.max(min, value)));
}

/** The next of the minimum, default and maximum sizes after `value`, cycling. */
export function nextPreset(value: number, min: number, preset: number, max: number): number {
	const presets = [...new Set([min, preset, max])].sort((a, b) => a - b);
	return presets.find((size) => size > value) ?? (presets[0] as number);
}
