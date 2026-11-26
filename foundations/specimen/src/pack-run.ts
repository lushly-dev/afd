import { performance } from 'node:perf_hooks';
import { type CoverageCase, computeCoverage, GUIDE_PREFIX, schemaMembers } from './coverage.js';
import {
	type CollectedCases,
	type CoverageHost,
	collectCases,
	runSchemas,
} from './coverage-run.js';
import { computeGuideCoverage } from './guide-coverage.js';
import { checkPack } from './pack.js';
import { buildPack, libraryTags, type PackCase, type PackExample } from './pack-build.js';
import { PACK_TEXT_LIMITS } from './pack-schema.js';
import { computePatternCoverage, hasPatternCoverageScope } from './pattern-coverage.js';
import { resolvePatternTarget } from './pattern-gates.js';
import type { ComponentSchema } from './plugin.js';
import { DEFAULT_SUITE_WORKERS, pool } from './suite.js';
import type {
	GateRun,
	Observation,
	PackBuildRequest,
	PackBuildRun,
	PackIndex,
	PatternCoverage,
	SpecimenEntry,
} from './types.js';

/**
 * Build a library's pack from two passes over its cases. A case that fails is retried once, as
 * `specimen-run` retries; a case whose observations differ between the passes contributes
 * nothing; an example is mounted again from its own markup and kept only when that gives the
 * same observation.
 */

/** What a pack run needs of the bench, beyond a coverage run: a capture with options. */
export interface PackHost extends CoverageHost {
	/** The digest of the bundle the last `prepare()` built, when the host reports one. */
	bundle(): string | null;
	capture(
		id: string,
		options: {
			timeoutMs?: number;
			observe: SpecimenEntry['observe'];
			/** Mount this markup, after loading the entry's module, in place of the entry. */
			remount?: string;
		}
	): Promise<Observation | null>;
}

/** Ids of shadow content serialized into the DOM, which an example leaves out. */
function lightDom(raw: string): string {
	let text = raw;
	for (;;) {
		const next = text.replace(
			/<template shadowrootmode[^>]*>(?:(?!<template)[\s\S])*?<\/template>/g,
			''
		);
		if (next === text) return text;
		text = next;
	}
}

const START_TAG = /<([a-z][^\s/>]*)(\s[^>]*)?>/g;
const ATTRIBUTE = /([^\s=/>]+)(?:="([^"]*)")?/g;

/**
 * An example's markup: the light DOM a case mounted, each element's attributes in name order (by
 * code unit), and an empty attribute written as its name alone, as a person writes a boolean
 * attribute. The browser writes attributes in the order they were set, which a component that
 * reflects one later than a story sets another makes differ from run to run.
 */
export function exampleMarkup(raw: string): string {
	return lightDom(raw)
		.replace(START_TAG, (_, name: string, rest: string | undefined) => {
			const attributes = [...(rest ?? '').matchAll(ATTRIBUTE)]
				.map(([, attribute, value]) => [attribute as string, value ?? ''] as const)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([attribute, value]) => (value ? ` ${attribute}="${value}"` : ` ${attribute}`));
			return `<${name}${attributes.join('')}>`;
		})
		.trim();
}

/** What a record takes from one capture: the library's elements, their states and the claims. */
function projection(
	observation: Observation,
	schemas: ReadonlyMap<string, ComponentSchema>
): unknown {
	const { elements, events, evidence, a11y } = observation.channels;
	return {
		checkpoint: observation.manifest.checkpoint.name,
		elements: elements
			.filter((element) => schemas.has(element.tag))
			.map((element) => {
				const schema = schemas.get(element.tag) as ComponentSchema;
				const declared = new Set(
					schemaMembers(schema).flatMap(({ attribute }) => (attribute ? [attribute] : []))
				);
				return {
					ref: element.ref,
					tag: element.tag,
					attributes: Object.entries(element.attributes)
						.filter(([name]) => declared.has(name) || name === 'slot')
						.sort(),
					state: Object.entries(element.state)
						.filter(
							([name]) =>
								name.startsWith('prop:') || name.startsWith('slot:') || name === 'formAssociated'
						)
						.sort(),
					accessibility: element.accessibility ?? null,
				};
			}),
		events: events.history.map((event) => event.type),
		claims: evidence.claims.map(({ obligation, checkpoint, ref, checked }) => [
			obligation,
			checkpoint,
			ref,
			checked ?? null,
		]),
		expectations: evidence.expectations.map((record) => record.id),
		axe:
			a11y.axe === 'not-run'
				? null
				: {
						violations: a11y.axe.violations.map((item) => item.id),
						exceptions: a11y.axe.exceptions.map((item) => item.rule),
					},
	};
}

