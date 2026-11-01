/**
 * @fileoverview The `_meta` key rule (`spec/mcp-resources.md`, T2): which extra keys a command's
 * tool, a resource entry and a resource read's content item may carry.
 *
 * An extra key is allowed when it is either a prefixed key in MCP's `_meta` key format with a
 * prefix of two or more labels (`dev.umbel/origin`, `com.example/flags`) outside `dev.afd/` and
 * outside the prefixes MCP reserves, or exactly `ui`, the MCP Apps key. Every other key is
 * refused, so an extra entry can never replace an entry the server sets itself.
 */

/** The MCP Apps key. Its value must be an object, and a `resourceUri` in it a `ui://` string. */
export const MCP_APPS_META_KEY = 'ui';

/** One prefix label: a letter, then letters, digits and `-`, ending in a letter or digit. */
const LABEL = /^[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

/** A key name: begins and ends with a letter or digit, with `-`, `_` and `.` between. */
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** Deeper than this is not treated as JSON: it also stops a cycle. */
const MAX_JSON_DEPTH = 64;

/** Whether `value` is plain JSON: no `undefined`, function, symbol, bigint, NaN, Infinity or class instance. */
export function isJsonValue(value: unknown, depth = 0): boolean {
	if (depth > MAX_JSON_DEPTH) return false;
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
	if (typeof value !== 'object') return false;
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return false;
	return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

/**
 * Check one extra `_meta` entry against the key rule.
 *
 * `allowUi` is true for a command's tool and a read's content item, and false for a resource
 * entry (`ui` is not allowed on a listed resource).
 *
 * @returns The reason the entry is refused, naming the key, or `undefined` when it is allowed.
 */
export function checkMetaEntry(key: string, value: unknown, allowUi: boolean): string | undefined {
	const why = (reason: string) => `_meta key "${key}" ${reason}`;
	if (!isJsonValue(value)) return why('must hold a JSON value');
	if (key === MCP_APPS_META_KEY) {
		const uri = (value as { resourceUri?: unknown } | null)?.resourceUri;
		if (!allowUi) return why('is not allowed here (it belongs on a tool or a read)');
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			return why('must hold an object');
		}
		return uri === undefined || (typeof uri === 'string' && uri.startsWith('ui://'))
			? undefined
			: why('needs a resourceUri that begins ui://');
	}
	const [prefix = '', name, ...rest] = key.split('/');
	const labels = prefix.split('.');
	if (
		name === undefined ||
		rest.length > 0 ||
		labels.length < 2 ||
		!labels.every((label) => LABEL.test(label)) ||
		!NAME.test(name)
	) {
		return why(
			'must be a prefixed key with two or more labels (dev.example/name) or "ui", in MCP\'s key format'
		);
	}
	// Reserved prefixes are compared without regard to case, which only widens the refusal.
	return key.toLowerCase().startsWith('dev.afd/') ||
		['modelcontextprotocol', 'mcp'].includes((labels[1] as string).toLowerCase())
		? why('is under a prefix AFD or MCP reserves')
		: undefined;
}

/**
 * Refuse a command's `toolMeta` that breaks the key rule.
 *
 * @throws An error naming the command and the key.
 */
export function assertToolMeta(command: string, toolMeta: unknown): void {
	if (toolMeta === undefined) return;
	if (toolMeta === null || typeof toolMeta !== 'object' || Array.isArray(toolMeta)) {
		throw new Error(`command "${command}": toolMeta must be an object of _meta key to JSON value`);
	}
	for (const [key, value] of Object.entries(toolMeta)) {
		const reason = checkMetaEntry(key, value, true);
		if (reason) throw new Error(`command "${command}": ${reason}`);
	}
}
