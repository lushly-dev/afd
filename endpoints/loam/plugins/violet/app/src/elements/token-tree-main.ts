/**
 * @fileoverview `token-tree-main`: lists the active scope's `violet-tree` documents when no tree is open
 * and points to New when empty (spec §7.1; D82).
 */
import { css, FASTElement, html, observable, repeat } from '@lushly-dev/fast-element';
import type { AppContextV1, DocumentRecordV1, LoamSurfaceElementV1 } from '@lushly-dev/loam-sdk';
import { sharedStyles } from './styles.js';

interface TreeSummary {
	id: string;
	title: string;
}

const styles = css`
	${sharedStyles}
	:host {
		display: grid;
		align-content: start;
		gap: var(--violet-space-stack-md);
		padding: var(--violet-space-layout-md);
		background: var(--violet-color-surface-page);
		block-size: 100%;
		box-sizing: border-box;
	}
	.list {
		display: grid;
		gap: var(--violet-space-stack-xs);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--violet-space-stack-xs) var(--violet-space-inline-md);
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-md);
		background: var(--violet-color-surface-card);
	}
`;

const template = html<TokenTreeMain>`
	<h2>Token trees</h2>
	<p class="error-banner" role="alert">${(x) => x.error}</p>
	<violet-empty-state
		?hidden="${(x) => x.loading || x.trees.length > 0}"
		heading="No token trees yet"
		message="Use New in the shell to create a blank, example, or AFD default token tree."
	></violet-empty-state>
	<ul class="list" aria-label="Token trees" ?hidden="${(x) => x.trees.length === 0}">
		${repeat(
			(x) => x.trees,
			html<TreeSummary, TokenTreeMain>`<li class="item">
				<violet-button appearance="quiet" @click="${(tree, c) => c.parent.openTree(tree.id)}">
					${(tree) => tree.title}
				</violet-button>
			</li>`
		)}
	</ul>
`;

export class TokenTreeMain extends FASTElement implements LoamSurfaceElementV1 {
	context?: AppContextV1;
	declare trees: TreeSummary[];
	declare loading: boolean;
	declare error: string;
	#turn = 0;

	constructor() {
		super();
		this.trees = [];
		this.loading = false;
		this.error = '';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		void this.refresh();
	}

	async refresh(): Promise<void> {
		const documents = this.context?.documents;
		if (!documents) return;
		const turn = ++this.#turn;
		this.loading = true;
		try {
			const list: DocumentRecordV1[] = await documents.list({ type: 'violet-tree' });
			if (turn !== this.#turn) return;
			this.trees = list.map((doc) => ({ id: doc.id, title: doc.title }));
			this.error = '';
		} catch (cause) {
			if (turn !== this.#turn) return;
			this.error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (turn === this.#turn) this.loading = false;
		}
	}

	async openTree(id: string): Promise<void> {
		try {
			await this.context?.documents?.open(id);
			this.error = '';
		} catch (cause) {
			this.error = cause instanceof Error ? cause.message : String(cause);
		}
	}
}
observable(TokenTreeMain.prototype, 'trees');
observable(TokenTreeMain.prototype, 'loading');
observable(TokenTreeMain.prototype, 'error');

export const tokenTreeMainDefinition = {
	name: 'token-tree-main',
	template,
	styles,
} as const;
