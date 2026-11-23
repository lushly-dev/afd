/**
 * @fileoverview `token-tree-editor`: document editor for `violet-tree` documents (spec §7.1–§7.4).
 * Left node column (U1), Files toolbar (U6), accessible five-view tablist (U2), CSSOM-scoped
 * Preview root (§7.4), and `EDITOR_SELECTION_EVENT` dispatch (`<node>` or `<node>#<token>`).
 */
import {
	FASTElement,
	html,
	observable,
	ref,
	repeat,
	Updates,
	when,
} from '@lushly-dev/fast-element';
import {
	type AppContextV1,
	type DocumentChangeV1,
	type DocumentRefV1,
	EDITOR_SELECTION_EVENT,
	type LoamEditorElementV1,
} from '@lushly-dev/loam-sdk';
import {
	exportTokenFiles,
	fetchChecksView,
	fetchHistoryView,
	fetchNodeCompare,
	fetchPreviewView,
	fetchTokensView,
	fetchTreeCompare,
	importTokenFiles,
	type SelectOptionItem,
} from './editor-loaders.js';
import {
	type CompareRowDisplay,
	checksViewTemplate,
	compareViewTemplate,
	type EditorViewId,
	type HistoryDisplay,
	historyViewTemplate,
	type InvalidDisplay,
	type LeakedDisplay,
	type MissingDisplay,
	type NodeListRow,
	previewViewTemplate,
	type RefusedPreviewDisplay,
	type TokenDisplayRow,
	type TreeCompareRowDisplay,
	tokensViewTemplate,
	type ViolationDisplay,
} from './editor-views.js';
import { clearSelectionBus, publishSelection } from './selection-bus.js';
import { editorStyles, paintSwatches } from './styles.js';

const VIEW_TABS: ReadonlyArray<{ id: EditorViewId; label: string }> = [
	{ id: 'tokens', label: 'Tokens' },
	{ id: 'compare', label: 'Compare' },
	{ id: 'preview', label: 'Preview' },
	{ id: 'checks', label: 'Checks' },
	{ id: 'history', label: 'History' },
];

const template = html<TokenTreeEditor>`
	<div class="layout">
		<nav
			class="nodes-column"
			aria-label="${(x) => `Nodes — ${x.document?.title ?? 'Token tree'}`}"
		>
			<div class="nodes-header">
				<h2>Nodes</h2>
				${when(
					(x) => x.unexported > 0,
					html<TokenTreeEditor>`<violet-badge color="warning" size="sm"
						>${(x) => `${x.unexported} unexported`}</violet-badge
					>`
				)}
			</div>
			<ul class="node-list">
				${repeat(
					(x) => x.nodes,
					html<NodeListRow, TokenTreeEditor>`<li>
						<button
							type="button"
							class="node-button"
							data-depth="${(row) => String(Math.min(row.depth, 3))}"
							aria-current="${(row, c) => (c.parent.selectedNode === row.id ? 'true' : 'false')}"
							@click="${(row, c) => c.parent.selectNode(row.id)}"
						>
							<span>${(row) => row.label}</span>
							<span class="node-meta">
								<span>${(row) => row.type}</span>
								<span>${(row) => `${row.customizations} set`}</span>
							</span>
						</button>
					</li>`
				)}
			</ul>
		</nav>
		<div class="workspace">
			<div class="toolbar">
				<h2>${(x) => x.document?.title ?? 'Token tree'}</h2>
				<div class="toolbar-actions">
					<input
						${ref('fileInput')}
						class="file-input"
						type="file"
						accept=".json,.tokens.json"
						multiple
						aria-label="Import token files"
						?hidden="${(x) => x.document?.readOnly === true}"
						@change="${(x, c) => x.onFilesChosen(c.event)}"
					/>
					<violet-button
						appearance="secondary"
						?hidden="${(x) => x.document?.readOnly === true}"
						@click="${(x) => x.openFilePicker()}"
						>Import files</violet-button
					>
					<violet-button appearance="secondary" @click="${(x) => x.exportFiles()}"
						>Export files</violet-button
					>
				</div>
			</div>
			<p class="error-banner" role="alert">${(x) => x.error}</p>
			<p class="status-banner" role="status">${(x) => x.status}</p>
			<div
				class="tablist"
				role="tablist"
				aria-label="Tree views"
				@keydown="${(x, c) => x.onTablistKeydown(c.event as KeyboardEvent)}"
			>
				${repeat(
					() => VIEW_TABS,
					html<{ id: EditorViewId; label: string }, TokenTreeEditor>`<button
						type="button"
						class="tab"
						role="tab"
						id="${(tab) => `tab-${tab.id}`}"
						aria-selected="${(tab, c) => (c.parent.activeView === tab.id ? 'true' : 'false')}"
						aria-controls="${(tab) => `panel-${tab.id}`}"
						tabindex="${(tab, c) => (c.parent.activeView === tab.id ? '0' : '-1')}"
						@click="${(tab, c) => c.parent.selectView(tab.id)}"
					>
						${(tab) => tab.label}
					</button>`
				)}
			</div>
			<section
				class="panel"
				role="tabpanel"
				id="${(x) => `panel-${x.activeView}`}"
				aria-labelledby="${(x) => `tab-${x.activeView}`}"
			>
				${when((x) => x.activeView === 'tokens', tokensViewTemplate)}
				${when((x) => x.activeView === 'compare', compareViewTemplate)}
				${when((x) => x.activeView === 'preview', previewViewTemplate)}
				${when((x) => x.activeView === 'checks', checksViewTemplate)}
				${when((x) => x.activeView === 'history', historyViewTemplate)}
			</section>
		</div>
	</div>
`;

