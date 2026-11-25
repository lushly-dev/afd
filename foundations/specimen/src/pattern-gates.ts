import { isAbsolute, relative, sep } from 'node:path';
import type { LoadedGuides } from './guides.js';
import { PACK_PATTERNS } from './pack-schema.js';
import type { LoadedPatterns } from './patterns.js';
import type {
	EventDeclaration,
	ImplementationContexts,
	PatternFile,
	PatternGate,
	PatternSetup,
	SpecimenContext,
	SpecimenEntry,
	SpecimenListFilter,
	SpecimenListPatternMeta,
} from './types.js';
import { parseContext } from './validate.js';

/** Fallback owning library name when local patterns are authored without `pack.library`. */
export const DEFAULT_PATTERN_LIBRARY = 'local';

const DEFAULT_GATE_CONTEXT: SpecimenContext = {
	viewport: { width: 1280, height: 720 },
	theme: 'light',
	locale: 'en-US',
	reducedMotion: 'no-preference',
	motion: 'natural',
};

/** One synthesized native gate case derived from a bound setup case and a pattern gate. */
export interface SynthesizedGateCase {
	id: string;
	title: string;
	/** Pattern file path relative to the bench root, without a leading `./`. */
	file: string;
	component?: string;
	patternLibrary: string;
	pattern: string;
	setupName: string;
	gateName: string;
	setupEntry: SpecimenEntry;
	setup: PatternSetup;
	gate: PatternGate;
	/** Applicable context limits from the setup entry and, when named, its component guide. */
	contexts: ImplementationContexts[];
	/** Standard DOM events referenced by `expect.event` steps in the gate scenario. */
	events: EventDeclaration[];
	/** List-facing entry shape (`kind: 'gate'`) for `specimen-list` and `specimen-capture` skipping. */
	entry: SpecimenEntry;
}

export interface ResolvedPatternTarget {
	library: string;
	pattern: string;
	/** Pattern file path relative to the bench root, without a leading `./`. */
	file: string;
	data: PatternFile;
}

export function parsePatternFilter(ref: string): { library?: string; pattern: string } {
	const slash = ref.indexOf('/');
	if (slash < 0) return { pattern: ref };
	return { library: ref.slice(0, slash), pattern: ref.slice(slash + 1) };
}

export function matchesPatternRef(library: string, pattern: string, filterRef: string): boolean {
	const parsed = parsePatternFilter(filterRef);
	if (parsed.library !== undefined) {
		return library === parsed.library && pattern === parsed.pattern;
	}
	return pattern === parsed.pattern;
}

function normalizePatternFilePath(root: string, filePath: string): string {
	if (filePath.startsWith('./')) return filePath.slice(2);
	if (!isAbsolute(filePath)) return filePath.replaceAll('\\', '/');
	const rel = relative(root, filePath);
	if (isAbsolute(rel)) {
		return filePath.split(sep).join('/');
	}
	return rel.split(sep).join('/');
}

/** Resolve a setup binding or guide claim against loaded local and external patterns. */
export function resolvePatternTarget(
	patterns: LoadedPatterns | undefined,
	localLibrary: string | undefined,
	root: string,
	ref: { library?: string; pattern: string }
): ResolvedPatternTarget | undefined {
	if (!patterns) return undefined;
	const localLib = localLibrary ?? DEFAULT_PATTERN_LIBRARY;
	const findLocal = (): ResolvedPatternTarget | undefined => {
		const found = patterns.patterns.find((item) => item.pattern === ref.pattern);
		if (!found) return undefined;
		return {
			library: localLib,
			pattern: found.pattern,
			file: normalizePatternFilePath(root, found.file),
			data: found,
		};
	};
	if (ref.library === undefined) return findLocal();
	if (localLibrary !== undefined && ref.library === localLibrary) {
		const local = findLocal();
		if (local) return local;
	}
	const ext = patterns.external[`${ref.library}/${ref.pattern}`];
	if (!ext) return undefined;
	return {
		library: ext.library,
		pattern: ext.pattern,
		file: normalizePatternFilePath(root, ext.file),
		data: ext.data,
	};
}

