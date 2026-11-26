import { isValidIsoClock } from './browser/clock-parse.js';
import { parsePatternBindings } from './card-validate.js';
import { parsePanelConfig } from './panel-validate.js';
import type {
	A11yRequest,
	BaselineRequest,
	BenchConfig,
	CaptureEntryKind,
	CaptureFilter,
	CaptureRequest,
	CaptureSetRequest,
	CheckpointsRequest,
	CompareRequest,
	ContractRequest,
	CoverageRequest,
	ImplementationContexts,
	JobBeforeAction,
	JobCapturePoint,
	JobCaptureSelection,
	JobConfig,
	JobCreateRequest,
	JobPin,
	JobRunRequest,
	JobScenario,
	JobScenarioStep,
	MatrixAxes,
	MatrixRequest,
	PackExportRequest,
	PackLocalElements,
	PackRequest,
	PatternSetupBinding,
	PointCheckRequest,
	PointContextInput,
	PointMoveDirection,
	PointMoveRequest,
	PointRequest,
	PointTarget,
	ProfileRequest,
	RunRequest,
	SpecimenAction,
	SpecimenContext,
	SuggestRequest,
	SuiteFilter,
	SuiteRequest,
	ThemeSupport,
	ThemesRequest,
} from './types.js';

/**
 * Validation for the bench's own inputs: the configuration file, capture requests and
 * contexts. These rules are the `./schema` Zod schemas', written out so that creating a bench
 * and rendering never load Zod (about 9 MB resident in the caller's process). `validate.test.ts`
 * holds the two to the same verdicts.
 */
type Fields = Record<string, unknown>;

function fail(path: string, message: string): never {
	throw new TypeError(`Invalid ${path}: ${message}`);
}
function record(value: unknown, path: string, keys: readonly string[]): Fields {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		fail(path, 'expected an object');
	for (const key of Object.keys(value))
		if (!keys.includes(key)) fail(path, `unrecognized key "${key}"`);
	return value as Fields;
}
function text(value: unknown, path: string, pattern?: RegExp): string {
	if (typeof value !== 'string' || value.length < 1) fail(path, 'expected a non-empty string');
	if (pattern && !pattern.test(value)) fail(path, `must match ${pattern}`);
	return value;
}
function integer(value: unknown, path: string, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
		fail(path, `expected an integer from ${min} to ${max}`);
	return value;
}
function choice<T extends string>(value: unknown, path: string, values: readonly T[]): T {
	if (!values.includes(value as T)) fail(path, `expected ${values.join(' or ')}`);
	return value as T;
}
function locale(value: unknown, path: string): string {
	const tag = text(value, path);
	let canonical: string[] = [];
	try {
		canonical = Intl.getCanonicalLocales(tag);
	} catch {
		// Not a language tag.
	}
	if (canonical.length !== 1) fail(path, 'Locale must be a BCP 47 language tag');
	return tag;
}
function size(value: unknown, path: string, heightOptional: boolean) {
	const fields = record(value, path, ['width', 'height']);
	const width = integer(fields.width, `${path}.width`, 1, 8192);
	if (heightOptional && fields.height === undefined) return { width };
	return { width, height: integer(fields.height, `${path}.height`, 1, 8192) };
}

/** The themes, in the order a declaration lists them. */
export const THEMES = ['light', 'dark', 'high-contrast'] as const;

/** A native specimen's declared themes: one or more, each once; listed in `THEMES` order. */
export function themeSupport(value: unknown, path: string): ThemeSupport {
	const fields = record(value, path, ['supported', 'reason']);
	if (!Array.isArray(fields.supported) || fields.supported.length < 1)
		fail(`${path}.supported`, 'expected at least one theme');
	const supported = fields.supported.map((theme, index) =>
		choice(theme, `${path}.supported[${index}]`, THEMES)
	);
	if (new Set(supported).size !== supported.length)
		fail(`${path}.supported`, 'names a theme twice');
	return {
		supported: THEMES.filter((theme) => supported.includes(theme)),
		basis: 'declared',
		...(fields.reason === undefined ? {} : { reason: text(fields.reason, `${path}.reason`) }),
	};
}

const CONTEXT_KEYS = [
	'viewport',
	'container',
	'theme',
	'locale',
	'reducedMotion',
	'motion',
	'themeMedia',
] as const;
const contextField: Record<
	(typeof CONTEXT_KEYS)[number],
	(value: unknown, path: string) => unknown
> = {
	viewport: (value, path) => size(value, path, false),
	container: (value, path) => size(value, path, true),
	theme: (value, path) => choice(value, path, ['light', 'dark', 'high-contrast']),
	locale,
	reducedMotion: (value, path) => choice(value, path, ['reduce', 'no-preference']),
	motion: (value, path) => choice(value, path, ['natural', 'settled']),
	themeMedia: (value, path) => choice(value, path, ['browser-default']),
};

/** A context for a new request; with `partial`, any field may be absent. */
export function parseContext(
	value: unknown,
	path = 'context',
	partial = false
): Partial<SpecimenContext> {
	const fields = record(value, path, CONTEXT_KEYS);
	const context: Fields = {};
	for (const key of CONTEXT_KEYS) {
		const optional = partial || key === 'container' || key === 'themeMedia';
		if (fields[key] === undefined) {
			if (!optional) fail(`${path}.${key}`, 'required');
			continue;
		}
		context[key] = contextField[key](fields[key], `${path}.${key}`);
	}
	return context as Partial<SpecimenContext>;
}

const MAX_SUITE_WORKERS = 32;

const SUITE_FILTER_KINDS = ['story', 'native', 'gate'] as const;

function suiteFilter(value: unknown, path: string): SuiteFilter {
	const filter = record(value, path, ['ids', 'file', 'tags', 'match', 'kind', 'pattern']);
	let kind: SuiteFilter['kind'];
	if (filter.kind !== undefined) {
		if (!Array.isArray(filter.kind) || filter.kind.length < 1)
			fail(`${path}.kind`, 'expected at least one kind');
		kind = filter.kind.map((item, index) =>
			choice(item, `${path}.kind[${index}]`, SUITE_FILTER_KINDS)
		);
	}
	return {
		...(filter.ids === undefined ? {} : { ids: tagList(filter.ids, `${path}.ids`) }),
		...(filter.file === undefined ? {} : { file: text(filter.file, `${path}.file`) }),
		...(filter.tags === undefined ? {} : { tags: tagList(filter.tags, `${path}.tags`) }),
		...(filter.match === undefined ? {} : { match: text(filter.match, `${path}.match`) }),
		...(kind === undefined ? {} : { kind }),
		...(filter.pattern === undefined ? {} : { pattern: text(filter.pattern, `${path}.pattern`) }),
	};
}

export function parseSuggestRequest(value: unknown): SuggestRequest {
	const fields = record(value, 'suggest request', [
		'component',
		'pattern',
		'gaps',
		'timeoutMs',
		'workers',
	]);
	const request: SuggestRequest = {};
	if (fields.component !== undefined)
		request.component = text(fields.component, 'suggest request.component');
	if (fields.pattern !== undefined)
		request.pattern = text(fields.pattern, 'suggest request.pattern');
	if (fields.gaps !== undefined) {
		if (!Array.isArray(fields.gaps)) fail('suggest request.gaps', 'expected an array');
		request.gaps = fields.gaps.map((gap, index) => text(gap, `suggest request.gaps[${index}]`));
	}
	if (
		request.component === undefined &&
		!(request.pattern !== undefined && request.gaps !== undefined && request.gaps.length > 0)
	) {
		fail('suggest request', 'give a component tag, or give pattern and non-empty gaps');
	}
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, 'suggest request.timeoutMs', 1, 60_000);
	if (fields.workers !== undefined)
		request.workers = integer(fields.workers, 'suggest request.workers', 1, MAX_SUITE_WORKERS);
	return request;
}

