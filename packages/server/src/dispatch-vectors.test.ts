/**
 * Single-command dispatch-order vectors (`spec/dispatch.md`, `spec/vectors/dispatch.json`).
 *
 * Drives both `createDirectRegistry` (in-process registry dispatch) and `createMcpHandler`
 * (remote MCP `afd-call` with confirmation enforcement) through every case and validates every
 * returned `CommandResult` against `spec/schema/result.json`.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
	type ActorKind,
	type CommandContext,
	type CommandMiddleware,
	type CommandResult,
	type ExposeOptions,
	type Recovery,
	success,
} from '@lushly-dev/afd-core';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApprovalMiddleware } from './approval.js';
import { createContextCommands } from './bootstrap/registry.js';
import type { ContextField } from './context-fields.js';
import { createContextState } from './context-scope.js';
import { createDirectRegistry, type ExposeInterface } from './direct-registry.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';

interface DispatchCommandSpec {
	name: string;
	description: string;
	version: string;
	expose: ExposeOptions;
	contexts?: string[];
	confirmPrompt?: string;
	approval?: 'required' | 'not-required';
	behavior: 'echo' | 'throw';
}

interface DispatchCase {
	id: string;
	description: string;
	surface: 'registry' | 'mcp';
	gap?: string;
	withContextFields?: boolean;
	withApprovalMiddleware?: boolean;
	middleware?: 'record' | 'throw';
	onCommandThrows?: boolean;
	devMode?: boolean;
	call: {
		command: string;
		input: Record<string, unknown>;
		interface?: ExposeInterface;
		activeContext?: string;
		contextFields?: Record<string, unknown>;
		traceId?: string;
		actorKind?: ActorKind;
		confirm?: boolean;
	};
	expect: {
		success: boolean;
		code?: string;
		/** The error's recovery (`spec/recovery.md`, "Engine errors"); `null` for none. */
		recovery?: Recovery | null;
		retryable?: boolean;
		message?: string;
		data?: unknown;
		hooks: string[];
		stamped?: string[];
		onCommand?: boolean;
		onCommandSeesRawInput?: boolean;
		onError?: boolean;
	};
}

interface DispatchVectors {
	setup: {
		/** `plain`: the registry surface registers the context commands as plain commands. */
		contextCommands?: 'plain';
		contexts: string[];
		commands: DispatchCommandSpec[];
	};
	cases: DispatchCase[];
}

const vectors = JSON.parse(
	readFileSync(new URL('../../../spec/vectors/dispatch.json', import.meta.url), 'utf8')
) as DispatchVectors;

const resultValidator = (() => {
	const validator = new AjvJsonSchemaValidator();
	const errorSchema = JSON.parse(
		readFileSync(new URL('../../../spec/schema/error.json', import.meta.url), 'utf8')
	) as Parameters<AjvJsonSchemaValidator['getValidator']>[0];
	const resultSchema = JSON.parse(
		readFileSync(new URL('../../../spec/schema/result.json', import.meta.url), 'utf8')
	) as Parameters<AjvJsonSchemaValidator['getValidator']>[0];
	validator.getValidator(errorSchema);
	const validate = validator.getValidator(resultSchema);
	return (value: unknown) => {
		const outcome = validate(value);
		return { valid: outcome.valid, errors: outcome.valid ? '' : (outcome.errorMessage ?? '') };
	};
})();

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function inputSchemaFor(name: string): z.ZodType {
	switch (name) {
		case 'item-echo':
			return z.object({ text: z.string(), count: z.number().int().default(1) });
		case 'secret-rotate':
			return z.object({ reason: z.string() });
		case 'item-purge':
			return z.object({ scope: z.string() });
		case 'item-approve':
			return z.object({ id: z.string() });
		default:
			return z.object({});
	}
}

function buildCommands(hooks: string[]) {
	return vectors.setup.commands.map((spec) =>
		defineCommand({
			name: spec.name,
			description: spec.description,
			version: spec.version,
			expose: spec.expose,
			...(spec.contexts && { contexts: spec.contexts }),
			...(spec.confirmPrompt && { confirmPrompt: spec.confirmPrompt }),
			...(spec.approval && { approval: spec.approval }),
			input: inputSchemaFor(spec.name),
			handler: async (input) => {
				hooks.push('handler');
				if (spec.behavior === 'throw') {
					throw new Error('sensitive handler crash at /srv/secret');
				}
				return success(input);
			},
		})
	);
}

const declaredFields: ContextField[] = [
	{
		name: 'tenant',
		meta: 'dev.example/tenant',
		schema: z.string().min(1),
		required: true,
	},
];

function buildMiddleware(testCase: DispatchCase, hooks: string[]): CommandMiddleware[] {
	if (testCase.middleware === 'throw') {
		return [
			async () => {
				hooks.push('mw1:before');
				throw new Error('sensitive middleware crash at /srv/secret');
			},
		];
	}
	const mw1: CommandMiddleware = async (_name, _input, _ctx, next) => {
		hooks.push('mw1:before');
		const result = await next();
		hooks.push('mw1:after');
		return result;
	};
	const mw2: CommandMiddleware = async (_name, _input, _ctx, next) => {
		hooks.push('mw2:before');
		const result = await next();
		hooks.push('mw2:after');
		return result;
	};
	if (testCase.withApprovalMiddleware) {
		const approval = createApprovalMiddleware({
			secret: 'dispatch-vector-test-secret-key-32b',
		});
		return [mw1, approval, mw2];
	}
	return [mw1, mw2];
}

