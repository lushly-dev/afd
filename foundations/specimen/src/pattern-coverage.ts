import type { LoadedConfig } from './config.js';
import {
	checkImplementationContexts,
	effectiveGateContext,
	matchesPatternRef,
	resolvePatternTarget,
	type SynthesizedGateCase,
} from './pattern-gates.js';
import { pool } from './suite.js';
import type {
	GateRun,
	ImplementationContexts,
	PatternCoverage,
	PatternCoverageLevel,
	PatternFile,
	PatternImplementationCoverage,
	PatternKeepCoverage,
} from './types.js';

export const PATTERNS_OBLIGATIONS = 'patterns@1' as const;

interface DiscoveredImplementation {
	key: string;
	patternLibrary: string;
	pattern: string;
	patternData: PatternFile;
	kind: 'component' | 'copy' | 'case';
	tag?: string;
	name?: string;
	case?: string;
	/** Component-wide guide contexts (for `kind: 'component'`) or case contexts (for `kind: 'case'`). */
	contexts?: ImplementationContexts;
	gatesByName: Map<string, SynthesizedGateCase[]>;
}

/** True when this bench has any pattern files, external sources, guide claims, or setup bindings. */
export function hasPatternCoverageScope(config: LoadedConfig): boolean {
	if (!config.patterns) return false;
	return (
		config.patterns.patterns.length > 0 ||
		Object.keys(config.patterns.external).length > 0 ||
		(config.gateCases?.length ?? 0) > 0 ||
		Boolean(
			config.guides?.components.some((guide) => guide.implements && guide.implements.length > 0)
		) ||
		config.entries.some((entry) => entry.patternSetup !== undefined)
	);
}

function discoverImplementations(
	config: LoadedConfig,
	filter: { component?: string; pattern?: string }
): DiscoveredImplementation[] {
	const localLibrary = config.config.pack?.library;
	const byKey = new Map<string, DiscoveredImplementation>();
	const guideByTag = new Map((config.guides?.components ?? []).map((guide) => [guide.tag, guide]));

	const ensureComponentImpl = (
		tag: string,
		ref: { library?: string; pattern: string }
	): DiscoveredImplementation | undefined => {
		const target = resolvePatternTarget(config.patterns, localLibrary, config.root, ref);
		if (!target) return undefined;
		const key = `${target.library}\0${target.pattern}\0component\0${tag}`;
		let impl = byKey.get(key);
		if (!impl) {
			const guideContexts = guideByTag.get(tag)?.contexts;
			impl = {
				key,
				patternLibrary: target.library,
				pattern: target.pattern,
				patternData: target.data,
				kind: 'component',
				tag,
				...(guideContexts ? { contexts: guideContexts } : {}),
				gatesByName: new Map(),
			};
			byKey.set(key, impl);
		}
		return impl;
	};

	// 1. Component guide `implements` claims (even when no setup case exists yet -> `missing`).
	for (const guide of config.guides?.components ?? []) {
		for (const claim of guide.implements ?? []) {
			const ref = typeof claim === 'string' ? { pattern: claim } : claim;
			ensureComponentImpl(guide.tag, ref);
		}
	}

	// 2. Setup entries (component-bound and tagless consumer cases).
	const gateCasesBySetupId = new Map<string, SynthesizedGateCase[]>();
	for (const gateCase of config.gateCases ?? []) {
		const list = gateCasesBySetupId.get(gateCase.setupEntry.id) ?? [];
		list.push(gateCase);
		gateCasesBySetupId.set(gateCase.setupEntry.id, list);
	}

	for (const entry of config.entries) {
		const binding = entry.patternSetup;
		if (!binding || (entry.story !== undefined && entry.story.play !== 'absent')) continue;
		const target = resolvePatternTarget(config.patterns, localLibrary, config.root, binding);
		if (!target) continue;

		let impl: DiscoveredImplementation | undefined;
		if (entry.component) {
			impl = ensureComponentImpl(entry.component, binding);
		} else {
			const key = `${target.library}\0${target.pattern}\0case\0${entry.id}`;
			impl = byKey.get(key);
			if (!impl) {
				impl = {
					key,
					patternLibrary: target.library,
					pattern: target.pattern,
					patternData: target.data,
					kind: 'case',
					case: entry.id,
					...(entry.contexts ? { contexts: entry.contexts } : {}),
					gatesByName: new Map(),
				};
				byKey.set(key, impl);
			}
		}
		if (!impl) continue;
		for (const gateCase of gateCasesBySetupId.get(entry.id) ?? []) {
			const existing = impl.gatesByName.get(gateCase.gateName) ?? [];
			existing.push(gateCase);
			impl.gatesByName.set(gateCase.gateName, existing);
		}
	}

	let implementations = [...byKey.values()];
	if (filter.component !== undefined) {
		implementations = implementations.filter(
			(impl) => impl.kind === 'component' && impl.tag === filter.component
		);
	}
	if (filter.pattern !== undefined) {
		const wantedPattern = filter.pattern;
		implementations = implementations.filter((impl) =>
			matchesPatternRef(impl.patternLibrary, impl.pattern, wantedPattern)
		);
	}

	implementations.sort((left, right) => {
		const a = `${left.patternLibrary}/${left.pattern}:${left.kind}:${left.tag ?? left.name ?? left.case ?? ''}`;
		const b = `${right.patternLibrary}/${right.pattern}:${right.kind}:${right.tag ?? right.name ?? right.case ?? ''}`;
		return a.localeCompare(b, 'en-US');
	});
	return implementations;
}

