# Patterns: Phase A specification

| Field | Value |
| --- | --- |
| Epic | [#1073](https://github.com/lushly-dev/afd/issues/1073) |
| Phase A issue | [#2133](https://github.com/lushly-dev/afd/issues/2133) |
| Proposal & status | [`patterns.proposal.md`](patterns.proposal.md), [`STATUS.md`](STATUS.md) |
| Companion amendments | [Umbel `components` plugin spec (Amendment A31)](../../../../endpoints/umbel/docs/plugins/components/spec.md#amendment-a31-patterns-and-saved-copies-1073), [Design Decisions proposal (gate-case skip)](../design-decisions/design-decisions.proposal.md) |
| Normative baseline | `foundations/specimen/docs/pack-format.md` (format 1), `foundations/specimen/src/{types,schema,pack-types,pack-schema,guide-schema,guides,validate}.ts`, `integrations/specimen-afd/src/commands.ts` |
| Elevation | Exact schemas, identifier forms, limits, wire contracts, error codes, and exit checks. Implementing agents in Phases B–D need no further design decisions; any gap stops and amends this specification by pull request |

## Status

- **State:** Phase A draft ready for owner review and approval (2026-11-22), authored after the owner's step 0.5 **go with changes** decision on [#1966](https://github.com/lushly-dev/afd/issues/1966) (findings merged in [#2122](https://github.com/lushly-dev/afd/pull/2122)).
- **Scope boundary:** Phases B–D remain gated on Phase A exit (owner approval of this specification, Amendment A31, the Design Decisions amendment, and verified scenario checks). `foundations/specimen/docs/pack-format.md` remains version 1 until Phase B5 lands pack format 2 in `@lushly-dev/specimen`, so existing shipped package docs and CI paths stay accurate until code implements format 2.
- **Scenarios:** All ten scenarios in [`scenarios/`](scenarios/) are revised to these exact contracts.

### Phase 0 adjustments and deferred Phase A items

Every adjustment proved in Phase 0 ([#1966](https://github.com/lushly-dev/afd/issues/1966)) and every item deferred from the proposal walkthrough/review ([#2020](https://github.com/lushly-dev/afd/pull/2020)) is folded into this specification:

| # | Origin | Requirement | Normative section |
| --- | --- | --- | --- |
| P0-1 | Step 0.1 | Role sets (`role: string \| string[]`) and prefix/substring name matchers (`nameStartsWith`, `nameContains`) on pattern setup targets | [§2.4](#24-setup-targets) |
| P0-2 | Step 0.1 | Host-climb to enclosing form-associated custom element for `validity`, and custom element host box for `layout` | [§3.2](#32-expectations-and-host-climb) |
| P0-3 | Step 0.1 | Structured ARIA states (including `invalid`) on `ElementObservation.accessibility` from CDP `Accessibility.getFullAXTree` (capture 0.10; focus confirmed via `state.focused`) | [§3.4](#34-capture-010-structured-aria-states) |
| P0-4 | Step 0.1 | Upgrade `foundations/specimen/fixtures/pack-library/{select,field}.js` stubs with `tabindex`, keyboard handling, text editing, and `checkValidity()` before Slice 1 exit | [§7](#7-phase-deliverables-and-measurement-gates) |
| P0-5 | Step 0.2 | Zero console/page errors required for `complete` copies; external theme `tokens` & optional `themeStylesheet` on copy records; `pack.localElements` / local CEM for apps without a CEM | [§1.2](#12-benchconfig-extensions-specimenconfigjson), [§5.1](#51-specimen-pattern-save), [§6.5](#65-copy-record-datalibrarypatternspatternnamejson-slice-2) |
| P0-6 | Step 0.4 | Shed `content.patterns[].customize` before `usage` and use compact same-library string pattern links (`"patterns": ["field"]`) in `components-brief` | [Amendment A31](../../../../endpoints/umbel/docs/plugins/components/spec.md#amendment-a31-patterns-and-saved-copies-1073) |
| P0-7 | Step 0.3 | Re-measure builder accuracy, tokens, and cost on `dialog.modal` in Step D1 | [§7](#7-phase-deliverables-and-measurement-gates) |
| PA-1 | Walk / Review | Pattern and copy deprecation (`status: "deprecated"`, `replacedBy`) | [§2.1](#21-schema-patternjson), [§6.4](#64-pattern-record-datalibrarypatternspatternjson-slice-1), [§6.5](#65-copy-record-datalibrarypatternspatternnamejson-slice-2) |
| PA-2 | Walk / Review | `complete` → `draft` downgrade guard on `specimen-pattern-save { replace: true }` (`COPY_DOWNGRADE_REFUSED`, `allowDowngrade: true`) | [§5.1](#51-specimen-pattern-save) |
| PA-3 | Walk / Review | Batch stale copy refresh (`specimen-pattern-save { refreshStale: true }`) | [§5.1](#51-specimen-pattern-save) |
| PA-4 | Walk / Review | `patternLibrary` field naming on `specimen-coverage` `patterns.implementations[]` | [§4.4](#44-coverage-patterns1-specimen-coverage) |
| PA-5 | Walk / Review | Static validation codes `GATE_UNKNOWN` and `TARGET_UNKNOWN` alongside `GATE_NOT_PORTABLE`, `PATTERN_UNKNOWN`, `SETUP_UNKNOWN`, `DUPLICATE_ID` | [§2.6](#26-static-validation-specimen-validate) |
| PA-6 | Walk / Review | Revision change notes (`changeNote`) on saved copies and facet key governance | [§2.1](#21-schema-patternjson), [§5.1](#51-specimen-pattern-save), [§6.5](#65-copy-record-datalibrarypatternspatternnamejson-slice-2) |
| PA-7 | Walk / Review | Outdated-copy warnings in `components-check`, `out-of-context` vs `minimum_basis`, and `render: "text"` quoting | [Amendment A31](../../../../endpoints/umbel/docs/plugins/components/spec.md#amendment-a31-patterns-and-saved-copies-1073) |
| PA-8 | Walk / Review | Unfiltered `specimen-capture` skips Pattern gate cases (`<case>--gate--<gate>`) | [Design Decisions §5, §6.2, §7](../design-decisions/design-decisions.proposal.md) |

---

## 1. Repository Layout and Configuration

### 1.1 Committed vs local paths

Aligned with sibling Specimen proposals ([`patterns.proposal.md` §5.0](patterns.proposal.md#50-shared-conventions-aligned-with-sibling-proposals)):

- **Committed pattern files:** `specimens/patterns/<pattern>/pattern.json` (default; configurable via `patterns` globs in `specimen.config.json`).
- **Committed saved copies (Slice 2):** `specimens/patterns/<pattern>/copies/<name>.{html,css,json}` beside the pattern file, under the configured patterns root.
- **Local ephemeral data:** `.specimen/` (ignored by root `.gitignore`, `#1132`): remount screenshots, scratch exports, and run caches.
- **Commands never run `git commit`.** Every command that writes files (`specimen-pattern-save`, `specimen-pack`, `specimen-pack-export`) is declared `mutation: true`.
- **Single MCP host:** `endpoints/specimen-server` (`#1320`); Patterns adds no review UI or separate server.

### 1.2 `BenchConfig` extensions (`specimen.config.json`)

Extends `BenchConfig` (`foundations/specimen/src/types.ts:223`) and `PackConfig` (`foundations/specimen/src/pack-types.ts:4`) with strict keys (`additionalProperties: false`):

```ts
export interface BenchConfigPatternsExtension {
	/**
	 * Globs finding local pattern files, relative to the configuration file.
	 * Uses the same glob dialect as `guides` (`*`, whole-segment `**`, `?`, `{a,b}`).
	 * Defaults to `['specimens/patterns/*/pattern.json']` when omitted and the directory exists.
	 */
	patterns?: string[];
	/**
	 * External libraries whose patterns and gates this project may claim and run locally
	 * with no network call. Each entry is a relative path to a committed or exported pack
	 * root directory, or an npm package specifier whose `package.json` exports `./pack`
	 * (resolved via Node module resolution from the configuration directory).
	 */
	patternSources?: string[];
}

export interface PackConfigPatternsExtension {
	/**
	 * Paths to dependency Custom Elements Manifests (or exported pack roots) describing
	 * third-party custom elements used in saved copies (e.g., an application consuming
	 * `@lushly-dev/violet-elements`). Required when the project has no `manifest` of its own
	 * and saves copies.
	 */
	dependencies?: string[];
	/**
	 * App-local custom elements for applications without a full Custom Elements Manifest
	 * (Adjustment P0-5, e.g., Loam's `loam-*` tags). Admitted during `specimen-pattern-save`
	 * so app-local elements are not stripped as `unmanifested-element`.
	 */
	localElements?: {
		/** Optional relative path to a local Custom Elements Manifest JSON file. */
		manifest?: string;
		/** Optional explicit list of app-local custom element tags (each matches `PACK_PATTERNS.tag`, max 256). */
		tags?: string[];
	};
	/**
	 * Optional theme stylesheet specifier or repo-relative path required to render saved
	 * copies with their intended tokens (recorded as `themeStylesheet` on saved copies
	 * when external custom properties are referenced; Adjustment P0-5).
	 */
	themeStylesheet?: string;
}
```

Configuration validation rules (`foundations/specimen/src/validate.ts`):

- `patterns` and `patternSources` may be set even when `manifest` is absent (so consumer applications like Loam can run portable gates and save copies without a library CEM).
- `pack` without `manifest` is valid **only** when `patterns` is configured and at least one of `pack.dependencies` or `pack.localElements` is set (an application pack holding patterns and copies, with `components: []` in its catalog). When `manifest` is absent, `pack.prefix` remains required and valid (`PACK_PATTERNS.prefix`).
- `pack.localElements` must specify at least one of `manifest` or non-empty `tags`. Every tag in `pack.localElements.tags` must match `PACK_PATTERNS.tag` with no duplicates.

---

## 2. Pattern File Schema and Static Validation

### 2.1 Schema (`pattern.json`)

Published as `@lushly-dev/specimen/pattern.schema.json` (JSON Schema draft 2020-12) alongside `@lushly-dev/specimen/guide/*.schema.json`. Every object is strict (`additionalProperties: false`); see [§8](#8-amendment-agent-first-design-phase-a-approved-2026-11-24) for the 2026-11-24 optional `approvalStatus`, `derivedFrom` and `waivedKeep` additions:

```ts
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
	/** One ARIA role or 1..8 unique ARIA roles (Adjustment P0-1). Each matches `PACK_PATTERNS.role`. */
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

export interface PatternGate {
	/** Key declared in `setups`. */
	setup: string;
	/** Optional Specimen context overrides for this gate (`viewport`, `container`, `theme`, `locale`, `reducedMotion`, `motion`). */
	context?: Partial<SpecimenContext>;
	/** Portable scenario steps (1..32 steps; §3). */
	scenario: PortableScenarioStep[];
}

export interface PatternFile {
	/** Matches `PACK_PATTERNS.pattern`. Must equal the parent directory name when using the default layout. */
	pattern: string;
	/** One-line summary (1..160 code points). Optional in the static schema so skeleton patterns validate cleanly; `specimen-pattern-save` reports an absent summary in `gaps`. */
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
	useWhen?: PatternStatement[];    // max 32
	avoidWhen?: PatternStatement[];  // max 32
	keep?: PatternKeepStatement[];   // max 64
	customize?: PatternStatement[];  // max 32
	setups?: Record<string, PatternSetup>; // max 16
	gates?: Record<string, PatternGate>;   // max 64
}
```

**Facet governance (PA-6):** Four standard keys (`purpose`, `structure`, `context`, `behavior`) cover common discovery axes. Libraries may add domain-specific facet keys matching `PACK_PATTERNS.facetKey` without a schema bump; Umbel computes `content.availableFacets` dynamically from the touched libraries' catalogs so callers discover valid facet keys and values at run time.

**Deprecation rule (PA-1):** `replacedBy` is refused (`PATTERN_SCHEMA_INVALID` / `SCHEMA_INVALID`) unless `status === 'deprecated'`. A same-library `replacedBy` must reference an existing pattern in the same library; a cross-library `<library>/<pattern>` reference must match `<library>` + `/` + `<pattern>` identifier forms.

### 2.2 Identifier forms (ASCII-only)

Every new identifier form uses an ASCII-only alphabet with no `\d`, `\w`, or `\s` so ECMAScript (`RegExp`) and Rust (`regex`, Unicode disabled) agree identically:

| Kind | Key in `PACK_PATTERNS` | Identifier form | Longest |
| --- | --- | --- | ---: |
| Pattern id | `pattern` | `^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$` | 64 |
| Qualified pattern ref | `qualifiedPattern` | `^[a-z][a-z0-9-]{0,63}/[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$` (split on `/` and enforce `library` <= 64 and `pattern` <= 64 independently) | 129 |
| Copy name | `copyName` | `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` | 64 |
| Setup id | `setup` | `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` | 64 |
| Gate id | `gate` | `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` | 64 |
| Target alias | `alias` | `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` | 64 |
| Facet key | `facetKey` | `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` | 64 |
| Facet value | `facetValue` | `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` | 64 |
| Step id | `stepId` | `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` | 64 |

All 20 format-1 identifier forms (`library`, `tag`, `prefix`, `element`, `id`, `version`, `digest`, `revision`, `package`, `specifier`, `story`, `attribute`, `property`, `slot`, `event`, `command`, `cssProperty`, `state`, `role`, `axeRule`) remain unchanged.

### 2.3 Text limits (`PACK_TEXT_LIMITS`)

| Text kind | Longest (Unicode code points) | Lines |
| --- | ---: | --- |
| `summary`, accessible name matcher | 160 | single |
| `statement`, `setup.text`, `changeNote`, `contexts.reason` | 240 | single |
| `copyHtml` (saved copy `.html`) | 16 000 | multi |
| `copyCss` (saved copy `.css`) | 8 000 | multi |

Single-line and multi-line character restrictions (no C0/DEL/C1 controls, no bidi overrides/isolates, no lone surrogates; multi-line permits `\t` and `\n`) are identical to `foundations/specimen/src/pack-schema.ts:76-108`.

### 2.4 Setup targets

*(Phase 0.1 adjustment P0-1.)*

A pattern setup target resolves across the live accessibility tree of the mounted specimen (including open shadow roots):

1. **Role matching:** If `role` is a string, the node's computed ARIA role must equal `role`. If `role` is an array of strings (1–8 unique roles, e.g. `["combobox", "button"]` or `["textbox", "searchbox"]`), the node's computed ARIA role must be a member of the array.
2. **Accessible name matching:** At most one of `name`, `nameStartsWith`, or `nameContains` may be present (supplying two or more is `PATTERN_SCHEMA_INVALID`). Matching is case-sensitive against the node's computed accessible name:
   - `name`: `node.name === target.name`
   - `nameStartsWith`: `node.name.startsWith(target.nameStartsWith)`
   - `nameContains`: `node.name.includes(target.nameContains)`
   - omitted: any accessible name (including empty) matches.
3. **Uniqueness:** Exactly one element must match in the mounted specimen:
   - `0` matches → fails the step with error code `TARGET_NOT_FOUND`.
   - `>= 2` matches → fails the step with error code `TARGET_AMBIGUOUS` (reporting match count, aligned with Pointing `#2046`).

### 2.5 Component guide extensions

`guideComponentSchema` (`foundations/specimen/src/guide-schema.ts:27`) gains two optional keys:

```ts
export type GuidePatternClaim =
	| string                                     // same-library pattern id (`PACK_PATTERNS.pattern`)
	| { library: string; pattern: string };      // cross-library pattern resolved via `patternSources`

export interface ImplementationContexts {
	/** Inclusive viewport bounds (CSS pixels) this implementation supports. When present, at least one bound must be set. */
	viewport?: {
		minWidth?: number;  // integer 1..8192
		maxWidth?: number;  // integer 1..8192 (must be >= minWidth when both set)
		minHeight?: number; // integer 1..8192
		maxHeight?: number; // integer 1..8192 (must be >= minHeight when both set)
	};
	/** Supported themes: 1..3 unique values in ascending order (`dark`, `high-contrast`, `light`). */
	themes?: ('dark' | 'high-contrast' | 'light')[];
	/** Required one-line explanation of why the implementation is scoped (1..240 code points). */
	reason: string;
}
// Schema refinement: at least one of `viewport` or `themes` must be present on `ImplementationContexts`.

// Added to guideComponentSchema:
// implements?: GuidePatternClaim[];   // max 16, unique by (library, pattern)
// contexts?: ImplementationContexts;
```

### 2.6 Static validation (`specimen-validate`)

`specimen-validate` checks pattern files, guide `implements` links, and setup bindings with **no browser**. Every issue uses Specimen's `ValidationIssue` shape (`severity`, `code`, `message`, `suggestion`, `importPath`, `field`) with bracket array notation (`gates.shows-choice.scenario[0]`, matching `foundations/specimen/src/guides.ts:36`):

| Code | Severity | Condition | Recovery suggestion |
| --- | --- | --- | --- |
| `GATE_NOT_PORTABLE` | `error` | A setup target uses `selector`, or a gate step uses a `state` expectation, a `command` runner step, a `capture` step, or an `event` outside `input`/`change`/`submit`/`reset` | Replace selectors, attribute/property checks, capture steps, and custom events with portable `{ role, name }` targets, `a11y`/`focus`/`layout`/`validity`/`form` expectations, or standard DOM events (`input`, `change`, `submit`, `reset`) |
| `PATTERN_UNKNOWN` | `error` | A guide `implements`, setup binding, or same-library `replacedBy` names a pattern not found in local `patterns` or configured `patternSources` | Use a pattern id present in `specimens/patterns/` or add the owning library to `patternSources` in `specimen.config.json` |
| `SETUP_UNKNOWN` | `error` | A gate's `setup` or a case/copy setup binding names a setup key not declared in the pattern's `setups` | Name one of the pattern's declared `setups` keys, or declare the setup in `pattern.json` |
| `GATE_UNKNOWN` | `error` | A `keep[].gate` references a gate id not declared in the pattern's `gates` | Declare the gate under `gates` in `pattern.json` or remove the `gate` link from the `keep` statement |
| `TARGET_UNKNOWN` | `error` | A gate step's action or expectation references a target alias not declared in its gate's `setup.targets` | Declare the target alias in `setups.<setup>.targets` or fix the target name in the gate step |
| `DUPLICATE_ID` | `error` | Two statements across patterns, component guides, and shared rules in the same library share an `id`; two pattern files declare the same `pattern` id; two steps in one gate share an `id`; or a synthesized gate case id collides with an explicit specimen or story id | Give each statement, pattern, step, and case id a unique id; a statement lives in a pattern or in a guide, never both |
| `PATTERN_SCHEMA_INVALID` | `error` | Missing/unknown key, wrong type, invalid identifier form, `replacedBy` without `status: "deprecated"`, conflicting target/`a11y` name matchers, `event.since` not referencing an earlier step `id` in the same gate (`gates.<gate>.scenario[<i>].expect.since`), or a play-bearing story bound as a pattern setup | Match `@lushly-dev/specimen/pattern.schema.json` |
| `PATTERN_TEXT_TOO_LONG` | `error` | Any pattern text exceeds `PACK_TEXT_LIMITS` | Shorten the text within the pack limit (160 summary, 240 statement/setup) |
| `PATTERN_TEXT_INVALID` | `error` | Control character, line break in single-line text, bidi control, or lone surrogate | Remove control characters, line breaks, and bidirectional overrides |
| `PATTERN_JSON_INVALID` | `error` | Pattern file is not valid UTF-8 JSON | Fix JSON syntax in the pattern file |
| `PATTERN_UNREADABLE` | `error` | Configured `patterns` file or `patternSources` directory cannot be read | Check the path and file permissions in `specimen.config.json` |

---

## 3. Portable Gate Vocabulary and Capture 0.10

### 3.1 Allowed actions

All gate actions operate on target aliases declared in the gate's `setup.targets`:

```ts
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
```

`press` drives Chromium's native `Input.dispatchKeyEvent` (`rawKeyDown` + `char` when printable + `keyUp`) through `specimen-host`, supporting W3C WebDriver / CDP key names and `+`-joined modifiers (`Alt`, `Control`, `Meta`, `Shift`).

### 3.2 Expectations and host-climb

*(Phase 0.1 adjustment P0-2.)*

```ts
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
		/** Case-sensitive substring match on accessible name (mutually exclusive with `name`; matches `PatternTarget.nameContains`). */
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
		/** Element box height >= `minHeight` CSS pixels (positive integer/number <= 8192). */
		minHeight?: number;
		/** Element box width >= `minWidth` CSS pixels (positive integer/number <= 8192). */
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
	| FormExpectation        // existing `foundations/specimen/src/types.ts:89`
	| ValidityExpectation    // existing `foundations/specimen/src/types.ts:96`, with host-climb below
	| A11yExpectation
	| FocusExpectation
	| LayoutExpectation;

export type PortableScenarioStep =
	| { id: string; action: PortableAction }
	| { id: string; expect: PortableExpectation };
```

Every step in a pattern gate **requires** an explicit `id` (`PACK_PATTERNS.stepId`, unique within the gate) so failing runs always report a deterministic `outcome.failures[].stepId`.

**Host-climb rules (Adjustment P0-2, aligned with [Pointing §4.1](../pointing/pointing.proposal.md#41-one-rule-for-what-is-selected)):**

When a portable role target resolves to an element `el` inside one or more open shadow roots (for example, `<button>` inside `<violet-select>` or `<input>` inside `<violet-text-field>`):

| Expectation | Element evaluated | Reason (from Phase 0.1) |
| --- | --- | --- |
| `a11y`, `focus` | `el` itself | ARIA attributes and `shadowRoot.activeElement` live on the interactive element inside the shadow tree |
| `event`, `form` | `el`, climbing to enclosing `formAssociated` host if `el.form === null` | Form-associated custom elements participate via `ElementInternals` on the host, while native controls participate via `el.form` |
| `validity` | Walk `el` → enclosing shadow hosts (`root.host`) until the first custom element with `constructor.formAssociated === true` (or an own `checkValidity` method on a custom element tag containing `-`); otherwise `el` itself | Inner shadow `<button>` returns `checkValidity() === true` even when `<violet-select>.checkValidity() === false` |
| `layout` | Walk `el` → enclosing shadow hosts to the nearest enclosing custom element host (tag containing `-`); if `el` is not inside a shadow root, evaluate `el` itself | Inner shadow `<input>` has height 19 px inside a 36 px `<violet-text-field>` control frame; component height, overflow, and outer margin belong to the host box |

### 3.3 Forbidden constructs

Any of the following inside a pattern file's `setups` or `gates` fails `specimen-validate` with `GATE_NOT_PORTABLE`:

- A setup target containing `selector` (or any non-portable targeting key).
- A `state` expectation (reading a JS property or DOM attribute).
- A `command` step calling a plugin runner.
- An `event` expectation whose `event` is not one of `'input' | 'change' | 'submit' | 'reset'`.
- A `capture` step inside a gate (gate runs control capture via `specimen-run`'s `capture` parameter).

### 3.4 Capture 0.10: structured ARIA states

*(Phase 0.1 adjustment P0-3.)*

Phase B2 bumps `CAPTURE_VERSION` (`foundations/specimen/src/types.ts:5`) from `'0.9'` to `'0.10'` and extends `ElementObservation.accessibility` (`src/types.ts:587`, `src/schema.ts:64`):

```ts
export interface ElementAccessibilityStates {
	checked?: boolean | 'mixed';
	pressed?: boolean | 'mixed';
	selected?: boolean;
	expanded?: boolean;
	disabled?: boolean;
	invalid?: boolean | 'grammar' | 'spelling';
	readonly?: boolean;
	required?: boolean;
	level?: number;
}

// On ElementObservation:
accessibility?: {
	role: string;
	name: string;
	/** Present only when at least one non-default ARIA state is reported by CDP `Accessibility.getFullAXTree`. */
	states?: ElementAccessibilityStates;
};
```

`foundations/specimen/host/src/aria.rs` populates `states` directly from each AX node's CDP `properties` array (fixing the Phase 0.1 gap where `aria.rs:52-58` dropped `invalid` to `_ => None` and `aria.rs:344-348` dropped all states from `ElementObservation.accessibility`):

- CDP `invalid`: `"true"` → `true`, `"grammar"` → `"grammar"`, `"spelling"` → `"spelling"`, `"false"` → omitted.
- CDP `checked` / `pressed`: `"true"` → `true`, `"mixed"` → `"mixed"`, `"false"` → `false` when explicitly present on checkable/toggle roles, else omitted.
- CDP `selected`, `expanded`, `disabled`, `readonly`, `required`: boolean `true` (and explicit `false` for `expanded` / `selected` when present on expandable/selectable roles so `expanded: false` is directly observable).
- CDP `level`: positive integer.
- `ElementObservation.state.focused` continues to walk `document.activeElement` through open `shadowRoot.activeElement` (`foundations/specimen/src/browser/capture.ts:112-123`).

---

## 4. Setup Bindings, Execution, Discovery, and Coverage

### 4.1 Declaring setup cases

An implementation binds a setup case to a pattern in one of four ways:

1. **Native specimen (`SpecimenEntry` / `SpecimenDefinition`):** declares `patternSetup: { library?: string; pattern: string; setup: string }` and optional `contexts?: ImplementationContexts`.
2. **Play-free retained story:** declares `parameters.specimen.patternSetup` (and optional `parameters.specimen.contexts`). Stories with a `play` function cannot serve as pattern setups (`PATTERN_SCHEMA_INVALID` error in `specimen-validate` because a play mutates state before the gate starts).
3. **Saved copy (`specimens/patterns/<pattern>/copies/<name>.json`, Slice 2):** declares optional `setup: "<setup>"` and optional `contexts?: ImplementationContexts` on its [`CopySourceRecord`](#52-on-disk-copy-source-record-namejson). When `setup` is present and `status === "complete"`, Specimen synthesizes a setup case `<pattern>--<name>` that remounts `<name>.html` + `<name>.css` (plus configured `pack.themeStylesheet` if any).
4. **Consumer adapted-region case (Slice 2):** a native specimen in a consumer project (claiming an external pattern via `patternSources`) declares `patternSetup: { library: "<lib>", pattern: "<pattern>", setup: "<setup>" }` with no component tag, producing `kind: "case"` coverage (`case: "<specimen-id>"`).

### 4.2 Gate case ids and `specimen-list`

For every bound setup case `<case>` and every gate `<gate>` in the bound pattern whose `gate.setup` equals the case's `setup`, Specimen synthesizes a native gate case with an id conforming to `PACK_PATTERNS.story` (`^[a-z0-9][a-z0-9._-]*$`, permitting `.` for dotted pattern ids such as `dialog.modal`, separate from hand-authored `configuration.specimens[].id` in `validate.ts:455`):

- Component or consumer case: `<case>--gate--<gate>`
- Saved copy case: `<pattern>--<name>--gate--<gate>`

Any collision between a synthesized gate case id and an explicitly configured specimen or story id is reported as `DUPLICATE_ID` (`severity: 'error'`) by `specimen-validate`.

**`specimen-list` extended contract (`integrations/specimen-afd/src/commands.ts`):**

```ts
export interface ListRequest {
	/** Filter by entry kind. Absent returns all registered entries (stories, native specimens, and synthesized gate cases). */
	kind?: 'story' | 'native' | 'gate';
	/** Filter to entries associated with this custom element tag. */
	component?: string;
	/** Filter to gate cases or setup cases for a pattern (`<pattern>` or `<library>/<pattern>`). */
	pattern?: string;
	/** Case-insensitive substring match against `id` and `title`. */
	match?: string;
	/** Maximum entries returned per page (integer 1..500). */
	limit?: number;
	/** Cursor from a previous page's `next`. */
	after?: string;
}

export interface ListResult {
	specimens: Array<SpecimenEntry & {
		kind?: 'story' | 'native' | 'gate';
		pattern?: { library: string; pattern: string; setup: string; gate?: string };
	}>;
	/** Present only when more entries exist past this page. */
	next?: string;
}
```

Empty `{}` input keeps backward compatibility with existing callers (returns `{ specimens: [...] }`).

### 4.3 Native gate execution (`specimen-run`)

`specimen-run` is extended beyond retained stories (`src/bench-runtime.ts:552-555`) to execute synthesized gate cases in both single-id and suite modes:

- **Single-id input (`RunRequest`):** adds optional `capture?: 'all' | 'failed' | 'none'`. Defaults to `'none'` for gate cases (keeping full `Observation` objects out of agent context, aligned with Design Decisions exit criterion 1) and preserves existing default (`'all'`) for retained stories.
- **Suite filter (`SuiteFilter`):** adds optional `kind?: ('story' | 'native' | 'gate')[]` and `pattern?: string` (`<pattern>` or `<library>/<pattern>`).
- **Context check before launch:** Before launching the gate scenario, Specimen compares the gate's effective context (`gate.context` merged over default/request context) against the implementation's declared `contexts` (from its guide, copy record, or setup case):
  - If the effective viewport width/height is outside `[minWidth, maxWidth]` / `[minHeight, maxHeight]` or the effective theme is absent from `contexts.themes`, the gate does **not** run as passed or failed; it immediately returns `outcome.status: 'out-of-context'` with `outcome.reason: contexts.reason` and `observation: null`.
- **Gate outcome shape (`GateOutcome`):**

```ts
export interface GateFailure {
	stepId: string;
	kind: 'target' | 'action' | 'event' | 'form' | 'validity' | 'a11y' | 'focus' | 'layout' | 'render';
	code?: 'TARGET_NOT_FOUND' | 'TARGET_AMBIGUOUS';
	message: string;
}

export interface GateOutcome {
	status: 'passed' | 'failed' | 'out-of-context';
	/** Present when `status === 'out-of-context'`: the implementation's declared context reason. */
	reason?: string;
	/** Empty when `passed` or `out-of-context`; ordered failing steps when `failed`. */
	failures: GateFailure[];
}

export interface GateRun {
	id: string;
	outcome: GateOutcome;
	/** Populated only when `capture: 'all'` or (`capture: 'failed'` and `outcome.status === 'failed'`). */
	observation: Observation | null;
}
```

- **Suite mode & `specimen-afd` output schema extensions:**
  - `SuiteRun.counts` (`foundations/specimen/src/types.ts:544`, `src/schema.ts:304`) adds `outOfContext: number` (default `0` when no gate cases ran). An `out-of-context` gate never fails the suite and never increments `passed`.
  - `SuiteStory` (`src/types.ts:527-541`, `src/schema.ts:313-324`) extends `status` to `'passed' | 'failed' | 'flaky' | 'skipped' | 'excluded' | 'out-of-context'` and `attempts` to `Array<StoryOutcome | GateOutcome>`. For a synthesized gate case, `id`, `name`, and `flakeId` equal the unique gate case id (`<case>--gate--<gate>`), `title` is `<pattern> / <gate>`, and `file` is the pattern file path (relative to root, no leading `./`).
  - `runOutputSchema` (`integrations/specimen-afd/src/commands.ts:197`) extends to `z.union([storyRunSchema, gateRunSchema, suiteRunSchema])` so single-id gate runs, single-id story runs, and suite runs all pass output schema validation.

### 4.4 Coverage: `patterns@1` (`specimen-coverage`)

`CoverageRequest` adds optional `pattern?: string` (`<pattern>` or `<library>/<pattern>`). `CoverageRun` adds optional `patterns?: PatternCoverage` beside `guides?: GuideCoverage`. Neither `schema-partitions@1` nor `guides@1` changes when pattern files are added (Slice 1 exit criterion 4).

```ts
export type PatternCoverageLevel = 'verified' | 'missing' | 'ungated' | 'out-of-context';

export interface PatternKeepCoverage {
	id: string;
	level: PatternCoverageLevel;
	/** Present when `level === 'out-of-context'`. */
	reason?: string;
}

export interface PatternImplementationCoverage {
	/** Owning library of the pattern (PA-4; unambiguously distinct from the implementing library). */
	patternLibrary: string;
	pattern: string;
	kind: 'component' | 'copy' | 'case';
	/** Present when `kind === 'component'`. */
	tag?: string;
	/** Present when `kind === 'copy'`. */
	name?: string;
	/** Present when `kind === 'case'` (consumer adapted region). */
	case?: string;
	contexts?: ImplementationContexts;
	/** Ordered identically to the pattern file's `keep` array. */
	keep: PatternKeepCoverage[];
}

export interface PatternCoverage {
	obligations: 'patterns@1';
	/** `true` iff every gated keep statement across reported implementations is `verified` or `out-of-context` (zero `missing`, zero gate failures). */
	complete: boolean;
	implementations: PatternImplementationCoverage[];
	counts: Record<PatternCoverageLevel, number>;
}
```

Level resolution per `(implementation, keep statement)`:
1. `keep.gate` absent → `ungated`.
2. `keep.gate` present, implementation has no setup case for `gate.setup`, and the gate's context is within implementation `contexts` → `missing` (sets `patterns.complete = false` and blocks `specimen-pack` with `PATTERN_SETUP_MISSING`).
3. `keep.gate` present and gate context is outside implementation `contexts` → `out-of-context` with `reason: contexts.reason` (even when no setup case exists for that out-of-context viewport/theme).
4. `keep.gate` present, setup case exists: `specimen-coverage` executes the gate case (using its `workers` and `timeoutMs` options, matching how it runs partition and guide cases) — if the gate holds → `verified`; if it fails → `missing` (a failed gate is never `verified` and blocks `specimen-pack`).

### 4.5 `specimen-suggest`

`SuggestRequest` (`foundations/specimen/src/types.ts:397`) makes `component` optional when `pattern` (`<pattern>` or `<library>/<pattern>`) and `gaps` are provided, so both components and tagless consumer/copy cases can request setup stubs. `SuggestRequest.gaps` accepts `pattern:<statement-id>` (same library) and `pattern:<library>/<statement-id>` (external pattern via `patternSources`). For each missing gated `keep` statement, `specimen-suggest` emits a proposed setup case stub with `status: 'unverified'` and `placeholder: true` that fails until a person or agent supplies the concrete markup/props for `setup.text`.

---

## 5. Saved Copies Lifecycle (Slice 2)

### 5.1 `specimen-pattern-save`

New command (`mutation: true`, `expose: { mcp: true, cli: true }`) supporting three mutually exclusive modes:

1. **Capture mode** (`id` + (`target` | `point`) + `pattern` + `name`): renders a specimen, extracts a region, verifies standalone remount, and writes `specimens/patterns/<pattern>/copies/<name>.{html,css,json}`.
2. **In-place verify/promote mode** (`pattern` + `name` + `replace: true`, omitting `id`, `target`, `point`): reads edited `<name>.html` and `<name>.css` on disk, remounts standalone, promotes `draft` → `complete` when clean, and updates `revision` and `fingerprint`.
3. **Batch stale-refresh mode** (`refreshStale: true`, optional `pattern`, optional `dryRun`, optional `allowDowngrade`; PA-3): runs `fingerprintsOnly` staleness detection, re-captures each stale copy from its stored `origin` (`id`, `checkpoint`, `context`, `target`), preserves its `setup` and `contexts`, enforces the downgrade guard per copy without aborting remaining copies, and never touches clean copies.

```ts
export interface PatternSaveRequest {
	/** Required for capture and in-place modes; optional filter in `refreshStale` mode. */
	pattern?: string;
	/** Copy name (`PACK_PATTERNS.copyName`). Required for capture and in-place modes; forbidden with `refreshStale`. */
	name?: string;
	/** Specimen id to capture from (capture mode). */
	id?: string;
	/** Portable target in the rendered specimen (capture mode; mutually exclusive with `point`). */
	target?: PatternTarget;
	/** Pointing `pt-*` id (capture mode; mutually exclusive with `target`; checked for staleness via `POINT_STALE`). */
	point?: string;
	checkpoint?: string;
	context?: Partial<SpecimenContext>;
	/** Optional pattern setup key this copy implements; preserved on `replace: true` unless explicitly passed. */
	setup?: string;
	/** Required to create a brand-new skeleton `pattern.json`; otherwise unknown pattern fails `PATTERN_UNKNOWN`. */
	createPattern?: boolean;
	/** Required to overwrite an existing copy or run in-place verify/promote. */
	replace?: boolean;
	/** Required to overwrite an existing `complete` copy with a `draft` result (`COPY_DOWNGRADE_REFUSED` otherwise; PA-2). */
	allowDowngrade?: boolean;
	/** Optional one-line note describing why this copy revision changed (1..240 code points, never hashed in `revision`; PA-6). */
	changeNote?: string;
	/** Optional lifecycle status stored on the on-disk copy record (PA-1); preserved on `replace: true` / `refreshStale` unless overridden. */
	lifecycle?: PatternStatus;
	/** Replacement copy name within the same pattern; allowed only when `lifecycle === 'deprecated'` (PA-1). */
	replacedBy?: string;
	/** Batch refresh all copies whose `fingerprint` is stale against current manifests (PA-3). */
	refreshStale?: boolean;
	/** Valid only with `refreshStale: true`: browserless static preview listing stale copies and whether each can auto-refresh, writing nothing. */
	dryRun?: boolean;
}

export type StrippedKind = 'script' | 'handler' | 'bound-data' | 'unmanifested-element';

export interface PatternSaveResult {
	pattern: string;
	implementation: string;
	/** Completeness status of the saved copy (`'complete'` or `'draft'`). */
	status: 'complete' | 'draft';
	/** Lifecycle status carried into pack format 2 (`'stable' | 'preview' | 'deprecated'`). */
	lifecycle: PatternStatus;
	replacedBy?: string;
	/** `PACK_PATTERNS.digest` (`sha256:`) over `canonicalJson({ html, css })` only. */
	revision: string;
	/** `PACK_PATTERNS.digest` (`sha256:`) over canonical sorted tag manifest entries (§5.3). */
	fingerprint: string;
	/** External CSS custom properties referenced inside the region (`--*`, sorted; Adjustment P0-5). */
	tokens: string[];
	themeStylesheet?: string;
	written: string[];
	created: { pattern: boolean; copy: boolean };
	stripped: Array<{ kind: StrippedKind; count: number; detail?: string }>;
	remount: {
		same: boolean;
		/** Console errors and uncaught page errors observed during standalone remount (Adjustment P0-5). */
		errors: string[];
		differences?: string[];
	};
	/** Path to remount PNG under `.specimen/copies/<pattern>/<name>.png`. */
	screenshot: string;
	/** Missing pattern guidance sections (`summary`, `useWhen`, `avoidWhen`, `keep`, `customize`). Never auto-authored. */
	gaps: ('summary' | 'useWhen' | 'avoidWhen' | 'keep' | 'customize')[];
}

export interface PatternBatchPreviewEntry {
	pattern: string;
	name: string;
	file: string;
	tags: string[];
	origin: CopyOrigin;
	/** `false` when `editedInPlace === true` or `origin.target` is absent (cannot safely auto-recapture). */
	canAutoRefresh: boolean;
	reason?: string;
}

export interface PatternBatchRefreshResult {
	dryRun: boolean;
	/** Populated when `dryRun: true` (browserless preview; no files written). */
	preview?: PatternBatchPreviewEntry[];
	/** Populated when `dryRun` is false/omitted. */
	refreshed: PatternSaveResult[];
	downgraded: Array<{ pattern: string; name: string; code: 'COPY_DOWNGRADE_REFUSED'; stripped: PatternSaveResult['stripped']; errors: string[] }>;
	failed: Array<{ pattern: string; name: string; code: 'COPY_REFRESH_UNSUPPORTED' | string; message: string }>;
}
```

**Mode validation & batch refresh safety:**

- Mixing mutually exclusive mode fields (e.g. `refreshStale: true` with `name` or `id`, `dryRun: true` without `refreshStale`, or both `target` and `point`) is refused with `VALIDATION_ERROR` (`integrations/specimen-afd/src/commands.ts:575`).
- In-place verify/promote mode (`replace: true` without `id`/`target`/`point`) requires existing `specimens/patterns/<pattern>/copies/<name>.{html,css,json}`; missing files fail with `COPY_NOT_FOUND`.
- **In-place edit protection (`refreshStale`):** Mode 2 (in-place verify/promote) sets `editedInPlace: true` on `<name>.json`; Mode 1 (screen capture) sets `editedInPlace: false`. `refreshStale` never silently overwrites a copy with `editedInPlace === true` or without a durable `origin.target`; it skips re-capturing it and reports an entry in `failed[]` with `code: 'COPY_REFRESH_UNSUPPORTED'` directing the caller to update `.html`/`.css` manually and run in-place `replace: true`.
- When Mode 1 captures via a Pointing `point` id, Specimen stores `point.identity.roleName` as `origin.target` when available; if the point had only `component-position` or `ref` identity, `origin.target` is omitted and `refreshStale` reports `COPY_REFRESH_UNSUPPORTED` rather than guessing.

**Extraction, stripping, and remount rules (Adjustment P0-5 & PA-2):**

1. **Element resolution:** Resolve `target` (or `point`) and apply Pointing §4.1's host-climb rule so any element inside a custom element's shadow root climbs to its custom element host before extracting light DOM.
2. **Light DOM and matched CSS:** Serialize light DOM with attributes sorted by name and empty boolean attributes written by name (reusing Specimen's `exampleMarkup()`), and collect CSS rules matching elements within the region. Enforce `copyHtml` (16 000 code points) and `copyCss` (8 000 code points) caps; oversize copies stay `draft` with a clear difference entry and never enter the pack.
3. **Stripping:** Remove `<script>` tags (`script`), inline `on*` event attributes (`handler`), non-reflected JS-bound state detected on remount (`bound-data`), and custom elements whose tag is absent from `manifest`, `pack.dependencies`, and `pack.localElements` (`unmanifested-element`).
4. **External theme tokens (Adjustment P0-5):** Extract every `var(--name...)` reference in the saved CSS and inline `style` attributes whose custom property `--name` is not defined inside the saved CSS itself, deduplicate and sort by UTF-16 code unit into `tokens[]`, and record `pack.themeStylesheet` when configured.
5. **Standalone remount & zero-error check (Adjustment P0-5):** Mount `<name>.html` and `<name>.css` (with configured `pack.themeStylesheet` and component modules loaded) in a fresh browser context, capture `.specimen/copies/<pattern>/<name>.png`, and compare elements, computed ARIA roles/states, bounding boxes (<= 2 px tolerance), and console/page errors. `remount.same` is `true` **only** when elements, roles, states, and boxes match **and** `remount.errors.length === 0` (zero `console.error`, zero uncaught `pageerror`).
6. **Status and downgrade guard (PA-2):**
   - `status` is `'complete'` iff `stripped.length === 0`, `remount.same === true`, and `.html`/`.css` fit pack text limits. Otherwise `status` is `'draft'`.
   - If the existing `<name>.json` on disk has `status: 'complete'`, `replace: true` was passed, and the new result would be `'draft'`, `specimen-pattern-save` **refuses to overwrite** with `COPY_DOWNGRADE_REFUSED` (carrying `stripped` and `remount` diagnostics) unless `allowDowngrade: true` is set.
   - `replace: true` and `refreshStale` preserve `setup`, `contexts`, `lifecycle`, and `replacedBy` from the existing `<name>.json` unless explicitly overridden.
7. **Skeleton pattern creation:** `createPattern: true` writes a minimal `pattern.json` containing `{ "pattern": "<pattern>", "scope": "composition" }` and nothing else (never invents statements). `gaps` reports `["summary", "useWhen", "avoidWhen", "keep", "customize"]`.

### 5.2 On-disk copy source record (`<name>.json`)

Committed at `specimens/patterns/<pattern>/copies/<name>.json` beside `<name>.html` and `<name>.css` (separate from Pack Format 2's packed copy record in §6.5). Every object is strict (`additionalProperties: false`):

```ts
export interface CopyOrigin {
	id: string;
	checkpoint?: string;
	context?: Partial<SpecimenContext>;
	/** Durable portable target used for `refreshStale`; populated from `target` or `point.identity.roleName`. */
	target?: PatternTarget;
}

export interface CopySourceRecord {
	pattern: string;
	name: string;
	/** Completeness status determined by `specimen-pattern-save` (`'draft'` never enters the pack). */
	status: 'complete' | 'draft';
	/** Optional lifecycle status packed into `PackCopyRecord.status` (defaults to `'stable'`; PA-1). */
	lifecycle?: PatternStatus;
	/** Replacement copy name under the same pattern; allowed only when `lifecycle === 'deprecated'` (PA-1). */
	replacedBy?: string;
	/** True when last saved via Mode 2 in-place verify/promote (protects hand-adapted copies from `refreshStale`). */
	editedInPlace: boolean;
	origin: CopyOrigin;
	/** Sorted unique custom element tags used in `<name>.html`. */
	dependencies: string[];
	/** Sorted unique external CSS custom properties referenced (`--*`). */
	tokens: string[];
	themeStylesheet?: string;
	stripped: Array<{ kind: StrippedKind; count: number; detail?: string }>;
	setup?: string;
	contexts?: ImplementationContexts;
	/** `PACK_PATTERNS.digest` (`sha256:`) over `canonicalJson({ html, css })` only. */
	revision: string;
	/** `PACK_PATTERNS.digest` (`sha256:`) over canonical sorted tag manifest entries (§5.3). */
	fingerprint: string;
	changeNote?: string;
}
```

### 5.3 Revision, fingerprint, and provenance

- **`revision` (`PACK_PATTERNS.digest`, distinct from format 1's Git `PACK_PATTERNS.revision`):** `sha256:` over UTF-8 bytes of `canonicalJson({ html, css })` (keys sorted: `css`, `html`, JSON-escaped, unambiguous framing that cannot collide across embedded newlines or delimiters). Never hashes `fingerprint`, `tokens`, `changeNote`, `origin`, `lifecycle`, or `keep` bases—so refreshing a copy after a harmless dependency manifest update without changing `.html`/`.css` keeps `revision` identical (Slice 2 exit criterion 5).
- **`fingerprint` (`PACK_PATTERNS.digest`):** `sha256:` over UTF-8 bytes of `canonicalJson(entries)`, where `entries` is sorted ascending by `tag` (UTF-16 code unit):
  - For each tag resolved in `manifest`, `pack.dependencies`, or `pack.localElements.manifest`:
    `{ "tag": "<tag>", "manifest": { "attributes": [...], "slots": [...], "events": [...], "cssProperties": [...], "form": <boolean> } }` (canonical sorted members).
  - For each tag admitted solely via `pack.localElements.tags` (with no CEM declaration):
    `{ "tag": "<tag>", "local": true }`.
- **Provenance markers:** Saved `.html` on disk carries no embedded digest. `components-pattern-open` deterministically stamps `data-pattern-copy="<library>/<pattern>/<name> <revision>"` onto the root element when `html` has a single root element, or prepends `<!-- pattern-copy: <library>/<pattern>/<name> <revision> -->\n` when `html` has multiple root nodes or begins with a non-element node. Callers targeting frameworks that strip unknown attributes may manually use the same HTML comment form; both forms are recognized by Umbel's scanner.

### 5.4 Browserless staleness check (`specimen-pack-check`)

`PackCheckRequest` extends `PackRequest` with optional `fingerprintsOnly?: boolean` (forbidden on `specimen-pack`). When `fingerprintsOnly: true`, `specimen-pack-check` launches **no browser**; it reads committed pack copy records (`data/<library>/patterns/<pattern>/<name>.json`) for `file` and committed `fingerprint`, joins each with its on-disk [`CopySourceRecord`](#52-on-disk-copy-source-record-namejson) (`specimens/patterns/<pattern>/copies/<name>.json`) for `origin`, recomputes each copy's `fingerprint` against current manifests (`manifest`, `pack.dependencies`, `pack.localElements`), and returns:

```ts
export interface StaleCopyEntry {
	/** Pack-relative file path, e.g. `data/example/patterns/empty-collection/collection-empty.json`. */
	file: string;
	pattern: string;
	name: string;
	reason: 'fingerprint';
	/** Referenced tags whose manifest declaration changed. */
	tags: string[];
	/** Origin from the on-disk `CopySourceRecord` (`<name>.json`) so callers can refresh directly without reading disk. */
	origin: CopyOrigin;
}

export interface PackFingerprintCheckRun {
	valid: boolean;
	stale: StaleCopyEntry[];
	changedTags: string[];
	elapsedMs: number;
}
```

### 5.5 Typed error codes and per-error suggestions (`integrations/specimen-afd`)

`integrations/specimen-afd/src/commands.ts` (`result()` helper, lines 199–218) is extended so typed bench errors carry their own `suggestion` (instead of overwriting every error with one generic command suggestion):

| Error code | From | Recovery suggestion |
| --- | --- | --- |
| `TARGET_NOT_FOUND` | `specimen-pattern-save`, `specimen-run` | Name a `{ role, name }` target (or Pointing `point`) that matches an accessible element in the rendered specimen |
| `TARGET_AMBIGUOUS` | `specimen-pattern-save`, `specimen-run` | Narrow the target with `name`, `nameStartsWith`, or `nameContains` (or pass a Pointing `point`) so it matches one element |
| `SPECIMEN_NOT_FOUND` | `specimen-pattern-save`, `specimen-run` | Use one of the nearest specimen ids listed in details, or run `specimen-list` |
| `ALREADY_EXISTS` | `specimen-pattern-save` | Choose another copy `name`, or pass `replace: true` to overwrite the existing copy |
| `PATTERN_UNKNOWN` | `specimen-pattern-save` | Use one of the nearest local patterns in `specimens/patterns/`, or pass `createPattern: true` to start a new pattern |
| `COPY_NOT_FOUND` | `specimen-pattern-save` (in-place mode) | Run `specimen-pattern-save` in capture mode (`id` + `target`/`point`) before re-verifying in place |
| `COPY_DOWNGRADE_REFUSED` | `specimen-pattern-save` | Fix the stripped items or remount errors so the copy stays `complete`, or pass `allowDowngrade: true` to demote it to `draft` |
| `COPY_REFRESH_UNSUPPORTED` | `specimen-pattern-save` (`refreshStale`) | Update `.html`/`.css` on disk and run `specimen-pattern-save` with `{ pattern, name, replace: true }` (copy was edited in place or lacks a durable `origin.target`) |
| `PATTERN_SETUP_MISSING` | `specimen-pack` | Add the missing setup case (run `specimen-suggest` with the reported `pattern:` obligation) or declare a `contexts` limit on the implementation |
| `POINT_STALE` | `specimen-pattern-save` (when `point` given; owned by Pointing) | Run `specimen-point` again to capture a fresh point id before saving |

---

## 6. Component Pack Format, Version 2 (`format: 2`)

Version 1 (`foundations/specimen/docs/pack-format.md`) is fixed and refuses unknown keys. Pack format 2 bumps `PACK_FORMAT_VERSION = 2` and adds pattern records (Slice 1), component pattern links (Slice 1), complete copy records (Slice 2), and catalog indexes for both.

### 6.1 Layout

```text
<pack root>/
├── data/<library>/library.json                         # exported form only: catalog and digests
├── data/<library>/components/<tag>.json                # one record per component
├── data/<library>/patterns/<pattern>.json              # Slice 1: one record per pattern
├── data/<library>/patterns/<pattern>/<name>.json       # Slice 2: one record per complete copy
└── rules/<library>.json                                # the library's shared rules
```

- Draft copies (`status: "draft"`) **never** enter the pack.
- A library with no components (an application pack such as Loam with patterns and saved copies only) has `components: []` in `library.json`, no files under `components/`, and an empty `rules/<library>.json` (`rules: []`).
- Any file outside this layout (other than deployment-owned `pack.toml` at root) is `LAYOUT_INVALID`.

### 6.2 Packable bases for pattern `keep` statements

Because `missing` blocks `specimen-pack` (`PATTERN_SETUP_MISSING`), pack format 2 holds exactly **three** packable bases for pattern `keep` entries:

| Basis | Meaning |
| --- | --- |
| `verified` | The `keep` statement's gate ran on this implementation in this pack build and held |
| `ungated` | The `keep` statement carries no `gate` (authored requirement only) |
| `out-of-context` | The implementation declares `contexts` excluding the gate's context; carries required one-line `reason` (1..240 code points) |

### 6.3 Component record additions (`data/<library>/components/<tag>.json`)

Adds one optional key `patterns` (omitted when the component implements no patterns; max 16 entries, sorted ascending by `(library, pattern)`):

```ts
export interface PackKeepBasis {
	id: string; // PACK_PATTERNS.id
	basis: 'verified' | 'ungated' | 'out-of-context';
	/** Present and required iff `basis === 'out-of-context'` (1..240 code points). */
	reason?: string;
}

export interface PackComponentPattern {
	/** Owning library of the pattern (`PACK_PATTERNS.library`). Always explicit on disk. */
	library: string;
	/** Pattern id (`PACK_PATTERNS.pattern`). */
	pattern: string;
	/** Optional declared context limits for this component's implementation of the pattern. */
	contexts?: ImplementationContexts;
	/** One entry per `keep` statement of the pattern, in the pattern's declared `keep` order. */
	keep: PackKeepBasis[];
}
```

### 6.4 Pattern record (`data/<library>/patterns/<pattern>.json`, Slice 1)

Every key below is allowed and no other (`SCHEMA_INVALID`); see [§8](#8-amendment-agent-first-design-phase-a-approved-2026-11-24) for the 2026-11-24 optional `approvalStatus` and `derivedFrom` additions:

```ts
export interface PackPatternRecord {
	format: 2;
	/** Equal to file basename without `.json` (`PATTERN_MISMATCH`). */
	pattern: string;
	summary?: string;
	status: 'stable' | 'preview' | 'deprecated';
	/** Allowed only when `status === 'deprecated'`. */
	replacedBy?: string;
	scope: 'control' | 'composition';
	/** Keys sorted ascending; each value array sorted ascending with unique entries. */
	facets: Record<string, string[]>;
	useWhen: PatternStatement[];
	avoidWhen: PatternStatement[];
	keep: PatternKeepStatement[];
	customize: PatternStatement[];
	/** Keys sorted ascending. */
	setups: Record<string, PatternSetup>;
	/** Keys sorted ascending. */
	gates: Record<string, PatternGate>;
	/**
	 * Same-library implementations by reference (cross-library implementations are aggregated
	 * by Umbel at read time across loaded libraries in the space).
	 * Sorted ascending by `(kind, tag ?? name)`.
	 */
	implementations: Array<
		| { kind: 'component'; tag: string; linkage: 'instance' }
		| { kind: 'copy'; name: string; linkage: 'copy' }
	>;
}
```

### 6.5 Copy record (`data/<library>/patterns/<pattern>/<name>.json`, Slice 2)

Every key below is allowed and no other (`SCHEMA_INVALID`); see [§8](#8-amendment-agent-first-design-phase-a-approved-2026-11-24) for the 2026-11-24 optional `approvalStatus` addition:

```ts
export interface PackCopyRecord {
	format: 2;
	/** Equal to parent directory name (`PATTERN_MISMATCH`). */
	pattern: string;
	/** Equal to file basename without `.json` (`COPY_MISMATCH`). */
	name: string;
	/** Lifecycle status copied from `CopySourceRecord.lifecycle ?? 'stable'` (PA-1). */
	status: 'stable' | 'preview' | 'deprecated';
	/** Allowed only when `status === 'deprecated'` (another copy name under the same pattern). */
	replacedBy?: string;
	/** Clean light DOM (1..16 000 code points, multi-line, no provenance digest stamped). */
	html: string;
	/** Matched styles (0..8 000 code points, multi-line; empty string allowed when no custom CSS). */
	css: string;
	/** Sorted unique custom element tags used in `html` (`PACK_PATTERNS.tag`, max 64). */
	dependencies: string[];
	/** Sorted unique external CSS custom properties referenced (`PACK_PATTERNS.cssProperty`, max 256; Adjustment P0-5). */
	tokens: string[];
	/** Optional theme stylesheet specifier required for external tokens (Adjustment P0-5). */
	themeStylesheet?: string;
	/** Optional pattern setup key this copy implements. */
	setup?: string;
	contexts?: ImplementationContexts;
	/** `PACK_PATTERNS.digest` (`sha256:`) over `canonicalJson({ html, css })` only. */
	revision: string;
	/** `PACK_PATTERNS.digest` (`sha256:`) over canonical sorted tag manifest entries (§5.3). */
	fingerprint: string;
	/** Optional one-line note describing what changed in this revision (PA-6). */
	changeNote?: string;
	origin: {
		id: string;
		checkpoint?: string;
	};
	/** Per-`keep` bases in the pattern's declared `keep` order (empty array when pattern has no `keep` statements). */
	keep: PackKeepBasis[];
}
```

### 6.6 Catalog (`data/<library>/library.json`)

Extends format 1's catalog with `format: 2`, `patterns`, and `copies` (and optional `approvalStatus` / compiled `patternBindings` per [§8](#8-amendment-agent-first-design-phase-a-approved-2026-11-24)):

```ts
export interface PackCatalogV2 {
	format: 2;
	library: string;
	title: string;
	package: { name: string; version: string };
	prefix: string;
	revision?: string;
	/** Pack digest over sorted `<path> <digest>\n` for rules + all components + all patterns + all copies (not `library.json`). */
	digest: string;
	rules: string; // digest of `rules/<library>.json`
	components: Array<{ tag: string; summary?: string; status: PatternStatus; digest: string }>; // max 990
	/** Sorted ascending by `pattern` (max 256). Empty array when library owns no patterns. */
	patterns: Array<{
		pattern: string;
		summary?: string;
		status: PatternStatus;
		replacedBy?: string;
		scope: PatternScope;
		facets: Record<string, string[]>;
		digest: string;
	}>;
	/** Sorted ascending by `(pattern, name)` (max 512). Empty array when library owns no complete copies. */
	copies: Array<{
		pattern: string;
		name: string;
		status: PatternStatus;
		replacedBy?: string;
		/** `PACK_PATTERNS.digest` (`sha256:`). */
		revision: string;
		/** `PACK_PATTERNS.digest` (`sha256:`). */
		fingerprint: string;
		digest: string;
	}>;
}
```

### 6.7 Canonical bytes, sorting, and `checkPack` problem codes

- **Format versions during rollout:** Specimen's `checkPack` accepts uniform format `2` libraries and uniform format `1` libraries (for packs without patterns), matching Umbel A31.1. Mixing format `1` and format `2` files within the same library fails the mismatched files with `FORMAT_UNSUPPORTED`. Per-section catalog caps (`990` components, `256` patterns, `512` copies) are format-level bounds; as in format 1 (`pack-format.md:43`), a reader applies its own total pack file cap (Umbel's `MAX_PACK_FILES = 1 000` applies when serving a pack).
- **Canonical serialization:** identical to format 1 (`canonicalJson`: UTF-8 without BOM, keys sorted by UTF-16 code unit, 1-tab indentation, trailing `\n`, safe integers only).
- **Sorted lists (UTF-16 ascending, no repeats; out of order is `NOT_CANONICAL`, duplicate is `DUPLICATE_ID`):**
  - Component `patterns` by `(library, pattern)`.
  - `contexts.themes` on component pattern claims and copy records (`dark`, `high-contrast`, `light`).
  - Pattern `facets` values per key; `implementations` by `(kind, tag ?? name)`.
  - Copy `dependencies`, `tokens`.
  - Catalog `components` by `tag`; `patterns` by `pattern`; `copies` by `(pattern, name)`.
- **Order-preserving lists:** `useWhen`, `avoidWhen`, `keep`, `customize`, `gates.<gate>.scenario`, and every `keep` basis list preserve authored order.
- **Extended `CATALOG_MISMATCH` checks:** In addition to format 1's component checks (`tag`, `summary`, `status`, file existence), `checkPack` reports `CATALOG_MISMATCH` whenever:
  - catalog `patterns[]` disagrees with `data/<lib>/patterns/<pattern>.json` on existence, `summary`, `status`, `replacedBy`, `scope`, or `facets`;
  - catalog `copies[]` disagrees with `data/<lib>/patterns/<pattern>/<name>.json` on existence, `status`, `replacedBy`, `revision`, or `fingerprint`.
- **Additional `checkPack` problem codes (extending format 1's 16 codes):**
  - `PATTERN_MISMATCH`: `pattern` field disagrees with file/directory path.
  - `COPY_MISMATCH`: `name` field disagrees with copy filename.
  - `PATTERN_UNKNOWN`: a same-library component `patterns[]`, copy record, or `replacedBy` references a pattern file missing from the library (cross-library references are validated when all libraries are loaded in Umbel or via `patternSources`).
  - `COPY_UNKNOWN`: a pattern record's `implementations[]` or copy `replacedBy` references a copy file missing from the library.
- **Cross-library statement ids:** Still unique within a library across component guides, shared rules, and pattern statements (`DUPLICATE_ID`). Qualified `<library>/<id>` when multiple libraries are in scope.
- **JSON Schemas:** `@lushly-dev/specimen/pack` adds `pattern.schema.json` and `copy.schema.json` beside `component.schema.json`, `rules.schema.json`, and `library.schema.json`.

---

## 7. Phase Deliverables and Measurement Gates

Phases B–D stay gated on Phase A exit (owner approval of this specification and its companion amendments). Each step below maps directly to a future sub-issue under epic [#1073](https://github.com/lushly-dev/afd/issues/1073):

| Step | Slice | Deliverable | Exit check |
| --- | --- | --- | --- |
| **B1** | Slice 1 | `pattern.json` Zod + JSON Schema, `patterns` & `patternSources` config, guide `implements`/`contexts`, `specimen-validate` static checks (`GATE_NOT_PORTABLE`, `PATTERN_UNKNOWN`, `SETUP_UNKNOWN`, `GATE_UNKNOWN`, `TARGET_UNKNOWN`, `DUPLICATE_ID`) | Job 5 scenario + unit tests for every validation code and target matcher rule |
| **B2** | Slice 1 | `press` action in `specimen-host`; capture 0.10 structured ARIA states (incl. `invalid`) in `host/src/aria.rs`; `a11y`, `focus`, `layout` expectations; host-climb on `validity` & `layout`; role sets & `nameStartsWith`/`nameContains` target matching | Browser tests on both `example-*` and `violet-*` covering focus, `invalid`, host-climb, and keyboard chords |
| **B3** | Slice 1 | Setup bindings; filtered `specimen-list`; native gate execution + `GateOutcome` + single-id `capture` in `specimen-run`; declared `contexts` → `out-of-context`; `patterns@1` coverage (`patternLibrary`); `specimen-suggest` `pattern:` gaps; upgrade `fixtures/pack-library/{select,field}.js` stubs (**P0-4**) | Jobs 3, 4, 9 Specimen steps; `schema-partitions@1` & `guides@1` unchanged |
| **B4** | Slice 2 | `specimen-pattern-save` (capture + in-place verify/promote + `refreshStale` batch mode + zero-error remount + `tokens`/`themeStylesheet` + `pack.dependencies`/`pack.localElements` + `COPY_DOWNGRADE_REFUSED` + `PATTERN_UNKNOWN`); copy/adapted-region gate cases | Jobs 6, 7, 10 Specimen steps; zero false `complete` on erroring or property-bound regions |
| **B5** | Slice 1/2 | Pack format 2 in `foundations/specimen` (updates `docs/pack-format.md` + provenance, Zod, JSON Schema, `checkPack`, `fixtures/pack/` v2, `PATTERN_SETUP_MISSING`, per-error suggestions in `specimen-afd`); Slice 2 adds copy records & browserless `specimen-pack-check { fingerprintsOnly: true }` | `checkPack` invalid fixtures; Slice 1 + Slice 2 pack/export/check tests |
| **C1** | Slice 1 | Umbel `components` plugin format 2 reader (and format 1 compatibility during rollout), new ASCII identifier forms, cross-library implementation aggregation (Amendment A31) | Parity with Specimen `checkPack` on all format 2 invalid fixtures; `tests/patterns.rs` regex sync |
| **C2** | Slice 1/2 | `components-pattern-list` (16/64 KB, `availableFacets`) and `components-pattern-open` (32/96 KB, `skip`, `contexts`, copy `source` + provenance stamping in Slice 2) | Jobs 1, 3, 6, 8, 9, 10 Umbel steps; D153 `content_stays_content.rs` canary tests |
| **C3** | Slice 1/2 | `components-brief` patterns (`content.patterns`, compact same-library string links, `patternCustomize` shed before `usage`, `known`, `detail: "api"`, `sections`), `out-of-context` vs `minimum_basis`; Slice 2 `content.copies` + `OUTDATED_COPIES` warning in `components-brief` and `components-check` | Jobs 2, 8, 10; `fast_af.rs` confirms Loam `chrome` <= post-A24 baseline at 96k and 40k |
| **D1** | Slice 1 | `violet-elements`: author `select`, `field`, and `dialog.modal` patterns, split shared guide statements, rebuild format 2 pack; **re-measure builder accuracy, tokens, and cost on `dialog.modal` (P0-7)** | Slice 1 exit criteria 1–4 pass on both `example-*` (upgraded stubs) and `violet-*`; `dialog.modal` builder benchmark recorded |
| **D2** | Slice 2 | Loam: configure `pack.dependencies` + `pack.localElements` + `pack.themeStylesheet`, save 2–3 screen compositions as complete copies, encode checklist rules as gated `keep` statements | Slice 2 exit criteria 5–6 pass on Loam copies |
| **D3** | Slice 1/2 | Second consumer library (Lushly) claiming shared patterns across libraries | Cross-library aggregation and portable gates verified |

---

## 8. Amendment: Agent-First Design Phase A (approved 2026-11-24)

Approved by the owner on 2026-11-24 at [Agent-First Design](../agent-first-design/spec.md#4-proposed-amendments-for-the-owner) Phase A exit (Epic [#2544](https://github.com/lushly-dev/afd/issues/2544)). Norms live in [`../agent-first-design/spec.md`](../agent-first-design/spec.md) and apply to Patterns' schema, Pack Format 2 and Umbel Amendment A31:

1. **Default pattern ownership (`afd-defaults`):** Applies Patterns' 2026-11-21 question 4 decision (library-owned; [`patterns.proposal.md`](patterns.proposal.md#12-owner-decisions-resolved-2026-11-21)) to AFD's ten canonical result-state patterns (`alternatives-and-confidence`, `approval-request`, `batch-partial-failure`, `collection-states`, `destructive-confirm`, `error-recovery`, `evidence-and-sources`, `progress-and-plan`, `undo-offer`, `warnings-banner`) as a versioned library (`afd-defaults@<semver>`). Products that customize nothing pin `afd-defaults` at a version in `specimen.config.json`.
2. **Approval status (`approvalStatus`) and Pack Format 2 update:** Optional `approvalStatus?: 'proposed' | 'approved' | 'deprecated'` is added to `pattern.json`, `PackPatternRecord`, `PackCopyRecord`, `PackCatalogV2` and individual statements (updating Pack Format 2's strict `additionalProperties: false` schemas and `checkPack`), separate from completeness (`complete`/`draft`) and release lifecycle (`stable`/`preview`/`deprecated`). `components-pattern-list`, `components-pattern-open` and `components-brief` serve only `approved` content by default (`includeProposed: true` exposes proposed items for review), and `components-brief` gains optional `patterns?: string[]` input to fetch pattern guidance directly by `<library>/<pattern>` id.
3. **Copied patterns (`derivedFrom`, `waivedKeep`, fork/compare/merge):**
   - `PatternFile` and Pack Format 2 gain optional `derivedFrom: { library, pattern, version, revision, statements: Record<id, sha256>, declined?: Record<id, sha256> }` (supporting statement-by-statement comparison statuses `unchanged`, `changed-here`, `changed-upstream`, `changed-both`, `dropped-here`, `added-upstream`, `declined`) and `waivedKeep: Array<{ id, reason }>`.
   - `specimen-validate` reports `valid: false` with issue code `WAIVER_REASON_REQUIRED` when a copied pattern drops an upstream `keep` without a waiver reason, and verifies that an `approved` pattern's digest matches a recorded person approval.
   - `specimen-pattern-fork`, `specimen-pattern-compare` and `specimen-pattern-merge` govern customization by copy rather than layering: `specimen-pattern-merge` stages selected upstream statement updates (including paired `gate`/`setup` keys, `waivers` for declined `keep`s, and `derivedFrom.declined` digests for non-`keep`s) pinned to `upstreamVersion` and statement digests onto a guidance decision card, applied atomically only upon person approval (refused with `UPSTREAM_CHANGED` if upstream moved).
4. **Compiled `patternBindings` for WASI Umbel:** `specimen.config.json` gains optional `patternBindings?: Record<"<sourceLibrary>/<pattern>", "<localLibrary>/<pattern>">`, and Specimen compiles active (approved) bindings into Pack Format 2 (`library.json`) / `consumers.json` (v3) so sandboxed WASI Umbel (`Cx::pack_read`) resolves them without reading `specimen.config.json`. Bindings to a `proposed` copy stay pending until approved; until then, `components-brief` and `design-states` continue serving the approved upstream default unless `includeProposed: true`. Nothing is layered implicitly.