export function parseContractRequest(value: unknown): ContractRequest {
	const fields = record(value, 'contract request', ['component', 'filter', 'timeoutMs', 'workers']);
	const request: ContractRequest = {};
	if (fields.component !== undefined)
		request.component = text(fields.component, 'contract request.component');
	if (fields.filter !== undefined)
		request.filter = suiteFilter(fields.filter, 'contract request.filter');
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, 'contract request.timeoutMs', 1, 60_000);
	if (fields.workers !== undefined)
		request.workers = integer(fields.workers, 'contract request.workers', 1, MAX_SUITE_WORKERS);
	return request;
}

const COVERAGE_OBLIGATION_SETS = ['schema-partitions@1', 'jobs@1'] as const;

export function parseCoverageRequest(value: unknown): CoverageRequest {
	const fields = record(value, 'coverage request', [
		'component',
		'pattern',
		'filter',
		'obligations',
		'captures',
		'timeoutMs',
		'workers',
	]);
	const request: CoverageRequest = {};
	if (fields.component !== undefined)
		request.component = text(fields.component, 'coverage request.component');
	if (fields.pattern !== undefined)
		request.pattern = text(fields.pattern, 'coverage request.pattern');
	if (fields.filter !== undefined)
		request.filter = suiteFilter(fields.filter, 'coverage request.filter');
	if (fields.obligations !== undefined)
		request.obligations = choice(
			fields.obligations,
			'coverage request.obligations',
			COVERAGE_OBLIGATION_SETS
		);
	if (fields.captures !== undefined)
		request.captures = text(fields.captures, 'coverage request.captures');
	if (request.obligations === 'jobs@1' && request.captures === undefined)
		fail('coverage request', 'give captures (a set id or label) when obligations is jobs@1');
	if (request.captures !== undefined && request.obligations !== 'jobs@1')
		fail('coverage request', 'captures applies only when obligations is jobs@1');
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, 'coverage request.timeoutMs', 1, 60_000);
	if (fields.workers !== undefined)
		request.workers = integer(fields.workers, 'coverage request.workers', 1, MAX_SUITE_WORKERS);
	return request;
}

export function parsePackRequest(value: unknown): PackRequest {
	const fields = record(value, 'pack request', [
		'component',
		'timeoutMs',
		'workers',
		'allowFailed',
		'index',
	]);
	const request: PackRequest = {};
	if (fields.component !== undefined)
		request.component = text(fields.component, 'pack request.component');
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, 'pack request.timeoutMs', 1, 60_000);
	if (fields.workers !== undefined)
		request.workers = integer(fields.workers, 'pack request.workers', 1, MAX_SUITE_WORKERS);
	if (fields.allowFailed !== undefined) {
		if (!Array.isArray(fields.allowFailed))
			fail('pack request.allowFailed', 'expected an array of case ids');
		request.allowFailed = fields.allowFailed.map((item, index) =>
			text(item, `pack request.allowFailed[${index}]`)
		);
	}
	return request;
}

export function parsePackExportRequest(value: unknown): PackExportRequest {
	const fields = record(value, 'pack export request', ['directory', 'revision']);
	return {
		directory: text(fields.directory, 'pack export request.directory'),
		...(fields.revision === undefined
			? {}
			: {
					revision: text(
						fields.revision,
						'pack export request.revision',
						/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
					),
				}),
	};
}

export function parseA11yRequest(value: unknown): A11yRequest {
	const fields = record(value, 'accessibility request', [
		'id',
		'filter',
		'set',
		'checkpoint',
		'context',
		'timeoutMs',
		'workers',
	]);
	const request: A11yRequest = {};
	if (fields.id !== undefined) request.id = text(fields.id, 'accessibility request.id');
	if (fields.filter !== undefined)
		request.filter = suiteFilter(fields.filter, 'accessibility request.filter');
	if (request.id !== undefined && request.filter !== undefined)
		fail('accessibility request', 'give an id or a filter, not both');
	if (fields.set !== undefined) request.set = text(fields.set, 'accessibility request.set');
	if (fields.checkpoint !== undefined)
		request.checkpoint = text(fields.checkpoint, 'accessibility request.checkpoint');
	if (fields.context !== undefined)
		request.context = parseContext(fields.context, 'accessibility request.context', true);
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, 'accessibility request.timeoutMs', 1, 60_000);
	if (fields.workers !== undefined)
		request.workers = integer(
			fields.workers,
			'accessibility request.workers',
			1,
			MAX_SUITE_WORKERS
		);
	return request;
}

export function parseThemesRequest(value: unknown): ThemesRequest {
	const path = 'themes request';
	const fields = record(value, path, [
		'id',
		'filter',
		'themes',
		'checkpoint',
		'context',
		'threshold',
		'timeoutMs',
		'workers',
	]);
	const request: ThemesRequest = {};
	if (fields.id !== undefined) request.id = text(fields.id, `${path}.id`);
	if (fields.filter !== undefined) request.filter = suiteFilter(fields.filter, `${path}.filter`);
	if (request.id !== undefined && request.filter !== undefined)
		fail(path, 'give an id or a filter, not both');
	if (fields.themes !== undefined) {
		if (!Array.isArray(fields.themes) || fields.themes.length < 2)
			fail(`${path}.themes`, 'expected at least two themes');
		const themes = fields.themes.map((theme, index) =>
			choice(theme, `${path}.themes[${index}]`, THEMES)
		);
		if (new Set(themes).size !== themes.length) fail(`${path}.themes`, 'names a theme twice');
		request.themes = themes;
	}
	if (fields.checkpoint !== undefined)
		request.checkpoint = text(fields.checkpoint, `${path}.checkpoint`);
	if (fields.context !== undefined)
		request.context = parseContext(fields.context, `${path}.context`, true);
	if (fields.threshold !== undefined) {
		const threshold = fields.threshold;
		if (typeof threshold !== 'number' || !(threshold >= 0 && threshold <= 1))
			fail(`${path}.threshold`, 'expected a number from 0 to 1');
		request.threshold = threshold;
	}
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, `${path}.timeoutMs`, 1, 60_000);
	if (fields.workers !== undefined)
		request.workers = integer(fields.workers, `${path}.workers`, 1, MAX_SUITE_WORKERS);
	return request;
}

function profileFields(fields: Record<string, unknown>, path: string): ProfileRequest {
	const request: ProfileRequest = {};
	if (fields.id !== undefined) request.id = text(fields.id, `${path}.id`);
	if (fields.filter !== undefined) request.filter = suiteFilter(fields.filter, `${path}.filter`);
	if (request.id !== undefined && request.filter !== undefined)
		fail(path, 'give an id or a filter, not both');
	if (fields.runs !== undefined) request.runs = integer(fields.runs, `${path}.runs`, 1, 7);
	if (fields.checkpoint !== undefined)
		request.checkpoint = text(fields.checkpoint, `${path}.checkpoint`);
	if (fields.context !== undefined)
		request.context = parseContext(fields.context, `${path}.context`, true);
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, `${path}.timeoutMs`, 1, 60_000);
	return request;
}

const PROFILE_FIELDS = ['id', 'filter', 'runs', 'checkpoint', 'context', 'timeoutMs'];

