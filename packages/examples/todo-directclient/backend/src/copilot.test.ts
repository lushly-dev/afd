/**
 * @fileoverview The copilot with a scripted model: its tools come from `listTools()`, `allow`
 * holds in look-only mode whatever the model sends, its calls run as an agent, and a clear waits
 * for the person.
 */

import { setStore, TodoStore } from '@afd/example-todo-ts/store';
import { createDirectClient, type DirectApprovalRequest } from '@lushly-dev/afd-client';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	allowedCommands,
	Copilot,
	type CopilotEvent,
	type CopilotModel,
	type ModelCall,
	type ModelMessage,
	type ModelTool,
} from './copilot.js';
import type { PageHost } from './page.js';
import { createCopilotRegistry } from './registry.js';

const READING = ['todo-get', 'todo-history', 'todo-list', 'todo-stats'];
const VIEW = ['view-state-get', 'view-state-list', 'view-state-set'];

/** A model that makes the given calls, one round each, then answers "done". */
function scripted(...rounds: ModelCall[][]): CopilotModel & {
	seen: { messages: ModelMessage[]; tools: ModelTool[] }[];
} {
	const seen: { messages: ModelMessage[]; tools: ModelTool[] }[] = [];
	return {
		seen,
		async respond({ messages, tools }) {
			seen.push({ messages: [...messages], tools: [...tools] });
			const calls = rounds[seen.length - 1];
			return calls ? { calls } : { text: 'done', calls: [] };
		},
	};
}

/** The tool results the model read in its last round. */
function lastResults(model: ReturnType<typeof scripted>) {
	const last = model.seen.at(-1)?.messages.at(-1);
	if (last?.role !== 'tool') throw new Error('The model read no tool results');
	return last.results.map(({ result }) => result);
}

let store: TodoStore;

beforeEach(() => {
	store = new TodoStore();
	setStore(store);
});

function copilot(
	model: CopilotModel,
	options: Partial<ConstructorParameters<typeof Copilot>[0]> = {}
) {
	return new Copilot({ registry: createCopilotRegistry({}), model, ...options });
}

describe('the model tools', () => {
	it('are the commands from listTools(), with their own JSON Schemas and no meta-tools', () => {
		const registry = createCopilotRegistry({});
		const tools = new Copilot({ registry, model: scripted() }).tools('change');
		expect(tools.map((tool) => tool.name).sort()).toEqual(
			[...allowedCommands(registry, 'change')].sort()
		);
		expect(tools).toHaveLength(16);
		expect(tools.some((tool) => tool.name.startsWith('afd-'))).toBe(false);
		const create = tools.find((tool) => tool.name === 'todo-create');
		expect(create?.parameters).toMatchObject({
			type: 'object',
			required: ['title'],
			properties: { priority: { enum: ['low', 'medium', 'high'] } },
		});
	});

	it("are only the reading commands and the page's view in look mode", () => {
		expect(
			copilot(scripted())
				.tools('look')
				.map((tool) => tool.name)
				.sort()
		).toEqual([...READING, ...VIEW].sort());
	});
});

