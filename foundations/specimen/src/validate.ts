import type { BenchConfig, CaptureRequest, SpecimenContext } from './types.js';

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
		const optional = partial || key === 'container';
		if (fields[key] === undefined) {
			if (!optional) fail(`${path}.${key}`, 'required');
			continue;
		}
		context[key] = contextField[key](fields[key], `${path}.${key}`);
	}
	return context as Partial<SpecimenContext>;
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

export function parseConfig(value: unknown): BenchConfig {
	const fields = record(value, 'configuration', ['specimens']);
	if (!Array.isArray(fields.specimens) || fields.specimens.length < 1)
		fail('configuration.specimens', 'expected at least one specimen');
	return {
		specimens: fields.specimens.map((item: unknown, index) => {
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
		}),
	};
}
