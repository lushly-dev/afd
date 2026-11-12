import type { SpecimenEntry, SpecimenTheme, ThemeReport, ThemeStatus, ThemesRun } from './types.js';

/**
 * At or under this share of pixels changed, two frames count as the same. Lushly's audit of 916
 * stories set it: the light-only pages changed 0%, and stories that follow the theme 10% or more.
 */
export const DEFAULT_THEME_THRESHOLD = 0.02;
/** What every theme's render shares unless the request says otherwise: no motion between them. */
export const DEFAULT_THEME_CONTEXT = { reducedMotion: 'reduce' } as const;

/** One theme's render: what it rendered in, or why it could not. */
export interface ThemeFrame {
	theme: SpecimenTheme;
	rendered: SpecimenTheme | null;
	reason?: string;
}

/**
 * Classify one entry from its frames. `distance(a, b)` is the share of pixels that differ between
 * two frames that rendered, by index; it is called only for pairs the verdict needs.
 */
export function themeReport(
	entry: SpecimenEntry,
	frames: readonly ThemeFrame[],
	distance: (a: number, b: number) => number,
	threshold: number
): ThemeReport {
	const declared = entry.themes ?? null;
	const base = {
		id: entry.id,
		title: entry.title,
		...(entry.component === undefined ? {} : { component: entry.component }),
		declared,
	};
	const failed = frames.find((frame) => frame.reason !== undefined);
	if (failed)
		return {
			...base,
			status: 'unavailable',
			frames: frames.map((frame, index) => ({
				theme: frame.theme,
				rendered: frame.rendered,
				changed: null,
				...(frame.reason === undefined
					? index === 0
						? {}
						: { reason: 'not compared: another theme did not render' }
					: { reason: frame.reason }),
			})),
			reason: `${failed.theme}: ${failed.reason}`,
		};
	const changed = frames.map((_, index) => (index === 0 ? 0 : distance(0, index)));
	const same = changed.every((share) => share <= threshold);
	// A declaration that names every compared theme sets no limit.
	const unsupported = declared
		? frames.flatMap((frame, index) => (declared.supported.includes(frame.theme) ? [] : [index]))
		: [];
	const supported = frames.flatMap((_, index) => (unsupported.includes(index) ? [] : [index]));
	let status: ThemeStatus;
	if (unsupported.length) {
		// Under a theme it does not support, it should look as it does under one it does; with
		// none of those compared, an unchanged frame is the only evidence.
		const between = (a: number, b: number) =>
			a === 0 ? (changed[b] as number) : b === 0 ? (changed[a] as number) : distance(a, b);
		const holds = unsupported.every((index) =>
			supported.length ? supported.some((other) => between(other, index) <= threshold) : same
		);
		status = holds ? 'declared' : 'contradicted';
	} else if (same) {
		// A declaration of every compared theme says it supports them all, such as an image that
		// looks the same in each: the author said so, so it is not undeclared.
		const rendered = new Set(frames.map((frame) => frame.rendered));
		status = declared
			? 'declared'
			: rendered.size === 1 &&
					!rendered.has(null) &&
					frames.some((frame) => frame.rendered !== frame.theme)
				? 'pinned'
				: 'undeclared';
	} else status = 'follows';
	return {
		...base,
		status,
		frames: frames.map((frame, index) => ({
			theme: frame.theme,
			rendered: frame.rendered,
			changed: changed[index] as number,
		})),
	};
}

/** The run's totals; it is valid when no entry is `undeclared`. */
export function themesSummary(
	reports: ThemeReport[]
): Pick<ThemesRun, 'valid' | 'counts' | 'reports'> {
	const count = (status: ThemeStatus) =>
		reports.filter((report) => report.status === status).length;
	return {
		valid: count('undeclared') === 0,
		reports,
		counts: {
			total: reports.length,
			follows: count('follows'),
			declared: count('declared'),
			pinned: count('pinned'),
			undeclared: count('undeclared'),
			contradicted: count('contradicted'),
			unavailable: count('unavailable'),
		},
	};
}
