/**
 * @fileoverview `token-tree-inspector`: displays the selected token's lineage, value field with
 * CSSOM swatch, and batched pending change preview with Apply and Cancel (spec §7.5, U3).
 */
import {
	css,
	FASTElement,
	html,
	observable,
	repeat,
	Updates,
	when,
} from '@lushly-dev/fast-element';
import type {
	AppContextV1,
	DocumentChangeV1,
	DocumentRefV1,
	LoamEditorElementV1,
} from '@lushly-dev/loam-sdk';
import { getSelection, subscribeSelection } from './selection-bus.js';
import { formatTokenValue, isColorValue, paintSwatches, sharedStyles } from './styles.js';

const MAX_PENDING_CHANGES = 50;

export interface LineageEntry {
	node: string;
	operation: string;
	valueText: string;
	swatch: string;
}

export interface PendingChange {
	operation: 'override';
	token: string;
	value: string;
}

interface PreviewSummary {
	changed: number;
	shielded: number;
	violationsIntroduced: number;
}

const styles = css`
	${sharedStyles}
	:host {
		display: grid;
		align-content: start;
		gap: var(--violet-space-stack-section);
		padding: var(--violet-space-layout-panel);
		background: var(--violet-color-surface-card);
		block-size: 100%;
		box-sizing: border-box;
		overflow-y: auto;
	}
	h2 {
		font-size: var(--violet-type-heading-section-size);
		line-height: var(--violet-type-heading-section-line);
		font-weight: var(--violet-type-heading-section-weight);
	}
	.section {
		display: grid;
		gap: var(--violet-space-stack-tight);
	}
	.lineage {
		display: grid;
		gap: var(--violet-space-stack-tight);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.lineage-item {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--violet-space-inline-tight);
		padding: var(--violet-space-stack-tight) var(--violet-space-inline-tight);
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-control);
		background: var(--violet-color-surface-page);
	}
	.value-editor {
		display: flex;
		align-items: end;
		gap: var(--violet-space-inline-tight);
	}
	.value-editor violet-text-field {
		flex: 1 1 auto;
		min-inline-size: 0;
	}
	.pending-box {
		display: grid;
		gap: var(--violet-space-stack-group);
		padding: var(--violet-space-stack-group) var(--violet-space-inline-group);
		border: 1px solid var(--violet-color-border-strong);
		border-radius: var(--violet-radius-control);
		background: var(--violet-color-surface-subtle);
	}
	.pending-list {
		display: grid;
		gap: var(--violet-space-stack-tight);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--violet-space-inline-tight);
	}
	@media (forced-colors: active) {
		.lineage-item,
		.pending-box {
			border-color: CanvasText;
			background: Canvas;
			color: CanvasText;
		}
	}
`;

const template = html<TokenTreeInspector>`
	<p class="error-banner" role="alert">${(x) => x.error}</p>
	<p class="status-banner" role="status">${(x) => x.status}</p>
	${when(
		(x) => !x.selectedToken,
		html<TokenTreeInspector>`
			<violet-empty-state
				heading="No token selected"
				message="Select a token in the editor to inspect its lineage and stage changes."
			></violet-empty-state>
		`
	)}
	${when(
		(x) => Boolean(x.selectedToken),
		html<TokenTreeInspector>`
			<section class="section" aria-label="Selected token">
				<h2>${(x) => x.selectedToken}</h2>
				<p class="muted">${(x) => `${x.selectedNode} · from ${x.resolvedFrom || x.selectedNode}`}</p>
			</section>
			<section class="section" aria-label="Value">
				<div class="value-editor">
					<violet-text-field
						label="Token value"
						:value="${(x) => x.draftValue}"
						?readonly="${(x) => x.document?.readOnly === true}"
						@input="${(x, c) => x.onValueInput(c.event)}"
					></violet-text-field>
					${when(
						(x) => isColorValue(x.draftValue),
						html<TokenTreeInspector>`<span
							class="swatch"
							data-swatch="${(x) => x.draftValue}"
							aria-hidden="true"
						></span>`
					)}
				</div>
				<div class="actions" ?hidden="${(x) => x.document?.readOnly === true}">
					<violet-button
						appearance="secondary"
						?disabled="${(x) => x.applying}"
						@click="${(x) => x.stageChange()}"
						>Stage change</violet-button
					>
				</div>
			</section>
			<section class="section" aria-label="Lineage">
				<h3>Lineage</h3>
				<ol class="lineage">
					${repeat(
						(x) => x.lineage,
						html<LineageEntry>`<li class="lineage-item">
							<span class="mono">${(row) => row.node}</span>
							<span class="value-cell">
								<violet-badge size="sm">${(row) => row.operation}</violet-badge>
								${when(
									(row) => row.swatch !== '',
									html<LineageEntry>`<span
										class="swatch"
										data-swatch="${(row) => row.swatch}"
										aria-hidden="true"
									></span>`
								)}
								<span class="mono">${(row) => row.valueText}</span>
							</span>
						</li>`
					)}
				</ol>
			</section>
		`
	)}
	${when(
		(x) => x.pending.length > 0,
		html<TokenTreeInspector>`
			<section class="pending-box" aria-label="Pending changes">
				<h3>Pending changes (${(x) => x.pending.length})</h3>
				<ul class="pending-list">
					${repeat(
						(x) => x.pending,
						html<PendingChange>`<li class="mono">
							${(item) => `${item.token} = ${item.value}`}
						</li>`
					)}
				</ul>
				${when(
					(x) => x.previewSummary !== null,
					html<TokenTreeInspector>`
						<p class="muted" role="status">
							${(x) =>
								`${x.previewSummary?.changed ?? 0} changed, ${x.previewSummary?.shielded ?? 0} shielded, ${x.previewSummary?.violationsIntroduced ?? 0} violations introduced`}
						</p>
					`
				)}
				<div class="actions">
					<violet-button
						appearance="primary"
						?disabled="${(x) => x.applying}"
						@click="${(x) => x.applyPending()}"
						>Apply</violet-button
					>
					<violet-button appearance="secondary" @click="${(x) => x.cancelPending()}"
						>Cancel</violet-button
					>
				</div>
			</section>
		`
	)}
`;