export function parseProfileRequest(value: unknown): ProfileRequest {
	return profileFields(record(value, 'profile request', PROFILE_FIELDS), 'profile request');
}

export function parseBaselineRequest(value: unknown): BaselineRequest {
	const fields = record(value, 'baseline request', [...PROFILE_FIELDS, 'notes']);
	const request: BaselineRequest = profileFields(fields, 'baseline request');
	if (fields.notes !== undefined) request.notes = tagList(fields.notes, 'baseline request.notes');
	return request;
}

export function parseMatrixRequest(value: unknown): MatrixRequest {
	const fields = record(value, 'matrix request', [
		'id',
		'axes',
		'checkpoint',
		'context',
		'timeoutMs',
		'workers',
		'observations',
	]);
	const axes = record(fields.axes, 'matrix request.axes', [
		'theme',
		'viewport',
		'container',
		'locale',
		'reducedMotion',
		'motion',
	]);
	const parsed: Record<string, unknown[]> = {};
	for (const [axis, values] of Object.entries(axes)) {
		if (values === undefined) continue;
		const path = `matrix request.axes.${axis}`;
		if (!Array.isArray(values) || values.length === 0) fail(path, 'expected at least one value');
		// Each value through the context's own validation, as a capture would read it.
		parsed[axis] = values.map(
			(item, index) =>
				parseContext({ [axis]: item }, `${path}[${index}]`, true)[axis as keyof SpecimenContext]
		);
	}
	if (!Object.keys(parsed).length) fail('matrix request.axes', 'expected at least one axis');
	return {
		id: text(fields.id, 'matrix request.id'),
		axes: parsed as MatrixAxes,
		...(fields.checkpoint === undefined
			? {}
			: { checkpoint: text(fields.checkpoint, 'matrix request.checkpoint') }),
		...(fields.context === undefined
			? {}
			: { context: parseContext(fields.context, 'matrix request.context', true) }),
		...(fields.timeoutMs === undefined
			? {}
			: { timeoutMs: integer(fields.timeoutMs, 'matrix request.timeoutMs', 1, 60_000) }),
		...(fields.workers === undefined
			? {}
			: { workers: integer(fields.workers, 'matrix request.workers', 1, MAX_SUITE_WORKERS) }),
		...(fields.observations === undefined
			? {}
			: {
					observations:
						typeof fields.observations === 'boolean'
							? fields.observations
							: fail('matrix request.observations', 'expected a boolean'),
				}),
	};
}

export function parseSuiteRequest(value: unknown): SuiteRequest {
	const fields = record(value, 'suite request', [
		'filter',
		'context',
		'timeoutMs',
		'workers',
		'retry',
		'flakeCap',
		'capture',
	]);
	const request: SuiteRequest = {};
	if (fields.filter !== undefined)
		request.filter = suiteFilter(fields.filter, 'suite request.filter');
	if (fields.context !== undefined)
		request.context = parseContext(fields.context, 'suite request.context', true);
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, 'suite request.timeoutMs', 1, 60_000);
	if (fields.workers !== undefined)
		request.workers = integer(fields.workers, 'suite request.workers', 1, MAX_SUITE_WORKERS);
	if (fields.retry !== undefined) {
		if (typeof fields.retry !== 'boolean') fail('suite request.retry', 'expected a boolean');
		request.retry = fields.retry;
	}
	if (fields.flakeCap !== undefined)
		request.flakeCap = integer(fields.flakeCap, 'suite request.flakeCap', 0, 1_000);
	if (fields.capture !== undefined) {
		if (fields.capture !== 'all' && fields.capture !== 'failed' && fields.capture !== 'none')
			fail('suite request.capture', 'expected all, failed or none');
		request.capture = fields.capture;
	}
	return request;
}

export function parseRunRequest(value: unknown): RunRequest {
	const fields = record(value, 'run request', [
		'id',
		'context',
		'screenshot',
		'timeoutMs',
		'capture',
	]);
	const request: RunRequest = { id: text(fields.id, 'run request.id') };
	if (fields.context !== undefined)
		request.context = parseContext(fields.context, 'run request.context', true);
	if (fields.screenshot !== undefined)
		request.screenshot = text(fields.screenshot, 'run request.screenshot');
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, 'run request.timeoutMs', 1, 60_000);
	if (fields.capture !== undefined) {
		if (fields.capture !== 'all' && fields.capture !== 'failed' && fields.capture !== 'none')
			fail('run request.capture', 'expected all, failed or none');
		request.capture = fields.capture;
	}
	return request;
}

export function parseCaptureRequest(value: unknown): CaptureRequest {
	const fields = record(value, 'capture request', [
		'id',
		'checkpoint',
		'set',
		'context',
		'screenshot',
		'timeoutMs',
	]);
	const request: CaptureRequest = { id: text(fields.id, 'capture request.id') };
	if (fields.checkpoint !== undefined)
		request.checkpoint = text(fields.checkpoint, 'capture request.checkpoint');
	if (fields.set !== undefined) request.set = text(fields.set, 'capture request.set');
	if (fields.context !== undefined)
		request.context = parseContext(fields.context, 'capture request.context', true);
	if (fields.screenshot !== undefined)
		request.screenshot = text(fields.screenshot, 'capture request.screenshot');
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, 'capture request.timeoutMs', 1, 60_000);
	return request;
}

const CAPTURE_KINDS: readonly CaptureEntryKind[] = ['component', 'story', 'job', 'gate'];
const CAPTURE_LABEL = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/;
const CAPTURE_SET_ID = /^set-[0-9a-f]{12}$/;

function captureFilter(value: unknown, path: string): CaptureFilter {
	const filter = record(value, path, ['ids', 'file', 'tags', 'match', 'kind']);
	let kind: CaptureEntryKind[] | undefined;
	if (filter.kind !== undefined) {
		if (!Array.isArray(filter.kind) || filter.kind.length < 1)
			fail(`${path}.kind`, 'expected at least one kind');
		kind = filter.kind.map((item, index) => choice(item, `${path}.kind[${index}]`, CAPTURE_KINDS));
	}
	return {
		...(filter.ids === undefined ? {} : { ids: tagList(filter.ids, `${path}.ids`) }),
		...(filter.file === undefined ? {} : { file: text(filter.file, `${path}.file`) }),
		...(filter.tags === undefined ? {} : { tags: tagList(filter.tags, `${path}.tags`) }),
		...(filter.match === undefined ? {} : { match: text(filter.match, `${path}.match`) }),
		...(kind === undefined ? {} : { kind }),
	};
}

export function parseCaptureSetRequest(value: unknown): CaptureSetRequest {
	const path = 'capture set request';
	const fields = record(value, path, [
		'ids',
		'filter',
		'context',
		'checkpoint',
		'label',
		'axe',
		'timeoutMs',
		'workers',
	]);
	const request: CaptureSetRequest = {};
	if (fields.ids !== undefined) {
		if (!Array.isArray(fields.ids) || fields.ids.length < 1)
			fail(`${path}.ids`, 'expected at least one specimen id');
		request.ids = fields.ids.map((item, index) => text(item, `${path}.ids[${index}]`));
	}
	if (fields.filter !== undefined) request.filter = captureFilter(fields.filter, `${path}.filter`);
	if (request.ids !== undefined && request.filter !== undefined)
		fail(path, 'give ids or filter, not both');
	if (fields.context !== undefined)
		request.context = parseContext(fields.context, `${path}.context`, true);
	if (fields.checkpoint !== undefined)
		request.checkpoint = text(fields.checkpoint, `${path}.checkpoint`);
	if (fields.label !== undefined) {
		const label = text(fields.label, `${path}.label`, CAPTURE_LABEL);
		if (CAPTURE_SET_ID.test(label)) fail(`${path}.label`, 'must not match a capture set id');
		if (label.split('/').some((segment) => segment === '' || segment === '.' || segment === '..'))
			fail(`${path}.label`, 'must not contain empty or traversal path segments');
		request.label = label;
	}
	if (fields.axe !== undefined) {
		if (typeof fields.axe !== 'boolean') fail(`${path}.axe`, 'expected a boolean');
		request.axe = fields.axe;
	}
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, `${path}.timeoutMs`, 1, 60_000);
	if (fields.workers !== undefined)
		request.workers = integer(fields.workers, `${path}.workers`, 1, MAX_SUITE_WORKERS);
	return request;
}