const byId = (cases: readonly CoverageCase[]) => {
	const grouped = new Map<string, CoverageCase[]>();
	for (const item of cases) grouped.set(item.id, [...(grouped.get(item.id) ?? []), item]);
	return grouped;
};

/** One pass, with each failed case retried once. */
async function pass(
	host: PackHost,
	request: PackBuildRequest,
	entries: SpecimenEntry[],
	schemas: ComponentSchema[],
	progress?: (message: string) => void
): Promise<CollectedCases & { retried: string[] }> {
	let completed = 0;
	const first = await collectCases(host, request, {
		entries,
		schemas,
		onCaseComplete: () => {
			completed++;
			if (completed % 50 === 0 || completed === entries.length)
				progress?.(`${completed}/${entries.length} cases completed`);
		},
	});
	if (!first.failed.length) return { ...first, retried: [] };
	const retried = new Set(first.failed.map((item) => item.id));
	progress?.(`Retrying ${retried.size} failed cases`);
	const again = await collectCases(
		host,
		{ ...request, workers: 1 },
		{ entries: entries.filter((entry) => retried.has(entry.id)), schemas }
	);
	// A case that failed may have left captures from before its failure; only its retry counts.
	const earlier = (cases: CoverageCase[]) => cases.filter((item) => !retried.has(item.id));
	return {
		...first,
		cases: [...earlier(first.cases), ...again.cases],
		guideCases: [...earlier(first.guideCases), ...again.guideCases],
		failed: again.failed,
		skipped: first.skipped + again.skipped,
		retried: [...retried],
	};
}

/** The cases to run: all of them, or the ones the index says render the component. */
function select(
	host: PackHost,
	{ component, index }: PackBuildRequest,
	library: ReadonlyMap<string, ComponentSchema>
): { entries: SpecimenEntry[]; selection: PackBuildRun['selection'] } {
	const all = host.config.entries;
	if (component === undefined)
		return {
			entries: all,
			selection: { component: null, complete: true, reason: 'Every case ran.' },
		};
	const everything = (reason: string) => ({
		entries: all,
		selection: { component, complete: true, reason: `${reason}, so every case ran.` },
	});
	if (!index)
		return everything('No full build has written an index of the cases each component renders in');
	if (index.bundle !== host.bundle() || index.config !== host.config.digest)
		return everything('The sources changed since the last full build wrote its index');
	if (!library.has(component) || !Object.hasOwn(index.cases, component))
		return everything(`The last full build's index does not list ${component}`);
	const wanted = new Set(index.cases[component]);
	const entries = all.filter((entry) => wanted.has(entry.id));
	return {
		entries,
		selection: {
			component,
			complete: true,
			reason: `The last full build's index lists ${entries.length} case${entries.length === 1 ? '' : 's'} that render it, and the sources have not changed since.`,
		},
	};
}

/** Each library tag's cases in a full build: those that rendered it, and every case that failed. */
function indexOf(
	bundle: string,
	config: string,
	library: ReadonlyMap<string, ComponentSchema>,
	passes: readonly CollectedCases[]
): PackIndex {
	const cases: Record<string, Set<string>> = Object.fromEntries(
		[...library.keys()].map((tag) => [tag, new Set<string>()])
	);
	for (const { cases: captured, guideCases, failed } of passes) {
		for (const { id, observation } of [...captured, ...guideCases])
			for (const element of observation.channels.elements) cases[element.tag]?.add(id);
		for (const { id } of failed) for (const tag of Object.keys(cases)) cases[tag]?.add(id);
	}
	return {
		bundle,
		config,
		cases: Object.fromEntries(
			Object.entries(cases)
				.sort(([a], [b]) => (a < b ? -1 : 1))
				.map(([tag, ids]) => [tag, [...ids].sort()])
		),
	};
}