/** Collect unique standard DOM event declarations needed by a gate's `expect.event` steps. */
export function gateEventDeclarations(gate: PatternGate): EventDeclaration[] {
	const seen = new Set<string>();
	const events: EventDeclaration[] = [];
	for (const step of gate.scenario) {
		if (!('expect' in step) || !('event' in step.expect)) continue;
		const type = step.expect.event;
		const target = step.expect.target;
		const key = `${type}\0${target ?? ''}`;
		if (seen.has(key)) continue;
		seen.add(key);
		events.push(target === undefined ? { type } : { type, target });
	}
	return events;
}

/** Synthesize native gate cases for every valid bound setup case (native or play-free story). */
export function synthesizeGateCases(options: {
	root: string;
	entries: readonly SpecimenEntry[];
	patterns: LoadedPatterns | undefined;
	guides: LoadedGuides | undefined;
	localLibrary?: string;
}): SynthesizedGateCase[] {
	const { root, entries, patterns, guides, localLibrary } = options;
	if (!patterns) return [];
	const explicitIds = new Set(entries.map((entry) => entry.id));
	const seenGateIds = new Set<string>();
	const guideByTag = new Map((guides?.components ?? []).map((guide) => [guide.tag, guide]));
	const synthesized: SynthesizedGateCase[] = [];

	for (const entry of entries) {
		const binding = entry.patternSetup;
		if (!binding) continue;
		// Only stories statically confirmed play-free (`play === 'absent'`) may serve as setups.
		if (entry.story !== undefined && entry.story.play !== 'absent') continue;
		const target = resolvePatternTarget(patterns, localLibrary, root, binding);
		if (!target) continue;
		const setup = target.data.setups?.[binding.setup];
		if (!setup) continue;
		const gates = target.data.gates;
		if (!gates) continue;

		const contexts: ImplementationContexts[] = [];
		if (entry.contexts) contexts.push(entry.contexts);
		const guideContexts = entry.component ? guideByTag.get(entry.component)?.contexts : undefined;
		if (guideContexts) contexts.push(guideContexts);

		const orderedGates = Object.entries(gates).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0
		);
		for (const [gateName, gate] of orderedGates) {
			if (gate.setup !== binding.setup) continue;
			const id = `${entry.id}--gate--${gateName}`;
			if (!PACK_PATTERNS.story.test(id) || id.length > 200) continue;
			if (explicitIds.has(id) || seenGateIds.has(id)) continue;
			seenGateIds.add(id);
			const title = `${target.pattern} / ${gateName}`;
			const patternMeta: SpecimenListPatternMeta = {
				library: target.library,
				pattern: target.pattern,
				setup: binding.setup,
				gate: gateName,
			};
			const gateEntry: SpecimenEntry = {
				id,
				title,
				module: target.file,
				exportName: gateName,
				kind: 'gate',
				...(entry.component ? { component: entry.component } : {}),
				pattern: patternMeta,
			};
			synthesized.push({
				id,
				title,
				file: target.file,
				...(entry.component ? { component: entry.component } : {}),
				patternLibrary: target.library,
				pattern: target.pattern,
				setupName: binding.setup,
				gateName,
				setupEntry: entry,
				setup,
				gate,
				contexts,
				events: gateEventDeclarations(gate),
				entry: gateEntry,
			});
		}
	}

	return synthesized;
}

/** Merge `gate.context` over `requestContext` over the default Specimen context. */
export function effectiveGateContext(
	gate: PatternGate,
	requestContext?: Partial<SpecimenContext>
): SpecimenContext {
	return parseContext({
		...DEFAULT_GATE_CONTEXT,
		...requestContext,
		...(gate.context ?? {}),
	}) as SpecimenContext;
}

/**
 * Check whether an effective context falls outside any declared `ImplementationContexts`.
 * Returns the first violated context's `reason`, or `undefined` when in context.
 */
export function checkImplementationContexts(
	effective: SpecimenContext,
	contextsList: readonly ImplementationContexts[]
): string | undefined {
	for (const ctx of contextsList) {
		if (ctx.viewport) {
			const { minWidth, maxWidth, minHeight, maxHeight } = ctx.viewport;
			if (minWidth !== undefined && effective.viewport.width < minWidth) return ctx.reason;
			if (maxWidth !== undefined && effective.viewport.width > maxWidth) return ctx.reason;
			if (minHeight !== undefined && effective.viewport.height < minHeight) return ctx.reason;
			if (maxHeight !== undefined && effective.viewport.height > maxHeight) return ctx.reason;
		}
		if (ctx.themes && !ctx.themes.includes(effective.theme)) {
			return ctx.reason;
		}
	}
	return undefined;
}

