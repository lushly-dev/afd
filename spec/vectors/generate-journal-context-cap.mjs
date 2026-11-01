// Generates journal-context-cap.json, the vectors for the journal's 4096-byte cap on a declared
// context field's value, which every language loads (spec/journal.md, "Declared context fields";
// #578).
//
//   pnpm -F @lushly-dev/afd-core build && pnpm -F @lushly-dev/afd-server build
//   node spec/vectors/generate-journal-context-cap.mjs
//   npx biome format --write spec/vectors/journal-context-cap.json
//
// Each case holds a value as JSON text, spelled as a caller might send it, so `1.0`, `1e21`,
// `€` escapes and whitespace reach every language's JSON reader. The cap measures the value's
// canonical JSON instead: object keys sorted, no whitespace, numbers as JavaScript writes them.
// Each text is padded with ASCII `x`s until its canonical JSON is a set number of bytes from the
// cap. `bytes` is the UTF-8 length of `JSON.stringify` of the parsed value (key order does not
// change it), and `expected` is what TypeScript's `journalContextFields` does with the value.
//
// packages/server/src/journal-context-cap-vectors.test.ts calls journalContextCapVectors() to
// check the file against the current code.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** `MAX_JOURNAL_CONTEXT_BYTES`. */
const MAX_BYTES = 4096;
/** The declared field each case is journaled under. */
const FIELD = 'scope';

const utf8Length = (text) => Buffer.byteLength(text, 'utf8');

/**
 * Each case: `json(pad)` builds the received text around `pad`, a run of `x`s inside a string, and
 * `offset` is how far the canonical JSON ends up from the cap.
 */
const CASES = [
	{
		description: 'an ASCII string at the cap',
		offset: 0,
		json: (pad) => `"${pad}"`,
	},
	{
		description: 'an ASCII string a byte under the cap',
		offset: -1,
		json: (pad) => `"${pad}"`,
	},
	{
		description: 'an ASCII string a byte over the cap',
		offset: 1,
		json: (pad) => `"${pad}"`,
	},
	{
		description:
			'an object received with whitespace and unsorted keys, at the cap once canonical: the received text is longer',
		offset: 0,
		json: (pad) => `{\n\t"project": "${pad}",\n\t"labels": [ "a", "b" ],\n\t"archived": false\n}`,
	},
	{
		description:
			'whole numbers received as 1.0, at the cap: JavaScript writes 1, 2.5, -3, 0 and 100',
		offset: 0,
		json: (pad) => `{"pad":"${pad}","weights":[1.0,2.50,-3.0,0.0,100.0,1.0e2]}`,
	},
	{
		description: 'exponents, a byte over the cap: JavaScript writes 1e+21 and 2e+22',
		offset: 1,
		json: (pad) => `{"limits":[1e21,1000000000000000000000,2E+22],"pad":"${pad}"}`,
	},
	{
		description:
			'large and small magnitudes, a byte over the cap: JavaScript writes 100000000000000000000, 0.000001 and 0.0000015 in full',
		offset: 1,
		json: (pad) => `{"pad":"${pad}","range":[1e20,1e-6,123456789012345680000,0.0000015]}`,
	},
	{
		description:
			'shortest round-trip decimals at the cap: 0.1 is 0.1, and 1e-7 and beyond take an exponent',
		offset: 0,
		json: (pad) =>
			`{"pad":"${pad}","ratios":[0.1,0.2,0.30000000000000004,0.3333333333333333,-2.5e-7,1e-7,5e-324,1.7976931348623157e308]}`,
	},
	{
		description: 'negative zero at the cap: JavaScript writes 0',
		offset: 0,
		json: (pad) => `{"offsets":[-0,-0.0,0.0],"pad":"${pad}"}`,
	},
	{
		description:
			'integers past 2^53, a byte over the cap: JavaScript writes the double it reads, so 99999999999999999 is 100000000000000000',
		offset: 1,
		json: (pad) =>
			`{"ids":[99999999999999999,-99999999999999999,9007199254740993,18446744073709551615],"pad":"${pad}"}`,
	},
	{
		description: 'two-byte characters at the cap',
		offset: 0,
		json: (pad) => `"${'é'.repeat(1000)}${pad}"`,
	},
	{
		description:
			'three-byte characters a byte over the cap, though far under 4096 characters or UTF-16 code units',
		offset: 1,
		json: (pad) => `"${'€'.repeat(1365)}${pad}"`,
	},
	{
		description: 'four-byte characters (UTF-16 surrogate pairs) at the cap',
		offset: 0,
		json: (pad) => `"${'😀'.repeat(1000)}${pad}"`,
	},
	{
		description:
			'escapes in the received text count as the characters they encode, at the cap: \\u00e9, \\u20ac, a surrogate pair and \\/',
		offset: 0,
		json: (pad) => `"${'\\u00e9\\u20ac\\ud83d\\ude00\\/'.repeat(100)}${pad}"`,
	},
	{
		description:
			'quotes, backslashes and the short escapes take two bytes each, a byte over the cap',
		offset: 1,
		json: (pad) => `"${'\\"\\\\\\b\\f\\n\\r\\t'.repeat(200)}${pad}"`,
	},
	{
		description: 'other control characters take six bytes each, a byte over the cap',
		offset: 1,
		json: (pad) => `"${'\\u0000\\u0001\\u001f'.repeat(200)}${pad}"`,
	},
	{
		description: 'DEL, U+2028 and U+2029 are written as they are, at the cap',
		offset: 0,
		json: (pad) => `"${'\\u007f\\u2028\\u2029'.repeat(200)}${pad}"`,
	},
	{
		description: 'escapes and multibyte characters in object keys count too, a byte over the cap',
		offset: 1,
		json: (pad) => `{"pad":"${pad}","é\\n\\u0001😀":1.0,"\\"key\\"":[]}`,
	},
	{
		description: 'nested objects and arrays with keys out of order, a byte under the cap',
		offset: -1,
		json: (pad) => `{"z":{"b":[true,false,null],"a":{}},"a":[[],{},""],"pad":"${pad}"}`,
	},
];

