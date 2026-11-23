/**
 * @fileoverview Data types and FAST templates for the five `token-tree-editor` views (spec §7.3, §7.4).
 */
import { html, ref, repeat, when } from '@lushly-dev/fast-element';
import type { TokenTreeEditor } from './token-tree-editor.js';

export type EditorViewId = 'tokens' | 'compare' | 'preview' | 'checks' | 'history';

export interface NodeListRow {
	id: string;
	label: string;
	parent: string | null;
	type: string;
	customizations: number;
	depth: number;
}

export interface TokenDisplayRow {
	id: string;
	valueText: string;
	swatch: string;
	from: string;
	own: boolean;
}

export interface CompareCellDisplay {
	node: string;
	valueText: string;
	swatch: string;
	differs: boolean;
}

export interface CompareRowDisplay {
	token: string;
	cells: CompareCellDisplay[];
}

export interface TreeCompareRowDisplay {
	token: string;
	hereText: string;
	hereSwatch: string;
	thereText: string;
	thereSwatch: string;
}

export interface ViolationDisplay {
	node: string;
	token: string;
	rule: string;
	severity: string;
	detail: string;
}

export interface MissingDisplay {
	node: string;
	token: string;
	reason: string;
}

export interface InvalidDisplay {
	node: string;
	token: string;
	type: string;
	problem: string;
}

export interface LeakedDisplay {
	token: string;
	reason: string;
}

export interface HistoryDisplay {
	at: string;
	actor: string;
	node: string;
	token: string;
	operation: string;
	transition: string;
	reason: string;
}

export interface RefusedPreviewDisplay {
	token: string;
	reason: string;
}

export const tokensViewTemplate = html<TokenTreeEditor>`
	<div class="controls-row">
		<violet-text-field
			label="Filter tokens"
			placeholder="e.g. color.text.*"
			:value="${(x) => x.tokenFilter}"
			@input="${(x, c) => x.onFilterInput(c.event)}"
		></violet-text-field>
		<span class="muted" role="status">${(x) => x.tokensSummary}</span>
	</div>
	${when(
		(x) => !x.loading && x.tokens.length === 0,
		html<TokenTreeEditor>`
			<violet-empty-state
				heading="${(x) => (x.tokenFilter ? 'No matching tokens' : 'No tokens in this tree')}"
				message="${(x) =>
					x.tokenFilter
						? 'Try a broader filter or clear the search.'
						: 'Import DTCG token files or select another node.'}"
			></violet-empty-state>
		`
	)}
	${when(
		(x) => x.tokens.length > 0,
		html<TokenTreeEditor>`
			<div class="table-wrap">
				<table aria-label="Resolved tokens">
					<thead>
						<tr>
							<th scope="col">Token</th>
							<th scope="col">Value</th>
							<th scope="col">Source</th>
						</tr>
					</thead>
					<tbody>
						${repeat(
							(x) => x.tokens,
							html<TokenDisplayRow, TokenTreeEditor>`<tr
								data-selected="${(row, c) => (c.parent.selectedToken === row.id ? 'true' : 'false')}"
							>
								<td>
									<button
										type="button"
										class="row-select"
										@click="${(row, c) => c.parent.selectToken(row.id)}"
									>
										${(row) => row.id}
									</button>
								</td>
								<td>
									<span class="value-cell">
										${when(
											(row) => row.swatch !== '',
											html<TokenDisplayRow>`<span
												class="swatch"
												data-swatch="${(row) => row.swatch}"
												aria-hidden="true"
											></span>`
										)}
										<span class="mono">${(row) => row.valueText}</span>
									</span>
								</td>
								<td>
									<span class="value-cell">
										<span class="mono">${(row) => row.from}</span>
										${when(
											(row) => row.own,
											html<TokenDisplayRow>`<violet-badge color="accent" size="sm"
												>Set here</violet-badge
											>`
										)}
									</span>
								</td>
							</tr>`
						)}
					</tbody>
				</table>
			</div>
		`
	)}
`;