function parseSelection(raw: unknown): { node: string; token: string } {
	const id =
		typeof raw === 'string'
			? raw
			: raw &&
					typeof raw === 'object' &&
					'id' in raw &&
					typeof (raw as { id?: unknown }).id === 'string'
				? (raw as { id: string }).id
				: '';
	const hash = id.lastIndexOf('#');
	if (hash === -1) return { node: id, token: '' };
	return { node: id.slice(0, hash), token: id.slice(hash + 1) };
}

export class TokenTreeInspector extends FASTElement implements LoamEditorElementV1 {
	context?: AppContextV1;
	declare document?: DocumentRefV1;
	declare selection?: string | null;

	declare selectedNode: string;
	declare selectedToken: string;
	declare resolvedFrom: string;
	declare draftValue: string;
	declare lineage: LineageEntry[];
	declare pending: PendingChange[];
	declare previewSummary: PreviewSummary | null;
	declare applying: boolean;
	declare status: string;
	declare error: string;

	#applyInput: Record<string, unknown> | null = null;
	#turn = 0;
	#stageTurn = 0;
	#unsubscribeSelection: (() => void) | null = null;

	constructor() {
		super();
		this.selectedNode = '';
		this.selectedToken = '';
		this.resolvedFrom = '';
		this.draftValue = '';
		this.lineage = [];
		this.pending = [];
		this.previewSummary = null;
		this.applying = false;
		this.status = '';
		this.error = '';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.#bindSelectionBus();
		this.syncSelection();
	}

	override disconnectedCallback(): void {
		this.#unsubscribeSelection?.();
		this.#unsubscribeSelection = null;
		super.disconnectedCallback();
	}

	selectionChanged(): void {
		this.syncSelection();
	}

	documentChanged(_change: DocumentChangeV1): void {
		this.#bindSelectionBus();
		void this.loadLineage();
	}

