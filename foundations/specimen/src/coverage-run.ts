import { performance } from 'node:perf_hooks';
import type { LoadedConfig } from './config.js';
import {
	COVERAGE_OBLIGATIONS,
	type CoverageCase,
	computeCoverage,
	GUIDE_PREFIX,
	observedProperties,
} from './coverage.js';
import { computeGuideCoverage } from './guide-coverage.js';
import type { ComponentSchema } from './plugin.js';
import { DEFAULT_SUITE_WORKERS, pool, selectEntries } from './suite.js';
import type {
	CoverageRequest,
	CoverageRun,
	Observation,
	SpecimenEntry,
	StoryOutcome,
} from './types.js';

type Observed = SpecimenEntry['observe'];

/** What a coverage run needs of the bench that runs it. */
export interface CoverageHost {
	config: LoadedConfig;
	prepare(): Promise<void>;
	inspect(id: string): Promise<ComponentSchema | null>;
	runStory(
		id: string,
		timeoutMs: number | undefined,
		observe: Observed
	): Promise<{ outcome: StoryOutcome; observation: Observation | null }>;
	render(
		id: string,
		checkpoint: string,
		timeoutMs: number | undefined,
		observe: Observed
	): Promise<Observation | null>;
}

/** Run the selected cases, and report each component's required partitions at the level earned. */
export async function runCoverage(
	{ config, prepare, inspect, runStory, render }: CoverageHost,
	request: CoverageRequest
): Promise<CoverageRun> {
	// A plugin may know more than the manifest, but only of a component a case names.
	const named = config.config.plugins?.length
		? new Map(
				config.entries.flatMap((entry) =>
					entry.component ? [[entry.component, entry.id] as const] : []
				)
			)
		: new Map<string, string>();
	const tags = [...new Set([...Object.keys(config.schemas), ...named.keys()])];
	const wanted = request.component ? tags.filter((tag) => tag === request.component) : tags;
	if (request.component && !wanted.length)
		throw new Error(
			`No schema describes ${request.component}. Configure a custom elements manifest that does.`
		);
	const entries = selectEntries(config.entries, request.filter, config.root);
	if (!entries.length) throw new Error('No specimen or retained story matches the filter.');
	const workers = request.workers ?? config.config.test?.workers ?? DEFAULT_SUITE_WORKERS;
	const started = performance.now();
	await prepare();
	const { timeoutMs } = request;
	const schemas = (
		await Promise.all(
			wanted.map(async (tag) => {
				const id = named.get(tag);
				return (id && (await inspect(id))) || config.schemas[tag];
			})
		)
	).filter((schema) => schema !== undefined);
	const observe = observedProperties(schemas);
	const failed: CoverageRun['cases']['failed'] = [];
	let skipped = 0;
	const cases: CoverageCase[] = [];
	/** Captures taken only for a guide claim at an earlier checkpoint. */
	const guideCases: CoverageCase[] = [];
	await pool(entries, workers, async ({ id, story }) => {
		try {
			if (story) {
				const { outcome, observation } = await runStory(id, timeoutMs, observe);
				if (outcome.status === 'failed')
					failed.push({ id, message: outcome.failures[0]?.message ?? 'The story failed.' });
				else if (outcome.status !== 'passed' || !observation) skipped++;
				else cases.push({ id, observation });
				return;
			}
			const observation = await render(id, 'after-run', timeoutMs, observe);
			if (!observation) return;
			cases.push({ id, observation });
			// A claim about an earlier checkpoint needs that checkpoint's own capture. One taken only
			// for a guide claim is evidence for `guides@1` alone, so adding guides never adds a
			// capture to `schema-partitions@1`.
			const earlier = (guide: boolean) =>
				new Set(
					observation.channels.evidence.claims
						.filter((claim) => claim.obligation.startsWith(GUIDE_PREFIX) === guide)
						.map((claim) => claim.checkpoint)
						.filter((checkpoint) => checkpoint !== 'after-run')
				);
			const partitions = earlier(false);
			const guideOnly = [...earlier(true)].filter((checkpoint) => !partitions.has(checkpoint));
			for (const [checkpoints, into] of [
				[partitions, cases],
				[guideOnly, guideCases],
			] as const)
				for (const checkpoint of checkpoints) {
					const capture = await render(id, checkpoint, timeoutMs, observe);
					if (capture) into.push({ id, observation: capture });
				}
		} catch (error) {
			failed.push({ id, message: error instanceof Error ? error.message : String(error) });
		}
	});
	const waivers = config.config.coverage?.waivers;
	const { unusedWaivers, ...report } = computeCoverage(schemas, cases, waivers);
	// Its own set: present when the project has guides or a case claims a statement.
	const claimsGuide = [...cases, ...guideCases].some(({ observation }) =>
		observation.channels.evidence.claims.some((claim) => claim.obligation.startsWith(GUIDE_PREFIX))
	);
	const guides =
		config.guides || claimsGuide
			? computeGuideCoverage(config.guides, schemas, [...cases, ...guideCases], request.component)
			: undefined;
	return {
		obligations: COVERAGE_OBLIGATIONS,
		...report,
		waivers: {
			version: waivers?.version ?? null,
			unused: request.component
				? unusedWaivers.filter((entry) => entry.component === request.component)
				: unusedWaivers,
		},
		...(guides ? { guides } : {}),
		cases: {
			total: entries.length,
			passed: new Set(cases.map((item) => item.id)).size,
			failed: failed.sort((a, b) => a.id.localeCompare(b.id, 'en-US')),
			skipped,
		},
		workers,
		elapsedMs: performance.now() - started,
	};
}
