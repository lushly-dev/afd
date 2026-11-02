/**
 * @fileoverview Hello's surfaces: `hello-main`, `hello-inspector` and a small `x-card`, each defined in
 * the app's scoped registry. Its shadow roots use that registry too, so its template sees the scoped
 * elements (5.2).
 */

import { css, FASTElement, html, observable, ref } from '@lushly-dev/fast-element';
import type { AppContextV1, LoamSurfaceElementV1 } from '@lushly-dev/loam-sdk';
import { onGreetingsChanged } from './handlers.js';

const cardTemplate = html<HelloCard>`<slot></slot>`;
const cardStyles = css`
	:host {
		display: block;
		padding: var(--space-layout-sm);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-surface-card);
		color: var(--color-text-primary);
	}
	@media (forced-colors: active) {
		:host {
			border-color: CanvasText;
			background: Canvas;
			color: CanvasText;
		}
	}
`;

/** Named as tally's own card is, so a test can see that each registry keeps its own. */
export class HelloCard extends FASTElement {
	readonly app = 'hello';
}

interface TextField extends HTMLElement {
	value: string;
}

const mainTemplate = html<HelloMain>`
	<h1>Hello</h1>
	<div class="form" role="group" aria-label="Greet someone">
		<violet-text-field ${ref('field')} label="Name" autocomplete="off"></violet-text-field>
		<violet-button class="greet" appearance="primary" @click="${(x) => x.greet()}">Greet</violet-button>
	</div>
	<p class="greeting" role="status">${(x) => x.greeting}</p>
	<x-card class="selected">${(x) => (x.selection ? `Selected: ${x.selection}` : 'Nothing selected')}</x-card>
	<div class="actions" role="group" aria-label="Overlays">
		<violet-button class="toast" @click="${(x) => x.toast()}">Show a toast</violet-button>
		<violet-button class="modal" @click="${(x) => x.modal()}">Ask in a modal</violet-button>
	</div>
	<p class="answer" role="status">${(x) => x.answer}</p>
`;

const mainStyles = css`
	:host {
		display: grid;
		gap: var(--space-stack-md);
		align-content: start;
		padding: var(--space-layout-md);
	}
	h1 {
		margin: 0;
		font-size: var(--type-title-md-size);
		line-height: var(--type-title-md-line);
		font-weight: var(--type-title-md-weight);
	}
	p {
		margin: 0;
		color: var(--color-text-secondary);
	}
	p:empty {
		display: none;
	}
	.form,
	.actions {
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

export class HelloMain extends FASTElement implements LoamSurfaceElementV1 {
	context?: AppContextV1;
	declare selection: string | null;
	declare greeting: string;
	declare answer: string;
	declare field: TextField;
	#stopListening: (() => void) | undefined;

	constructor() {
		super();
		this.selection = null;
		this.greeting = '';
		this.answer = '';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		// A command may run from anywhere: the palette, an agent, the header or a chord.
		this.#stopListening = onGreetingsChanged(() => void this.#publishCount());
		void this.#publishCount();
	}

	override disconnectedCallback(): void {
		this.#stopListening?.();
		super.disconnectedCallback();
	}

	/** The status item holds what the store holds; a mutation from inside a handler would be refused. */
	async #publishCount(): Promise<void> {
		const client = this.context?.client;
		const list = await client?.call<{ items: unknown[] }>('hello-list');
		if (list?.success) {
			await client?.call('status-item-set', {
				id: 'count',
				value: String(list.data?.items.length ?? 0),
			});
		}
	}

	async greet(): Promise<void> {
		const name = this.field.value.trim();
		const result = await this.context?.client.call<{ greeting: string }>(
			'hello-greet',
			name ? { name } : {}
		);
		this.greeting = result?.success
			? (result.data?.greeting ?? '')
			: (result?.error?.message ?? 'Hello is not ready');
	}

	toast(): void {
		void this.context?.overlays.toast({ message: 'Hello from a toast', tone: 'success' });
	}

	async modal(): Promise<void> {
		const outcome = await this.context?.overlays.modal({
			title: 'Say hello?',
			body: 'This modal comes from the Hello app, and an app switch cancels it.',
			confirmLabel: 'Say hello',
		});
		this.answer = outcome ? `The modal closed with ${outcome.result}` : '';
	}
}
observable(HelloMain.prototype, 'selection');
observable(HelloMain.prototype, 'greeting');
observable(HelloMain.prototype, 'answer');

const inspectorTemplate = html<HelloInspector>`
	<x-card>${(x) => (x.selection ? `Greeted ${x.selection}` : 'Select a name in the list')}</x-card>
`;

export class HelloInspector extends FASTElement implements LoamSurfaceElementV1 {
	context?: AppContextV1;
	declare selection: string | null;

	constructor() {
		super();
		this.selection = null;
	}
}
observable(HelloInspector.prototype, 'selection');

/** Define each element in the app's scoped registry, never the global one. */
export async function defineHelloElements(context: AppContextV1): Promise<void> {
	const { registry } = context;
	const shadowOptions = { mode: 'open' as const, customElementRegistry: registry };
	await FASTElement.define(HelloCard, {
		name: 'x-card',
		template: cardTemplate,
		styles: cardStyles,
		registry,
	});
	await FASTElement.define(HelloMain, {
		name: 'hello-main',
		template: mainTemplate,
		styles: mainStyles,
		registry,
		shadowOptions,
	});
	await FASTElement.define(HelloInspector, {
		name: 'hello-inspector',
		template: inspectorTemplate,
		registry,
		shadowOptions,
	});
}