	#bindSelectionBus(): void {
		this.#unsubscribeSelection?.();
		this.#unsubscribeSelection = null;
		const docId = this.document?.id;
		if (!docId) return;
		this.#unsubscribeSelection = subscribeSelection(docId, (next) => {
			this.#applySelection(next);
		});
	}

	syncSelection(): void {
		const raw =
			this.selection ?? (this.document?.id ? (getSelection(this.document.id) ?? null) : null);
		this.#applySelection(raw);
	}

	#applySelection(raw: unknown): void {
		const { node, token } = parseSelection(raw);
		if (node !== this.selectedNode) {
			++this.#stageTurn;
			this.applying = false;
			this.pending = [];
			this.previewSummary = null;
			this.#applyInput = null;
		}
		this.selectedNode = node;
		this.selectedToken = token;
		void this.loadLineage();
	}

	onValueInput(event: Event): boolean {
		const field = event.currentTarget as (HTMLElement & { value?: string }) | null;
		this.draftValue = field?.value ?? '';
		void Updates.next().then(() => paintSwatches(this.shadowRoot));
		return true;
	}

	async loadLineage(): Promise<void> {
		const turn = ++this.#turn;
		const docId = this.document?.id;
		if (!docId || !this.context || !this.selectedNode || !this.selectedToken) {
			this.lineage = [];
			this.resolvedFrom = '';
			this.draftValue = '';
			return;
		}
		const res = await this.context.client.call<{
			token: string;
			value: unknown;
			from: string;
			chain: Array<{ node: string; operation: string; value?: unknown }>;
		}>('violet-token-lineage', {
			document: docId,
			node: this.selectedNode,
			token: this.selectedToken,
		});
		if (turn !== this.#turn) return;
		if (!res.success || !res.data) {
			this.error = res.error?.message ?? 'Could not read token lineage';
			this.lineage = [];
			return;
		}
		this.error = '';
		this.resolvedFrom = res.data.from;
		this.draftValue = formatTokenValue(res.data.value);
		this.lineage = res.data.chain.map((step) => ({
			node: step.node,
			operation: step.operation,
			valueText: step.value !== undefined ? formatTokenValue(step.value) : 'inherits',
			swatch: step.value !== undefined && isColorValue(step.value) ? step.value.trim() : '',
		}));
		void Updates.next().then(() => paintSwatches(this.shadowRoot));
	}

	async stageChange(overrideValue?: string): Promise<void> {
		if (this.applying) return;
		const docId = this.document?.id;
		const targetNode = this.selectedNode;
		const targetToken = this.selectedToken;
		if (!docId || !this.context || !targetNode || !targetToken) return;
		const nextValue = overrideValue ?? this.draftValue;
		const existingIndex = this.pending.findIndex((item) => item.token === targetToken);
		if (existingIndex === -1 && this.pending.length >= MAX_PENDING_CHANGES) {
			this.error = `At most ${MAX_PENDING_CHANGES} changes can be batched in one preview; apply or cancel before adding another.`;
			return;
		}
		const nextList: PendingChange[] =
			existingIndex >= 0
				? this.pending.map((item, idx) =>
						idx === existingIndex
							? { operation: 'override', token: targetToken, value: nextValue }
							: item
					)
				: [...this.pending, { operation: 'override', token: targetToken, value: nextValue }];

		const stageTurn = ++this.#stageTurn;
		const preview = await this.context.client.call<{
			summary: PreviewSummary;
			apply: { command: string; input: Record<string, unknown> };
		}>('violet-change-preview', {
			document: docId,
			node: targetNode,
			changes: nextList,
		});
		if (stageTurn !== this.#stageTurn || this.selectedNode !== targetNode) return;
		if (!preview.success || !preview.data) {
			const hint = preview.error?.suggestion ? ` — ${preview.error.suggestion}` : '';
			this.error = `${preview.error?.message ?? 'Preview failed'}${hint}`;
			return;
		}
		this.error = '';
		this.pending = nextList;
		this.previewSummary = preview.data.summary;
		this.#applyInput = preview.data.apply.input;
	}

	async applyPending(): Promise<void> {
		if (this.applying || !this.context || !this.#applyInput) return;
		this.applying = true;
		const stageTurn = ++this.#stageTurn;
		try {
			const applied = await this.context.client.call('violet-change-apply', this.#applyInput);
			if (stageTurn !== this.#stageTurn) return;
			if (!applied.success) {
				const hint = applied.error?.suggestion ? ` — ${applied.error.suggestion}` : '';
				this.error = `${applied.error?.message ?? 'Apply failed'}${hint}`;
				return;
			}
			const count = this.pending.length;
			this.pending = [];
			this.previewSummary = null;
			this.#applyInput = null;
			this.error = '';
			this.status = `Applied ${count} change${count === 1 ? '' : 's'}.`;
			await this.loadLineage();
		} finally {
			if (stageTurn === this.#stageTurn) {
				this.applying = false;
			}
		}
	}

	cancelPending(): void {
		++this.#stageTurn;
		this.applying = false;
		this.pending = [];
		this.previewSummary = null;
		this.#applyInput = null;
		this.error = '';
		this.status = '';
	}
}

observable(TokenTreeInspector.prototype, 'document');
observable(TokenTreeInspector.prototype, 'selection');
observable(TokenTreeInspector.prototype, 'selectedNode');
observable(TokenTreeInspector.prototype, 'selectedToken');
observable(TokenTreeInspector.prototype, 'resolvedFrom');
observable(TokenTreeInspector.prototype, 'draftValue');
observable(TokenTreeInspector.prototype, 'lineage');
observable(TokenTreeInspector.prototype, 'pending');
observable(TokenTreeInspector.prototype, 'previewSummary');
observable(TokenTreeInspector.prototype, 'applying');
observable(TokenTreeInspector.prototype, 'status');
observable(TokenTreeInspector.prototype, 'error');

export const tokenTreeInspectorDefinition = {
	name: 'token-tree-inspector',
	template,
	styles,
} as const;