export async function runPack(
	host: PackHost,
	request: PackBuildRequest,
	progress?: (message: string) => void
): Promise<PackBuildRun> {
	const { config } = host;
	const pack = config.config.pack;
	if (!pack) throw new Error('This configuration has no pack key; add one to build a pack.');
	const started = performance.now();
	progress?.('Preparing captures');
	const hasLocalPatterns = (config.patterns?.patterns.length ?? 0) > 0;
	if (!config.entries.length && !hasLocalPatterns)
		throw new Error('No specimen or retained story to build a pack from.');
	if (config.entries.length > 0 || (config.gateCases?.length ?? 0) > 0) {
		await host.prepare();
	}
	const schemas = await runSchemas(host);
	const bySchema = new Map(schemas.map((schema) => [schema.tag, schema]));
	const tags = new Set(libraryTags(pack, schemas));
	const library = new Map([...bySchema].filter(([tag]) => tags.has(tag)));
	const { component } = request;
	if (component !== undefined && !tags.has(component))
		throw new Error(
			`${component} is not one of the library's components: a schema has to describe it, and its tag start with ${pack.prefix}.`
		);
	const { entries, selection } = select(host, request, library);

	const none: CollectedCases & { retried: string[] } = {
		entries,
		schemas,
		cases: [],
		guideCases: [],
		failed: [],
		skipped: 0,
		workers: 1,
		retried: [],
	};
	const capturePass = async (number: number) => {
		const phase = `Capture pass ${number}/2`;
		progress?.(`${phase} (${entries.length} cases)`);
		return entries.length
			? pass(
					host,
					request,
					entries,
					schemas,
					progress && ((message) => progress(`${phase} - ${message}`))
				)
			: none;
	};
	const one = await capturePass(1);
	const two = await capturePass(2);
	progress?.('Comparing capture passes and computing coverage');
	const failedIds = new Set([...one.failed, ...two.failed].map((item) => item.id));
	const failed = [
		...one.failed,
		...two.failed.filter((item) => !one.failed.some((f) => f.id === item.id)),
	].sort((a, b) => (a.id < b.id ? -1 : 1));
	const firstById = byId([...one.cases, ...one.guideCases]);
	const secondById = byId([...two.cases, ...two.guideCases]);
	const unstable: string[] = [];
	const stable = new Set<string>();
	// A case seen in one pass only did not show the same thing twice.
	for (const id of new Set([...firstById.keys(), ...secondById.keys()])) {
		if (failedIds.has(id)) continue;
		const captures = firstById.get(id) ?? [];
		const other = secondById.get(id);
		const left = JSON.stringify(captures.map((item) => projection(item.observation, library)));
		const right = JSON.stringify(
			(other ?? []).map((item) => projection(item.observation, library))
		);
		if (left === right) stable.add(id);
		else unstable.push(id);
	}
	unstable.sort();
	const keep = (cases: readonly CoverageCase[]) => cases.filter((item) => stable.has(item.id));
	const cases = keep(one.cases);
	const guideCases = keep(one.guideCases);

	const coverage = computeCoverage(schemas, cases);
	const guideCoverage = computeGuideCoverage(config.guides, schemas, [...cases, ...guideCases]);
	const failedGateRuns = new Map<string, GateRun>();
	const runGateHost = host.runGate;
	const patternCoverage: PatternCoverage | undefined =
		hasPatternCoverageScope(config) && runGateHost
			? await computePatternCoverage({
					config,
					...(component ? { component } : {}),
					workers: request.workers ?? config.config.test?.workers ?? DEFAULT_SUITE_WORKERS,
					...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
					runGate: async (id, timeoutMs) => {
						const run = await runGateHost(id, timeoutMs);
						if (run.outcome.status === 'failed') failedGateRuns.set(id, run);
						return run;
					},
				})
			: undefined;
	for (const [gateId, run] of failedGateRuns) {
		if (!failed.some((item) => item.id === gateId)) {
			failed.push({
				id: gateId,
				message: run.outcome.failures[0]?.message ?? 'The pattern gate failed.',
			});
		}
	}
	failed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const componentOf = new Map(config.entries.map((entry) => [entry.id, entry.component]));
	const themesOf = new Map(config.entries.map((entry) => [entry.id, entry.themes]));

	// Examples: what a case about a component mounted, the same in both passes, and the same
	// again when that markup alone is mounted.
	const examples: PackExample[] = [];
	const leftOut: PackBuildRun['examples']['leftOut'] = [];
	const observe = Object.fromEntries(
		[...library.values()].map((schema) => [
			schema.tag,
			schema.properties.filter((member) => member.values?.length).map((member) => member.name),
		])
	);
	const afterRun = (cases: readonly CoverageCase[] | undefined) =>
		cases?.find((item) => item.observation.manifest.checkpoint.name === 'after-run');
	progress?.('Verifying examples by remounting');
	let remounts = 0;
	const remounted = await pool([...stable].sort(), one.workers, async (id) => {
		const tag = componentOf.get(id);
		if (!tag || !library.has(tag)) return;
		const original = afterRun(firstById.get(id));
		const second = afterRun(secondById.get(id));
		if (!original || !second) return;
		const html = exampleMarkup(original.observation.channels.dom.raw);
		const omit = (reason: string) => ({ tag, from: id, reason });
		if (!html.includes(`<${tag}`)) {
			return omit('Its markup does not hold the component.');
		}
		if (html !== exampleMarkup(second.observation.channels.dom.raw)) {
			return omit('Its markup differs between the two passes.');
		}
		if ([...html].length > PACK_TEXT_LIMITS.example) {
			return omit(`Its markup is longer than ${PACK_TEXT_LIMITS.example} characters.`);
		}
		const captureRemount = async (): Promise<{
			observation: Observation | null;
			error?: unknown;
		}> => {
			try {
				return {
					observation: await host.capture(id, {
						timeoutMs: request.timeoutMs,
						observe,
						remount: html,
					}),
				};
			} catch (error) {
				return { observation: null, error };
			}
		};
		const shown = (observation: Observation) => {
			const { elements } = projection(observation, library) as { elements: unknown[] };
			return JSON.stringify(elements);
		};
		const expectedShown = shown(original.observation);
		// Retry once on transient capture failure or settle race, matching `pass()`.
		let attempt = await captureRemount();
		if (attempt.error || !attempt.observation || shown(attempt.observation) !== expectedShown) {
			attempt = await captureRemount();
		}
		remounts++;
		if (remounts % 50 === 0) progress?.(`Checked ${remounts} remount candidates`);
		if (attempt.error) {
			const { error } = attempt;
			return omit(
				`Mounted again, it failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
		if (!attempt.observation || shown(attempt.observation) !== expectedShown) {
			return omit('Mounted again from its markup, it shows something else.');
		}
		return { tag, from: id, html };
	});
	for (const result of remounted) {
		if (!result) continue;
		if ('reason' in result) leftOut.push(result);
		else examples.push(result);
	}

	progress?.(`Building pack records after checking ${remounts} remount candidates`);
	const packCases: PackCase[] = cases.map(({ id, observation }) => ({
		id,
		...(componentOf.get(id) ? { component: componentOf.get(id) } : {}),
		...(themesOf.get(id) ? { themes: themesOf.get(id) } : {}),
		observation,
	}));
	const built = buildPack({
		config: pack,
		schemas,
		...(config.guides ? { guides: config.guides } : {}),
		...(config.patterns ? { patterns: config.patterns } : {}),
		coverage,
		guideCoverage,
		...(patternCoverage ? { patternCoverage } : {}),
		cases: packCases,
		examples,
	});
	// One component's build answers for its record alone.
	const record = component && `data/${pack.library}/components/${component}.json`;
	const files = Object.fromEntries([...built.files].filter(([path]) => !record || path === record));
	const encoder = new TextEncoder();
	const problems: PackBuildRun['problems'] = checkPack(
		new Map([...built.files].map(([path, text]) => [path, encoder.encode(text)])),
		{ form: 'committed' }
	).problems.filter((problem) => !record || problem.path === record);
	// A guide or pattern file with an error is left out of every record, so the build is not sound.
	for (const problem of [
		...(config.guides?.problems ?? []),
		...(config.patterns?.problems ?? []),
	]) {
		if (problem.severity !== 'error') continue;
		problems.push({
			code: problem.code,
			path: problem.file ?? 'guides',
			...(problem.field ? { at: `#${problem.field}` } : {}),
			message: problem.message,
		});
	}
	// Format 2 holds only verified, ungated, and out-of-context keep bases: any missing gated
	// setup blocks packing with PATTERN_SETUP_MISSING (`spec.md` §5.5, §6.2).
	for (const impl of patternCoverage?.implementations ?? []) {
		if (impl.kind !== 'component' || !impl.tag || !tags.has(impl.tag)) continue;
		if (component && impl.tag !== component) continue;
		const resolvedPattern = resolvePatternTarget(config.patterns, pack.library, config.root, {
			library: impl.patternLibrary,
			pattern: impl.pattern,
		});
		const recordPath = `data/${pack.library}/components/${impl.tag}.json`;
		for (const item of impl.keep) {
			if (item.level !== 'missing') continue;
			const keepDef = resolvedPattern?.data.keep?.find((k) => k.id === item.id);
			const gateName = keepDef?.gate;
			const matchingGateCases = (config.gateCases ?? []).filter(
				(gc) =>
					gc.setupEntry.component === impl.tag &&
					gc.patternLibrary === impl.patternLibrary &&
					gc.pattern === impl.pattern &&
					gc.gateName === gateName
			);
			const ranAndFailed = matchingGateCases.some((gc) => failedGateRuns.has(gc.id));
			if (ranAndFailed) {
				problems.push({
					code: 'GATE_FAILED',
					path: recordPath,
					message: `Pattern gate ${gateName ?? item.id} failed for ${impl.tag} (${impl.patternLibrary}/${impl.pattern}).`,
				});
			} else {
				const obligation = `pattern:${impl.patternLibrary}/${item.id}`;
				problems.push({
					code: 'PATTERN_SETUP_MISSING',
					path: recordPath,
					message: `${impl.tag} claims ${impl.patternLibrary}/${impl.pattern} but is missing a setup case for ${obligation}.`,
				});
			}
		}
	}
	const claimed = new Set(
		[...cases, ...guideCases].flatMap(({ observation }) =>
			observation.channels.evidence.claims
				.filter((claim) => claim.obligation.startsWith(GUIDE_PREFIX))
				.map((claim) => claim.obligation)
		)
	);
	return {
		library: pack.library,
		files,
		problems,
		components: built.gaps.filter((item) => !component || item.tag === component),
		omitted: built.omitted.filter((item) => !component || item.tag === component),
		guides: {
			verified: guideCoverage.counts.verified,
			authored: guideCoverage.counts.authored,
			invalidClaims: guideCoverage.invalidClaims,
			claimed: claimed.size,
		},
		examples: { kept: examples.length, leftOut },
		selection,
		...(component || !host.bundle()
			? {}
			: { index: indexOf(host.bundle() as string, config.digest, library, [one, two]) }),
		cases: {
			total: entries.length,
			passed: stable.size,
			failed,
			retried: [...new Set([...one.retried, ...two.retried])].sort(),
			unstable,
			skipped: one.skipped,
		},
		elapsedMs: performance.now() - started,
	};
}
