import { relative, resolve } from 'node:path';
import type {
	Observation,
	SpecimenEntry,
	StoryOutcome,
	SuiteFilter,
	SuiteRun,
	SuiteStory,
} from './types.js';

/**
 * A suite of retained stories: selection, the worker pool and the once-only retry. The rules
 * follow the final-validation protocol a consumer already holds its flake records under: at most
 * `flakeCap` failures may be retried, once, one at a time, and the run passes with a flake only
 * when every one of them passes on that retry.
 */

export interface SuiteOptions {
	workers: number;
	retry: boolean;
	flakeCap: number;
}

export const DEFAULT_SUITE_WORKERS = 2;
export const DEFAULT_FLAKE_CAP = 2;

export type StoryEntry = SpecimenEntry & { story: NonNullable<SpecimenEntry['story']> };

export interface StoryAttempt {
	outcome: StoryOutcome;
	observation: Observation | null;
}

/**
 * A story's key in a consumer's flake records. Its form and its `storybook` runner name are the
 * incumbent's, `storybook:<file>::<titles>`, so that records stay valid through a migration.
 */
export function flakeId(file: string, titles: readonly string[]): string {
	return `storybook:${file}::${titles.join(' › ')}`;
}

/** The entries a filter selects, in discovery order. A native specimen has no tags to match. */
export function selectEntries(
	entries: readonly SpecimenEntry[],
	filter: SuiteFilter | undefined,
	root: string
): SpecimenEntry[] {
	const ids = filter?.ids && new Set(filter.ids);
	const file = filter?.file && resolve(root, filter.file);
	return entries.filter(
		(entry) =>
			(!ids || ids.has(entry.id)) &&
			(!file || resolve(root, entry.module) === file) &&
			(!filter?.tags || filter.tags.some((tag) => entry.story?.tags.includes(tag))) &&
			(!filter?.match ||
				`${entry.title} ${entry.story?.name ?? entry.exportName}`
					.toLowerCase()
					.includes(filter.match.toLowerCase()))
	);
}

/** The retained stories a filter selects. No filter selects them all. */
export function selectStories(
	entries: readonly SpecimenEntry[],
	filter: SuiteFilter | undefined,
	root: string
): StoryEntry[] {
	return selectEntries(entries, filter, root).filter(
		(entry): entry is StoryEntry => entry.story !== undefined
	);
}

function storyRecord(root: string, entry: StoryEntry, attempts: StoryAttempt[]): SuiteStory {
	const file = relative(root, resolve(root, entry.module)).replaceAll('\\', '/');
	const last = attempts.at(-1) as StoryAttempt;
	const retriedAway = attempts.length > 1 && last.outcome.status === 'passed';
	return {
		id: entry.id,
		file,
		title: entry.title,
		name: entry.story.name,
		flakeId: flakeId(file, [entry.story.name]),
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

export async function executeSuite(
	root: string,
	stories: readonly StoryEntry[],
	run: (entry: StoryEntry) => Promise<StoryAttempt>,
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
		},
		retry,
		stories: records,
	};
}