export class TokenTreeEditor extends FASTElement implements LoamEditorElementV1 {
	context?: AppContextV1;
	declare document?: DocumentRefV1;
	declare fileInput?: HTMLInputElement;
	declare previewRoot?: HTMLElement;

	declare activeView: EditorViewId;
	declare nodes: NodeListRow[];
	declare unexported: number;
	declare selectedNode: string;
	declare selectedToken: string | null;
	declare tokenFilter: string;
	declare tokens: TokenDisplayRow[];
	declare tokensSummary: string;
	declare compareMode: 'nodes' | 'trees';
	declare compareNodes: string[];
	declare compareRows: CompareRowDisplay[];
	declare treeCompareRows: TreeCompareRowDisplay[];
	declare otherDocuments: SelectOptionItem[];
	declare otherNodes: SelectOptionItem[];
	declare otherDocument: string;
	declare otherNode: string;
	declare otherLabel: string;
	declare compareSummary: string;
	declare previewCount: number;
	declare previewSummary: string;
	declare refusedPreview: RefusedPreviewDisplay[];
	declare violations: ViolationDisplay[];
	declare missingEntries: MissingDisplay[];
	declare invalidEntries: InvalidDisplay[];
	declare leakedEntries: LeakedDisplay[];
	declare checksHealthy: boolean;
	declare checksSummary: string;
	declare historyRows: HistoryDisplay[];
	declare loading: boolean;
	declare status: string;
	declare error: string;

	#turn = 0;
	#lastExportedRev: number | null = null;
	#appliedPreviewProps: string[] = [];

	constructor() {
		super();
		this.activeView = 'tokens';
		this.nodes = [];
		this.unexported = 0;
		this.selectedNode = '';
		this.selectedToken = null;
		this.tokenFilter = '';
		this.tokens = [];
		this.tokensSummary = '';
		this.compareMode = 'nodes';
		this.compareNodes = [];
		this.compareRows = [];
		this.treeCompareRows = [];
		this.otherDocuments = [];
		this.otherNodes = [];
		this.otherDocument = '';
		this.otherNode = '';
		this.otherLabel = '';
		this.compareSummary = '';
		this.previewCount = 0;
		this.previewSummary = '';
		this.refusedPreview = [];
		this.violations = [];
		this.missingEntries = [];
		this.invalidEntries = [];
		this.leakedEntries = [];
		this.checksHealthy = true;
		this.checksSummary = '';
		this.historyRows = [];
		this.loading = false;
		this.status = '';
		this.error = '';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		void this.refresh();
	}

	override disconnectedCallback(): void {
		if (this.document?.id) {
			clearSelectionBus(this.document.id);
		}
		super.disconnectedCallback();
	}

	documentChanged(_change: DocumentChangeV1): void {
		void this.refresh();
	}

	selectView(view: EditorViewId): void {
		if (this.activeView === view) return;
		this.activeView = view;
		void this.loadActiveView();
	}

	onTablistKeydown(event: KeyboardEvent): boolean {
		const index = VIEW_TABS.findIndex((tab) => tab.id === this.activeView);
		let next = index;
		if (event.key === 'ArrowRight') next = (index + 1) % VIEW_TABS.length;
		else if (event.key === 'ArrowLeft') next = (index - 1 + VIEW_TABS.length) % VIEW_TABS.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = VIEW_TABS.length - 1;
		else return true;
		event.preventDefault();
		const target = VIEW_TABS[next];
		if (!target) return false;
		this.selectView(target.id);
		void Updates.next().then(() => {
			this.shadowRoot?.querySelector<HTMLElement>(`#tab-${target.id}`)?.focus();
		});
		return false;
	}

	selectNode(nodeId: string): void {
		this.selectedNode = nodeId;
		this.selectedToken = null;
		this.#emitSelection(nodeId);
		void this.loadActiveView();
	}

