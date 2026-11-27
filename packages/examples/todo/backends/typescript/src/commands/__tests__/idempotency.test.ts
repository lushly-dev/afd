/**
 * @fileoverview The todo commands' repeats (`spec/idempotency.md`): a keyed `todo-create` is
 * answered by the server's step, and `todo-create-batch`, which may run as a task, answers its
 * own repeats (D5). Neither records a repeat in the history.
 */

import { createMcpServer } from '@lushly-dev/afd-server';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTodoServerOptions } from '../../server-options.js';
import { setStore, store, TodoStore } from '../../store/index.js';

const agent = { kind: 'agent' as const, id: 'advisor' };

/** The todo server, called in process; it is never started. */
function server(options: { step: boolean } = { step: true }) {
	const base = createTodoServerOptions({ APPROVALS: 'off' });
	return createMcpServer(options.step ? base : { ...base, idempotency: undefined });
}

/** How many changes the history holds. */
async function changes(): Promise<number> {
	return (await store.history()).length;
}

describe('repeats of the todo mutations', () => {
	beforeEach(() => {
		setStore(new TodoStore());
	});

	it('creates a todo once for a repeat with the same key, and again for a new key', async () => {
		const runtime = server();
		const call = (key: string) =>
			runtime.execute(
				'todo-create',
				{ title: 'Net the brassicas' },
				{ actor: agent, idempotencyKey: key }
			);
		const first = await call('k1');
		const repeat = await call('k1');
		expect(first.success).toBe(true);
		expect(repeat.metadata?.idempotentReplay).toBe(true);
		expect(repeat.data).toEqual(first.data);
		expect((await store.list()).length).toBe(1);
		expect(await changes()).toBe(1);
		await call('k2');
		expect((await store.list()).length).toBe(2);
		expect(await changes()).toBe(2);
	});

	it('answers a repeated keyed batch in its own handler, without the server step', async () => {
		const runtime = server({ step: false });
		const call = (titles: string[]) =>
			runtime.execute(
				'todo-create-batch',
				{ todos: titles.map((title) => ({ title })) },
				{ actor: agent, idempotencyKey: 'b1' }
			);
		const first = await call(['One', 'Two']);
		const repeat = await call(['One', 'Two']);
		expect(repeat.data).toEqual(first.data);
		expect((await store.list()).length).toBe(2);
		expect(await changes()).toBe(1);
		const other = await call(['Three']);
		expect(other.error?.code).toBe('IDEMPOTENCY_KEY_REUSED');
		expect(other.error?.details?.meta).toBe('dev.afd/idempotencyKey');
		expect((await store.list()).length).toBe(2);
	});

	it('keeps no batch answer across stores or callers', async () => {
		const runtime = server({ step: false });
		const call = (actor: typeof agent) =>
			runtime.execute(
				'todo-create-batch',
				{ todos: [{ title: 'One' }] },
				{ actor, idempotencyKey: 'b1' }
			);
		await call(agent);
		await call({ kind: 'agent', id: 'reviewer' });
		expect((await store.list()).length).toBe(2);
		setStore(new TodoStore());
		await call(agent);
		expect((await store.list()).length).toBe(1);
	});
});