describe('a turn', () => {
	it('runs the calls as the copilot, so the history names it', async () => {
		const model = scripted([{ name: 'todo-create', args: { title: 'Buy stamps' } }]);
		const turn = await copilot(model).run('Remind me to buy stamps', 'change');

		expect(turn.message).toBe('done');
		expect(turn.toolExecutions).toMatchObject([{ name: 'todo-create', success: true }]);
		const history = await createDirectClient(createCopilotRegistry({})).call<{
			entries: { command: string; actor: unknown }[];
		}>('todo-history', {});
		expect(history.data).toMatchObject({
			entries: [{ command: 'todo-create', actor: { kind: 'agent', id: 'todo-copilot' } }],
		});
	});

	it('refuses a change in look mode before it runs, whatever the model sends', async () => {
		const model = scripted([
			{ name: 'todo-create', args: { title: 'Sneaked in' } },
			{ name: 'afd-call', args: { command: 'todo-create', input: { title: 'Sneaked in' } } },
		]);
		const turn = await copilot(model).run('Add a todo', 'look');

		expect(turn.toolExecutions.map((call) => (call.result as { code: string }).code)).toEqual([
			'COMMAND_NOT_ALLOWED',
			'COMMAND_NOT_ALLOWED',
		]);
		expect(store.count()).toBe(0);
	});

	it('gives the model the whole result, so it can follow a suggestion', async () => {
		const model = scripted([{ name: 'todo-get', args: { id: 'missing' } }]);
		await copilot(model).run('Show todo missing', 'change');

		expect(lastResults(model)[0]).toMatchObject({
			success: false,
			error: { code: 'NOT_FOUND', suggestion: expect.any(String) },
		});
	});

	it('stops a model that keeps calling tools, keeping what already ran', async () => {
		const create = (title: string) => ({ name: 'todo-create', args: { title } });
		const model = scripted([create('one')], [create('two')], [create('three')]);
		const turn = await copilot(model, { maxRounds: 2 }).run('Add some', 'change');

		expect(turn.stopped).toBe('rounds');
		expect(turn.message).toContain('2 rounds');
		expect(turn.toolExecutions.map((call) => call.args.title)).toEqual(['one', 'two']);
		expect(store.count()).toBe(2);
	});

	it('stops before a round would go past the most calls for one message', async () => {
		const stats = { name: 'todo-stats', args: {} };
		const model = scripted([stats, stats], [stats, stats]);
		const turn = await copilot(model, { maxCalls: 3 }).run('Stats?', 'change');

		expect(turn.stopped).toBe('calls');
		expect(turn.toolExecutions).toHaveLength(2);
	});

	it('refuses limits that are not positive integers, so a blank setting cannot lift them', () => {
		expect(() => copilot(scripted(), { maxRounds: Number.NaN })).toThrow(RangeError);
		expect(() => copilot(scripted(), { maxCalls: 0 })).toThrow(RangeError);
	});

	it("returns each result with its call's id", async () => {
		const model = scripted([{ id: 'call-7', name: 'todo-stats', args: {} }]);
		await copilot(model).run('Stats?', 'change');
		const last = model.seen.at(-1)?.messages.at(-1);
		expect(last).toMatchObject({ role: 'tool', results: [{ id: 'call-7', name: 'todo-stats' }] });
	});

	it('ends when the signal aborts, before the next call runs', async () => {
		const cancel = new AbortController();
		const model: CopilotModel = {
			async respond() {
				cancel.abort();
				return { calls: [{ name: 'todo-create', args: { title: 'Too late' } }] };
			},
		};
		await expect(
			copilot(model).run('Add one', 'change', { signal: cancel.signal })
		).rejects.toThrow();
		expect(store.count()).toBe(0);
	});
});