export function parseCompareRequest(value: unknown): CompareRequest {
	const path = 'compare request';
	const fields = record(value, path, ['ids', 'context', 'checkpoint', 'timeoutMs', 'workers']);
	if (!Array.isArray(fields.ids) || fields.ids.length < 2 || fields.ids.length > 8)
		fail(`${path}.ids`, 'expected 2 to 8 specimen ids');
	const ids = fields.ids.map((item, index) => text(item, `${path}.ids[${index}]`));
	if (new Set(ids).size !== ids.length) fail(`${path}.ids`, 'variant ids must be unique');
	const request: CompareRequest = { ids };
	if (fields.context !== undefined)
		request.context = parseContext(fields.context, `${path}.context`, true);
	if (fields.checkpoint !== undefined)
		request.checkpoint = text(fields.checkpoint, `${path}.checkpoint`);
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, `${path}.timeoutMs`, 1, 60_000);
	if (fields.workers !== undefined)
		request.workers = integer(fields.workers, `${path}.workers`, 1, MAX_SUITE_WORKERS);
	return request;
}

const JOB_CAPTURE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function parseLabel(value: unknown, path: string): string {
	const label = text(value, path, CAPTURE_LABEL);
	if (CAPTURE_SET_ID.test(label)) fail(path, 'must not match a capture set id');
	if (label.split('/').some((segment) => segment === '' || segment === '.' || segment === '..'))
		fail(path, 'must not contain empty or traversal path segments');
	return label;
}

function parseJobPin(value: unknown, path: string): JobPin {
	const fields = record(value, path, ['clock']);
	const pin: JobPin = {};
	if (fields.clock !== undefined) {
		const clock = text(fields.clock, `${path}.clock`);
		if (!isValidIsoClock(clock))
			fail(`${path}.clock`, 'expected a calendar-valid ISO-8601 timestamp with timezone');
		pin.clock = clock;
	}
	return pin;
}

function parseSpecimenAction(value: unknown, path: string): SpecimenAction {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		fail(path, 'expected an action object');
	const keys = Object.keys(value);
	const fields = value as Fields;
	if (keys.length === 1 && keys[0] === 'click')
		return { click: text(fields.click, `${path}.click`) };
	if (keys.length === 1 && keys[0] === 'focus')
		return { focus: text(fields.focus, `${path}.focus`) };
	if (keys.length === 1 && keys[0] === 'hover')
		return { hover: text(fields.hover, `${path}.hover`) };
	if (keys.length === 2 && Object.hasOwn(fields, 'fill') && Object.hasOwn(fields, 'value')) {
		if (typeof fields.value !== 'string') fail(`${path}.value`, 'expected a string');
		return { fill: text(fields.fill, `${path}.fill`), value: fields.value };
	}
	if (
		(keys.length === 1 && keys[0] === 'press') ||
		(keys.length === 2 && Object.hasOwn(fields, 'press') && Object.hasOwn(fields, 'target'))
	) {
		const action: SpecimenAction = { press: text(fields.press, `${path}.press`) };
		if (fields.target !== undefined) action.target = text(fields.target, `${path}.target`);
		return action;
	}
	fail(path, 'expected click, focus, hover, fill+value, or press action');
}

function parseJobBefore(value: unknown, path: string): JobBeforeAction[] {
	if (!Array.isArray(value) || value.length < 1)
		fail(path, 'expected a non-empty array of before actions');
	return value.map((item, index) => {
		const itemPath = `${path}[${index}]`;
		const fields = record(item, itemPath, ['action']);
		return { action: parseSpecimenAction(fields.action, `${itemPath}.action`) };
	});
}

function parseJobCapturePoint(value: unknown, path: string): JobCapturePoint {
	const fields = record(value, path, ['after', 'name', 'before']);
	return {
		after: text(fields.after, `${path}.after`),
		name: text(fields.name, `${path}.name`, JOB_CAPTURE_NAME),
		...(fields.before === undefined
			? {}
			: { before: parseJobBefore(fields.before, `${path}.before`) }),
	};
}

function parseJobConfig(value: unknown, path: string): JobConfig {
	const fields = record(value, path, ['scenario', 'target', 'runner', 'pin', 'captures']);
	if (!Array.isArray(fields.captures) || fields.captures.length < 1)
		fail(`${path}.captures`, 'expected at least one capture point');
	const captures = fields.captures.map((item, index) =>
		parseJobCapturePoint(item, `${path}.captures[${index}]`)
	);
	if (new Set(captures.map((c) => c.name)).size !== captures.length)
		fail(`${path}.captures`, 'capture names must be unique');
	if (new Set(captures.map((c) => c.after)).size !== captures.length)
		fail(`${path}.captures`, 'capture step descriptions must be unique');
	return {
		scenario: text(fields.scenario, `${path}.scenario`),
		target: text(fields.target, `${path}.target`),
		...(fields.runner === undefined ? {} : { runner: text(fields.runner, `${path}.runner`) }),
		...(fields.pin === undefined ? {} : { pin: parseJobPin(fields.pin, `${path}.pin`) }),
		captures,
	};
}

function parseJobScenarioStep(value: unknown, path: string): JobScenarioStep {
	const fields = record(value, path, [
		'step',
		'command',
		'description',
		'input',
		'expect',
		'continueOnFailure',
	]);
	const step: JobScenarioStep = {
		step: integer(fields.step, `${path}.step`, 1, Number.MAX_SAFE_INTEGER),
		command: text(fields.command, `${path}.command`),
	};
	if (fields.description !== undefined) {
		if (typeof fields.description !== 'string') fail(`${path}.description`, 'expected a string');
		step.description = fields.description;
	}
	if (fields.input !== undefined) {
		if (typeof fields.input !== 'object' || fields.input === null || Array.isArray(fields.input))
			fail(`${path}.input`, 'expected an object');
		step.input = fields.input as Record<string, unknown>;
	}
	if (fields.expect !== undefined) step.expect = fields.expect;
	if (fields.continueOnFailure !== undefined) {
		if (typeof fields.continueOnFailure !== 'boolean')
			fail(`${path}.continueOnFailure`, 'expected a boolean');
		step.continueOnFailure = fields.continueOnFailure;
	}
	return step;
}