/**
 * Evaluate `patterns@1` coverage for all discovered pattern implementations (`spec.md` §4.4).
 * Runs each referenced synthesized gate case at most once with `capture: 'none'`.
 */
export async function computePatternCoverage(options: {
	config: LoadedConfig;
	component?: string;
	pattern?: string;
	workers: number;
	timeoutMs?: number;
	runGate: (id: string, timeoutMs?: number) => Promise<GateRun>;
}): Promise<PatternCoverage> {
	const { config, component, pattern, workers, timeoutMs, runGate } = options;
	const discovered = discoverImplementations(config, {
		...(component ? { component } : {}),
		...(pattern ? { pattern } : {}),
	});

	// Collect the unique gate case ids needed by any in-context gated keep statement.
	// Each bound setup case is checked against its own `gateCase.contexts` (guide + that setup)
	// so a context limit on one setup never hides or skips a sibling setup's gates.
	const neededGateIds = new Set<string>();
	for (const impl of discovered) {
		for (const keep of impl.patternData.keep ?? []) {
			if (!keep.gate) continue;
			const gateDef = impl.patternData.gates?.[keep.gate];
			if (!gateDef) continue;
			const cases = impl.gatesByName.get(keep.gate) ?? [];
			if (cases.length === 0) continue;
			const effective = effectiveGateContext(gateDef);
			for (const gateCase of cases) {
				if (checkImplementationContexts(effective, gateCase.contexts) === undefined) {
					neededGateIds.add(gateCase.id);
				}
			}
		}
	}

	const gateResults = new Map<string, GateRun>();
	if (neededGateIds.size > 0) {
		const ids = [...neededGateIds].sort((a, b) => a.localeCompare(b, 'en-US'));
		const runs = await pool(ids, workers, (id) => runGate(id, timeoutMs));
		ids.forEach((id, index) => {
			const run = runs[index];
			if (run) gateResults.set(id, run);
		});
	}

	const counts: Record<PatternCoverageLevel, number> = {
		verified: 0,
		missing: 0,
		ungated: 0,
		'out-of-context': 0,
	};
	const implementations: PatternImplementationCoverage[] = [];

	for (const impl of discovered) {
		const keepCoverage: PatternKeepCoverage[] = [];
		const implContexts = impl.contexts ? [impl.contexts] : [];
		for (const keep of impl.patternData.keep ?? []) {
			if (!keep.gate) {
				counts.ungated += 1;
				keepCoverage.push({ id: keep.id, level: 'ungated' });
				continue;
			}
			const gateDef = impl.patternData.gates?.[keep.gate];
			if (!gateDef) {
				counts.missing += 1;
				keepCoverage.push({ id: keep.id, level: 'missing' });
				continue;
			}
			const effective = effectiveGateContext(gateDef);
			const cases = impl.gatesByName.get(keep.gate) ?? [];
			if (cases.length === 0) {
				const outOfContextReason = checkImplementationContexts(effective, implContexts);
				if (outOfContextReason !== undefined) {
					counts['out-of-context'] += 1;
					keepCoverage.push({ id: keep.id, level: 'out-of-context', reason: outOfContextReason });
				} else {
					counts.missing += 1;
					keepCoverage.push({ id: keep.id, level: 'missing' });
				}
				continue;
			}
			const outcomes: GateRun['outcome'][] = [];
			for (const gateCase of cases) {
				const caseOutOfContext = checkImplementationContexts(effective, gateCase.contexts);
				if (caseOutOfContext !== undefined) {
					outcomes.push({ status: 'out-of-context', reason: caseOutOfContext, failures: [] });
				} else {
					const runOutcome = gateResults.get(gateCase.id)?.outcome;
					if (runOutcome) outcomes.push(runOutcome);
				}
			}
			if (outcomes.length !== cases.length || outcomes.some((item) => item.status === 'failed')) {
				counts.missing += 1;
				keepCoverage.push({ id: keep.id, level: 'missing' });
			} else if (outcomes.every((item) => item.status === 'out-of-context')) {
				counts['out-of-context'] += 1;
				const reason = outcomes[0]?.reason;
				keepCoverage.push({
					id: keep.id,
					level: 'out-of-context',
					...(reason ? { reason } : {}),
				});
			} else {
				counts.verified += 1;
				keepCoverage.push({ id: keep.id, level: 'verified' });
			}
		}

		implementations.push({
			patternLibrary: impl.patternLibrary,
			pattern: impl.pattern,
			kind: impl.kind,
			...(impl.tag !== undefined ? { tag: impl.tag } : {}),
			...(impl.name !== undefined ? { name: impl.name } : {}),
			...(impl.case !== undefined ? { case: impl.case } : {}),
			...(impl.contexts !== undefined ? { contexts: impl.contexts } : {}),
			keep: keepCoverage,
		});
	}

	return {
		obligations: PATTERNS_OBLIGATIONS,
		complete: counts.missing === 0,
		implementations,
		counts,
	};
}
