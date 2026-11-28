// Generates approver-client.json: approval evidence from an approver client and the approval
// display rules (spec/command-metadata.md, "Approval evidence from an approver client" and
// "Approval display"; Loam phase 5, step 0c).
//
//   pnpm -F @lushly-dev/afd-core build
//   node spec/vectors/generate-approver-client.mjs
//   npx biome format --write spec/vectors/approver-client.json
//
// The display verdicts come from the TypeScript reference (`approvalDisplay`). The carrier's
// token payloads are built here from the documented format, independently of the middleware:
// an approver's token binds `principal\0` and the call's principal binding (M8) in `a`.
//
// packages/server/src/approver-client-vectors.test.ts calls approverClientVectors() to check the
// file against the current code.
import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SECRET = 'afd-approver-client-vectors-secret-0123456789';
/** 2026-10-26T12:00:00.000Z, as the approval token vectors. */
const NOW = Date.UTC(2026, 9, 26, 12);
const TTL_MS = 300_000;
const ISSUER = 'https://auth.example.com';

/** M4's default actor for these credentials. */
const caller = (subject, clientId, approver) => ({
	approver,
	credentials: { issuer: ISSUER, subject, clientId },
	actor: { kind: 'agent', id: clientId, onBehalfOf: subject },
});
const CALLERS = {
	shell: caller('person-1', 'loam-shell', true),
	// Another approver: the same person through another client is another principal.
	'shell-other': caller('person-1', 'other-shell', true),
	agent: caller('person-1', 'todo-agent', false),
};

const base64url = (bytes) => Buffer.from(bytes).toString('base64url');
const hmac = (data) => base64url(createHmac('sha256', SECRET).update(data).digest());

const repeat = (text, count) => text.repeat(count);
const nest = (depth, leaf) => {
	let value = leaf;
	for (let level = 0; level < depth; level += 1) value = [value];
	return value;
};
/** An object whose canonical JSON is exactly `length` UTF-16 code units, in 1000-unit strings. */
function sized(length) {
	const value = {};
	// {"a0":"xxx…",…}: every member is `"aN":"` + text + `"`, plus commas and braces.
	let used = 2;
	for (let index = 0; ; index += 1) {
		const key = `a${index}`;
		const overhead = key.length + 5 + (index > 0 ? 1 : 0);
		const room = length - used - overhead;
		if (room <= 1000) {
			value[key] = repeat('x', room);
			return value;
		}
		value[key] = repeat('x', 1000);
		used += overhead + 1000;
	}
}