export const compareViewTemplate = html<TokenTreeEditor>`
	<div class="controls-row">
		<violet-button
			appearance="${(x) => (x.compareMode === 'nodes' ? 'primary' : 'secondary')}"
			aria-pressed="${(x) => (x.compareMode === 'nodes' ? 'true' : 'false')}"
			@click="${(x) => x.setCompareMode('nodes')}"
			>Compare nodes</violet-button
		>
		<violet-button
			appearance="${(x) => (x.compareMode === 'trees' ? 'primary' : 'secondary')}"
			aria-pressed="${(x) => (x.compareMode === 'trees' ? 'true' : 'false')}"
			@click="${(x) => x.setCompareMode('trees')}"
			>Compare another tree</violet-button
		>
		<span class="muted" role="status">${(x) => x.compareSummary}</span>
	</div>
	${when(
		(x) => x.compareMode === 'nodes' && x.nodes.length >= 2,
		html<TokenTreeEditor>`
			<div class="compare-picker" role="group" aria-label="Nodes to compare">
				${repeat(
					(x) => x.nodes,
					html<NodeListRow, TokenTreeEditor>`<violet-checkbox
						?checked="${(row, c) => c.parent.compareNodes.includes(row.id)}"
						?disabled="${(row, c) =>
							(!c.parent.compareNodes.includes(row.id) && c.parent.compareNodes.length >= 4) ||
							(c.parent.compareNodes.includes(row.id) && c.parent.compareNodes.length <= 2)}"
						@change="${(row, c) => c.parent.toggleCompareNode(row.id)}"
						>${(row) => row.id}</violet-checkbox
					>`
				)}
			</div>
		`
	)}
	${when(
		(x) => x.compareMode === 'trees' && x.otherDocuments.length > 0,
		html<TokenTreeEditor>`
			<div class="controls-row">
				<violet-select
					label="Other tree"
					:value="${(x) => x.otherDocument}"
					@change="${(x, c) => x.onOtherDocumentChange(c.event)}"
				>
					${repeat(
						(x) => x.otherDocuments,
						html<{ id: string; label: string }, TokenTreeEditor>`<violet-option
							value="${(item) => item.id}"
							?selected="${(item, c) => c.parent.otherDocument === item.id}"
							>${(item) => item.label}</violet-option
						>`
					)}
				</violet-select>
				${when(
					(x) => x.otherNodes.length > 0,
					html<TokenTreeEditor>`
						<violet-select
							label="Other node"
							:value="${(x) => x.otherNode}"
							@change="${(x, c) => x.onOtherNodeChange(c.event)}"
						>
							${repeat(
								(x) => x.otherNodes,
								html<{ id: string; label: string }, TokenTreeEditor>`<violet-option
									value="${(item) => item.id}"
									?selected="${(item, c) => c.parent.otherNode === item.id}"
									>${(item) => item.label}</violet-option
								>`
							)}
						</violet-select>
					`
				)}
			</div>
		`
	)}
	${when(
		(x) => x.compareMode === 'nodes' && x.nodes.length < 2,
		html<TokenTreeEditor>`
			<violet-empty-state
				heading="Add another node to compare"
				message="Comparing nodes needs at least two nodes in this tree."
			></violet-empty-state>
		`
	)}
	${when(
		(x) => x.compareMode === 'nodes' && x.nodes.length >= 2 && x.compareRows.length > 0,
		html<TokenTreeEditor>`
			<div class="table-wrap">
				<table aria-label="Node comparison">
					<thead>
						<tr>
							<th scope="col">Token</th>
							${repeat((x) => x.compareNodes, html<string>`<th scope="col">${(id) => id}</th>`)}
						</tr>
					</thead>
					<tbody>
						${repeat(
							(x) => x.compareRows,
							html<CompareRowDisplay>`<tr>
								<td class="mono">${(row) => row.token}</td>
								${repeat(
									(row) => row.cells,
									html<CompareCellDisplay>`<td>
										<span class="value-cell">
											${when(
												(cell) => cell.swatch !== '',
												html<CompareCellDisplay>`<span
													class="swatch"
													data-swatch="${(cell) => cell.swatch}"
													aria-hidden="true"
												></span>`
											)}
											<span class="mono">${(cell) => cell.valueText}</span>
											${when(
												(cell) => cell.differs,
												html<CompareCellDisplay>`<span class="diff-mark">Differs</span>`
											)}
										</span>
									</td>`
								)}
							</tr>`
						)}
					</tbody>
				</table>
			</div>
		`
	)}
	${when(
		(x) => x.compareMode === 'trees' && x.treeCompareRows.length > 0,
		html<TokenTreeEditor>`
			<div class="table-wrap">
				<table aria-label="Tree comparison">
					<thead>
						<tr>
							<th scope="col">Token</th>
							<th scope="col">Here (${(x) => x.selectedNode})</th>
							<th scope="col">Other (${(x) => x.otherLabel})</th>
						</tr>
					</thead>
					<tbody>
						${repeat(
							(x) => x.treeCompareRows,
							html<TreeCompareRowDisplay>`<tr>
								<td class="mono">${(row) => row.token}</td>
								<td>
									<span class="value-cell">
										${when(
											(row) => row.hereSwatch !== '',
											html<TreeCompareRowDisplay>`<span
												class="swatch"
												data-swatch="${(row) => row.hereSwatch}"
												aria-hidden="true"
											></span>`
										)}
										<span class="mono">${(row) => row.hereText}</span>
									</span>
								</td>
								<td>
									<span class="value-cell">
										${when(
											(row) => row.thereSwatch !== '',
											html<TreeCompareRowDisplay>`<span
												class="swatch"
												data-swatch="${(row) => row.thereSwatch}"
												aria-hidden="true"
											></span>`
										)}
										<span class="mono">${(row) => row.thereText}</span>
									</span>
								</td>
							</tr>`
						)}
					</tbody>
				</table>
			</div>
		`
	)}
	${when(
		(x) =>
			!x.loading &&
			!x.error &&
			((x.compareMode === 'nodes' && x.nodes.length >= 2 && x.compareRows.length === 0) ||
				(x.compareMode === 'trees' &&
					x.otherDocuments.length > 0 &&
					x.otherNodes.length > 0 &&
					x.treeCompareRows.length === 0)),
		html<TokenTreeEditor>`
			<violet-empty-state
				heading="No differences found"
				message="All compared tokens resolve to identical values."
			></violet-empty-state>
		`
	)}
`;

