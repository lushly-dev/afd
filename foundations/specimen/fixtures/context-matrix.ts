import type { SpecimenContext } from '../src/types.js';

/** What a specimen can read about its browsing context, from inside its own document. */
export interface ContextReport {
	innerWidth: number;
	innerHeight: number;
	/** `(max-width: 600px)`, the breakpoint the native fixtures use. */
	narrow: boolean;
	/** Rendered widths of `100vw` and `100vh` boxes, in CSS pixels. */
	vw: number;
	vh: number;
	rem: number;
	/** `100cqw` inside an inline-size container filling the specimen root. */
	container: number;
	/** `@container (max-width: 400px)`. */
	containerNarrow: boolean;
	colorScheme: string;
	theme: string | null;
	prefersDark: boolean;
	prefersReducedMotion: boolean;
	lang: string;
	language: string;
	intlLocale: string;
	devicePixelRatio: number;
}

/** The instant FixedClock installs for its own lifetime. */
export const FIXED_NOW = Date.UTC(2026, 9, 31, 12);

export interface MatrixCase {
	name: string;
	context: SpecimenContext;
}

const base = { motion: 'natural' } as const;

/**
 * Three contexts which differ on every axis a driver must apply. `incumbent` is the 1200x900
 * viewport the Storybook Vitest addon gives a story whose viewport is `responsive`.
 */
export const contextMatrix: MatrixCase[] = [
	{
		name: 'phone',
		context: {
			...base,
			viewport: { width: 375, height: 667 },
			container: { width: 320 },
			theme: 'dark',
			locale: 'fr-FR',
			reducedMotion: 'reduce',
		},
	},
	{
		name: 'desktop',
		context: {
			...base,
			viewport: { width: 1280, height: 720 },
			theme: 'light',
			locale: 'en-US',
			reducedMotion: 'no-preference',
		},
	},
	{
		name: 'incumbent',
		context: {
			...base,
			viewport: { width: 1200, height: 900 },
			container: { width: 480 },
			theme: 'dark',
			locale: 'en-US',
			reducedMotion: 'no-preference',
		},
	},
];

/** Fields whose value follows the browser's own emulation rather than the specimen document. */
export const emulatedFields = [
	'prefersDark',
	'prefersReducedMotion',
	'language',
	'intlLocale',
] as const;

/**
 * The report a driver must produce for `context`. Without a container the probe fills the
 * body, whose default 8px margins the bench page keeps.
 */
export function expectedReport(context: SpecimenContext): ContextReport {
	const container = context.container?.width ?? context.viewport.width - 16;
	return {
		innerWidth: context.viewport.width,
		innerHeight: context.viewport.height,
		narrow: context.viewport.width <= 600,
		vw: context.viewport.width,
		vh: context.viewport.height,
		rem: 16,
		container,
		containerNarrow: container <= 400,
		colorScheme: context.theme,
		theme: context.theme,
		prefersDark: context.theme === 'dark',
		prefersReducedMotion: context.reducedMotion === 'reduce',
		lang: context.locale,
		language: context.locale,
		intlLocale: context.locale,
		devicePixelRatio: 1,
	};
}

/** URL parameters the static index reads for `context`. */
export function contextParameters(context: SpecimenContext): URLSearchParams {
	const params = new URLSearchParams({
		viewport: `${context.viewport.width}x${context.viewport.height}`,
		theme: context.theme,
		locale: context.locale,
		reducedMotion: context.reducedMotion,
		motion: context.motion,
	});
	if (context.container)
		params.set(
			'container',
			context.container.height === undefined
				? String(context.container.width)
				: `${context.container.width}x${context.container.height}`
		);
	return params;
}
