import type {
	MetricSummary,
	ProfileBaseline,
	ProfileBaselines,
	ProfileComparison,
	ProfileFinding,
	ProfileFlag,
	ProfileSample,
	ProfileSummary,
} from './types.js';

/**
 * The rules of `specimen-profile`, as FAST-AF's profiler applies them: medians over a few runs,
 * flags with fixed thresholds, and a comparison with per-metric tolerances and optional absolute
 * budgets. The page differs from Storybook's, so a baseline from another page is not comparable.
 */

export const DEFAULT_PROFILE_RUNS = 3;
export const DEFAULT_BASELINE_RUNS = 5;
export const BASELINE_RUNNER = 'specimen';

function summarize(values: readonly number[]): MetricSummary | null {
	if (!values.length) return null;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	const median =
		sorted.length % 2
			? (sorted[middle] as number)
			: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
	const round = (value: number) => Math.round(value * 100) / 100;
	return {
		min: round(sorted[0] as number),
		median: round(median),
		max: round(sorted.at(-1) as number),
	};
}

export function summarizeProfile(samples: readonly ProfileSample[]): ProfileSummary {
	const metric = (pick: (sample: ProfileSample) => number | null) =>
		summarize(samples.map(pick).filter((value): value is number => value !== null));
	const total = (pick: (sample: ProfileSample) => number) =>
		samples.reduce((sum, sample) => sum + pick(sample), 0);
	return {
		paints: { firstContentfulPaintMs: metric((sample) => sample.firstContentfulPaintMs) },
		timings: {
			domContentLoadedMs: metric((sample) => sample.domContentLoadedMs),
			loadMs: metric((sample) => sample.loadMs),
			readyMs: metric((sample) => sample.readyMs),
			captureMs: metric((sample) => sample.captureMs),
		},
		dom: {
			totalElements: metric((sample) => sample.totalElements),
			customElements: metric((sample) => sample.customElements),
			shadowHosts: metric((sample) => sample.shadowHosts),
		},
		resources: {
			requestCount: metric((sample) => sample.requestCount),
			transferSizeBytes: metric((sample) => sample.transferSizeBytes),
		},
		memory: { usedJSHeapSizeBytes: metric((sample) => sample.usedJSHeapSizeBytes) },
		console: {
			errorCount: total((sample) => sample.consoleErrors),
			warningCount: total((sample) => sample.consoleWarnings),
		},
	};
}

export function profileFlags(summary: ProfileSummary): ProfileFlag[] {
	const flags: ProfileFlag[] = [];
	const paint = summary.paints.firstContentfulPaintMs?.median;
	if (paint !== undefined && paint > 1600)
		flags.push({
			code: 'SLOW_FIRST_CONTENTFUL_PAINT',
			severity: paint <= 2500 ? 'warning' : 'high',
			message: `Median first contentful paint is ${paint} ms.`,
		});
	const elements = summary.dom.totalElements?.median;
	if (elements !== undefined && elements > 450)
		flags.push({
			code: 'HIGH_DOM_NODE_COUNT',
			severity: elements <= 700 ? 'warning' : 'high',
			message: `Median element count is ${elements}.`,
		});
	const hosts = summary.dom.shadowHosts?.median;
	if (hosts !== undefined && hosts > 35)
		flags.push({
			code: 'HIGH_SHADOW_HOST_COUNT',
			severity: 'warning',
			message: `Median shadow host count is ${hosts}.`,
		});
	if (summary.console.errorCount > 0)
		flags.push({
			code: 'CONSOLE_ERRORS_PRESENT',
			severity: 'high',
			message: 'Console errors were captured during profiling.',
		});
	else if (summary.console.warningCount > 0)
		flags.push({
			code: 'CONSOLE_WARNINGS_PRESENT',
			severity: 'warning',
			message: 'Console warnings were captured during profiling.',
		});
	return flags;
}

type BudgetName = keyof ProfileBaseline['budgets'];