	selectToken(tokenId: string): void {
		this.selectedToken = tokenId;
		if (this.selectedNode) {
			this.#emitSelection(`${this.selectedNode}#${tokenId}`);
		}
	}

	selectNodeAndToken(nodeId: string, tokenId: string): void {
		this.selectedNode = nodeId;
		this.selectedToken = tokenId;
		this.#emitSelection(`${nodeId}#${tokenId}`);
	}

	setCompareMode(mode: 'nodes' | 'trees'): void {
		this.compareMode = mode;
		void this.loadActiveView();
	}

	toggleCompareNode(nodeId: string): void {
		const exists = this.compareNodes.includes(nodeId);
		if (exists) {
			if (this.compareNodes.length <= 2) return;
			this.compareNodes = this.compareNodes.filter((id) => id !== nodeId);
		} else {
			if (this.compareNodes.length >= 4) return;
			this.compareNodes = [...this.compareNodes, nodeId];
		}
		void this.loadActiveView();
	}

	onOtherDocumentChange(event: Event): boolean {
		const select = event.currentTarget as (HTMLElement & { value?: string }) | null;
		const nextDoc = select?.value ?? '';
		if (nextDoc && nextDoc !== this.otherDocument) {
			this.otherDocument = nextDoc;
			this.otherNode = '';
			void this.loadActiveView();
		}
		return true;
	}

	onOtherNodeChange(event: Event): boolean {
		const select = event.currentTarget as (HTMLElement & { value?: string }) | null;
		const nextNode = select?.value ?? '';
		if (nextNode && nextNode !== this.otherNode) {
			this.otherNode = nextNode;
			void this.loadActiveView();
		}
		return true;
	}

	onFilterInput(event: Event): boolean {
		const field = event.currentTarget as (HTMLElement & { value?: string }) | null;
		this.tokenFilter = field?.value?.trim() ?? '';
		void this.loadActiveView();
		return true;
	}

	openFilePicker(): void {
		this.fileInput?.click();
	}

	async onFilesChosen(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement | null;
		const fileList = input?.files;
		const docId = this.document?.id;
		if (!fileList || fileList.length === 0 || !docId || !this.context) return;
		const files = await Promise.all(
			[...fileList].map(async (file) => ({ name: file.name, content: await file.text() }))
		);
		if (input) input.value = '';
		const res = await importTokenFiles(
			this.context,
			docId,
			files,
			this.nodes.length > 0,
			this.#lastExportedRev
		);
		if (!res.ok) {
			this.error = res.error ?? 'Import failed';
			return;
		}
		this.error = '';
		this.status = `Imported ${files.length} file${files.length === 1 ? '' : 's'}.`;
		await this.refresh();
	}

	async exportFiles(): Promise<void> {
		const docId = this.document?.id;
		if (!docId || !this.context) return;
		const res = await exportTokenFiles(this.context, docId);
		if (res.error || res.rev === undefined) {
			this.error = res.error ?? 'Export failed';
			return;
		}
		this.#lastExportedRev = res.rev;
		const count = res.count ?? 0;
		this.error = '';
		this.status = `Exported ${count} file${count === 1 ? '' : 's'} (rev ${res.rev}).`;
	}

