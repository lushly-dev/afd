import { isValidIsoClock } from './browser/clock-parse.js';
import {
	CARD_SCOPE_VALUES,
	CARD_SEVERITY_VALUES,
	type CardScope,
	type CardSeverity,
	type DesignCardListRequest,
	type DesignReleaseRequest,
	RELEASE_ID_PATTERN,
} from './card-types.js';

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

const SCOPE_OPTIONS = ['all', ...CARD_SCOPE_VALUES] as const;
const LIST_STATUS_OPTIONS = ['open', 'deferred', 'changes-requested', 'withdrawn', 'all'] as const;

const QUALIFIED_PATTERN_KEY = /^[a-z][a-z0-9-]{0,63}\/[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const MAX_PATTERN_BINDINGS = 256;

export function parsePatternBindings(
	value: unknown,
	path = 'configuration.patternBindings'
): Record<string, string> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		fail(path, 'expected a record of pattern id bindings');
	}
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length > MAX_PATTERN_BINDINGS) {
		fail(path, `expected at most ${MAX_PATTERN_BINDINGS} pattern bindings`);
	}
	const out: Record<string, string> = {};
	for (const [key, val] of entries) {
		if (!QUALIFIED_PATTERN_KEY.test(key) || key.length > 129) {
			fail(path, `invalid qualified pattern key "${key}" (expected <library>/<pattern>)`);
		}
		if (typeof val !== 'string' || !QUALIFIED_PATTERN_KEY.test(val) || val.length > 129) {
			fail(
				`${path}.${key}`,
				`invalid qualified pattern target "${String(val)}" (expected <library>/<pattern>)`
			);
		}
		out[key] = val;
	}
	return out;
}

export function parseDesignCardListRequest(value: unknown = {}): DesignCardListRequest {
	const path = 'design-card-list request';
	const fields = record(value, path, [
		'scope',
		'card',
		'status',
		'severity',
		'includeProvisional',
		'includeDecided',
		'limit',
		'after',
	]);

	let scope: ('all' | CardScope) | undefined;
	if (fields.scope !== undefined) {
		if (
			typeof fields.scope !== 'string' ||
			!(SCOPE_OPTIONS as readonly string[]).includes(fields.scope)
		) {
			fail(`${path}.scope`, `expected one of ${SCOPE_OPTIONS.join(', ')}`);
		}
		scope = fields.scope as 'all' | CardScope;
	}

	const card = fields.card === undefined ? undefined : text(fields.card, `${path}.card`);

	let status: DesignCardListRequest['status'];
	if (fields.status !== undefined) {
		if (
			typeof fields.status !== 'string' ||
			!(LIST_STATUS_OPTIONS as readonly string[]).includes(fields.status)
		) {
			fail(`${path}.status`, `expected one of ${LIST_STATUS_OPTIONS.join(', ')}`);
		}
		status = fields.status as DesignCardListRequest['status'];
	}

	let severity: CardSeverity | undefined;
	if (fields.severity !== undefined) {
		if (
			typeof fields.severity !== 'string' ||
			!(CARD_SEVERITY_VALUES as readonly string[]).includes(fields.severity)
		) {
			fail(`${path}.severity`, `expected one of ${CARD_SEVERITY_VALUES.join(', ')}`);
		}
		severity = fields.severity as CardSeverity;
	}

	let includeProvisional: boolean | undefined;
	if (fields.includeProvisional !== undefined) {
		if (typeof fields.includeProvisional !== 'boolean') {
			fail(`${path}.includeProvisional`, 'expected a boolean');
		}
		includeProvisional = fields.includeProvisional;
	}

	let includeDecided: boolean | undefined;
	if (fields.includeDecided !== undefined) {
		if (typeof fields.includeDecided !== 'boolean') {
			fail(`${path}.includeDecided`, 'expected a boolean');
		}
		includeDecided = fields.includeDecided;
	}

	let limit: number | undefined;
	if (fields.limit !== undefined) {
		if (
			typeof fields.limit !== 'number' ||
			!Number.isSafeInteger(fields.limit) ||
			fields.limit < 1 ||
			fields.limit > 200
		) {
			fail(`${path}.limit`, 'expected an integer from 1 to 200');
		}
		limit = fields.limit;
	}

	const after = fields.after === undefined ? undefined : text(fields.after, `${path}.after`);

	return {
		...(scope === undefined ? {} : { scope }),
		...(card === undefined ? {} : { card }),
		...(status === undefined ? {} : { status }),
		...(severity === undefined ? {} : { severity }),
		...(includeProvisional === undefined ? {} : { includeProvisional }),
		...(includeDecided === undefined ? {} : { includeDecided }),
		...(limit === undefined ? {} : { limit }),
		...(after === undefined ? {} : { after }),
	};
}

export function parseDesignReleaseRequest(value: unknown): DesignReleaseRequest {
	const path = 'design-release request';
	const fields = record(value, path, ['release', 'decisions', 'scope', 'releasedAt']);

	const release = text(fields.release, `${path}.release`);
	if (!RELEASE_ID_PATTERN.test(release.trim())) {
		fail(
			`${path}.release`,
			'expected a safe release identifier matching /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/'
		);
	}

	if (!Array.isArray(fields.decisions) || fields.decisions.length < 1) {
		fail(`${path}.decisions`, 'expected a non-empty array of decision ids');
	}
	const decisions = fields.decisions.map((item, idx) => text(item, `${path}.decisions[${idx}]`));
	if (new Set(decisions.map((id) => id.trim())).size !== decisions.length) {
		fail(`${path}.decisions`, 'decision ids must be unique');
	}

	let scope: ('all' | CardScope) | undefined;
	if (fields.scope !== undefined) {
		if (
			typeof fields.scope !== 'string' ||
			!(SCOPE_OPTIONS as readonly string[]).includes(fields.scope)
		) {
			fail(`${path}.scope`, `expected one of ${SCOPE_OPTIONS.join(', ')}`);
		}
		scope = fields.scope as 'all' | CardScope;
	}

	let releasedAt: string | undefined;
	if (fields.releasedAt !== undefined) {
		const raw = text(fields.releasedAt, `${path}.releasedAt`);
		if (!isValidIsoClock(raw.trim())) {
			fail(`${path}.releasedAt`, 'expected a calendar-valid ISO-8601 timestamp with timezone');
		}
		releasedAt = raw;
	}

	return {
		release,
		decisions,
		...(scope === undefined ? {} : { scope }),
		...(releasedAt === undefined ? {} : { releasedAt }),
	};
}
