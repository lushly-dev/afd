/**
 * @fileoverview Tasks' main surface: a form that adds a task, and the selected task, with Rename and
 * Complete. It reads its scope from nothing: the shell recreates it with a new client when the project
 * changes (phase 2 specification, 7.6), so what it shows is always the project it was made in.
 */

import { css, FASTElement, html, observable, ref, when } from '@lushly-dev/fast-element';
import type { AppContextV1, LoamSurfaceElementV1 } from '@lushly-dev/loam-sdk';
import { onTasksChanged } from './handlers.js';

interface TextField extends HTMLElement {
	value: string;
}

interface Item {
	id: string;
	title: string;
	description?: string;
}

const mainTemplate = html<TasksMain>`
	<h1>Tasks</h1>
	<div class="form" role="group" aria-label="Add a task">
		<violet-text-field ${ref('field')} label="New task" autocomplete="off"></violet-text-field>
		<violet-button class="add" appearance="primary" @click="${(x) => x.add()}">Add</violet-button>
	</div>
	<p class="outcome" role="status">${(x) => x.outcome}</p>
	${when((x) => x.task === null, html<TasksMain>`<p class="none">Select a task in the list</p>`)}
	${when(
		(x) => x.task !== null,
		html<TasksMain>`
			<section class="task" aria-labelledby="task-title">
				<h2 id="task-title">${(x) => x.task?.title}</h2>
				<p>${(x) => (x.task?.description === 'Done' ? 'Done' : 'Open')}</p>
				<div class="form" role="group" aria-label="Change this task">
					<violet-text-field ${ref('rename')} label="Title" autocomplete="off"></violet-text-field>
					<violet-button class="rename" @click="${(x) => x.renameTask()}">Rename</violet-button>
					<violet-button
						class="complete"
						?disabled="${(x) => x.task?.description === 'Done'}"
						@click="${(x) => x.complete()}"
						>Complete</violet-button
					>
				</div>
			</section>
		`
	)}
`;

const mainStyles = css`
	:host {
		display: grid;
		gap: var(--space-stack-md);
		align-content: start;
		padding: var(--space-layout-md);
	}
	h1,
	h2,
	p {
		margin: 0;
	}
	h1 {
		font-size: var(--type-title-md-size);
		line-height: var(--type-title-md-line);
		font-weight: var(--type-title-md-weight);
	}
	h2 {
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--weight-semibold);
	}
	p {
		color: var(--color-text-secondary);
	}
	.task {
		display: grid;
		gap: var(--space-stack-sm);
	}
	.form {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-inline-sm);
	}
	@media (forced-colors: active) {
		p {
			color: CanvasText;
		}
	}
`;

export class TasksMain extends FASTElement implements LoamSurfaceElementV1 {
	context?: AppContextV1;
	declare selection: string | null;
	declare task: Item | null;
	declare outcome: string;
	declare field: TextField;
	declare rename: TextField;
	#stopListening: (() => void) | undefined;

	constructor() {
		super();
		this.selection = null;
		this.task = null;
		this.outcome = '';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		// A command may run from anywhere: the palette, an agent or the list.
		this.#stopListening = onTasksChanged(() => void this.#read());
		void this.#read();
	}

	override disconnectedCallback(): void {
		this.#stopListening?.();
		super.disconnectedCallback();
	}

	selectionChanged(): void {
		if (this.$fastController.isConnected) void this.#read();
	}

	async #read(): Promise<void> {
		const id = this.selection;
		const result = await this.context?.client.call<{ items: Item[] }>('tasks-list');
		if (id !== this.selection) return;
		this.task = result?.data?.items.find((item) => item.id === id) ?? null;
		if (this.rename && this.task) this.rename.value = this.task.title;
	}

	async #run(name: string, input: Record<string, string>, said: string): Promise<void> {
		const result = await this.context?.client.call(name, input);
		this.outcome = result?.success ? said : (result?.error?.message ?? 'Tasks is not ready');
	}

	async add(): Promise<void> {
		const title = this.field.value.trim();
		if (!title) {
			this.outcome = 'Name the task first';
			return;
		}
		await this.#run('tasks-add', { title }, `Added ${title}`);
		this.field.value = '';
	}

	async renameTask(): Promise<void> {
		const task = this.task;
		const title = this.rename.value.trim();
		if (task && title) await this.#run('tasks-rename', { task: task.id, title }, 'Renamed');
	}

	async complete(): Promise<void> {
		const task = this.task;
		if (task) await this.#run('tasks-complete', { task: task.id }, `Completed ${task.title}`);
	}
}
observable(TasksMain.prototype, 'selection');
observable(TasksMain.prototype, 'task');
observable(TasksMain.prototype, 'outcome');

export async function defineTasksElements(context: AppContextV1): Promise<void> {
	const { registry } = context;
	await FASTElement.define(TasksMain, {
		name: 'tasks-main',
		template: mainTemplate,
		styles: mainStyles,
		registry,
		shadowOptions: { mode: 'open' as const, customElementRegistry: registry },
	});
}
