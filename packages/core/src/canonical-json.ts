/**
 * @fileoverview Canonical JSON for approvals (`spec/approvals.md`, "Approvals", rule 3):
 * the text an approval token's input digest binds, and the text the approval display rules
 * measure. Shared by `@lushly-dev/afd-server`'s approval middleware and this package's
 * `approvalDisplay`, so the two can never disagree about what an input is.
 *
 * Internal: published as `@lushly-dev/afd-core/internal/canonical-json` for AFD's own packages.
 */

/**
 * Stable JSON for binding a token to an input: object keys sorted at every depth, otherwise the
 * `JSON.stringify` rules (`toJSON` is honoured, so a `Date` is its ISO string; `undefined`
 * members are dropped, and `undefined` in an array is `null`).
 *
 * It fails closed rather than collide: only plain objects, arrays, strings, finite numbers,
 * booleans, `null` and values with `toJSON` are accepted. A `bigint`, a non-finite number, a
 * cycle, or an object of any other kind (`Map`, `Set`, `RegExp`, typed arrays, class
 * instances) throws, so a call whose validated input holds one cannot be approved.
 *
 * @throws TypeError for a value it cannot encode without ambiguity
 */
export function canonicalJson(value: unknown): string {
	const ancestors = new Set<object>();

	function encode(raw: unknown): string | undefined {
		let value = raw;
		if (value !== null && typeof value === 'object' && 'toJSON' in value) {
			const toJSON = (value as { toJSON: unknown }).toJSON;
			if (typeof toJSON === 'function') value = toJSON.call(value);
		}
		switch (typeof value) {
			case 'string':
			case 'boolean':
				return JSON.stringify(value);
			case 'number':
				if (!Number.isFinite(value)) {
					throw new TypeError('Cannot bind an approval to a non-finite number');
				}
				return JSON.stringify(value);
			case 'bigint':
				throw new TypeError('Cannot bind an approval to a bigint');
			case 'undefined':
			case 'function':
			case 'symbol':
				return undefined;
		}
		if (value === null) return 'null';

		const object = value as object;
		if (ancestors.has(object)) throw new TypeError('Cannot bind an approval to a cyclic input');
		ancestors.add(object);
		try {
			if (Array.isArray(object)) {
				return `[${object.map((item) => encode(item) ?? 'null').join(',')}]`;
			}
			const prototype = Object.getPrototypeOf(object);
			if (prototype !== Object.prototype && prototype !== null) {
				const kind = object.constructor?.name ?? 'object';
				throw new TypeError(`Cannot bind an approval to a ${kind}: use plain JSON input`);
			}
			const members: string[] = [];
			for (const key of Object.keys(object).sort()) {
				const member = encode((object as Record<string, unknown>)[key]);
				if (member !== undefined) members.push(`${JSON.stringify(key)}:${member}`);
			}
			return `{${members.join(',')}}`;
		} finally {
			ancestors.delete(object);
		}
	}

	return encode(value) ?? 'null';
}
