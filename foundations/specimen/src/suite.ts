import { relative, resolve } from 'node:path';
import {
	DEFAULT_PATTERN_LIBRARY,
	matchesPatternRef,
	type SynthesizedGateCase,
} from './pattern-gates.js';
import type {
	GateOutcome,
	MatrixAxes,
	Observation,
	SpecimenContext,
	SpecimenEntry,
	StoryOutcome,
	SuiteFilter,
	SuiteRun,
	SuiteStory,
} from './types.js';

/**
 * A suite of retained stories and/or synthesized gate cases: selection, the worker pool and the
 * once-only retry. The rules follow the final-validation protocol a consumer already holds its
 * flake records under: at most `flakeCap` failures may be retried, once, one at a time, and the
 * run passes with a flake only when every one of them passes on that retry.
 */

export interface SuiteOptions {
	workers: number;
	retry: boolean;
	flakeCap: number;
}

export const DEFAULT_SUITE_WORKERS = 2;
export const DEFAULT_FLAKE_CAP = 2;

export type StoryEntry = SpecimenEntry & { story: NonNullable<SpecimenEntry['story']> };
export type SuiteTarget = StoryEntry | SynthesizedGateCase;

export interface StoryAttempt {
	outcome: StoryOutcome | GateOutcome;
	observation: Observation | null;
}

export function isSynthesizedGateCase(item: SuiteTarget): item is SynthesizedGateCase {
	return 'gate' in item && 'setupEntry' in item;
}

/**
 * A story's key in a consumer's flake records. Its form and its `storybook` runner name are the
 * incumbent's, `storybook:<file>::<titles>`, so that records stay valid through a migration.
 */
export function flakeId(file: string, titles: readonly string[]): string {
	return `storybook:${file}::${titles.join(' › ')}`;
}

/** More cells than this is rarely meant, and each is a browser context. */
export const MAX_MATRIX_CELLS = 64;

/** Every combination of the axes' values, in axis order; the first value of each comes first. */
export function matrixCells(axes: MatrixAxes): Partial<SpecimenContext>[] {
	let cells: Partial<SpecimenContext>[] = [{}];
	for (const [axis, values] of Object.entries(axes))
		cells = cells.flatMap((cell) =>
			(values as unknown[]).map((value) => ({ ...cell, [axis]: value }))
		);
	if (cells.length > MAX_MATRIX_CELLS)
		throw new Error(
			`The axes make ${cells.length} cells; ${MAX_MATRIX_CELLS} is the most a matrix runs. Narrow an axis.`
		);
	return cells;
}

function entrySuiteKind(entry: SpecimenEntry): 'story' | 'native' | 'gate' {
	if (entry.kind === 'gate') return 'gate';
	if (entry.story !== undefined) return 'story';
	return 'native';
}

function entryMatchesPattern(
	entry: SpecimenEntry,
	wantedPattern: string,
	localLibrary?: string
): boolean {
	if (entry.pattern) {
		return matchesPatternRef(entry.pattern.library, entry.pattern.pattern, wantedPattern);
	}
	if (entry.patternSetup) {
		return matchesPatternRef(
			entry.patternSetup.library ?? localLibrary ?? DEFAULT_PATTERN_LIBRARY,
			entry.patternSetup.pattern,
			wantedPattern
		);
	}
	return false;
}

/** The entries a filter selects, in discovery order. A native specimen has no tags to match. */
export function selectEntries(
	entries: readonly SpecimenEntry[],
	filter: SuiteFilter | undefined,
	root: string,
	localLibrary?: string
): SpecimenEntry[] {
	const ids = filter?.ids && new Set(filter.ids);
	const file = filter?.file && resolve(root, filter.file);
	const kinds = filter?.kind && new Set(filter.kind);
	return entries.filter(
		(entry) =>
			(!ids || ids.has(entry.id)) &&
			(!file || resolve(root, entry.module) === file) &&
			(!filter?.tags || filter.tags.some((tag) => entry.story?.tags.includes(tag))) &&
			(!kinds || kinds.has(entrySuiteKind(entry))) &&
			(!filter?.pattern || entryMatchesPattern(entry, filter.pattern, localLibrary)) &&
			(!filter?.match ||
				`${entry.id} ${entry.title} ${entry.story?.name ?? entry.exportName}`
					.toLowerCase()
					.includes(filter.match.toLowerCase()))
	);
}

/** The retained stories a filter selects. No filter selects them all. */
export function selectStories(
	entries: readonly SpecimenEntry[],
	filter: SuiteFilter | undefined,
	root: string,
	localLibrary?: string
): StoryEntry[] {
	return selectEntries(entries, filter, root, localLibrary).filter(
		(entry): entry is StoryEntry => entry.story !== undefined
	);
}

