import type { FormExpectation, SpecimenContext, ValidityExpectation } from './types.js';

/** Public contracts for pattern files, portable gates, guide links and setup bindings. */

export type PatternScope = 'control' | 'composition';
export type PatternStatus = 'stable' | 'preview' | 'deprecated';

export interface PatternStatement {
	/** Matches `PACK_PATTERNS.id` (e.g., `select.keep.escape-closes`). Unique across all guides, rules, and patterns in the library. */
	id: string;
	/** Single-line text, 1..240 Unicode code points, no controls or bidi overrides. */
	text: string;
}

export interface PatternKeepStatement extends PatternStatement {
	/** Optional gate key declared in `gates`. When absent, the keep statement's basis is `ungated`. */
	gate?: string;
}

export interface PatternTarget {
	/** One ARIA role or 1..8 unique ARIA roles. Each matches `PACK_PATTERNS.role`. */
	role: string | string[];
	/** Exact accessible name match (single-line, 1..160 code points). Mutually exclusive with `nameStartsWith` and `nameContains`. */
	name?: string;
	/** Accessible name prefix match (single-line, 1..160 code points). Mutually exclusive with `name` and `nameContains`. */
	nameStartsWith?: string;
	/** Accessible name substring match (single-line, 1..160 code points). Mutually exclusive with `name` and `nameStartsWith`. */
	nameContains?: string;
}

export interface PatternSetup {
	/** Human/agent description of the arrangement an implementation must mount (single-line, 1..240 code points). */
	text: string;
	/** Named portable targets resolved in the mounted setup (1..16 entries; keys match `PACK_PATTERNS.alias`). */
	targets: Record<string, PatternTarget>;
}

export type PortableAction =
	| { click: string }
	| { focus: string }
	| { hover: string }
	| { fill: string; value: string }
	| {
			/** Keyboard key or chord (e.g. `'Escape'`, `'ArrowDown'`, `'Enter'`, `'Tab'`, `'Shift+Tab'`, `'End'`). */
			press: string;
			/** Optional target alias to focus before sending the key; omitted sends to the active element. */
			target?: string;
	  };

export type StandardDomEvent = 'input' | 'change' | 'submit' | 'reset';

export interface PortableEventExpectation {
	event: StandardDomEvent;
	target?: string;
	since: string;
	timeoutMs?: number;
	absent?: boolean;
}

export interface A11yExpectation {
	target: string;
	a11y: {
		role?: string | string[];
		/** Exact accessible name match (mutually exclusive with `nameNonEmpty` and `nameContains`). */
		name?: string;
		/** Asserts non-empty accessible name (mutually exclusive with `name`). */
		nameNonEmpty?: boolean;
		/** Case-sensitive substring match on accessible name (mutually exclusive with `name`). */
		nameContains?: string;
		expanded?: boolean;
		selected?: boolean;
		checked?: boolean | 'mixed';
		pressed?: boolean | 'mixed';
		disabled?: boolean;
		/** `true` matches CDP `true`, `'grammar'`, or `'spelling'`; `false` matches absent or `false`. */
		invalid?: boolean | 'grammar' | 'spelling';
		readonly?: boolean;
		required?: boolean;
		/** Heading/treeitem ARIA level (integer 1..6). */
		level?: number;
	};
	/** Integer 1..60_000 ms (defaults to 1_000 ms). */
	timeoutMs?: number;
}

export interface FocusExpectation {
	target: string;
	/** `true`: target (or its resolved shadow-tree element) holds active focus; `false`: it does not. */
	focus: boolean;
	/** Integer 1..60_000 ms (defaults to 1_000 ms). */
	timeoutMs?: number;
}

export interface LayoutExpectation {
	target: string;
	layout: {
		/** Element box height >= `minHeight` CSS pixels (positive number <= 8192). */
		minHeight?: number;
		/** Element box width >= `minWidth` CSS pixels (positive number <= 8192). */
		minWidth?: number;
		/** `scrollWidth <= clientWidth + 1` and box stays within mount container horizontal bounds (+1 px tolerance). */
		noOverflow?: boolean;
		/** Computed `marginTop`, `marginRight`, `marginBottom`, `marginLeft` all equal `0`. */
		noOuterMargin?: boolean;
	};
	/** Integer 1..60_000 ms (defaults to 1_000 ms). */
	timeoutMs?: number;
}

export type PortableExpectation =
	| PortableEventExpectation
	| Omit<FormExpectation, 'id'>
	| Omit<ValidityExpectation, 'id'>
	| A11yExpectation
	| FocusExpectation
	| LayoutExpectation;

export type PortableScenarioStep =
	| { id: string; action: PortableAction }
	| { id: string; expect: PortableExpectation };

export interface PatternGate {
	/** Key declared in `setups`. */
	setup: string;
	/** Optional Specimen context overrides for this gate (`viewport`, `container`, `theme`, `locale`, `reducedMotion`, `motion`). */
	context?: Partial<Omit<SpecimenContext, 'themeMedia'>>;
	/** Portable scenario steps (1..32 steps). */
	scenario: PortableScenarioStep[];
}

export interface PatternFile {
	/** Matches `PACK_PATTERNS.pattern`. Must equal the parent directory name when using the default layout. */
	pattern: string;
	/** One-line summary (1..160 code points). Optional in the static schema so skeleton patterns validate cleanly. */
	summary?: string;
	/** Defaults to `'stable'` when omitted in source; required in pack format 2. */
	status?: PatternStatus;
	/** Allowed only when `status === 'deprecated'`. Same-library `<pattern>` or cross-library `<library>/<pattern>`. */
	replacedBy?: string;
	scope: PatternScope;
	/**
	 * Facet map for deterministic discovery (max 8 keys, 1..16 unique sorted values per key).
	 * Standard keys: `purpose`, `structure`, `context`, `behavior`. Custom keys allowed if matching `PACK_PATTERNS.facetKey`.
	 */
	facets?: Record<string, string[]>;
	useWhen?: PatternStatement[];
	avoidWhen?: PatternStatement[];
	keep?: PatternKeepStatement[];
	customize?: PatternStatement[];
	setups?: Record<string, PatternSetup>;
	gates?: Record<string, PatternGate>;
}

export type GuidePatternClaim = string | { library: string; pattern: string };

export interface ImplementationContexts {
	/** Inclusive viewport bounds (CSS pixels) this implementation supports. When present, at least one bound must be set. */
	viewport?: {
		minWidth?: number;
		maxWidth?: number;
		minHeight?: number;
		maxHeight?: number;
	};
	/** Supported themes: 1..3 unique values in ascending order (`dark`, `high-contrast`, `light`). */
	themes?: ('dark' | 'high-contrast' | 'light')[];
	/** Required one-line explanation of why the implementation is scoped (1..240 code points). */
	reason: string;
}

export interface PatternSetupBinding {
	/** Owning library when binding to an external pattern from `patternSources`. */
	library?: string;
	/** Pattern id (`PACK_PATTERNS.pattern`). */
	pattern: string;
	/** Setup key declared in the pattern's `setups`. */
	setup: string;
}