/** One display case per rule, limit and hidden range. */
function displayInputs() {
	const cases = [
		['an empty input', {}],
		['a null input is shown as null', null],
		['an ordinary call', { id: 7, title: 'Buy tomatoes', tags: ['shopping'], done: false }],
		[
			'tabs, newlines, accents, other scripts and emoji with their presentation selector',
			{ text: 'Tomatoes\tin\nrow 3; café, Ångström; 花 שלום नमस्ते; 🍅 ❤️' },
		],
		['five combining marks in a row', { text: `z${repeat('̀', 5)}` }],
		['six combining marks in a row', { text: `z${repeat('̀', 6)}` }],
		['six combining marks in a key', { [`z${repeat('̀', 6)}`]: 1 }],
		['a string of exactly 2000 code units', { text: repeat('x', 2000) }],
		['a string of 2001 code units', { text: repeat('x', 2001) }],
		['1000 emoji: 2000 UTF-16 code units', { text: repeat('🍅', 1000) }],
		['1001 emoji: 2002 UTF-16 code units', { text: repeat('🍅', 1001) }],
		['a key of exactly 200 code units', { [repeat('k', 200)]: 1 }],
		['a key of 201 code units', { [repeat('k', 201)]: 1 }],
		['a value at depth 6', { a: nest(5, 1) }],
		['a value at depth 7', { a: nest(6, 1) }],
		['exactly 400 values, the input included', { a: Array.from({ length: 398 }, () => 0) }],
		['401 values', { a: Array.from({ length: 399 }, () => 0) }],
		['canonical JSON of exactly 8000 code units', sized(8000)],
		['canonical JSON of 8001 code units', sized(8001)],
		['the whole size is checked before any value', { ...sized(8001), z: '​' }],
		['keys in canonical order: "10" sorts before "9"', { 9: '​', 10: repeat('x', 2001) }],
		['depth first: the first key decides', { a: '‮', b: nest(6, 1) }],
		['a key is checked before its value', { '​': repeat('x', 2001) }],
		['a hidden character in a key', { 'na​me': 1 }],
		['a hidden character in a nested string', { a: [{ b: 'ok' }, { c: 'tab\tok', d: 'x\u0000' }] }],
		['numbers, booleans and null hide nothing', { a: 1.5, b: true, c: null, d: [] }],
	];
	// Each hidden range: its first and last code point, in a string. Surrogates are left out:
	// JSON text cannot carry an unpaired one to every language's reader.
	const ranges = [
		[0x00, 0x08],
		[0x0b, 0x1f],
		[0x7f, 0x9f],
		[0xad, 0xad],
		[0x34f, 0x34f],
		[0x61c, 0x61c],
		[0x115f, 0x1160],
		[0x17b4, 0x17b5],
		[0x180b, 0x180f],
		[0x200b, 0x200f],
		[0x2028, 0x2029],
		[0x202a, 0x202e],
		[0x2060, 0x206f],
		[0x2800, 0x2800],
		[0x3164, 0x3164],
		[0xfe00, 0xfe0d],
		[0xfeff, 0xfeff],
		[0xffa0, 0xffa0],
		[0xfff0, 0xfffb],
		[0x1bca0, 0x1bca3],
		[0x1d173, 0x1d17a],
		[0xe0000, 0xe0fff],
	];
	const hex = (code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
	for (const [first, last] of ranges) {
		for (const code of new Set([first, last])) {
			cases.push([`${hex(code)} is hidden`, { text: `a${String.fromCodePoint(code)}b` }]);
		}
	}
	// Their neighbours, and the code points the rules keep visible.
	for (const code of [
		0x09, 0x0a, 0x20, 0x7e, 0xa0, 0xae, 0x200a, 0x2010, 0x2027, 0x202f, 0x205f, 0x2070, 0xfe0e,
		0xfe0f, 0xfefe, 0xffef, 0xfffc, 0xfffd, 0x1bc9f, 0x1bca4, 0x1d172, 0x1d17b, 0xdffff, 0xe1000,
	]) {
		cases.push([`${hex(code)} is visible`, { text: `a${String.fromCodePoint(code)}b` }]);
	}
	return cases;
}

/** The carrier's cases: rules 2 to 5 over MCP, each a sequence of `tools/call`s. */
function carrierCases() {
	const token = (step) => ({ token: step });
	const held = (extra = {}) => ({ code: 'APPROVAL_REQUIRED', token: true, ...extra });
	return [
		{
			description:
				'rule 2: an approver gets the token, even from a client that can elicit, and its retry runs once',
			steps: [
				{ caller: 'shell', tool: 'todo-delete', arguments: { id: 7 }, expected: held(), runs: 0 },
				{
					caller: 'shell',
					tool: 'todo-delete',
					arguments: { id: 7 },
					approval: token(0),
					expected: { success: true },
					runs: 1,
				},
				{
					caller: 'shell',
					tool: 'todo-delete',
					arguments: { id: 7 },
					approval: token(0),
					expected: held({ reason: 'already-used' }),
					runs: 1,
				},
			],
		},
		{
			description: 'rule 2: afd-call carries the key for one command',
			steps: [
				{
					caller: 'shell',
					tool: 'afd-call',
					arguments: { command: 'todo-delete', input: { id: 7 } },
					expected: held(),
					runs: 0,
				},
				{
					caller: 'shell',
					tool: 'afd-call',
					arguments: { command: 'todo-delete', input: { id: 7 } },
					approval: token(0),
					expected: { success: true },
					runs: 1,
				},
			],
		},
		{
			description:
				'rule 2: from a caller that is not an approver, no token is issued and the key is ignored',
			steps: [
				{ caller: 'shell', tool: 'todo-delete', arguments: { id: 7 }, expected: held(), runs: 0 },
				{
					caller: 'agent',
					tool: 'todo-delete',
					arguments: { id: 7 },
					elicit: false,
					expected: { code: 'APPROVAL_REQUIRED', token: false },
					runs: 0,
				},
				{
					caller: 'agent',
					tool: 'todo-delete',
					arguments: { id: 7 },
					elicit: false,
					approval: token(0),
					expected: { code: 'APPROVAL_REQUIRED', token: false },
					runs: 0,
				},
				{
					caller: 'shell',
					tool: 'todo-delete',
					arguments: { id: 7 },
					approval: token(0),
					expected: { success: true },
					runs: 1,
				},
			],
		},
		{
			description: 'rule 2: the key on a command that needs no approval is ignored',
			steps: [
				{
					caller: 'shell',
					tool: 'todo-list',
					arguments: {},
					approval: 'afdap1.not-a-token',
					expected: { success: true },
					runs: 1,
				},
			],
		},
		{
			description: 'rule 3: an approver key on afd-batch or afd-pipe runs nothing',
			steps: [
				{ caller: 'shell', tool: 'todo-delete', arguments: { id: 7 }, expected: held(), runs: 0 },
				{
					caller: 'shell',
					tool: 'afd-batch',
					arguments: { commands: [{ command: 'todo-delete', input: { id: 7 } }] },
					approval: token(0),
					expected: { code: 'APPROVAL_REQUIRED', token: false },
					runs: 0,
				},
				{
					caller: 'shell',
					tool: 'afd-pipe',
					arguments: { steps: [{ command: 'todo-delete', input: { id: 7 } }] },
					approval: token(0),
					expected: { code: 'APPROVAL_REQUIRED', token: false },
					runs: 0,
				},
				{
					caller: 'shell',
					tool: 'todo-delete',
					arguments: { id: 7 },
					approval: token(0),
					expected: { success: true },
					runs: 1,
				},
			],
		},
		{
			description:
				'rule 4: another approver, even another client of the same person, cannot redeem the token',
			steps: [
				{ caller: 'shell', tool: 'todo-delete', arguments: { id: 7 }, expected: held(), runs: 0 },
				{
					caller: 'shell-other',
					tool: 'todo-delete',
					arguments: { id: 7 },
					approval: token(0),
					expected: held({ reason: 'credentials-mismatch' }),
					runs: 0,
				},
				{
					caller: 'shell',
					tool: 'todo-delete',
					arguments: { id: 7 },
					approval: token(0),
					expected: { success: true },
					runs: 1,
				},
			],
		},
		{
			description: 'rule 4: the token is bound to the input',
			steps: [
				{ caller: 'shell', tool: 'todo-delete', arguments: { id: 7 }, expected: held(), runs: 0 },
				{
					caller: 'shell',
					tool: 'todo-delete',
					arguments: { id: 8 },
					approval: token(0),
					expected: held({ reason: 'input-mismatch' }),
					runs: 0,
				},
			],
		},
		{
			description: 'rule 4: a token that is not one is malformed',
			steps: [
				{
					caller: 'shell',
					tool: 'todo-delete',
					arguments: { id: 7 },
					approval: 'afdap1.not-a-token',
					expected: held({ reason: 'malformed' }),
					runs: 0,
				},
			],
		},
		{
			description:
				'rule 5: the key in tool arguments is refused, from every caller and at any depth',
			steps: [
				{
					caller: 'shell',
					tool: 'todo-delete',
					arguments: { id: 7, 'dev.afd/approval': 'afdap1.x.y' },
					expected: { code: 'VALIDATION_ERROR' },
					runs: 0,
				},
				{
					caller: 'agent',
					tool: 'todo-delete',
					arguments: { id: 7, _meta: { 'dev.afd/approval': 'afdap1.x.y' } },
					expected: { code: 'VALIDATION_ERROR' },
					runs: 0,
				},
				{
					// A member named `__proto__`, which a parser building objects by assignment
					// turns into the prototype: still input, still refused.
					caller: 'agent',
					tool: 'todo-delete',
					arguments: { id: 7, ['__proto__']: { 'dev.afd/approval': 'afdap1.x.y' } },
					expected: { code: 'VALIDATION_ERROR' },
					runs: 0,
				},
				{
					caller: 'agent',
					tool: 'afd-call',
					arguments: {
						command: 'todo-delete',
						input: { id: 7 },
						meta: { 'dev.afd/approval': 'afdap1.x.y' },
					},
					expected: { code: 'VALIDATION_ERROR' },
					runs: 0,
				},
				{
					caller: 'agent',
					tool: 'afd-batch',
					arguments: {
						commands: [{ command: 'todo-list', input: { filter: [{ 'dev.afd/approval': 'x' }] } }],
					},
					expected: { code: 'VALIDATION_ERROR' },
					runs: 0,
				},
			],
		},
	];
}

/**
 * Builds the vectors. `approvalDisplay` and `canonicalJson` come from the TypeScript reference.
 */
export function approverClientVectors(approvalDisplay, canonicalJson) {
	const principal = (name) => {
		const { actor, credentials } = CALLERS[name];
		return canonicalJson({
			actor: { kind: actor.kind, id: actor.id, onBehalfOf: actor.onBehalfOf },
			credentials: {
				issuer: credentials.issuer,
				subject: credentials.subject,
				clientId: credentials.clientId,
			},
		});
	};
	const callers = Object.fromEntries(
		Object.entries(CALLERS).map(([name, value]) => [name, { ...value, principal: principal(name) }])
	);
	const command = (tool, args) => (tool === 'afd-call' ? [args.command, args.input] : [tool, args]);
	const cases = carrierCases().map((item) => ({
		...item,
		steps: item.steps.map(({ elicit = true, ...step }) => {
			const result = { ...step, elicit };
			if (step.expected.token) {
				const [name, input] = command(step.tool, step.arguments);
				result.expected = {
					...step.expected,
					payload: {
						c: name,
						i: hmac(`input\0${canonicalJson(input)}`),
						a: hmac(`principal\0${callers[step.caller].principal}`),
						iat: NOW,
						exp: NOW + TTL_MS,
					},
				};
			}
			return result;
		}),
	}));
	return {
		description:
			'Approval evidence from an approver client and the approval display rules (spec/command-metadata.md). Display verdicts from the TypeScript reference; token payloads built from the documented format. Regenerate with node spec/vectors/generate-approver-client.mjs.',
		gaps: {},
		display: {
			limits: {
				maxSerializedLength: 8000,
				maxStringLength: 2000,
				maxKeyLength: 200,
				maxDepth: 6,
				maxValues: 400,
			},
			cases: displayInputs().map(([description, input]) => {
				const verdict = approvalDisplay(input);
				return { description, input, expected: verdict.ok ? 'shown' : verdict.refusal };
			}),
		},
		carrier: {
			secret: SECRET,
			now: NOW,
			ttlMs: TTL_MS,
			commands: {
				'todo-delete': { approval: 'required', input: { id: 'number' } },
				'todo-list': { approval: 'not-required', input: {} },
			},
			callers,
			cases,
		},
	};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const core = await import('../../packages/core/dist/index.js');
	const { canonicalJson } = await import('../../packages/core/dist/canonical-json.js');
	const vectors = approverClientVectors(core.approvalDisplay, canonicalJson);
	const json = `${JSON.stringify(vectors, null, '\t')}\n`;
	if (process.argv.includes('--stdout')) {
		process.stdout.write(json);
	} else {
		writeFileSync(new URL('./approver-client.json', import.meta.url), json);
		console.log(
			`Wrote ${vectors.display.cases.length} display cases and ${vectors.carrier.cases.length} carrier cases`
		);
	}
}
