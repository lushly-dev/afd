/**
 * Native portable pattern gate execution and suggestion helpers for the Specimen runtime.
 */
import { performance } from 'node:perf_hooks';
import type { LoadedConfig } from './config.js';
import {
	checkImplementationContexts,
	DEFAULT_PATTERN_LIBRARY,
	effectiveGateContext,
	type SynthesizedGateCase,
} from './pattern-gates.js';
import { PATTERN_GAP_PREFIX, suggestSpecimens } from './suggest.js';
import type {
	CaptureRequest,
	CoverageRequest,
	CoverageRun,
	EventDeclaration,
	GateOutcome,
	GateRun,
	Observation,
	PortableScenarioStep,
	RunRequest,
	StoryOutcome,
	SuggestRequest,
	SuggestRun,
	SuiteCapture,
	Target,
} from './types.js';
import { parseSuggestRequest } from './validate.js';

export interface GateCaptureOptions {
	capture?: SuiteCapture;
	reuseBundle?: boolean;
	gate?: {
		id: string;
		targets: Record<string, Target>;
		scenario: PortableScenarioStep[];
		events: EventDeclaration[];
	};
}

export type GateCaptureFn = (
	parsed: CaptureRequest,
	options?: GateCaptureOptions
) => Promise<{
	observation: Observation | null;
	outcome: StoryOutcome | GateOutcome | null;
}>;

/** Run one synthesized portable pattern gate case (`spec.md` §4.3). */
export async function runGateInRuntime(
	capture: GateCaptureFn,
	defaultTimeoutMs: number,
	gateCase: SynthesizedGateCase,
	parsed: RunRequest,
	options: {
		capture?: SuiteCapture;
		reuseBundle?: boolean;
	} = {}
): Promise<GateRun> {
	const effective = effectiveGateContext(gateCase.gate, parsed.context);
	const outOfContextReason = checkImplementationContexts(effective, gateCase.contexts);
	if (outOfContextReason !== undefined) {
		return {
			id: gateCase.id,
			outcome: { status: 'out-of-context', reason: outOfContextReason, failures: [] },
			observation: null,
		};
	}
	const captureMode = options.capture ?? parsed.capture ?? 'none';
	try {
		const { observation, outcome } = await capture(
			{
				id: gateCase.setupEntry.id,
				checkpoint: 'after-run',
				context: effective,
				...(parsed.screenshot !== undefined ? { screenshot: parsed.screenshot } : {}),
				timeoutMs: parsed.timeoutMs ?? defaultTimeoutMs,
			},
			{
				capture: captureMode,
				reuseBundle: options.reuseBundle,
				gate: {
					id: gateCase.id,
					targets: gateCase.setup.targets,
					scenario: gateCase.gate.scenario,
					events: gateCase.events,
				},
			}
		);
		if (!outcome || 'a11y' in outcome) {
			throw new Error('The host returned no gate outcome for the run');
		}
		return { id: gateCase.id, outcome, observation };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			id: gateCase.id,
			outcome: {
				status: 'failed',
				failures: [{ stepId: 'mount', kind: 'render', message }],
			},
			observation: null,
		};
	}
}

/** Suggest specimens or placeholder pattern gate setups for a component or tagless consumer case. */
export async function suggestInRuntime(
	config: LoadedConfig,
	coverage: (request: CoverageRequest) => Promise<CoverageRun>,
	rawRequest: SuggestRequest
): Promise<SuggestRun> {
	const started = performance.now();
	const { component, pattern, gaps, ...limits } = parseSuggestRequest(rawRequest);
	const localLibrary = config.config.pack?.library;
	if (component === undefined) {
		return {
			...suggestSpecimens(undefined, gaps ?? [], {
				patterns: config.patterns,
				localLibrary,
				...(pattern ? { patternFilter: pattern } : {}),
			}),
			elapsedMs: performance.now() - started,
		};
	}
	const known = config.schemas[component];
	if (!known) throw new Error(`The manifest does not describe ${component}.`);
	let wanted = gaps;
	if (wanted === undefined) {
		const report = await coverage({
			component,
			...(pattern ? { pattern } : {}),
			...limits,
		});
		const schemaGaps = report.components
			.flatMap((item) => item.obligations)
			.filter((item) => item.level !== 'verified' && !item.waiver)
			.map((item) => item.id);
		const componentImpls = (report.patterns?.implementations ?? []).filter(
			(impl) => impl.kind === 'component' && impl.tag === component
		);
		const localLib = localLibrary ?? DEFAULT_PATTERN_LIBRARY;
		// Count keep-id occurrences across all configured patterns in each library so intra-library
		// collisions are qualified even when the component implements only one of those patterns.
		const keepCountsByLib = new Map<string, number>();
		const bumpKeep = (lib: string, id: string) => {
			const k = `${lib}\0${id}`;
			keepCountsByLib.set(k, (keepCountsByLib.get(k) ?? 0) + 1);
		};
		for (const localPat of config.patterns?.patterns ?? []) {
			for (const keep of localPat.keep ?? []) bumpKeep(localLib, keep.id);
		}
		for (const extPat of Object.values(config.patterns?.external ?? {})) {
			for (const keep of extPat.data.keep ?? []) bumpKeep(extPat.library, keep.id);
		}
		const patternGaps = componentImpls.flatMap((impl) =>
			impl.keep
				.filter((item) => item.level === 'missing')
				.map((item) => {
					const ambiguousInLib =
						(keepCountsByLib.get(`${impl.patternLibrary}\0${item.id}`) ?? 0) > 1;
					const idPart = ambiguousInLib ? `${impl.pattern}:${item.id}` : item.id;
					const isLocal =
						impl.patternLibrary === localLib &&
						(config.patterns?.patterns.some((pat) => pat.pattern === impl.pattern) ?? false);
					return isLocal
						? `${PATTERN_GAP_PREFIX}${idPart}`
						: `${PATTERN_GAP_PREFIX}${impl.patternLibrary}/${idPart}`;
				})
		);
		wanted = [...schemaGaps, ...patternGaps];
	}
	return {
		...suggestSpecimens(known, wanted, {
			patterns: config.patterns,
			localLibrary,
			...(pattern ? { patternFilter: pattern } : {}),
		}),
		elapsedMs: performance.now() - started,
	};
}