/** Attach `kind` and setup-case `pattern` metadata for `specimen-list`. */
export function listEntriesOf(
	entries: readonly SpecimenEntry[],
	gateCases: readonly SynthesizedGateCase[] = [],
	localLibrary?: string
): SpecimenEntry[] {
	const localLib = localLibrary ?? DEFAULT_PATTERN_LIBRARY;
	const base = entries.map((entry): SpecimenEntry => {
		const kind = entry.job ? 'job' : entry.story ? 'story' : 'native';
		const pattern: SpecimenListPatternMeta | undefined = entry.patternSetup
			? {
					library: entry.patternSetup.library ?? localLib,
					pattern: entry.patternSetup.pattern,
					setup: entry.patternSetup.setup,
				}
			: undefined;
		return {
			...entry,
			kind,
			...(pattern ? { pattern } : {}),
		};
	});
	return [...base, ...gateCases.map((gateCase) => gateCase.entry)];
}

/** Match an entry against a `specimen-list` `kind` filter, preserving legacy `component` / `job` filters. */
export function matchesListKind(
	entry: SpecimenEntry,
	kind: NonNullable<SpecimenListFilter['kind']>
): boolean {
	const entryKind = entry.kind ?? (entry.job ? 'job' : entry.story ? 'story' : 'component');
	if (kind === 'gate') return entryKind === 'gate';
	if (kind === 'job') return entryKind === 'job' || entry.job !== undefined;
	if (kind === 'story')
		return entryKind === 'story' || (entryKind !== 'gate' && entry.story !== undefined);
	if (kind === 'native')
		return entryKind === 'native' || (entryKind !== 'gate' && !entry.story && !entry.job);
	// Legacy `kind: 'component'`: non-job, non-gate entries (native specimens and stories).
	return entryKind !== 'job' && entryKind !== 'gate' && entry.job === undefined;
}

/** Filter and cursor-paginate `specimen-list` entries (`spec.md` §4.2). */
export function filterAndPaginateListEntries<T extends SpecimenEntry>(
	entries: readonly T[],
	filter?: SpecimenListFilter,
	localLibrary?: string
): { specimens: T[]; next?: string } {
	const localLib = localLibrary ?? DEFAULT_PATTERN_LIBRARY;
	let filtered: T[] = [...entries];

	if (filter?.kind !== undefined) {
		const wantedKind = filter.kind;
		filtered = filtered.filter((entry) => matchesListKind(entry, wantedKind));
	}
	if (filter?.component !== undefined) {
		filtered = filtered.filter((entry) => entry.component === filter.component);
	}
	if (filter?.pattern !== undefined) {
		const wantedPattern = filter.pattern;
		filtered = filtered.filter((entry) => {
			if (entry.pattern) {
				return matchesPatternRef(entry.pattern.library, entry.pattern.pattern, wantedPattern);
			}
			if (entry.patternSetup) {
				return matchesPatternRef(
					entry.patternSetup.library ?? localLib,
					entry.patternSetup.pattern,
					wantedPattern
				);
			}
			return false;
		});
	}
	if (filter?.match !== undefined) {
		const needle = filter.match.toLowerCase();
		filtered = filtered.filter(
			(entry) =>
				entry.id.toLowerCase().includes(needle) || entry.title.toLowerCase().includes(needle)
		);
	}
	if (filter?.after !== undefined) {
		const index = filtered.findIndex((entry) => entry.id === filter.after);
		if (index < 0) {
			throw new Error(`Unknown list pagination cursor: '${filter.after}'.`);
		}
		filtered = filtered.slice(index + 1);
	}
	if (filter?.limit !== undefined) {
		const page = filtered.slice(0, filter.limit);
		const hasMore = filtered.length > filter.limit;
		const last = page.at(-1);
		return {
			specimens: page,
			...(hasMore && last ? { next: last.id } : {}),
		};
	}
	return { specimens: filtered };
}