describe("the page's view", () => {
	const filter = { status: 'pending', priority: 'high' };

	it('is set in the page that asked, even in look mode, with the page result returned', async () => {
		const ran: { command: string; input: Record<string, unknown> }[] = [];
		const page: PageHost = {
			async run(command, input) {
				ran.push({ command, input });
				return { success: true, data: { id: 'todo-filter', state: filter } };
			},
		};
		const model = scripted([
			{ name: 'view-state-set', args: { id: 'todo-filter', state: filter } },
		]);
		await copilot(model).run('Show my urgent open todos', 'look', { page });

		expect(ran).toEqual([
			{ command: 'view-state-set', input: { id: 'todo-filter', state: filter } },
		]);
		expect(lastResults(model)[0]).toMatchObject({ success: true, data: { state: filter } });
	});

	it('goes to the page of its own turn when two turns run at once', async () => {
		const pageOf = (name: string, ran: string[]): PageHost => ({
			async run(command) {
				ran.push(command);
				// Yield, so the other turn runs in between
				await new Promise((resolve) => setTimeout(resolve, 5));
				return { success: true, data: { page: name } };
			},
		});
		const first: string[] = [];
		const second: string[] = [];
		const firstModel = scripted([{ name: 'view-state-list', args: {} }]);
		const secondModel = scripted([
			{ name: 'todo-clear', args: {} },
			{ name: 'view-state-get', args: { id: 'todo-filter' } },
		]);
		await Promise.all([
			copilot(firstModel).run('What views are there?', 'look', { page: pageOf('first', first) }),
			// The second turn's view call comes after an approval retry, which must keep its page
			copilot(secondModel).run('Clear, then show me', 'change', {
				page: pageOf('second', second),
				onApprovalNeeded: async () => {
					await new Promise((resolve) => setTimeout(resolve, 5));
					return true;
				},
			}),
		]);

		expect(first).toEqual(['view-state-list']);
		expect(second).toEqual(['view-state-get']);
		expect(lastResults(firstModel)[0]).toMatchObject({ data: { page: 'first' } });
		expect(lastResults(secondModel)[1]).toMatchObject({ data: { page: 'second' } });
	});

	it('is validated before it reaches the page', async () => {
		let reached = false;
		const page: PageHost = {
			async run() {
				reached = true;
				return { success: true };
			},
		};
		const model = scripted([{ name: 'view-state-set', args: { state: filter } }]);
		await copilot(model).run('Show urgent ones', 'change', { page });

		expect(reached).toBe(false);
		expect(lastResults(model)[0]).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
	});

	it('fails, saying why, when no page is open', async () => {
		const model = scripted([{ name: 'view-state-get', args: { id: 'todo-filter' } }]);
		await copilot(model).run('What am I looking at?', 'change');

		expect(lastResults(model)[0]).toMatchObject({
			error: { code: 'PAGE_NOT_CONNECTED', suggestion: expect.any(String) },
		});
	});

	it('refuses an answer from the page that is not a command result', async () => {
		const page: PageHost = { run: async () => 'ok' as never };
		const model = scripted([{ name: 'view-state-get', args: { id: 'todo-filter' } }]);
		await copilot(model).run('What am I looking at?', 'change', { page });

		expect(lastResults(model)[0]).toMatchObject({ error: { code: 'PAGE_BAD_RESULT' } });
	});
});

describe('the turn as it happens', () => {
	it('reports each call as it starts and ends', async () => {
		const events: CopilotEvent[] = [];
		const model = scripted([{ name: 'todo-create', args: { title: 'Post the letter' } }]);
		await copilot(model).run('Add one', 'change', { onEvent: (event) => events.push(event) });

		expect(events).toMatchObject([
			{ type: 'call', index: 0, name: 'todo-create', args: { title: 'Post the letter' } },
			{ type: 'result', index: 0, name: 'todo-create', success: true },
		]);
	});
});

describe('clearing completed todos', () => {
	beforeEach(async () => {
		const done = await store.create({ title: 'Done already' });
		await store.toggle(done.id);
		await store.create({ title: 'Still open' });
	});

	it('is held for approval: without a way to ask, the model hears so and nothing is cleared', async () => {
		const model = scripted([{ name: 'todo-clear', args: {} }]);
		await copilot(model).run('Clear the done ones', 'change');

		expect(lastResults(model)[0]).toMatchObject({ error: { code: 'APPROVAL_REQUIRED' } });
		expect(store.count()).toBe(2);
	});

	it('runs once the person approves, after they see what it will do', async () => {
		const asked: DirectApprovalRequest[] = [];
		const model = scripted([{ name: 'todo-clear', args: {} }]);
		const turn = await copilot(model).run('Clear the done ones', 'change', {
			onApprovalNeeded: (request) => {
				asked.push(request);
				return true;
			},
		});

		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({ command: 'todo-clear', actor: { kind: 'agent' } });
		expect(asked[0]?.summary).toContain('1');
		expect(turn.toolExecutions[0]?.success).toBe(true);
		expect(store.count()).toBe(1);
	});

	it('does not run when the person denies it', async () => {
		const model = scripted([{ name: 'todo-clear', args: {} }]);
		await copilot(model).run('Clear the done ones', 'change', { onApprovalNeeded: () => false });

		expect(lastResults(model)[0]).toMatchObject({ error: { code: 'APPROVAL_REQUIRED' } });
		expect(store.count()).toBe(2);
	});
});
