import type {
	A11yRequest,
	BaselineRequest,
	BenchConfig,
	CaptureRequest,
	ContractRequest,
	CoverageRequest,
	MatrixAxes,
	MatrixRequest,
	ProfileRequest,
	SpecimenContext,
	SuiteFilter,
	SuiteRequest,
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

function suiteFilter(value: unknown, path: string): SuiteFilter {
	const filter = record(value, path, ['ids', 'file', 'tags', 'match']);
	return {
		...(filter.ids === undefined ? {} : { ids: tagList(filter.ids, `${path}.ids`) }),
		...(filter.file === undefined ? {} : { file: text(filter.file, `${path}.file`) }),
		...(filter.tags === undefined ? {} : { tags: tagList(filter.tags, `${path}.tags`) }),
		...(filter.match === undefined ? {} : { match: text(filter.match, `${path}.match`) }),
	};
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

export function parseCoverageRequest(value: unknown): CoverageRequest {
	const fields = record(value, 'coverage request', ['component', 'filter', 'timeoutMs', 'workers']);
	const request: CoverageRequest = {};
	if (fields.component !== undefined)
		request.component = text(fields.component, 'coverage request.component');
	if (fields.filter !== undefined)
		request.filter = suiteFilter(fields.filter, 'coverage request.filter');
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, 'coverage request.timeoutMs', 1, 60_000);
	if (fields.workers !== undefined)
		request.workers = integer(fields.workers, 'coverage request.workers', 1, MAX_SUITE_WORKERS);
	return request;
}

export function parseA11yRequest(value: unknown): A11yRequest {
	const fields = record(value, 'accessibility request', [
		'id',
		'filter',
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

export function parseCaptureRequest(value: unknown): CaptureRequest {
	const fields = record(value, 'capture request', [
		'id',
		'checkpoint',
		'context',
		'screenshot',
		'timeoutMs',
	]);
	const request: CaptureRequest = { id: text(fields.id, 'capture request.id') };
	if (fields.checkpoint !== undefined)
		request.checkpoint = text(fields.checkpoint, 'capture request.checkpoint');
	if (fields.context !== undefined)
		request.context = parseContext(fields.context, 'capture request.context', true);
	if (fields.screenshot !== undefined)
		request.screenshot = text(fields.screenshot, 'capture request.screenshot');
	if (fields.timeoutMs !== undefined)
		request.timeoutMs = integer(fields.timeoutMs, 'capture request.timeoutMs', 1, 60_000);
	return request;
}

function specimens(value: unknown): NonNullable<BenchConfig['specimens']> {
	if (!Array.isArray(value) || value.length < 1)
		fail('configuration.specimens', 'expected at least one specimen');
	return value.map((item: unknown, index) => {
		const path = `configuration.specimens[${index}]`;
		const entry = record(item, path, ['id', 'title', 'module', 'exportName', 'component']);
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
	]);
	const result: NonNullable<BenchConfig['test']> = {};
	for (const key of ['include', 'exclude', 'skip'] as const)
		if (fields[key] !== undefined) result[key] = tagList(fields[key], `configuration.test.${key}`);
	if (fields.workers !== undefined)
		result.workers = integer(fields.workers, 'configuration.test.workers', 1, MAX_SUITE_WORKERS);
	if (fields.timeoutMs !== undefined)
		result.timeoutMs = integer(fields.timeoutMs, 'configuration.test.timeoutMs', 1, 60_000);
	return result;
}

function staticDirs(value: unknown): NonNullable<BenchConfig['staticDirs']> {
	if (!Array.isArray(value)) fail('configuration.staticDirs', 'expected an array of directories');
	return value.map((item, index) => {
		const path = `configuration.staticDirs[${index}]`;
		if (typeof item === 'string') return text(item, path);
		const fields = record(item, path, ['from', 'to']);
		const to = text(fields.to, `${path}.to`);
		if (!to.startsWith('/')) fail(`${path}.to`, 'expected a path starting with /');
		return { from: text(fields.from, `${path}.from`), to };
	});
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
		'test',
		'plugins',
		'manifest',
		'profile',
		'coverage',
	]);
	if (fields.specimens === undefined && fields.stories === undefined)
		fail('configuration', 'expected specimens, stories or both');
	if (fields.preview !== undefined && fields.stories === undefined)
		fail('configuration.preview', 'project annotations apply only to stories');
	if (fields.test !== undefined && fields.stories === undefined)
		fail('configuration.test', 'test tags apply only to stories');
	return {
		...(fields.specimens === undefined ? {} : { specimens: specimens(fields.specimens) }),
		...(fields.stories === undefined ? {} : { stories: stories(fields.stories) }),
		...(fields.preview === undefined
			? {}
			: { preview: text(fields.preview, 'configuration.preview') }),
		...(fields.staticDirs === undefined ? {} : { staticDirs: staticDirs(fields.staticDirs) }),
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
	};
}