export function parseJobScenario(value: unknown, path = 'job scenario'): JobScenario {
	const fields = record(value, path, ['job', 'name', 'description', 'fixture', 'steps']);
	if (!Array.isArray(fields.steps) || fields.steps.length < 1)
		fail(`${path}.steps`, 'expected at least one step');
	const steps = fields.steps.map((item, index) =>
		parseJobScenarioStep(item, `${path}.steps[${index}]`)
	);
	for (let index = 0; index < steps.length; index++) {
		const expected = index + 1;
		if (steps[index]?.step !== expected)
			fail(
				`${path}.steps[${index}].step`,
				`expected sequential 1-based step number ${expected}, received ${steps[index]?.step}`
			);
	}
	const scenario: JobScenario = {
		job: text(fields.job, `${path}.job`),
		steps,
	};
	if (fields.name !== undefined) {
		if (typeof fields.name !== 'string') fail(`${path}.name`, 'expected a string');
		scenario.name = fields.name;
	}
	if (fields.description !== undefined) {
		if (typeof fields.description !== 'string') fail(`${path}.description`, 'expected a string');
		scenario.description = fields.description;
	}
	if (fields.fixture !== undefined) scenario.fixture = fields.fixture;
	return scenario;
}

export function parseCheckpointsRequest(value: unknown): CheckpointsRequest {
	const path = 'checkpoints request';
	const fields = record(value, path, [
		'id',
		'checkpoints',
		'context',
		'label',
		'axe',
		'timeoutMs',
		'pin',
	]);
	const request: CheckpointsRequest = { id: text(fields.id, `${path}.id`) };
	if (fields.checkpoints !== undefined) {
		if (!Array.isArray(fields.checkpoints) || fields.checkpoints.length < 1)
			fail(`${path}.checkpoints`, 'expected at least one checkpoint name');
		const names = fields.checkpoints.map((item, index) =>
			text(item, `${path}.checkpoints[${index}]`)
		);
		if (new Set(names).size !== names.length)
			fail(`${path}.checkpoints`, 'checkpoint names must be unique');
		request.checkpoints = names;
	}
	if (fields.context !== undefined)
		request.context = parseContext(fields.context, `${path}.context`, true);
	if (fields.label !== undefined) request.label = parseLabel(fields.label, `${path}.label`);
	if (fields.axe !== undefined) {
		if (typeof fields.axe !== 'boolean') fail(`${path}.axe`, 'expected a boolean');
		request.axe = fields.axe;
	}
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, `${path}.timeoutMs`, 1, 60_000);
	if (fields.pin !== undefined) request.pin = parseJobPin(fields.pin, `${path}.pin`);
	return request;
}

function parseJobCaptureSelection(value: unknown, path: string): number | JobCaptureSelection {
	if (typeof value === 'number') {
		return integer(value, path, 1, Number.MAX_SAFE_INTEGER);
	}
	const fields = record(value, path, ['step', 'name', 'before']);
	return {
		step: integer(fields.step, `${path}.step`, 1, Number.MAX_SAFE_INTEGER),
		...(fields.name === undefined
			? {}
			: { name: text(fields.name, `${path}.name`, JOB_CAPTURE_NAME) }),
		...(fields.before === undefined
			? {}
			: { before: parseJobBefore(fields.before, `${path}.before`) }),
	};
}

export function parseJobCreateRequest(value: unknown): JobCreateRequest {
	const path = 'job create request';
	const fields = record(value, path, [
		'id',
		'title',
		'scenario',
		'module',
		'exportName',
		'target',
		'runner',
		'pin',
		'captures',
	]);
	if (!Array.isArray(fields.captures) || fields.captures.length < 1)
		fail(`${path}.captures`, 'expected at least one capture step');
	const captures = fields.captures.map((item, index) =>
		parseJobCaptureSelection(item, `${path}.captures[${index}]`)
	);
	return {
		id: text(fields.id, `${path}.id`, /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
		...(fields.title === undefined ? {} : { title: text(fields.title, `${path}.title`) }),
		scenario: text(fields.scenario, `${path}.scenario`),
		module: text(fields.module, `${path}.module`),
		exportName: text(fields.exportName, `${path}.exportName`),
		target: text(fields.target, `${path}.target`),
		...(fields.runner === undefined ? {} : { runner: text(fields.runner, `${path}.runner`) }),
		...(fields.pin === undefined ? {} : { pin: parseJobPin(fields.pin, `${path}.pin`) }),
		captures,
	};
}

export function parseJobRunRequest(value: unknown): JobRunRequest {
	const path = 'job run request';
	const fields = record(value, path, [
		'id',
		'context',
		'label',
		'axe',
		'timeoutMs',
		'pin',
		'scenario',
	]);
	const request: JobRunRequest = { id: text(fields.id, `${path}.id`) };
	if (fields.context !== undefined)
		request.context = parseContext(fields.context, `${path}.context`, true);
	if (fields.label !== undefined) request.label = parseLabel(fields.label, `${path}.label`);
	if (fields.axe !== undefined) {
		if (typeof fields.axe !== 'boolean') fail(`${path}.axe`, 'expected a boolean');
		request.axe = fields.axe;
	}
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, `${path}.timeoutMs`, 1, 60_000);
	if (fields.pin !== undefined) request.pin = parseJobPin(fields.pin, `${path}.pin`);
	if (fields.scenario !== undefined)
		request.scenario = parseJobScenario(fields.scenario, `${path}.scenario`);
	return request;
}

const PACK_LIBRARY = /^[a-z][a-z0-9-]{0,63}$/;
const PACK_PREFIX = /^[a-z][a-z0-9._]*-$/;
const PACK_TAG = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;
const PACK_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const PACK_SETUP = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const SINGLE_LINE_TEXT = /^[^\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]*$/;
const CONTEXT_THEMES = ['dark', 'high-contrast', 'light'] as const;

function singleLineText(value: unknown, path: string, max: number): string {
	const raw = text(value, path);
	if ([...raw].length > max) fail(path, `expected at most ${max} characters`);
	if (!SINGLE_LINE_TEXT.test(raw) || !raw.isWellFormed())
		fail(path, 'must not contain control characters, line breaks or lone surrogates');
	return raw;
}

function patternSetupBinding(value: unknown, path: string): PatternSetupBinding {
	const fields = record(value, path, ['library', 'pattern', 'setup']);
	const pattern = text(fields.pattern, `${path}.pattern`, PACK_PATTERN);
	if (pattern.length > 64) fail(`${path}.pattern`, 'expected at most 64 characters');
	const setup = text(fields.setup, `${path}.setup`, PACK_SETUP);
	if (setup.length > 64) fail(`${path}.setup`, 'expected at most 64 characters');
	const binding: PatternSetupBinding = { pattern, setup };
	if (fields.library !== undefined) {
		const library = text(fields.library, `${path}.library`, PACK_LIBRARY);
		binding.library = library;
	}
	return binding;
}

