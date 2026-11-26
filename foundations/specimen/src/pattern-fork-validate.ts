/** Zod-free request validation for `specimen-pattern-fork`, `specimen-pattern-compare`, and `specimen-pattern-merge`. */

import type {
	PatternCompareRequest,
	PatternForkRequest,
	PatternMergeRequest,
	PatternMergeResolution,
} from './pattern-fork-types.js';
import type { WaivedKeepEntry } from './pattern-types.js';

const PATTERN_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const LIBRARY_ID = /^[a-z][a-z0-9-]{0,63}$/;
const STATEMENT_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;
const SEMVER =
	/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const KEY_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function fail(path: string, message: string): never {
	throw new TypeError(`Invalid ${path}: ${message}`);
}

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		fail(path, 'expected an object');
	const obj = value as Record<string, unknown>;
	const allowed = new Set(keys);
	for (const key of Object.keys(obj)) {
		if (!allowed.has(key)) fail(path, `unknown property "${key}"`);
	}
	return obj;
}

function text(value: unknown, path: string): string {
	if (typeof value !== 'string' || !value.trim()) fail(path, 'expected a non-empty string');
	return value;
}

function qualifiedPattern(value: unknown, path: string): string {
	const raw = text(value, path);
	const slash = raw.indexOf('/');
	if (slash <= 0 || raw.indexOf('/', slash + 1) >= 0) {
		fail(path, 'expected <library>/<pattern>');
	}
	const library = raw.slice(0, slash);
	const pattern = raw.slice(slash + 1);
	if (!LIBRARY_ID.test(library) || library.length > 64) {
		fail(path, `invalid library segment "${library}"`);
	}
	if (!PATTERN_ID.test(pattern) || pattern.length > 64) {
		fail(path, `invalid pattern segment "${pattern}"`);
	}
	return raw;
}

function patternId(value: unknown, path: string): string {
	const raw = text(value, path);
	if (!PATTERN_ID.test(raw) || raw.length > 64) {
		fail(path, `invalid pattern identifier "${raw}"`);
	}
	return raw;
}

function versionId(value: unknown, path: string): string {
	const raw = text(value, path);
	if (!SEMVER.test(raw) || raw.length > 64) {
		fail(path, `invalid semver "${raw}"`);
	}
	return raw;
}

function statementId(value: unknown, path: string): string {
	const raw = text(value, path);
	if (!STATEMENT_ID.test(raw) || raw.length > 128) {
		fail(path, `invalid statement identifier "${raw}"`);
	}
	return raw;
}

export function parsePatternForkRequest(value: unknown): PatternForkRequest {
	const path = 'specimen-pattern-fork request';
	const fields = record(value, path, ['source', 'target', 'bind']);
	const source = qualifiedPattern(fields.source, `${path}.source`);
	const target =
		fields.target === undefined ? undefined : patternId(fields.target, `${path}.target`);
	let bind: boolean | undefined;
	if (fields.bind !== undefined) {
		if (typeof fields.bind !== 'boolean') fail(`${path}.bind`, 'expected a boolean');
		bind = fields.bind;
	}
	return {
		source,
		...(target === undefined ? {} : { target }),
		...(bind === undefined ? {} : { bind }),
	};
}

export function parsePatternCompareRequest(value: unknown = {}): PatternCompareRequest {
	const path = 'specimen-pattern-compare request';
	const fields = record(value, path, ['pattern', 'upstreamVersion', 'onlyChanged']);
	const pattern =
		fields.pattern === undefined ? undefined : patternId(fields.pattern, `${path}.pattern`);
	const upstreamVersion =
		fields.upstreamVersion === undefined
			? undefined
			: versionId(fields.upstreamVersion, `${path}.upstreamVersion`);
	let onlyChanged: boolean | undefined;
	if (fields.onlyChanged !== undefined) {
		if (typeof fields.onlyChanged !== 'boolean') fail(`${path}.onlyChanged`, 'expected a boolean');
		onlyChanged = fields.onlyChanged;
	}
	return {
		...(pattern === undefined ? {} : { pattern }),
		...(upstreamVersion === undefined ? {} : { upstreamVersion }),
		...(onlyChanged === undefined ? {} : { onlyChanged }),
	};
}

