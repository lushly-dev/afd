// Generates approval-tokens.json, the approval token vectors every language loads
// (spec/command-metadata.md, "Approvals"; #458).
//
//   pnpm -F @lushly-dev/afd-core build && pnpm -F @lushly-dev/afd-server build
//   node spec/vectors/generate-approval-tokens.mjs
//   npx biome format --write spec/vectors/approval-tokens.json
//
// Canonical JSON comes from the TypeScript reference (`canonicalJson`). The tokens are built here
// from the documented format with fixed nonces, independently of the middleware, so the vectors
// pin the format rather than one implementation's output:
//
//   afdap1.<payload>.<mac>, both base64url without padding
//   payload: {"c":command,"i":input digest,"a":actor digest,"iat":ms,"exp":ms,"n":nonce}
//   digest:  HMAC-SHA256(secret, "<input|actor>\0<canonical JSON>"), base64url
//   mac:     HMAC-SHA256(secret, "afdap1.<payload>"), base64url
//   approvalId: SHA-256("approval\0<nonce>"), base64url (the approval summary's id for the token)
//
// packages/server/src/approval-vectors.test.ts calls approvalVectors() to check the file against
// the current code.
import { createHash, createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PREFIX = 'afdap1';
const SECRETS = {
	current: 'afd-approval-vectors-current-secret-0123456789',
	previous: 'afd-approval-vectors-previous-secret-0123456789',
	unknown: 'afd-approval-vectors-unknown-secret-0123456789',
};
/** 2026-10-26T12:00:00.000Z */
const NOW = Date.UTC(2026, 9, 26, 12);
const TTL_MS = 300_000;
const COMMANDS = ['todo-delete', 'todo-archive'];
const ACTORS = {
	agent: { kind: 'agent', id: 'advisor', label: 'Advisor', onBehalfOf: 'user-1' },
	'agent-relabelled': {
		kind: 'agent',
		id: 'advisor',
		label: 'Another label',
		onBehalfOf: 'user-1',
	},
	'agent-other-id': { kind: 'agent', id: 'reviewer', label: 'Advisor', onBehalfOf: 'user-1' },
	'agent-other-principal': { kind: 'agent', id: 'advisor', label: 'Advisor', onBehalfOf: 'user-2' },
	human: { kind: 'human', id: 'user-1' },
};

const base64url = (bytes) => Buffer.from(bytes).toString('base64url');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
/** A fixed 128-bit nonce for a case, so the file is the same on every run. */
const nonceFor = (description) =>
	base64url(createHash('sha256').update(`nonce\0${description}`).digest().subarray(0, 16));

/**
 * The approval summary's `approvalId` (spec/command-metadata.md, "The approval summary"): the
 * SHA-256 of `approval`, a zero byte and the evidence's single-use key, which for a token is its
 * nonce.
 */
const approvalIdFor = (singleUseKey) =>
	base64url(createHash('sha256').update(`approval\0${singleUseKey}`).digest());

/** The summary's `inputDigest`: the SHA-256 of the canonical JSON of the validated input. */
const inputDigestFor = (canonical) => base64url(createHash('sha256').update(canonical).digest());

function signed(payloadJson, secret = SECRETS.current) {
	const signingInput = `${PREFIX}.${base64url(Buffer.from(payloadJson))}`;
	return `${signingInput}.${base64url(hmac(secret, signingInput))}`;
}

/** Builds the binding cases and the tokens, with `canonicalJson` from the TypeScript reference. */
export function approvalVectors(canonicalJson) {
	const actorJson = (name) => {
		const actor = name === null ? undefined : ACTORS[name];
		return actor
			? canonicalJson({ kind: actor.kind, id: actor.id, onBehalfOf: actor.onBehalfOf })
			: 'null';
	};

	/** A token issued at `iat` for this call, signed with `secret`, and its payload. */
	function issue({ command = 'todo-delete', input, actor = 'agent', nonce, iat = NOW, secret }) {
		const key = secret ?? SECRETS.current;
		const payload = JSON.stringify({
			c: command,
			i: base64url(hmac(key, `input\0${canonicalJson(input)}`)),
			a: base64url(hmac(key, `actor\0${actorJson(actor)}`)),
			iat,
			exp: iat + TTL_MS,
			n: nonce,
		});
		return { payload, token: signed(payload, key) };
	}

	const binding = (description, input, actor = 'agent') => {
		const nonce = nonceFor(description);
		const { payload, token } = issue({ input, actor, nonce });
		return {
			description,
			command: 'todo-delete',
			input,
			actor,
			canonicalInput: canonicalJson(input),
			inputDigest: inputDigestFor(canonicalJson(input)),
			canonicalActor: actorJson(actor),
			nonce,
			approvalId: approvalIdFor(nonce),
			payload,
			token,
		};
	};

	const bindings = [
		binding('a flat object', { id: 42 }),
		binding('object keys sorted at every depth', {
			title: 'x',
			id: 42,
			nested: { z: true, a: false, m: { b: 2, a: 1 } },
		}),
		binding('arrays keep their order', { tags: ['b', 'a'], items: [{ y: 1, x: 2 }, 3, null] }),
		binding('strings escaped as JSON.stringify escapes them', {
			note: 'café ✓ "quoted" back\\slash /path <tag> \b\f\n\r\t \u0001 \u001f \u007f    ',
		}),
		binding('object keys sorted by UTF-16 code unit', {
			'': 1,
			'😀': 2,
			é: 3,
			z: 4,
			Z: 5,
			'': 6,
			'a b': 7,
		}),
		binding('numbers in JavaScript spelling', {
			integer: 42,
			negative: -7,
			zero: 0,
			half: 0.5,
			tenth: 0.1,
			third: 1 / 3,
			small: 1e-7,
			micro: 0.000001,
			tiny: 5e-324,
			exact: 1e20,
			large: 1e21,
			max: Number.MAX_VALUE,
			safe: Number.MAX_SAFE_INTEGER,
			negativeExponent: -2.5e-10,
			powerOfTwo: 2 ** -24,
		}),
		binding('literals and empty containers', { t: true, f: false, n: null, o: {}, a: [], s: '' }),
		binding('deep nesting', { a: { b: { c: { d: [[[]]] } } } }),
		binding('an actor without onBehalfOf', { id: 42 }, 'human'),
		binding('the actor label is not bound', { id: 42 }, 'agent-relabelled'),
		binding('no actor', { id: 42 }, null),
	];

	// Every verification case presents a token to the call it names, at `now`, through one
	// middleware configured with `secrets` (the first signs) and `replay`.
	const base = issue({ input: { id: 42 }, nonce: nonceFor('base') }).token;
	const [, basePayload, baseMac] = base.split('.');
	const withPayload = (json) => signed(JSON.stringify(json));
	const basePayloadJson = JSON.parse(Buffer.from(basePayload, 'base64url').toString('utf8'));
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
	// A 32-byte MAC is 43 characters; the last carries 4 data bits and 2 zero padding bits.
	const lastIndex = alphabet.indexOf(baseMac.at(-1));
	const respelledMac = baseMac.slice(0, -1) + alphabet[lastIndex | 1];
	const flipped = baseMac[10] === 'A' ? 'B' : 'A';

	const verify = (description, token, call = {}, expected = ['accepted']) => ({
		description,
		token,
		command: call.command ?? 'todo-delete',
		input: call.input ?? { id: 42 },
		actor: call.actor === undefined ? 'agent' : call.actor,
		...(call.now !== undefined && { now: call.now }),
		...(call.secrets && { secrets: call.secrets }),
		...(call.replay && { replay: call.replay }),
		expected,
	});

	const cases = [
		verify('single use: accepted once, then already used', base, {}, ['accepted', 'already-used']),
		verify('within the TTL: accepted every time', base, { replay: 'within-ttl' }, [
			'accepted',
			'accepted',
		]),
		verify('one millisecond before expiry', base, { now: NOW + TTL_MS - 1 }),
		verify('at expiry', base, { now: NOW + TTL_MS }, ['expired']),
		verify('another command', base, { command: 'todo-archive' }, ['command-mismatch']),
		verify('another input', base, { input: { id: 43 } }, ['input-mismatch']),
		verify(
			'the same input with its keys in another order',
			issue({ input: { a: 1, b: { d: 4, c: 3 } }, nonce: nonceFor('key order') }).token,
			{ input: { b: { c: 3, d: 4 }, a: 1 } }
		),
		verify('the same actor with another label', base, { actor: 'agent-relabelled' }),
		verify('another actor id', base, { actor: 'agent-other-id' }, ['actor-mismatch']),
		verify('the same agent for another principal', base, { actor: 'agent-other-principal' }, [
			'actor-mismatch',
		]),
		verify('an actor-bound token presented without an actor', base, { actor: null }, [
			'actor-mismatch',
		]),
		verify(
			'a token bound to no actor, presented by an agent',
			issue({ input: { id: 42 }, actor: null, nonce: nonceFor('no actor') }).token,
			{},
			['actor-mismatch']
		),
		verify(
			'a token signed with the previous secret during a rotation',
			issue({ input: { id: 42 }, nonce: nonceFor('rotation'), secret: SECRETS.previous }).token,
			{ secrets: ['current', 'previous'] }
		),
		verify(
			'a token signed with the previous secret after the rotation',
			issue({ input: { id: 42 }, nonce: nonceFor('rotation'), secret: SECRETS.previous }).token,
			{},
			['invalid-signature']
		),
		verify(
			'a token signed with an unknown secret',
			issue({ input: { id: 42 }, nonce: nonceFor('unknown'), secret: SECRETS.unknown }).token,
			{},
			['invalid-signature']
		),
		verify(
			'a payload changed after signing',
			`${PREFIX}.${base64url(Buffer.from(JSON.stringify({ ...basePayloadJson, c: 'todo-archive' })))}.${baseMac}`,
			{ command: 'todo-archive' },
			['invalid-signature']
		),
		verify(
			'a changed MAC',
			`${PREFIX}.${basePayload}.${baseMac.slice(0, 10)}${flipped}${baseMac.slice(11)}`,
			{},
			['invalid-signature']
		),
		verify(
			'the MAC spelled with nonzero padding bits, which decode to the same bytes',
			`${PREFIX}.${basePayload}.${respelledMac}`,
			{},
			['invalid-signature']
		),
		verify('an empty payload', `${PREFIX}..${baseMac}`, {}, ['invalid-signature']),
		verify(
			'expired and for another command: expiry is checked first',
			base,
			{
				now: NOW + TTL_MS,
				command: 'todo-archive',
			},
			['expired']
		),
		verify(
			'another command and another input: the command is checked first',
			base,
			{
				command: 'todo-archive',
				input: { id: 43 },
			},
			['command-mismatch']
		),
		verify('an empty string', '', {}, ['malformed']),
		verify('the prefix alone', PREFIX, {}, ['malformed']),
		verify('two parts', `${PREFIX}.${basePayload}`, {}, ['malformed']),
		verify('four parts', `${base}.extra`, {}, ['malformed']),
		verify('another prefix', `afdap2.${basePayload}.${baseMac}`, {}, ['malformed']),
		verify(
			'longer than 1024 characters',
			`${PREFIX}.${basePayload}.${baseMac}${'A'.repeat(1025 - base.length)}`,
			{},
			['malformed']
		),
		verify('a signed payload that is not JSON', signed('not json'), {}, ['malformed']),
		verify('a signed payload that is a JSON array', signed('[]'), {}, ['malformed']),
		verify(
			'a signed payload without a nonce',
			withPayload({ ...basePayloadJson, n: undefined }),
			{},
			['malformed']
		),
		verify(
			'a signed payload whose expiry is a string',
			withPayload({ ...basePayloadJson, exp: String(basePayloadJson.exp) }),
			{},
			['malformed']
		),
	];

	// Rule 6 (spec/command-metadata.md, "Approvals"): on MCP calls the held result leaves
	// `details.approvalToken` out unless the server opts in; non-MCP calls include it unless the
	// server opts out.
	const tokenDelivery = [
		{
			description: 'MCP call with default includeToken omits the token (rule 6)',
			command: 'todo-delete',
			input: { id: 42 },
			actor: 'agent',
			interface: 'mcp',
			expectedHasToken: false,
		},
		{
			description: 'agent call with default includeToken includes the token',
			command: 'todo-delete',
			input: { id: 42 },
			actor: 'agent',
			interface: 'agent',
			expectedHasToken: true,
		},
		{
			description: 'call without an interface and default includeToken includes the token',
			command: 'todo-delete',
			input: { id: 42 },
			actor: 'agent',
			interface: null,
			expectedHasToken: true,
		},
		{
			description: 'MCP call with includeToken: true opts in to returning the token',
			command: 'todo-delete',
			input: { id: 42 },
			actor: 'agent',
			interface: 'mcp',
			includeToken: true,
			expectedHasToken: true,
		},
		{
			description: 'non-MCP call with includeToken: false omits the token',
			command: 'todo-delete',
			input: { id: 42 },
			actor: 'agent',
			interface: 'agent',
			includeToken: false,
			expectedHasToken: false,
		},
		{
			description: 'MCP relay fallback with default includeToken omits the token (rule 6)',
			command: 'todo-delete',
			input: { id: 42 },
			actor: 'agent',
			interface: 'mcp',
			relay: 'mcp-elicitation',
			expectedHasToken: false,
		},
		{
			description: 'MCP relay fallback with includeToken: true opts in to returning the token',
			command: 'todo-delete',
			input: { id: 42 },
			actor: 'agent',
			interface: 'mcp',
			relay: 'mcp-elicitation',
			includeToken: true,
			expectedHasToken: true,
		},
	];

	return {
		description:
			'Approval tokens (spec/command-metadata.md, "Approvals"). Canonical JSON from the TypeScript reference; tokens built from the documented format with fixed nonces. Regenerate with node spec/vectors/generate-approval-tokens.mjs.',
		secrets: SECRETS,
		now: NOW,
		ttlMs: TTL_MS,
		commands: COMMANDS,
		actors: ACTORS,
		bindings,
		verify: cases,
		tokenDelivery,
		approvalIds: [
			{
				description: 'relay evidence: the single-use key is relay:<decisionId>',
				via: 'relay',
				singleUseKey: 'relay:decision-1',
				approvalId: approvalIdFor('relay:decision-1'),
			},
		],
	};
}

async function main() {
	const { canonicalJson } = await import('../../packages/server/dist/approval-crypto.js');
	const json = `${JSON.stringify(approvalVectors(canonicalJson), null, '\t')}\n`;
	if (process.argv.includes('--stdout')) process.stdout.write(json);
	else writeFileSync(new URL('./approval-tokens.json', import.meta.url), json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
