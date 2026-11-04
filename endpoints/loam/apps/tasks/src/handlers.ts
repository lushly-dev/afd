/**
 * @fileoverview Tasks' commands, with the `store` grant. The store holds only the call's scope, so each
 * project keeps its own tasks with no code here (phase 2 specification, section 5). A task's id comes from
 * a counter in the same store, so a replay makes the same ids.
 */

import { type AppCallContextV1, type AppStoreV1, failure, success } from '@lushly-dev/loam-sdk';

export interface TaskV1 {
	id: string;
	title: string;
	done: boolean;
	/** The order it was added in, from 1. */
	seq: number;
}

const STORE_MISSING = {
	code: 'APP_GRANT_MISSING',
	message: 'Tasks needs the `store` grant to keep tasks',
	suggestion: 'Declare the `store` grant in the manifest',
};

/** Every task's key starts with this; the counter's does not. */
const TASK_PREFIX = 't-';
const COUNTER = 'next';

/** Told after a command changes the store, so a surface in this page can read it again. */
const listeners = new Set<() => void>();

export function onTasksChanged(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

const changed = (): void => {
	for (const listener of listeners) listener();
};

/** One write at a time: two quick adds would otherwise read the same counter. */
let writing: Promise<unknown> = Promise.resolve();

function serially<T>(work: () => Promise<T>): Promise<T> {
	const done = writing.then(work);
	writing = done.catch(() => {});
	return done;
}

async function add(title: string, store: AppStoreV1): Promise<TaskV1> {
	const seq = ((await store.get<number>(COUNTER)) ?? 0) + 1;
	const task: TaskV1 = { id: `${TASK_PREFIX}${seq}`, title, done: false, seq };
	await store.put(COUNTER, seq);
	await store.put(task.id, task);
	return task;
}

async function tasksOf(store: AppStoreV1): Promise<TaskV1[]> {
	const rows = await store.list(TASK_PREFIX);
	return rows.map(({ value }) => value as TaskV1).sort((a, b) => a.seq - b.seq);
}

const missing = (task: string) =>
	failure({
		code: 'TASK_NOT_FOUND',
		message: `No task ${task} in this project`,
		suggestion: 'List the tasks with tasks-list',
	});

async function added(title: string, context: AppCallContextV1) {
	const { store } = context;
	if (!store) return failure(STORE_MISSING);
	const task = await serially(() => add(title, store));
	changed();
	return success({ task });
}

export const handlers = {
	'tasks-add': (input: { title: string }, context: AppCallContextV1) => added(input.title, context),
	'tasks-add-blank': (_input: Record<string, never>, context: AppCallContextV1) =>
		added('Untitled', context),
	async 'tasks-list'(_input: Record<string, never>, context: AppCallContextV1) {
		if (!context.store) return failure(STORE_MISSING);
		const items = (await tasksOf(context.store)).map((task) => ({
			id: task.id,
			title: task.title,
			...(task.done ? { description: 'Done' } : {}),
		}));
		return success({ items });
	},
	async 'tasks-rename'(input: { task: string; title: string }, context: AppCallContextV1) {
		const { store } = context;
		if (!store) return failure(STORE_MISSING);
		const held = await store.get<TaskV1>(input.task);
		if (!held) return missing(input.task);
		await serially(() => store.put(input.task, { ...held, title: input.title }));
		changed();
		return success(
			{ task: { ...held, title: input.title } },
			{ undoCommand: 'tasks-rename', undoArgs: { task: input.task, title: held.title } }
		);
	},
	async 'tasks-complete'(input: { task: string }, context: AppCallContextV1) {
		const { store } = context;
		if (!store) return failure(STORE_MISSING);
		const held = await store.get<TaskV1>(input.task);
		if (!held) return missing(input.task);
		await serially(() => store.put(input.task, { ...held, done: true }));
		changed();
		return success({ task: { ...held, done: true } });
	},
	/** What a project's home shows of it, once the projects section reads it (7.7). */
	async 'tasks-summary'(_input: Record<string, never>, context: AppCallContextV1) {
		if (!context.store) return failure(STORE_MISSING);
		const tasks = await tasksOf(context.store);
		const done = tasks.filter((task) => task.done).length;
		return success({
			counts: [
				{ label: 'Open', value: tasks.length - done },
				{ label: 'Done', value: done },
			],
			recent: tasks
				.slice(-5)
				.reverse()
				.map((task) => ({ title: task.title })),
		});
	},
};