/** Select retained stories and/or synthesized gate cases for `specimen-run` suite mode. */
export function selectSuiteCases(
	entries: readonly SpecimenEntry[],
	gateCases: readonly SynthesizedGateCase[],
	filter: SuiteFilter | undefined,
	root: string,
	localLibrary?: string
): SuiteTarget[] {
	const gateById = new Map(gateCases.map((gateCase) => [gateCase.id, gateCase]));
	const includeStories =
		filter?.kind !== undefined ? filter.kind.includes('story') : filter?.pattern === undefined;
	const includeGates =
		filter?.kind !== undefined ? filter.kind.includes('gate') : gateCases.length > 0;

	const results: SuiteTarget[] = [];
	if (includeStories) {
		const storyFilter = filter?.kind
			? { ...filter, kind: ['story'] as ('story' | 'native' | 'gate')[] }
			: filter;
		for (const story of selectStories(entries, storyFilter, root, localLibrary)) {
			results.push(story);
		}
	}
	if (includeGates && gateCases.length > 0) {
		const gateEntries = gateCases.map((gateCase) => gateCase.entry);
		const gateFilter = filter?.kind
			? { ...filter, kind: ['gate'] as ('story' | 'native' | 'gate')[] }
			: filter;
		for (const matched of selectEntries(gateEntries, gateFilter, root, localLibrary)) {
			const gateCase = gateById.get(matched.id);
			if (gateCase) results.push(gateCase);
		}
	}
	return results;
}

function storyRecord(root: string, item: SuiteTarget, attempts: StoryAttempt[]): SuiteStory {
	const last = attempts.at(-1) as StoryAttempt;
	const retriedAway = attempts.length > 1 && last.outcome.status === 'passed';
	if (isSynthesizedGateCase(item)) {
		return {
			id: item.id,
			file: item.file,
			title: item.title,
			name: item.id,
			flakeId: item.id,
			status: retriedAway ? 'flaky' : last.outcome.status,
			attempts: attempts.map((attempt) => attempt.outcome),
			observation: last.observation,
		};
	}
	const file = relative(root, resolve(root, item.module)).replaceAll('\\', '/');
	return {
		id: item.id,
		file,
		title: item.title,
		name: item.story.name,
		flakeId: flakeId(file, [item.story.name]),
		status: retriedAway ? 'flaky' : last.outcome.status,
		attempts: attempts.map((attempt) => attempt.outcome),
		observation: last.observation,
	};
}

/** Run `run` over `items`, at most `workers` at a time, with results in the items' order. */
export async function pool<T, R>(
	items: readonly T[],
	workers: number,
	run: (item: T) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await run(items[index] as T);
		}
	};
	await Promise.all(Array.from({ length: Math.min(workers, items.length) }, worker));
	return results;
}

export async function executeSuite<T extends SuiteTarget>(
	root: string,
	stories: readonly T[],
	run: (entry: T) => Promise<StoryAttempt>,
	options: SuiteOptions
): Promise<Pick<SuiteRun, 'outcome' | 'counts' | 'retry' | 'stories'>> {
	const first = await pool(stories, options.workers, run);
	const attempts = first.map((attempt) => [attempt]);
	const failed = stories.flatMap((entry, index) =>
		first[index]?.outcome.status === 'failed' ? [{ entry, index }] : []
	);
	let retry: SuiteRun['retry'] = { ran: false, reason: 'no story failed' };
	if (failed.length && !options.retry) retry = { ran: false, reason: 'retry was not requested' };
	else if (failed.length > options.flakeCap)
		retry = {
			ran: false,
			reason: `${failed.length} stories failed; more than ${options.flakeCap} cannot pass as flakes`,
		};
	else if (failed.length) {
		retry = { ran: true };
		// One at a time, so a story that only fails under load has no neighbours in its retry.
		for (const { entry, index } of failed) attempts[index]?.push(await run(entry));
	}
	const records = stories.map((entry, index) =>
		storyRecord(root, entry, attempts[index] as StoryAttempt[])
	);
	const count = (status: SuiteStory['status']) =>
		records.filter((record) => record.status === status).length;
	const stillFailing = count('failed');
	return {
		outcome: stillFailing
			? retry.ran
				? 'failed-after-retry'
				: 'failed'
			: count('flaky')
				? 'passed-with-flake'
				: 'passed',
		counts: {
			total: records.length,
			passed: count('passed'),
			failed: stillFailing,
			flaky: count('flaky'),
			skipped: count('skipped'),
			excluded: count('excluded'),
			outOfContext: count('out-of-context'),
		},
		retry,
		stories: records,
	};
}
