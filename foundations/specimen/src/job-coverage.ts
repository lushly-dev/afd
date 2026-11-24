import { performance } from 'node:perf_hooks';
import type { LoadedConfig } from './config.js';
import {
	type ComponentCoverage,
	type CoverageLevel,
	type CoverageObligation,
	type CoverageReport,
	readObservedMember,
	same,
	schemaMembers,
	UNREACHED_PREFIX,
} from './coverage.js';
import type { SpecimenHostError } from './host.js';
import type { ComponentSchema, PropertySchema, SchemaValue } from './plugin.js';
import {
	nearestSpecimenIds,
	readCaptureSetManifest,
	readSetCaptureFromManifest,
	resolveCaptureSetId,
} from './sets.js';
import type {
	CaptureSetEntry,
	CoverageRequest,
	CoverageRun,
	CoverageWaivers,
	ElementObservation,
	JobCoverageReach,
	Observation,
} from './types.js';

function typedError(
	code: string,
	message: string,
	suggestion: string,
	details?: Record<string, unknown>
): SpecimenHostError {
	const error = new Error(message) as SpecimenHostError;
	error.code = code;
	error.suggestion = suggestion;
	if (details !== undefined) error.details = details;
	return error;
}

/**
 * Read an observed property/attribute value for `jobs@1`, preserving recorded `null` property
 * values in `element.state` (unlike `??`, which drops `null` and falls back to attributes).
 */
function readJobObservedMember(
	element: ElementObservation,
	member: PropertySchema,
	attribute?: string
): SchemaValue | undefined {
	const propKey = `prop:${member.name}`;
	if (Object.hasOwn(element.state, propKey) && element.state[propKey] !== undefined) {
		return element.state[propKey];
	}
	if (Object.hasOwn(element.state, member.name) && element.state[member.name] !== undefined) {
		return element.state[member.name];
	}
	return readObservedMember(element, member, attribute);
}

/** The `jobs@1` component coverage obligation set: which job states reach which component partitions. */
export const JOBS_COVERAGE_OBLIGATIONS = 'jobs@1' as const;

const MAX_EVIDENCE = 3;

export interface JobCoverageCapture {
	/** Job specimen id (optional; defaults to the prefix before `/` in `key`). */
	id?: string;
	/** Capture key (`<id>/<step>`). */
	key: string;
	/** Capture checkpoint name. */
	name: string;
	/** 1-based scenario step number. */
	step: number;
	observation: Observation;
}

interface JobTarget {
	key: string;
	name: string;
	element: ElementObservation;
}