export function parsePatternMergeRequest(value: unknown): PatternMergeRequest {
	const path = 'specimen-pattern-merge request';
	const fields = record(value, path, [
		'pattern',
		'upstreamVersion',
		'accept',
		'decline',
		'waivers',
		'resolutions',
	]);
	const pattern = patternId(fields.pattern, `${path}.pattern`);
	const upstreamVersion =
		fields.upstreamVersion === undefined
			? undefined
			: versionId(fields.upstreamVersion, `${path}.upstreamVersion`);

	let accept: string[] | undefined;
	if (fields.accept !== undefined) {
		if (!Array.isArray(fields.accept) || fields.accept.length > 256)
			fail(`${path}.accept`, 'expected an array of at most 256 statement ids');
		accept = fields.accept.map((item, idx) => statementId(item, `${path}.accept[${idx}]`));
	}

	let decline: string[] | undefined;
	if (fields.decline !== undefined) {
		if (!Array.isArray(fields.decline) || fields.decline.length > 256)
			fail(`${path}.decline`, 'expected an array of at most 256 statement ids');
		decline = fields.decline.map((item, idx) => statementId(item, `${path}.decline[${idx}]`));
	}

	if ((accept?.length ?? 0) + (decline?.length ?? 0) === 0) {
		fail(path, 'provide at least one statement id in accept or decline');
	}

	let waivers: WaivedKeepEntry[] | undefined;
	if (fields.waivers !== undefined) {
		if (!Array.isArray(fields.waivers) || fields.waivers.length > 64)
			fail(`${path}.waivers`, 'expected an array of at most 64 waiver entries');
		waivers = fields.waivers.map((item, idx) => {
			const wPath = `${path}.waivers[${idx}]`;
			const w = record(item, wPath, ['id', 'reason']);
			return {
				id: statementId(w.id, `${wPath}.id`),
				reason: text(w.reason, `${wPath}.reason`),
			};
		});
	}

	let resolutions: PatternMergeResolution[] | undefined;
	if (fields.resolutions !== undefined) {
		if (!Array.isArray(fields.resolutions) || fields.resolutions.length > 256)
			fail(`${path}.resolutions`, 'expected an array of at most 256 resolution entries');
		resolutions = fields.resolutions.map((item, idx) => {
			const rPath = `${path}.resolutions[${idx}]`;
			const r = record(item, rPath, ['id', 'text', 'gate', 'setup']);
			const gate = r.gate === undefined ? undefined : text(r.gate, `${rPath}.gate`);
			if (gate !== undefined && (!KEY_ID.test(gate) || gate.length > 64)) {
				fail(`${rPath}.gate`, `invalid gate identifier "${gate}"`);
			}
			const setup = r.setup === undefined ? undefined : text(r.setup, `${rPath}.setup`);
			if (setup !== undefined && (!KEY_ID.test(setup) || setup.length > 64)) {
				fail(`${rPath}.setup`, `invalid setup identifier "${setup}"`);
			}
			return {
				id: statementId(r.id, `${rPath}.id`),
				text: text(r.text, `${rPath}.text`),
				...(gate === undefined ? {} : { gate }),
				...(setup === undefined ? {} : { setup }),
			};
		});
	}

	return {
		pattern,
		...(upstreamVersion === undefined ? {} : { upstreamVersion }),
		...(accept === undefined ? {} : { accept }),
		...(decline === undefined ? {} : { decline }),
		...(waivers === undefined ? {} : { waivers }),
		...(resolutions === undefined ? {} : { resolutions }),
	};
}
