/**
 * @fileoverview Tally's surfaces. Its `x-card` is another class under the name hello's has, which each
 * app's scoped registry keeps apart (phase 1 specification, 11.1).
 */

import { css, FASTElement, html, observable, repeat } from '@lushly-dev/fast-element';
import type { AppContextV1, LoamSurfaceElementV1 } from '@lushly-dev/loam-sdk';
import { onTallyChanged } from './handlers.js';

interface Held {
	total: number;
	history: number[];
}

const cardStyles = css`
	:host {
		display: block;
		padding: var(--space-layout-sm);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		font-size: var(--type-title-md-size);
		line-height: var(--type-title-md-line);
	}
	@media (forced-colors: active) {
		:host {
			border-color: CanvasText;
		}
	}
`;

export class TallyCard extends FASTElement {
	readonly app = 'tally';
}

const mainTemplate = html<TallyMain>`
	<h1>Tally</h1>
	<x-card><p role="status">Total: <span class="total">${(x) => String(x.total)}</span></p></x-card>
	<violet-button class="add" appearance="primary" @click="${(x) => x.add()}">Add one</violet-button>
`;

const mainStyles = css`
	:host {
		display: grid;
		gap: var(--space-stack-md);
		justify-items: start;
		align-content: start;
		padding: var(--space-layout-md);
	}
	h1,
	p {
		margin: 0;
	}
	h1 {
		font-size: var(--type-title-md-size);
		line-height: var(--type-title-md-line);
		font-weight: var(--type-title-md-weight);
	}
`;

export class TallyMain extends FASTElement implements LoamSurfaceElementV1 {
	context?: AppContextV1;
	declare total: number;
	#stopListening: (() => void) | undefined;

	constructor() {
		super();
		this.total = 0;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		// A command may run from anywhere: the status item, the palette or an agent.
		this.#stopListening = onTallyChanged(() => void this.#read());
		void this.#read();
	}

	override disconnectedCallback(): void {
		this.#stopListening?.();
		super.disconnectedCallback();
	}

	async #read(): Promise<void> {
		const result = await this.context?.client.call<Held>('tally-get');
		if (!result?.success || !result.data) return;
		this.total = result.data.total;
		await this.context?.client.call('status-item-set', {
			id: 'total',
			value: String(result.data.total),
		});
	}

	add(): void {
		void this.context?.client.call('tally-add');
	}
}
observable(TallyMain.prototype, 'total');

const historyTemplate = html<TallyHistory>`
	<ol class="history">
		${repeat((x) => x.entries, html<number>`<li>${(x) => `Added ${x}`}</li>`)}
	</ol>
	<p class="empty" ?hidden="${(x) => x.entries.length > 0}">Nothing added yet</p>
`;

const historyStyles = css`
	:host {
		display: block;
		color: var(--color-text-secondary);
	}
	ol {
		margin: 0;
		padding-inline-start: var(--space-layout-sm);
	}
	p {
		margin: 0;
	}
	[hidden] {
		display: none;
	}
	@media (forced-colors: active) {
		:host {
			color: CanvasText;
		}
	}
`;

export class TallyHistory extends FASTElement implements LoamSurfaceElementV1 {
	context?: AppContextV1;
	declare entries: number[];
	#stopListening: (() => void) | undefined;

	constructor() {
		super();
		this.entries = [];
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.#stopListening = onTallyChanged(() => void this.#read());
		void this.#read();
	}

	override disconnectedCallback(): void {
		this.#stopListening?.();
		super.disconnectedCallback();
	}

	async #read(): Promise<void> {
		const result = await this.context?.client.call<Held>('tally-get');
		if (result?.success && result.data) this.entries = result.data.history;
	}
}
observable(TallyHistory.prototype, 'entries');

export async function defineTallyElements(context: AppContextV1): Promise<void> {
	const { registry } = context;
	const shadowOptions = { mode: 'open' as const, customElementRegistry: registry };
	await FASTElement.define(TallyCard, {
		name: 'x-card',
		template: html<TallyCard>`<slot></slot>`,
		styles: cardStyles,
		registry,
	});
	await FASTElement.define(TallyMain, {
		name: 'tally-main',
		template: mainTemplate,
		styles: mainStyles,
		registry,
		shadowOptions,
	});
	await FASTElement.define(TallyHistory, {
		name: 'tally-history',
		template: historyTemplate,
		styles: historyStyles,
		registry,
		shadowOptions,
	});
}