function compareCodeUnits(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function specimenIdOf(capture: JobCoverageCapture): string {
	if (capture.id !== undefined) return capture.id;
	const slash = capture.key.lastIndexOf('/');
	return slash > 0 ? capture.key.slice(0, slash) : capture.key;
}

function sortJobCaptures(captures: readonly JobCoverageCapture[]): JobCoverageCapture[] {
	return [...captures].sort(
		(a, b) =>
			compareCodeUnits(specimenIdOf(a), specimenIdOf(b)) ||
			a.step - b.step ||
			compareCodeUnits(a.key, b.key)
	);
}

function sortSetEntries(entries: readonly CaptureSetEntry[]): CaptureSetEntry[] {
	return [...entries].sort(
		(a, b) =>
			compareCodeUnits(a.id, b.id) ||
			(a.step ?? -1) - (b.step ?? -1) ||
			compareCodeUnits(a.key, b.key)
	);
}

function buildObligation(
	id: string,
	kind: 'property' | 'slot',
	matches: JobTarget[],
	absent: string
): CoverageObligation {
	return {
		id,
		kind,
		level: matches.length > 0 ? 'represented' : 'missing',
		evidence: matches.slice(0, MAX_EVIDENCE).map(({ key, name, element }) => ({
			specimen: key,
			checkpoint: name,
			target: element.ref,
		})),
		evidenceCount: matches.length,
		...(matches.length > 0 ? {} : { reason: absent }),
	};
}

function componentJobCoverage(
	schema: ComponentSchema,
	captures: readonly JobCoverageCapture[]
): ComponentCoverage {
	const reachedBy: JobCoverageReach[] = [];
	const seenKeys = new Set<string>();
	const targets: JobTarget[] = [];

	for (const capture of captures) {
		const matched = capture.observation.channels.elements.filter(
			(element) => element.tag === schema.tag
		);
		if (matched.length === 0) continue;
		if (!seenKeys.has(capture.key)) {
			seenKeys.add(capture.key);
			reachedBy.push({ key: capture.key, name: capture.name, step: capture.step });
		}
		for (const element of matched) {
			targets.push({ key: capture.key, name: capture.name, element });
		}
	}

	const rendered = reachedBy.length;
	const none = `No job capture renders <${schema.tag}>.`;
	const members = schemaMembers(schema);
	const finite = members.filter(({ member }) => member.values?.length);
	const obligations: CoverageObligation[] = [];

	for (const { member, attribute } of finite) {
		const observable = targets.some(
			({ element }) => readJobObservedMember(element, member, attribute) !== undefined
		);
		for (const value of member.values ?? []) {
			const partition = `${member.name}=${String(value)}`;
			const id = `${UNREACHED_PREFIX}${partition}`;
			if (targets.length > 0 && !observable) {
				obligations.push({
					id,
					kind: 'property',
					level: 'unknown',
					evidence: [],
					evidenceCount: 0,
					reason: `${member.name} could not be read on any <${schema.tag}>.`,
				});
				continue;
			}
			obligations.push(
				buildObligation(
					id,
					'property',
					targets.filter(({ element }) =>
						same(readJobObservedMember(element, member, attribute), value)
					),
					rendered > 0 ? `No job capture shows ${member.name} as ${String(value)}.` : none
				)
			);
		}
	}

	for (const { name } of schema.slots) {
		const key = `slot:${name}`;
		const label = name || 'the default slot';
		const observable = targets.some(({ element }) => typeof element.state[key] === 'number');
		for (const [partition, test] of [
			['filled', (count: number) => count > 0],
			['empty', (count: number) => count === 0],
		] as const) {
			const id = `${UNREACHED_PREFIX}slot:${name || 'default'}=${partition}`;
			if (targets.length > 0 && !observable) {
				obligations.push({
					id,
					kind: 'slot',
					level: 'unknown',
					evidence: [],
					evidenceCount: 0,
					reason: `${label} could not be read on any <${schema.tag}>.`,
				});
				continue;
			}
			obligations.push(
				buildObligation(
					id,
					'slot',
					targets.filter(({ element }) => {
						const count = element.state[key];
						return typeof count === 'number' && test(count);
					}),
					rendered > 0 ? `No job capture shows ${label} ${partition}.` : none
				)
			);
		}
	}

	return {
		tag: schema.tag,
		sources: schema.sources,
		cases: rendered,
		obligations,
		counts: { verified: 0, asserted: 0, represented: 0, missing: 0, unknown: 0 },
		openEnded: members
			.filter(({ member }) => !member.values?.length)
			.map(({ member }) => member.name),
		unknownToSchema: schema.unknown,
		jobs: {
			reachedBy,
			unreached: [],
			...(rendered === 0 ? { reason: none } : {}),
		},
	};
}

/**
 * Compute `jobs@1` component coverage from recorded job captures and component schemas.
 * Applies only `unreached:<partition>` waivers, leaving `schema-partitions@1` waivers untouched.
 */
export function computeJobCoverage(
	schemas: Iterable<ComponentSchema>,
	captures: readonly JobCoverageCapture[],
	waivers?: CoverageWaivers
): CoverageReport {
	const ordered = sortJobCaptures(captures);
	const components = [...schemas].map((schema) => componentJobCoverage(schema, ordered));

	const unusedWaivers: CoverageWaivers['entries'] = [];
	for (const entry of waivers?.entries ?? []) {
		if (!entry.obligation.startsWith(UNREACHED_PREFIX)) continue;
		const owed = components
			.find((component) => component.tag === entry.component)
			?.obligations.find((item) => item.id === entry.obligation);
		if (owed) owed.waiver = entry.reason;
		else unusedWaivers.push(entry);
	}

	const counts: Record<CoverageLevel, number> = {
		verified: 0,
		asserted: 0,
		represented: 0,
		missing: 0,
		unknown: 0,
	};
	let waived = 0;
	let open = 0;

	for (const component of components) {
		const unreached: string[] = [];
		for (const item of component.obligations) {
			component.counts[item.level]++;
			counts[item.level]++;
			if (item.waiver) {
				waived++;
			} else {
				if (item.level === 'missing') {
					unreached.push(item.id.slice(UNREACHED_PREFIX.length));
				}
				if (item.level !== 'represented') {
					open++;
				}
			}
		}
		if (component.jobs) {
			component.jobs.unreached = unreached;
			if (component.jobs.reachedBy.length === 0 && component.obligations.length === 0) {
				open++;
			}
		}
	}

	return {
		complete: components.length > 0 && open === 0,
		components,
		counts,
		waived,
		unusedWaivers,
		invalidClaims: [],
	};
}

/**
 * Read job captures from a saved capture set (by set id or local label) with zero browser launch
 * and compute `jobs@1` component coverage. Refuses an unknown set with `CAPTURE_SET_NOT_FOUND`.
 */
export async function readJobCoverageFromSet(
	config: LoadedConfig,
	request: CoverageRequest & { obligations: typeof JOBS_COVERAGE_OBLIGATIONS; captures: string }
): Promise<CoverageRun> {
	const started = performance.now();
	if (request.filter?.file !== undefined || request.filter?.tags !== undefined) {
		throw new Error(
			'Set-backed jobs@1 specimen-coverage does not support filter.file or filter.tags; omit them or use component, filter.ids, or filter.match.'
		);
	}

	const setId = await resolveCaptureSetId(config.root, request.captures);
	const manifest = await readCaptureSetManifest(config.root, setId);

	const schemas = request.component
		? (() => {
				const found = Object.hasOwn(config.schemas, request.component)
					? config.schemas[request.component]
					: undefined;
				if (!found) {
					throw new Error(
						`No schema describes ${request.component}. Configure a custom elements manifest that does.`
					);
				}
				return [found];
			})()
		: Object.values(config.schemas);

	const configuredJobIds = new Set(
		config.entries.filter((entry) => entry.job !== undefined).map((entry) => entry.id)
	);
	const allJobEntries = sortSetEntries(Object.values(manifest.captures)).filter(
		(entry) =>
			entry.job !== undefined ||
			manifest.kind === 'job' ||
			(entry.status === 'unavailable' && configuredJobIds.has(entry.id))
	);
	let jobEntries = allJobEntries;

	if (request.filter?.ids !== undefined) {
		if (request.filter.ids.length === 0) {
			throw typedError(
				'SPECIMEN_NOT_FOUND',
				`No job capture in set ${setId} matched empty filter.ids.`,
				'Pass at least one job specimen id or capture key, or omit filter.ids.',
				{ set: setId, ids: [] }
			);
		}
		const idSet = new Set(request.filter.ids);
		const missing = request.filter.ids.filter(
			(wanted) => !jobEntries.some((entry) => entry.id === wanted || entry.key === wanted)
		);
		if (missing.length > 0) {
			const first = missing[0] as string;
			const availableIds = [...new Set(allJobEntries.flatMap((entry) => [entry.id, entry.key]))];
			const nearest = nearestSpecimenIds(first, availableIds);
			throw typedError(
				'SPECIMEN_NOT_FOUND',
				`Job capture '${first}' not found in capture set ${setId}.`,
				nearest.length
					? `Did you mean ${nearest.join(', ')}?`
					: `Capture set ${setId} contains no job capture for '${first}'.`,
				{ set: setId, id: first, nearest }
			);
		}
		jobEntries = jobEntries.filter((entry) => idSet.has(entry.id) || idSet.has(entry.key));
	}
	if (request.filter?.match) {
		const needle = request.filter.match.toLowerCase();
		jobEntries = jobEntries.filter((entry) =>
			`${entry.id} ${entry.key} ${entry.checkpoint ?? ''} ${entry.job ?? ''}`
				.toLowerCase()
				.includes(needle)
		);
		if (jobEntries.length === 0) {
			throw typedError(
				'SPECIMEN_NOT_FOUND',
				`No job capture in set ${setId} matched '${request.filter.match}'.`,
				`Inspect set ${setId} captures or omit filter.match to check every job capture in the set.`,
				{ set: setId, match: request.filter.match }
			);
		}
	}

	const captures: JobCoverageCapture[] = [];
	const failed: CoverageRun['cases']['failed'] = [];

	for (const entry of jobEntries) {
		if (entry.status !== 'captured' || !entry.observation) {
			failed.push({ id: entry.key, message: entry.reason ?? 'Capture was not taken.' });
			continue;
		}
		const observation = await readSetCaptureFromManifest(config.root, setId, manifest, entry.key);
		const step = entry.step ?? observation.manifest.job?.step;
		if (typeof step !== 'number' || !Number.isSafeInteger(step) || step < 1) {
			throw new Error(
				`Job capture '${entry.key}' in set ${setId} is missing a valid 1-based step number.`
			);
		}
		const name = entry.checkpoint ?? observation.manifest.checkpoint.name;
		captures.push({
			id: entry.id,
			key: entry.key,
			name,
			step,
			observation,
		});
	}

	const waivers = config.config.coverage?.waivers;
	const { unusedWaivers, ...report } = computeJobCoverage(schemas, captures, waivers);

	return {
		obligations: JOBS_COVERAGE_OBLIGATIONS,
		...report,
		waivers: {
			version: waivers?.version ?? null,
			unused: request.component
				? unusedWaivers.filter((entry) => entry.component === request.component)
				: unusedWaivers,
		},
		cases: {
			total: jobEntries.length,
			passed: captures.length,
			failed: failed.sort((a, b) => a.id.localeCompare(b.id, 'en-US')),
			skipped: 0,
		},
		workers: 1,
		elapsedMs: performance.now() - started,
	};
}