async function callMcp(
	commands: ReturnType<typeof buildCommands>,
	middleware: CommandMiddleware[],
	testCase: DispatchCase
): Promise<CommandResult> {
	const handler = createMcpHandler({
		name: 'dispatch-vectors',
		version: '1.0.0',
		host: '127.0.0.1',
		commands,
		middleware,
		contexts: vectors.setup.contexts.map((name) => ({ name })),
		confirmations: 'enforce',
		devMode: testCase.devMode ?? false,
	});
	const server = createServer(handler);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
	});
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const args: Record<string, unknown> = {
		command: testCase.call.command,
		input: testCase.call.input,
		...(testCase.call.confirm !== undefined && { confirm: testCase.call.confirm }),
	};
	const response = await fetch(`${url}/message`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name: 'afd-call', arguments: args },
		}),
	});
	expect(response.status).toBe(200);
	const body = (await response.json()) as { result: { content: Array<{ text: string }> } };
	return JSON.parse(body.result.content[0]?.text ?? 'null') as CommandResult;
}

describe('spec/vectors/dispatch.json', () => {
	for (const testCase of vectors.cases) {
		it(`${testCase.id}: ${testCase.description}`, async () => {
			const hooks: string[] = [];
			const onCommandCalls: Array<{ name: string; input: unknown; result: CommandResult }> = [];
			const onErrorCalls: Error[] = [];

			const commands = buildCommands(hooks);
			const middleware = buildMiddleware(testCase, hooks);

			let result: CommandResult;
			if (testCase.surface === 'mcp') {
				result = await callMcp(commands, middleware, testCase);
			} else {
				const contexts = vectors.setup.contexts.map((name) => ({ name }));
				// The context commands as plain commands: no tool surface, no bootstrap or help
				// commands, so afd-context-list is callable and afd-discover and afd-help are not.
				const contextCommands =
					vectors.setup.contextCommands === 'plain'
						? createContextCommands(contexts, createContextState({ persistent: false }))
						: [];
				const registry = createDirectRegistry([...commands, ...contextCommands], {
					interface: (testCase.call.interface ?? 'agent') as Exclude<ExposeInterface, 'apps'>,
					contexts,
					...(testCase.withContextFields && { contextFields: declaredFields }),
					middleware,
					devMode: testCase.devMode ?? false,
					onCommand: (name, input, res) => {
						onCommandCalls.push({ name, input, result: res });
						if (testCase.onCommandThrows) {
							throw new Error('onCommand boom');
						}
					},
					onError: (err) => {
						onErrorCalls.push(err);
					},
				});

				const context: CommandContext = {
					...(testCase.call.traceId && { traceId: testCase.call.traceId }),
					...(testCase.call.actorKind && { actor: { kind: testCase.call.actorKind } }),
					...(testCase.call.contextFields ?? {}),
				};
				result = await registry.execute(testCase.call.command, testCase.call.input, context, {
					...(testCase.call.activeContext && { activeContext: testCase.call.activeContext }),
				});
			}

			// Every dispatch result conforms to spec/schema/result.json.
			const schemaCheck = resultValidator(JSON.parse(JSON.stringify(result)));
			expect(schemaCheck.valid, `${testCase.id} schema: ${schemaCheck.errors}`).toBe(true);

			expect(result.success).toBe(testCase.expect.success);
			if (testCase.expect.code !== undefined) {
				expect(result.error?.code).toBe(testCase.expect.code);
			}
			if (testCase.expect.recovery !== undefined) {
				expect(result.error?.recovery, `${testCase.id} recovery`).toEqual(
					testCase.expect.recovery ?? undefined
				);
			}
			if (testCase.expect.retryable !== undefined) {
				expect(result.error?.retryable).toBe(testCase.expect.retryable);
			}
			if (testCase.expect.message !== undefined) {
				expect(result.error?.message).toBe(testCase.expect.message);
			}
			if (testCase.expect.data !== undefined) {
				expect(result.data).toEqual(testCase.expect.data);
			}
			expect(hooks).toEqual(testCase.expect.hooks);

			if (testCase.expect.stamped) {
				for (const field of testCase.expect.stamped) {
					expect(result.metadata?.[field], `stamped metadata.${field}`).toBeDefined();
				}
				if (testCase.call.traceId) {
					expect(result.metadata?.traceId).toBe(testCase.call.traceId);
				}
				if (testCase.call.actorKind) {
					expect(result.metadata?.actorKind).toBe(testCase.call.actorKind);
				}
				const cmd = vectors.setup.commands.find((c) => c.name === testCase.call.command);
				if (cmd?.version) {
					expect(result.metadata?.commandVersion).toBe(cmd.version);
				}
			}
			if (testCase.expect.onCommand !== undefined) {
				expect(onCommandCalls.length > 0).toBe(testCase.expect.onCommand);
			}
			if (testCase.expect.onCommandSeesRawInput) {
				expect(onCommandCalls[0]?.input).toEqual(testCase.call.input);
			}
			if (testCase.expect.onError !== undefined) {
				expect(onErrorCalls.length > 0).toBe(testCase.expect.onError);
			}
		});
	}
});