	async refresh(): Promise<void> {
		const docId = this.document?.id;
		if (!docId || !this.context) return;
		const turn = ++this.#turn;
		this.loading = true;
		const list = await this.context.client.call<{
			root: string | null;
			nodes: Array<{ id: string; parent: string | null; type: string; customizations: number }>;
			unexported: number;
		}>('violet-node-list', { document: docId });
		if (turn !== this.#turn) return;
		if (!list.success || !list.data) {
			this.error = list.error?.message ?? 'Could not read token tree nodes';
			this.loading = false;
			return;
		}
		this.error = '';
		this.unexported = list.data.unexported;
		const depthById = new Map<string, number>();
		this.nodes = list.data.nodes.map((node) => {
			const depth =
				node.parent && depthById.has(node.parent) ? (depthById.get(node.parent) ?? 0) + 1 : 0;
			depthById.set(node.id, depth);
			const parts = node.id.split('/');
			return {
				...node,
				depth,
				label: parts[parts.length - 1] ?? node.id,
			};
		});
		if (!this.selectedNode || !this.nodes.some((n) => n.id === this.selectedNode)) {
			const firstTheme = this.nodes.find((n) => n.parent !== null) ?? this.nodes[0];
			this.selectedNode = firstTheme?.id ?? '';
		}
		await this.loadActiveView(turn);
	}

	async loadActiveView(existingTurn?: number): Promise<void> {
		const docId = this.document?.id;
		if (!docId || !this.context) return;
		const turn = existingTurn ?? ++this.#turn;
		this.loading = true;
		try {
			if (this.activeView === 'tokens') await this.#loadTokens(docId, turn);
			else if (this.activeView === 'compare') await this.#loadCompare(docId, turn);
			else if (this.activeView === 'preview') await this.#loadPreview(docId, turn);
			else if (this.activeView === 'checks') await this.#loadChecks(docId, turn);
			else await this.#loadHistory(docId, turn);
		} finally {
			if (turn === this.#turn) {
				this.loading = false;
				void Updates.next().then(() => paintSwatches(this.shadowRoot));
			}
		}
	}

	async #loadTokens(docId: string, turn: number): Promise<void> {
		if (!this.context) return;
		const data = await fetchTokensView(this.context, docId, this.selectedNode, this.tokenFilter);
		if (turn !== this.#turn) return;
		this.error = data.error ?? '';
		this.tokens = data.tokens;
		this.tokensSummary = data.summary;
	}

	async #loadCompare(docId: string, turn: number): Promise<void> {
		if (!this.context) return;
		if (this.compareMode === 'nodes') {
			const data = await fetchNodeCompare(this.context, docId, this.nodes, this.compareNodes);
			if (turn !== this.#turn) return;
			this.compareNodes = data.compareNodes;
			this.error = data.error ?? '';
			this.compareRows = data.rows;
			this.compareSummary = data.summary;
			return;
		}
		const data = await fetchTreeCompare(
			this.context,
			docId,
			this.selectedNode,
			this.otherDocument,
			this.otherNode
		);
		if (turn !== this.#turn) return;
		this.otherDocuments = data.otherDocuments;
		this.otherNodes = data.otherNodes;
		this.otherDocument = data.otherDocument;
		this.otherNode = data.otherNode;
		this.otherLabel = data.otherLabel;
		this.error = data.error ?? '';
		this.treeCompareRows = data.rows;
		this.compareSummary = data.summary;
	}

	async #loadPreview(docId: string, turn: number): Promise<void> {
		if (!this.context) return;
		const data = await fetchPreviewView(this.context, docId, this.selectedNode);
		if (turn !== this.#turn) return;
		this.error = data.error ?? '';
		this.previewCount = data.count;
		this.refusedPreview = data.refused;
		this.previewSummary = data.summary;
		await Updates.next();
		this.#applyPreviewProperties(data.properties);
	}

	/** Apply custom properties strictly to the shadow-local preview root via CSSOM (spec §7.4, F7). */
	#applyPreviewProperties(properties: ReadonlyArray<{ name: string; value: string }>): void {
		const root = this.previewRoot;
		if (!root) return;
		for (const prior of this.#appliedPreviewProps) {
			root.style.removeProperty(prior);
		}
		this.#appliedPreviewProps = [];
		for (const entry of properties) {
			root.style.setProperty(entry.name, entry.value);
			this.#appliedPreviewProps.push(entry.name);
		}
	}

	async #loadChecks(docId: string, turn: number): Promise<void> {
		if (!this.context) return;
		const data = await fetchChecksView(this.context, docId);
		if (turn !== this.#turn) return;
		this.error = data.error ?? '';
		this.violations = data.violations;
		this.missingEntries = data.missing;
		this.invalidEntries = data.invalid;
		this.leakedEntries = data.leaked;
		this.checksHealthy = data.healthy;
		this.checksSummary = data.summary;
	}

	async #loadHistory(docId: string, turn: number): Promise<void> {
		if (!this.context) return;
		const data = await fetchHistoryView(this.context, docId);
		if (turn !== this.#turn) return;
		this.error = data.error ?? '';
		this.historyRows = data.rows;
	}

	#emitSelection(id: string): void {
		if (this.document?.id) {
			publishSelection(this.document.id, id);
		}
		this.dispatchEvent(
			new CustomEvent(EDITOR_SELECTION_EVENT, {
				detail: { kind: 'item', id },
				bubbles: true,
				composed: true,
			})
		);
	}
}

for (const prop of [
	'document',
	'activeView',
	'nodes',
	'unexported',
	'selectedNode',
	'selectedToken',
	'tokenFilter',
	'tokens',
	'tokensSummary',
	'compareMode',
	'compareNodes',
	'compareRows',
	'treeCompareRows',
	'otherDocuments',
	'otherNodes',
	'otherDocument',
	'otherNode',
	'otherLabel',
	'compareSummary',
	'previewCount',
	'previewSummary',
	'refusedPreview',
	'violations',
	'missingEntries',
	'invalidEntries',
	'leakedEntries',
	'checksHealthy',
	'checksSummary',
	'historyRows',
	'loading',
	'status',
	'error',
] as const) {
	observable(TokenTreeEditor.prototype, prop);
}

export const tokenTreeEditorDefinition = {
	name: 'token-tree-editor',
	template,
	styles: editorStyles,
} as const;