function implementationContexts(value: unknown, path: string): ImplementationContexts {
	const fields = record(value, path, ['viewport', 'themes', 'reason']);
	const reason = singleLineText(fields.reason, `${path}.reason`, 240);
	let viewport: ImplementationContexts['viewport'];
	if (fields.viewport !== undefined) {
		const bounds = record(fields.viewport, `${path}.viewport`, [
			'minWidth',
			'maxWidth',
			'minHeight',
			'maxHeight',
		]);
		const parsed: NonNullable<ImplementationContexts['viewport']> = {};
		if (bounds.minWidth !== undefined)
			parsed.minWidth = integer(bounds.minWidth, `${path}.viewport.minWidth`, 1, 8192);
		if (bounds.maxWidth !== undefined)
			parsed.maxWidth = integer(bounds.maxWidth, `${path}.viewport.maxWidth`, 1, 8192);
		if (bounds.minHeight !== undefined)
			parsed.minHeight = integer(bounds.minHeight, `${path}.viewport.minHeight`, 1, 8192);
		if (bounds.maxHeight !== undefined)
			parsed.maxHeight = integer(bounds.maxHeight, `${path}.viewport.maxHeight`, 1, 8192);
		if (Object.keys(parsed).length === 0)
			fail(`${path}.viewport`, 'expected at least one viewport bound');
		if (
			parsed.minWidth !== undefined &&
			parsed.maxWidth !== undefined &&
			parsed.maxWidth < parsed.minWidth
		)
			fail(`${path}.viewport.maxWidth`, 'must be >= minWidth');
		if (
			parsed.minHeight !== undefined &&
			parsed.maxHeight !== undefined &&
			parsed.maxHeight < parsed.minHeight
		)
			fail(`${path}.viewport.maxHeight`, 'must be >= minHeight');
		viewport = parsed;
	}
	let themes: ImplementationContexts['themes'];
	if (fields.themes !== undefined) {
		if (!Array.isArray(fields.themes) || fields.themes.length < 1 || fields.themes.length > 3)
			fail(`${path}.themes`, 'expected between 1 and 3 themes');
		const parsed = fields.themes.map((theme, index) =>
			choice(theme, `${path}.themes[${index}]`, CONTEXT_THEMES)
		);
		for (let index = 1; index < parsed.length; index++) {
			if ((parsed[index - 1] as string) >= (parsed[index] as string))
				fail(`${path}.themes`, 'expected unique themes in ascending order');
		}
		themes = parsed;
	}
	if (viewport === undefined && themes === undefined)
		fail(path, 'expected at least one of viewport or themes');
	return {
		...(viewport === undefined ? {} : { viewport }),
		...(themes === undefined ? {} : { themes }),
		reason,
	};
}

function specimens(value: unknown): NonNullable<BenchConfig['specimens']> {
	if (!Array.isArray(value) || value.length < 1)
		fail('configuration.specimens', 'expected at least one specimen');
	return value.map((item: unknown, index) => {
		const path = `configuration.specimens[${index}]`;
		const entry = record(item, path, [
			'id',
			'title',
			'module',
			'exportName',
			'component',
			'themes',
			'patternSetup',
			'contexts',
			'job',
		]);
		return {
			id: text(entry.id, `${path}.id`, /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
			title: text(entry.title, `${path}.title`),
			module: text(entry.module, `${path}.module`),
			exportName: text(entry.exportName, `${path}.exportName`),
			...(entry.component === undefined
				? {}
				: {
						component: text(entry.component, `${path}.component`, /^[a-z][a-z0-9]*-[a-z0-9-]+$/),
					}),
			...(entry.themes === undefined
				? {}
				: { themes: themeSupport(entry.themes, `${path}.themes`) }),
			...(entry.patternSetup === undefined
				? {}
				: { patternSetup: patternSetupBinding(entry.patternSetup, `${path}.patternSetup`) }),
			...(entry.contexts === undefined
				? {}
				: { contexts: implementationContexts(entry.contexts, `${path}.contexts`) }),
			...(entry.job === undefined ? {} : { job: parseJobConfig(entry.job, `${path}.job`) }),
		};
	});
}

function stories(value: unknown): NonNullable<BenchConfig['stories']> {
	if (!Array.isArray(value) || value.length < 1)
		fail('configuration.stories', 'expected at least one stories specifier');
	return value.map((item: unknown, index) => {
		const path = `configuration.stories[${index}]`;
		if (typeof item === 'string') return text(item, path);
		const entry = record(item, path, ['directory', 'files', 'titlePrefix']);
		return {
			directory: text(entry.directory, `${path}.directory`),
			...(entry.files === undefined ? {} : { files: text(entry.files, `${path}.files`) }),
			...(entry.titlePrefix === undefined
				? {}
				: {
						titlePrefix:
							typeof entry.titlePrefix === 'string'
								? entry.titlePrefix
								: fail(`${path}.titlePrefix`, 'expected a string'),
					}),
		};
	});
}

function tagList(value: unknown, path: string): string[] {
	if (!Array.isArray(value)) fail(path, 'expected an array of tags');
	return value.map((tag, index) => text(tag, `${path}[${index}]`));
}

function testTags(value: unknown): NonNullable<BenchConfig['test']> {
	const fields = record(value, 'configuration.test', [
		'include',
		'exclude',
		'skip',
		'workers',
		'timeoutMs',
		'settledAccessibility',
	]);
	const result: NonNullable<BenchConfig['test']> = {};
	for (const key of ['include', 'exclude', 'skip'] as const)
		if (fields[key] !== undefined) result[key] = tagList(fields[key], `configuration.test.${key}`);
	if (fields.workers !== undefined)
		result.workers = integer(fields.workers, 'configuration.test.workers', 1, MAX_SUITE_WORKERS);
	if (fields.timeoutMs !== undefined)
		result.timeoutMs = integer(fields.timeoutMs, 'configuration.test.timeoutMs', 1, 60_000);
	if (fields.settledAccessibility !== undefined) {
		if (typeof fields.settledAccessibility !== 'boolean')
			fail('configuration.test.settledAccessibility', 'expected a boolean');
		result.settledAccessibility = fields.settledAccessibility;
	}
	return result;
}

/** Validate a `staticDirs[].to` mount path: rooted at `/`, with no traversal or platform escapes. */
export function isSafeStaticMount(to: string): boolean {
	if (!to.startsWith('/') || to.includes('\\')) return false;
	for (let i = 0; i < to.length; i++) {
		const code = to.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) return false;
	}
	if (to === '/') return true;
	const trimmed = to.endsWith('/') ? to.slice(1, -1) : to.slice(1);
	if (!trimmed) return false;
	const segments = trimmed.split('/');
	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		if (!segment || segment === '.' || segment === '..') return false;
		if (i === 0 && /^[a-zA-Z]:/.test(segment)) return false;
	}
	return true;
}

function staticDirs(value: unknown): NonNullable<BenchConfig['staticDirs']> {
	if (!Array.isArray(value)) fail('configuration.staticDirs', 'expected an array of directories');
	return value.map((item, index) => {
		const path = `configuration.staticDirs[${index}]`;
		if (typeof item === 'string') return text(item, path);
		const fields = record(item, path, ['from', 'to']);
		const to = text(fields.to, `${path}.to`);
		if (!to.startsWith('/')) fail(`${path}.to`, 'expected a path starting with /');
		if (!isSafeStaticMount(to))
			fail(`${path}.to`, 'must be a normalized mount path without traversal segments');
		return { from: text(fields.from, `${path}.from`), to };
	});
}

/**
 * An `http` or `https` origin with its effective port written out (`https://fonts.example.com:443`),
 * so the host's rule admits that port alone. A host starting with `.` is refused: Chromium's
 * bypass rules read it as every subdomain.
 */
function origin(value: unknown, path: string): string {
	const entry = text(value, path);
	const example = 'expected an origin such as https://fonts.example.com';
	if (entry.includes('*')) fail(path, `${example}; wildcards are not supported`);
	let url: URL;
	try {
		url = new URL(entry);
	} catch {
		fail(path, example);
	}
	const bare = url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
	const web = url.protocol === 'http:' || url.protocol === 'https:';
	if (!web || !bare || !/^https?:\/\/[^/]/i.test(entry)) fail(path, example);
	if (url.hostname.startsWith('.'))
		fail(path, `${example}; a host starting with '.' would admit every subdomain`);
	const port = url.port || (url.protocol === 'https:' ? '443' : '80');
	return `${url.protocol}//${url.hostname}:${port}`;
}