const COMPARED: readonly {
	metric: Exclude<BudgetName, 'consoleErrorCount' | 'consoleWarningCount'>;
	code: string;
	tolerance: number;
	pick: (summary: BaselineSummary) => MetricSummary | null | undefined;
}[] = [
	{
		metric: 'firstContentfulPaintMs',
		code: 'FCP',
		tolerance: 1.2,
		pick: (summary) => summary.paints?.firstContentfulPaintMs,
	},
	{
		metric: 'totalElements',
		code: 'DOM',
		tolerance: 1.15,
		pick: (summary) => summary.dom?.totalElements,
	},
	{
		metric: 'requestCount',
		code: 'REQUESTS',
		tolerance: 1.1,
		pick: (summary) => summary.resources?.requestCount,
	},
	{
		metric: 'transferSizeBytes',
		code: 'TRANSFER',
		tolerance: 1.15,
		pick: (summary) => summary.resources?.transferSizeBytes,
	},
	{
		metric: 'usedJSHeapSizeBytes',
		code: 'HEAP',
		tolerance: 1.2,
		pick: (summary) => summary.memory?.usedJSHeapSizeBytes,
	},
];

/** A baseline's summary: a record from another tool may lack what this one measures. */
type BaselineSummary = {
	[Section in keyof ProfileSummary]?: Partial<ProfileSummary[Section]>;
};

/** Why a baseline does not describe this measurement, or `null` when it does. */
function incomparable(
	baseline: ProfileBaseline,
	current: { viewport: string; checkpoint: string; browser: string }
): string | null {
	if (baseline.runner !== BASELINE_RUNNER)
		return `The baseline was recorded from ${baseline.baseUrl ?? 'another page'}, not Specimen's page, on ${baseline.capturedAt}. Their metrics differ; record a new baseline.`;
	if (baseline.viewport !== current.viewport)
		return `The baseline is at ${baseline.viewport} and this run at ${current.viewport}.`;
	if (baseline.checkpoint !== current.checkpoint)
		return `The baseline is at the ${baseline.checkpoint} checkpoint and this run at ${current.checkpoint}.`;
	if (baseline.browser !== current.browser)
		return `The baseline was recorded on Chromium ${baseline.browser} and this run on ${current.browser}.`;
	return null;
}

/**
 * Compare a profile with its baseline. A budget is absolute, so it always applies. Tolerances and
 * console counts compare with the baseline, so they apply only when it describes this measurement.
 */
export function compareProfile(
	baseline: ProfileBaseline,
	summary: ProfileSummary,
	current: { viewport: string; checkpoint: string; browser: string }
): ProfileComparison {
	const errors: ProfileFinding[] = [];
	const warnings: ProfileFinding[] = [];
	const reason = incomparable(baseline, current);
	for (const { metric, code, tolerance, pick } of COMPARED) {
		const value = pick(summary)?.median;
		if (value === undefined) continue;
		const budget = baseline.budgets[metric];
		if (budget !== null && budget !== undefined && value > budget) {
			errors.push({
				code: `PERF_BUDGET_EXCEEDED_${code}`,
				metric,
				current: value,
				allowed: budget,
				message: `${metric} exceeded its budget (${value} > ${budget}).`,
			});
			continue;
		}
		const recorded = pick(baseline.summary)?.median;
		if (reason || recorded === undefined || recorded <= 0) continue;
		const allowed = Math.round(recorded * tolerance * 100) / 100;
		if (value > allowed)
			warnings.push({
				code: `PERF_REGRESSION_${code}`,
				metric,
				current: value,
				allowed,
				message: `${metric} regressed beyond its tolerance (${value} against a baseline of ${recorded}).`,
			});
	}
	const recordedConsole = reason ? undefined : baseline.summary.console;
	const errorBudget = baseline.budgets.consoleErrorCount ?? recordedConsole?.errorCount;
	if (errorBudget !== undefined && summary.console.errorCount > errorBudget)
		errors.push({
			code: 'PERF_CONSOLE_ERRORS_EXCEEDED',
			metric: 'consoleErrorCount',
			current: summary.console.errorCount,
			allowed: errorBudget,
			message: 'Console errors exceeded what the baseline or budget allows.',
		});
	const warningBudget = baseline.budgets.consoleWarningCount ?? recordedConsole?.warningCount;
	if (warningBudget !== undefined && summary.console.warningCount > warningBudget)
		warnings.push({
			code: 'PERF_CONSOLE_WARNINGS_EXCEEDED',
			metric: 'consoleWarningCount',
			current: summary.console.warningCount,
			allowed: warningBudget,
			message: 'Console warnings exceeded what the baseline or budget allows.',
		});
	return {
		status: errors.length
			? 'failed'
			: reason
				? 'not-comparable'
				: warnings.length
					? 'warnings'
					: 'passed',
		...(reason ? { reason } : {}),
		baseline: {
			capturedAt: baseline.capturedAt,
			runs: baseline.runs,
			runner: baseline.runner ?? null,
		},
		errors,
		warnings,
	};
}

