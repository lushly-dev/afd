/**
 * Checks the TypeScript approval middleware against `spec/vectors/approval-tokens.json`, the
 * approval token vectors every implementation loads (`spec/command-metadata.md`, "Approvals").
 *
 * The file is rebuilt by `approvalVectors()` in `spec/vectors/generate-approval-tokens.mjs`, which
 * builds its tokens from the documented format rather than through this middleware, so a change
 * to the token format or to canonical JSON fails here.
 */
import { readFileSync } from 'node:fs';
import type { Actor, CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { fixedClock } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { canonicalJson, createApprovalMiddleware } from './approval.js';

interface Binding {
	description: string;
	command: string;
	input: unknown;
	actor: string | null;
	canonicalInput: string;
	canonicalActor: string;
	nonce: string;
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

interface Vectors {
	secrets: Record<string, string>;
	now: number;
	ttlMs: number;
	commands: string[];
	actors: Record<string, Actor>;
	bindings: Binding[];
	verify: Verification[];
}

const VECTORS_DIR = new URL('../../../spec/vectors/', import.meta.url);
const vectors: Vectors = JSON.parse(
	readFileSync(new URL('approval-tokens.json', VECTORS_DIR), 'utf8')
);
const generator = (await import(new URL('generate-approval-tokens.mjs', VECTORS_DIR).href)) as {
	approvalVectors(canonical: typeof canonicalJson): Vectors;
};

/** One middleware, as each case configures it, in front of a handler that reports it ran. */
function gate(options: { now?: number; secrets?: string[]; replay?: Verification['replay'] } = {}) {
	const middleware = createApprovalMiddleware({
		secret: (options.secrets ?? ['current']).map((name) => vectors.secrets[name] as string),
		commands: vectors.commands.map((name) => ({ name, approval: 'required' as const })),
		clock: fixedClock(options.now ?? vectors.now),
		...(options.replay && { replay: options.replay }),
	});
	return (command: string, input: unknown, actor: string | null, approval?: string) => {
		const context: CommandContext = {
			...(actor !== null && { actor: vectors.actors[actor] }),
			...(approval !== undefined && { approval }),
		};
		return middleware(command, input, context, async () => ({ success: true, data: 'ran' }));
	};
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

		it('accepts the vector token', async () => {
			expect(
				outcome(await gate()(binding.command, binding.input, binding.actor, binding.token))
			).toBe('accepted');
		});
	});

	it.each(vectors.verify)('verifies $description', async (vector) => {
		const call = gate(vector);
		const outcomes: string[] = [];
		for (const _ of vector.expected) {
			outcomes.push(outcome(await call(vector.command, vector.input, vector.actor, vector.token)));
		}
		expect(outcomes).toEqual(vector.expected);
	});
});