/** Builds the cases, with `journalContextFields` from the TypeScript reference. */
export function journalContextCapVectors(journalContextFields) {
	const canonicalBytes = (text) => utf8Length(JSON.stringify(JSON.parse(text)));

	const cases = CASES.map(({ description, offset, json }) => {
		const bytes = MAX_BYTES + offset;
		const padding = bytes - canonicalBytes(json(''));
		if (padding < 0) throw new Error(`${description}: longer than ${bytes} bytes unpadded`);
		const text = json('x'.repeat(padding));
		if (canonicalBytes(text) !== bytes) throw new Error(`${description}: not ${bytes} bytes`);

		const value = JSON.parse(text);
		const journaled = journalContextFields({ [FIELD]: value }, [FIELD]);
		const kept = journaled.context !== undefined && FIELD in journaled.context;
		const omitted = journaled.contextOmitted?.includes(FIELD) === true;
		if (kept === omitted || kept !== bytes <= MAX_BYTES) {
			throw new Error(`${description}: journalContextFields disagrees with the cap`);
		}
		return { description, json: text, bytes, expected: kept ? 'kept' : 'omitted' };
	});

	return {
		description:
			"The journal's cap on a declared context field's value (spec/journal.md, \"Declared context fields\"): at most maxBytes bytes of UTF-8 canonical JSON (object keys sorted, no whitespace, numbers as JavaScript writes them) is kept in `context`, and a larger value's name goes in `contextOmitted`. `json` is the value as received; `bytes` is the length of its canonical JSON. Expected values from the TypeScript reference. Regenerate with node spec/vectors/generate-journal-context-cap.mjs.",
		maxBytes: MAX_BYTES,
		field: FIELD,
		cases,
	};
}

async function main() {
	const { journalContextFields } = await import('../../packages/server/dist/journal.js');
	writeFileSync(
		new URL('./journal-context-cap.json', import.meta.url),
		`${JSON.stringify(journalContextCapVectors(journalContextFields), null, '\t')}\n`
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