/** The text without `//` and block comments outside strings, as a `.jsonc` file may have. */
function stripComments(text: string): string {
	let out = '';
	let index = 0;
	let inString = false;
	while (index < text.length) {
		const character = text[index] as string;
		if (inString) {
			out += character;
			if (character === '\\') {
				out += text[index + 1] ?? '';
				index += 1;
			} else if (character === '"') inString = false;
			index += 1;
			continue;
		}
		if (character === '"') inString = true;
		if (character === '/' && text[index + 1] === '/') {
			const end = text.indexOf('\n', index);
			index = end === -1 ? text.length : end;
			continue;
		}
		if (character === '/' && text[index + 1] === '*') {
			const end = text.indexOf('*/', index + 2);
			index = end === -1 ? text.length : end + 2;
			continue;
		}
		out += character;
		index += 1;
	}
	return out;
}

export function parseBaselines(text: string, path: string): ProfileBaselines {
	let value: unknown;
	try {
		value = JSON.parse(stripComments(text));
	} catch (error) {
		throw new Error(`Baselines in ${path} are not valid JSON: ${String(error)}`);
	}
	const stories = (value as { stories?: unknown } | null)?.stories;
	if (typeof stories !== 'object' || stories === null || Array.isArray(stories))
		throw new Error(`Baselines in ${path} need a "stories" object.`);
	return value as ProfileBaselines;
}

/**
 * The file with this baseline recorded. Budgets carry over, since a person set them, and notes
 * say what the record replaced, so a new baseline stays attributable to the page's cutover. A
 * file with comments is refused rather than losing them.
 */
export function withBaseline(
	text: string | null,
	path: string,
	id: string,
	baseline: Omit<ProfileBaseline, 'budgets' | 'notes'>,
	notes: readonly string[]
): string {
	if (text !== null && stripComments(text) !== text)
		throw new Error(`${path} has comments that writing a baseline would lose; remove them first.`);
	const baselines = text === null ? { version: '0.1.0', stories: {} } : parseBaselines(text, path);
	const previous = baselines.stories[id];
	const replaced =
		previous && previous.runner !== BASELINE_RUNNER
			? [
					`Replaced a baseline recorded from ${previous.baseUrl ?? 'another page'} on ${previous.capturedAt}.`,
				]
			: [];
	baselines.stories[id] = {
		...baseline,
		budgets: previous?.budgets ?? {
			firstContentfulPaintMs: null,
			totalElements: null,
			requestCount: null,
			transferSizeBytes: null,
			usedJSHeapSizeBytes: null,
			consoleErrorCount: null,
			consoleWarningCount: null,
		},
		notes: [...replaced, ...notes],
	};
	return `${JSON.stringify(baselines, null, 2)}\n`;
}