function networkConfig(value: unknown): NonNullable<BenchConfig['network']> {
	const fields = record(value, 'configuration.network', ['allow']);
	if (fields.allow === undefined) return {};
	if (!Array.isArray(fields.allow))
		fail('configuration.network.allow', 'expected an array of origins');
	return {
		allow: fields.allow.map((item, index) => origin(item, `configuration.network.allow[${index}]`)),
	};
}

function profileConfig(value: unknown): NonNullable<BenchConfig['profile']> {
	const fields = record(value, 'configuration.profile', ['baselines']);
	return fields.baselines === undefined
		? {}
		: { baselines: text(fields.baselines, 'configuration.profile.baselines') };
}

function coverageConfig(value: unknown): NonNullable<BenchConfig['coverage']> {
	const fields = record(value, 'configuration.coverage', ['waivers']);
	if (fields.waivers === undefined) return {};
	const waivers = record(fields.waivers, 'configuration.coverage.waivers', ['version', 'entries']);
	if (!Array.isArray(waivers.entries))
		fail('configuration.coverage.waivers.entries', 'expected an array');
	return {
		waivers: {
			version: text(waivers.version, 'configuration.coverage.waivers.version'),
			entries: waivers.entries.map((item, index) => {
				const path = `configuration.coverage.waivers.entries[${index}]`;
				const entry = record(item, path, ['component', 'obligation', 'reason']);
				return {
					component: text(entry.component, `${path}.component`),
					obligation: text(entry.obligation, `${path}.obligation`),
					reason: text(entry.reason, `${path}.reason`),
				};
			}),
		},
	};
}

export function parseConfig(value: unknown): BenchConfig {
	const fields = record(value, 'configuration', [
		'specimens',
		'stories',
		'preview',
		'staticDirs',
		'network',
		'test',
		'plugins',
		'manifest',
		'profile',
		'coverage',
		'guides',
		'guideSources',
		'jobSources',
		'patterns',
		'patternSources',
		'defaults',
		'commandManifest',
		'patternBindings',
		'pack',
		'panel',
	]);
	if (
		fields.specimens === undefined &&
		fields.stories === undefined &&
		fields.commandManifest === undefined &&
		fields.panel === undefined
	)
		fail('configuration', 'expected specimens, stories, commandManifest, panel or a combination');
	if (fields.preview !== undefined && fields.stories === undefined)
		fail('configuration.preview', 'project annotations apply only to stories');
	if (fields.test !== undefined && fields.stories === undefined)
		fail('configuration.test', 'test tags apply only to stories');
	if (fields.guides !== undefined && fields.manifest === undefined)
		fail('configuration.guides', 'guides are checked against a manifest');
	if (fields.guideSources !== undefined && fields.manifest === undefined)
		fail('configuration.guideSources', 'guide sources are checked against a manifest');
	const patterns =
		fields.patterns === undefined
			? undefined
			: Array.isArray(fields.patterns)
				? fields.patterns.map((item, index) => text(item, `configuration.patterns[${index}]`))
				: fail('configuration.patterns', 'expected an array of file patterns');
	const patternSources =
		fields.patternSources === undefined
			? undefined
			: Array.isArray(fields.patternSources)
				? fields.patternSources.map((item, index) =>
						text(item, `configuration.patternSources[${index}]`)
					)
				: fail('configuration.patternSources', 'expected an array of pack paths or package names');
	const patternBindings =
		fields.patternBindings === undefined ? undefined : parsePatternBindings(fields.patternBindings);
	const pack = fields.pack === undefined ? undefined : packConfig(fields.pack);
	if (pack !== undefined && fields.manifest === undefined) {
		const hasAppElements =
			(pack.dependencies !== undefined && pack.dependencies.length > 0) ||
			pack.localElements !== undefined;
		if (patterns === undefined || patterns.length === 0 || !hasAppElements)
			fail(
				'configuration.pack',
				'a pack without a manifest requires patterns and at least one of pack.dependencies or pack.localElements'
			);
	}
	return {
		...(fields.specimens === undefined ? {} : { specimens: specimens(fields.specimens) }),
		...(fields.stories === undefined ? {} : { stories: stories(fields.stories) }),
		...(fields.preview === undefined
			? {}
			: { preview: text(fields.preview, 'configuration.preview') }),
		...(fields.staticDirs === undefined ? {} : { staticDirs: staticDirs(fields.staticDirs) }),
		...(fields.network === undefined ? {} : { network: networkConfig(fields.network) }),
		...(fields.test === undefined ? {} : { test: testTags(fields.test) }),
		...(fields.plugins === undefined
			? {}
			: {
					plugins: Array.isArray(fields.plugins)
						? fields.plugins.map((item, index) => text(item, `configuration.plugins[${index}]`))
						: fail('configuration.plugins', 'expected an array of module paths'),
				}),
		...(fields.manifest === undefined
			? {}
			: { manifest: text(fields.manifest, 'configuration.manifest') }),
		...(fields.profile === undefined ? {} : { profile: profileConfig(fields.profile) }),
		...(fields.coverage === undefined ? {} : { coverage: coverageConfig(fields.coverage) }),
		...(fields.guides === undefined
			? {}
			: {
					guides: Array.isArray(fields.guides)
						? fields.guides.map((item, index) => text(item, `configuration.guides[${index}]`))
						: fail('configuration.guides', 'expected an array of file patterns'),
				}),
		...(fields.guideSources === undefined
			? {}
			: {
					guideSources: Array.isArray(fields.guideSources)
						? fields.guideSources.map((item, index) =>
								text(item, `configuration.guideSources[${index}]`)
							)
						: fail('configuration.guideSources', 'expected an array of module paths'),
				}),
		...(fields.jobSources === undefined
			? {}
			: {
					jobSources: Array.isArray(fields.jobSources)
						? fields.jobSources.map((item, index) =>
								text(item, `configuration.jobSources[${index}]`)
							)
						: fail('configuration.jobSources', 'expected an array of module paths'),
				}),
		...(patterns === undefined ? {} : { patterns }),
		...(patternSources === undefined ? {} : { patternSources }),
		...(fields.defaults === undefined
			? {}
			: { defaults: text(fields.defaults, 'configuration.defaults') }),
		...(fields.commandManifest === undefined
			? {}
			: { commandManifest: text(fields.commandManifest, 'configuration.commandManifest') }),
		...(patternBindings === undefined ? {} : { patternBindings }),
		...(pack === undefined ? {} : { pack }),
		...(fields.panel === undefined ? {} : { panel: parsePanelConfig(fields.panel) }),
	};
}

function packLocalElements(value: unknown): PackLocalElements {
	const path = 'configuration.pack.localElements';
	const fields = record(value, path, ['manifest', 'tags']);
	const manifest =
		fields.manifest === undefined ? undefined : text(fields.manifest, `${path}.manifest`);
	let tags: string[] | undefined;
	if (fields.tags !== undefined) {
		if (!Array.isArray(fields.tags) || fields.tags.length < 1 || fields.tags.length > 256)
			fail(`${path}.tags`, 'expected between 1 and 256 custom element tags');
		tags = fields.tags.map((item, index) => {
			const tag = text(item, `${path}.tags[${index}]`, PACK_TAG);
			if (tag.length > 100) fail(`${path}.tags[${index}]`, 'expected at most 100 characters');
			return tag;
		});
		if (new Set(tags).size !== tags.length) fail(`${path}.tags`, 'names a tag twice');
	}
	if (manifest === undefined && tags === undefined)
		fail(path, 'expected at least one of manifest or non-empty tags');
	return {
		...(manifest === undefined ? {} : { manifest }),
		...(tags === undefined ? {} : { tags }),
	};
}