export const previewViewTemplate = html<TokenTreeEditor>`
	<p class="muted" role="status">${(x) => x.previewSummary}</p>
	${when(
		(x) => !x.loading && x.previewCount === 0 && x.refusedPreview.length === 0,
		html<TokenTreeEditor>`
			<violet-empty-state
				heading="Nothing to preview"
				message="Select a node with resolved tokens to preview shared components."
			></violet-empty-state>
		`
	)}
	<div
		${ref('previewRoot')}
		class="preview-scope"
		data-preview-root="true"
		role="region"
		aria-label="Theme preview"
		?hidden="${(x) => x.previewCount === 0}"
	>
		<h3>${(x) => x.selectedNode || 'Theme preview'}</h3>
		<div class="preview-row">
			<violet-button appearance="primary">Primary action</violet-button>
			<violet-button appearance="secondary">Secondary</violet-button>
			<violet-badge color="accent">Accent</violet-badge>
			<violet-badge color="success">Pass</violet-badge>
		</div>
		<div class="preview-row">
			<violet-text-field label="Sample field" value="Token preview"></violet-text-field>
			<violet-checkbox checked>Enable surface</violet-checkbox>
			<violet-select label="Mode" value="auto">
				<violet-option value="auto" selected>Automatic</violet-option>
				<violet-option value="manual">Manual</violet-option>
			</violet-select>
		</div>
	</div>
	${when(
		(x) => x.refusedPreview.length > 0,
		html<TokenTreeEditor>`
			<section class="check-section" aria-label="Refused preview values">
				<h3>Refused values</h3>
				<ul class="check-list">
					${repeat(
						(x) => x.refusedPreview,
						html<RefusedPreviewDisplay>`<li class="check-item">
							<span class="mono">${(item) => item.token}</span>
							<span class="muted">${(item) => item.reason}</span>
						</li>`
					)}
				</ul>
			</section>
		`
	)}
`;

export { checksViewTemplate, historyViewTemplate } from './editor-secondary-views.js';
