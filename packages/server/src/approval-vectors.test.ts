/**
 * Checks the TypeScript approval middleware against `spec/vectors/approval-tokens.json`, the
 * approval token vectors every implementation loads (`spec/approvals.md`, "Approvals").
 *
 * The file is rebuilt by `approvalVectors()` in `spec/vectors/generate-approval-tokens.mjs`, which
 * builds its tokens from the documented format rather than through this middleware, so a change
 * to the token format or to canonical JSON fails here.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Actor, CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { fixedClock } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { type ApprovalSummary, canonicalJson, createApprovalMiddleware } from './approval.js';

interface Binding {
	description: string;
	command: string;
	input: unknown;
	actor: string | null;
	canonicalInput: string;
	/** The approval summary's digest of the input ("The approval summary"). */
	inputDigest: string;
	canonicalActor: string;
	nonce: string;
	/** The approval summary's id for the token. */
	approvalId: string;
	payload: string;
	token: string;
}

interface Verification {
	description: string;
	token: string;
	command: string;
	input: unknown;
	actor: string | null;
	now?: number;
	secrets?: string[];
	replay?: 'single-use' | 'within-ttl';
	expected: string[];
}

interface TokenDelivery {
	description: string;
	command: string;
	input: unknown;
	actor: string | null;
	interface: CommandContext['interface'] | null;
	includeToken?: boolean;
	relay?: 'none' | 'mcp-elicitation';
	expectedHasToken: boolean;
}

interface Vectors {
	secrets: Record<string, string>;
	now: number;
	ttlMs: number;
	commands: string[];
	actors: Record<string, Actor>;
	bindings: Binding[];
	verify: Verification[];
	tokenDelivery: TokenDelivery[];
	/** Approval ids of evidence that is not a token. */
	approvalIds: { description: string; via: string; singleUseKey: string; approvalId: string }[];
}

const VECTORS_DIR = new URL('../../../spec/vectors/', import.meta.url);
const vectors: Vectors = JSON.parse(
	readFileSync(new URL('approval-tokens.json', VECTORS_DIR), 'utf8')
);
const generator = (await import(new URL('generate-approval-tokens.mjs', VECTORS_DIR).href)) as {
	approvalVectors(canonical: typeof canonicalJson): Vectors;
};

/** One middleware, as each case configures it, in front of a handler that reports it ran. */
function gate(
	options: {
		now?: number;
		secrets?: string[];
		replay?: Verification['replay'];
		includeToken?: boolean;
		relay?: TokenDelivery['relay'];
	} = {}
) {
	const middleware = createApprovalMiddleware({
		secret: (options.secrets ?? ['current']).map((name) => vectors.secrets[name] as string),
		commands: vectors.commands.map((name) => ({ name, approval: 'required' as const })),
		clock: fixedClock(options.now ?? vectors.now),
		...(options.replay && { replay: options.replay }),
		...(options.includeToken !== undefined && { includeToken: options.includeToken }),
		...(options.relay && { relay: options.relay }),
	});
	return (
		command: string,
		input: unknown,
		actor: string | null,
		approval?: string,
		iface?: CommandContext['interface'] | null
	) => {
		const context: CommandContext = {
			...(actor !== null && { actor: vectors.actors[actor] }),
			...(approval !== undefined && { approval }),
			...(iface !== undefined && iface !== null && { interface: iface }),
		};
		return middleware(command, input, context, async () => ({ success: true, data: 'ran' }));
	};
}

/** The approval summary's id for a single-use key, from its definition. */
function approvalIdOf(key: string): string {
	return createHash('sha256').update(`approval\0${key}`, 'utf8').digest('base64url');
}

function outcome(result: CommandResult): string {
	if (result.success) return 'accepted';
	expect(result.error?.code).toBe('APPROVAL_REQUIRED');
	return (result.error?.details as { reason?: string } | undefined)?.reason ?? 'held';
}

function issuedToken(result: CommandResult): string {
	expect(result.error?.code).toBe('APPROVAL_REQUIRED');
	return (result.error?.details as { approvalToken?: unknown } | undefined)
		?.approvalToken as string;
}

function payloadOf(token: string): string {
	return Buffer.from(token.split('.')[1] as string, 'base64url').toString('utf8');
}

describe('approval token vectors', () => {
	it('match what the generator builds from the current canonical JSON', () => {
		expect(generator.approvalVectors(canonicalJson)).toEqual(vectors);
	});

	describe.each(vectors.bindings)('$description', (binding) => {
		it('canonicalizes the input as the vector does', () => {
			expect(canonicalJson(binding.input)).toBe(binding.canonicalInput);
		});

		it('issues the vector payload, apart from its random nonce', async () => {
			const result = await gate()(binding.command, binding.input, binding.actor);
			const payload = payloadOf(issuedToken(result));
			const { n } = JSON.parse(payload) as { n: string };
			expect(Buffer.from(n, 'base64url')).toHaveLength(16);
			expect(payload).toBe(binding.payload.replace(binding.nonce, n));
		});

		it("gives the approval summary the binding's input digest and approval id", async () => {
			const summaries: ApprovalSummary[] = [];
			const middleware = createApprovalMiddleware({
				secret: vectors.secrets.current as string,
				commands: vectors.commands.map((name) => ({ name, approval: 'required' as const })),
				clock: fixedClock(vectors.now),
				onApprovalAccepted: (summary) => {
					summaries.push(summary);
				},
			});
			const context: CommandContext = {
				...(binding.actor !== null && { actor: vectors.actors[binding.actor] }),
				approval: binding.token,
			};
			await middleware(binding.command, binding.input, context, async () => ({ success: true }));
			expect(summaries).toEqual([
				{
					via: 'token',
					command: binding.command,
					inputDigest: binding.inputDigest,
					approvalId: binding.approvalId,
					issuedAt: vectors.now,
					expiresAt: vectors.now + vectors.ttlMs,
				},
			]);
			expect(binding.approvalId).toBe(approvalIdOf(binding.nonce));
		});

		it('accepts the vector token', async () => {
			expect(
				outcome(await gate()(binding.command, binding.input, binding.actor, binding.token))
			).toBe('accepted');
		});
	});

	it.each(vectors.approvalIds)('approval id: $description', (entry) => {
		expect(entry.approvalId).toBe(approvalIdOf(entry.singleUseKey));
	});

	it.each(vectors.verify)('verifies $description', async (vector) => {
		const call = gate(vector);
		const outcomes: string[] = [];
		for (const _ of vector.expected) {
			outcomes.push(outcome(await call(vector.command, vector.input, vector.actor, vector.token)));
		}
		expect(outcomes).toEqual(vector.expected);
	});

	it.each(vectors.tokenDelivery)('token delivery: $description', async (vector) => {
		const call = gate({
			...(vector.includeToken !== undefined && { includeToken: vector.includeToken }),
			...(vector.relay && { relay: vector.relay }),
		});
		const result = await call(
			vector.command,
			vector.input,
			vector.actor,
			undefined,
			vector.interface
		);
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('APPROVAL_REQUIRED');
		const details = result.error?.details as Record<string, unknown> | undefined;
		expect(details).toBeDefined();
		if (vector.expectedHasToken) {
			expect(typeof details?.approvalToken).toBe('string');
		} else {
			expect(details).not.toHaveProperty('approvalToken');
		}
	});
});