function packConfig(value: unknown): NonNullable<BenchConfig['pack']> {
	const fields = record(value, 'configuration.pack', [
		'library',
		'title',
		'prefix',
		'directory',
		'package',
		'import',
		'examples',
		'dependencies',
		'localElements',
		'themeStylesheet',
	]);
	const library = text(fields.library, 'configuration.pack.library');
	if (!PACK_LIBRARY.test(library))
		fail('configuration.pack.library', 'expected a library id: lowercase letters, digits and -');
	const prefix = text(fields.prefix, 'configuration.pack.prefix');
	if (!PACK_PREFIX.test(prefix) || prefix.length > 32)
		fail('configuration.pack.prefix', 'expected a tag prefix ending in -, such as example-');
	const title = text(fields.title, 'configuration.pack.title');
	if ([...title].length > 80) fail('configuration.pack.title', 'expected at most 80 characters');
	const dependencies =
		fields.dependencies === undefined
			? undefined
			: Array.isArray(fields.dependencies)
				? fields.dependencies.map((item, index) =>
						text(item, `configuration.pack.dependencies[${index}]`)
					)
				: fail('configuration.pack.dependencies', 'expected an array of manifest or pack paths');
	const localElements =
		fields.localElements === undefined ? undefined : packLocalElements(fields.localElements);
	return {
		library,
		title,
		prefix,
		directory: text(fields.directory, 'configuration.pack.directory'),
		package: text(fields.package, 'configuration.pack.package'),
		...(fields.import === undefined
			? {}
			: { import: text(fields.import, 'configuration.pack.import') }),
		...(fields.examples === undefined
			? {}
			: { examples: integer(fields.examples, 'configuration.pack.examples', 0, 16) }),
		...(dependencies === undefined ? {} : { dependencies }),
		...(localElements === undefined ? {} : { localElements }),
		...(fields.themeStylesheet === undefined
			? {}
			: { themeStylesheet: text(fields.themeStylesheet, 'configuration.pack.themeStylesheet') }),
	};
}

const POINT_MOVE_DIRECTIONS = ['parent', 'child', 'next', 'previous', 'component'] as const;

function parseDimensionPairText(value: string, path: string, heightOptional: boolean): string {
	const pattern = heightOptional ? /^([1-9]\d*)(?:x([1-9]\d*))?$/ : /^([1-9]\d*)x([1-9]\d*)$/;
	const match = pattern.exec(value);
	if (!match) fail(path, `expected ${heightOptional ? 'WIDTH or WIDTHxHEIGHT' : 'WIDTHxHEIGHT'}`);
	const width = Number(match[1]);
	const height = match[2] === undefined ? undefined : Number(match[2]);
	if (!Number.isSafeInteger(width) || width < 1 || width > 8192)
		fail(`${path}.width`, 'expected an integer from 1 to 8192');
	if (height !== undefined && (!Number.isSafeInteger(height) || height < 1 || height > 8192))
		fail(`${path}.height`, 'expected an integer from 1 to 8192');
	return value;
}

function parsePointTarget(value: unknown, path: string): PointTarget {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		fail(path, 'expected a selector or role target object');
	const raw = value as Fields;
	if ('selector' in raw) {
		const fields = record(raw, path, ['selector']);
		return { selector: text(fields.selector, `${path}.selector`) };
	}
	const fields = record(raw, path, ['role', 'name']);
	const role = text(fields.role, `${path}.role`);
	if (fields.name !== undefined && typeof fields.name !== 'string')
		fail(`${path}.name`, 'expected a string');
	return fields.name === undefined ? { role } : { role, name: fields.name };
}

function parsePointContextField(value: unknown, path: string): PointContextInput {
	const fields = record(value, path, CONTEXT_KEYS);
	const context: Fields = {};
	for (const key of CONTEXT_KEYS) {
		if (fields[key] === undefined) continue;
		if (key === 'viewport' && typeof fields[key] === 'string') {
			context.viewport = parseDimensionPairText(fields[key], `${path}.viewport`, false);
		} else if (key === 'container' && typeof fields[key] === 'string') {
			context.container = parseDimensionPairText(fields[key], `${path}.container`, true);
		} else {
			context[key] = contextField[key](fields[key], `${path}.${key}`);
		}
	}
	return context as PointContextInput;
}

export function parsePointRequest(value: unknown): PointRequest {
	const path = 'point request';
	const fields = record(value, path, [
		'pointer',
		'id',
		'context',
		'checkpoint',
		'target',
		'timeoutMs',
	]);
	const timeoutMs =
		fields.timeoutMs === undefined
			? undefined
			: integer(fields.timeoutMs, `${path}.timeoutMs`, 1, 60_000);
	const hasPointer = fields.pointer !== undefined;
	const hasNamed =
		fields.id !== undefined ||
		fields.target !== undefined ||
		fields.context !== undefined ||
		fields.checkpoint !== undefined;
	if (hasPointer) {
		if (hasNamed)
			fail(
				path,
				'provide either pointer or id and target (with optional context and checkpoint), not both'
			);
		if (typeof fields.pointer !== 'string') fail(`${path}.pointer`, 'expected a string');
		return timeoutMs === undefined
			? { pointer: fields.pointer }
			: { pointer: fields.pointer, timeoutMs };
	}
	if (fields.id === undefined || fields.target === undefined)
		fail(path, 'provide either pointer, or both id and target');
	return {
		id: text(fields.id, `${path}.id`),
		...(fields.context === undefined
			? {}
			: { context: parsePointContextField(fields.context, `${path}.context`) }),
		...(fields.checkpoint === undefined
			? {}
			: { checkpoint: text(fields.checkpoint, `${path}.checkpoint`) }),
		target: parsePointTarget(fields.target, `${path}.target`),
		...(timeoutMs === undefined ? {} : { timeoutMs }),
	};
}

export function parsePointMoveRequest(value: unknown): PointMoveRequest {
	const path = 'point move request';
	const fields = record(value, path, ['id', 'to', 'index', 'timeoutMs']);
	const id = text(fields.id, `${path}.id`);
	const to = choice<PointMoveDirection>(fields.to, `${path}.to`, POINT_MOVE_DIRECTIONS);
	let index: number | undefined;
	if (fields.index !== undefined) {
		if (typeof fields.index !== 'number' || !Number.isSafeInteger(fields.index) || fields.index < 0)
			fail(`${path}.index`, 'expected a non-negative integer');
		if (to !== 'child') fail(`${path}.index`, 'index applies only when to is "child"');
		index = fields.index;
	}
	const timeoutMs =
		fields.timeoutMs === undefined
			? undefined
			: integer(fields.timeoutMs, `${path}.timeoutMs`, 1, 60_000);
	return {
		id,
		to,
		...(index === undefined ? {} : { index }),
		...(timeoutMs === undefined ? {} : { timeoutMs }),
	};
}

export function parsePointCheckRequest(value: unknown): PointCheckRequest {
	const path = 'point check request';
	const fields = record(value, path, ['id', 'timeoutMs']);
	const id = text(fields.id, `${path}.id`);
	const timeoutMs =
		fields.timeoutMs === undefined
			? undefined
			: integer(fields.timeoutMs, `${path}.timeoutMs`, 1, 60_000);
	return timeoutMs === undefined ? { id } : { id, timeoutMs };
}

export { parseDesignCardListRequest, parseDesignReleaseRequest } from './card-validate.js';
export * from './decision-validate.js';
export * from './note-validate.js';
export { parseReviewRequest } from './review-validate.js';
