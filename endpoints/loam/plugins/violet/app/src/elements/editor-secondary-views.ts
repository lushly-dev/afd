/**
 * @fileoverview Checks and History view templates for `token-tree-editor` (spec §7.3).
 */
import { html, repeat, when } from '@lushly-dev/fast-element';
import type {
	HistoryDisplay,
	InvalidDisplay,
	LeakedDisplay,
	MissingDisplay,
	ViolationDisplay,
} from './editor-views.js';
import type { TokenTreeEditor } from './token-tree-editor.js';

export const checksViewTemplate = html<TokenTreeEditor>`
	<div class="checks-summary" role="status">
		<violet-badge color="${(x) => (x.checksHealthy ? 'success' : 'danger')}">
			${(x) => (x.checksHealthy ? 'All checks pass' : 'Checks failing')}
		</violet-badge>
		<span class="muted">${(x) => x.checksSummary}</span>
	</div>
	${when(
		(x) => x.violations.length > 0,
		html<TokenTreeEditor>`
			<section class="check-section" aria-label="Contrast and rule violations">
				<h3>Violations</h3>
				<ul class="check-list">
					${repeat(
						(x) => x.violations,
						html<ViolationDisplay, TokenTreeEditor>`<li class="check-item">
							<button
								type="button"
								class="row-select"
								@click="${(row, c) => c.parent.selectNodeAndToken(row.node, row.token)}"
							>
								${(row) => `${row.node} · ${row.token}`}
							</button>
							<span class="muted">${(row) => row.detail}</span>
						</li>`
					)}
				</ul>
			</section>
		`
	)}
	${when(
		(x) => x.missingEntries.length > 0,
		html<TokenTreeEditor>`
			<section class="check-section" aria-label="Unfilled interface entries">
				<h3>Unfilled entries</h3>
				<ul class="check-list">
					${repeat(
						(x) => x.missingEntries,
						html<MissingDisplay, TokenTreeEditor>`<li class="check-item">
							<button
								type="button"
								class="row-select"
								@click="${(row, c) => c.parent.selectNodeAndToken(row.node, row.token)}"
							>
								${(row) => `${row.node} · ${row.token}`}
							</button>
							<span class="muted">${(row) => row.reason}</span>
						</li>`
					)}
				</ul>
			</section>
		`
	)}
	${when(
		(x) => x.invalidEntries.length > 0,
		html<TokenTreeEditor>`
			<section class="check-section" aria-label="Invalid interface entries">
				<h3>Invalid entries</h3>
				<ul class="check-list">
					${repeat(
						(x) => x.invalidEntries,
						html<InvalidDisplay, TokenTreeEditor>`<li class="check-item">
							<button
								type="button"
								class="row-select"
								@click="${(row, c) => c.parent.selectNodeAndToken(row.node, row.token)}"
							>
								${(row) => `${row.node} · ${row.token}`}
							</button>
							<span class="muted">${(row) => `${row.type}: ${row.problem}`}</span>
						</li>`
					)}
				</ul>
			</section>
		`
	)}
	${when(
		(x) => x.leakedEntries.length > 0,
		html<TokenTreeEditor>`
			<section class="check-section" aria-label="Leaked interface entries">
				<h3>Leaked entries</h3>
				<ul class="check-list">
					${repeat(
						(x) => x.leakedEntries,
						html<LeakedDisplay, TokenTreeEditor>`<li class="check-item">
							<button
								type="button"
								class="row-select"
								@click="${(row, c) => c.parent.selectToken(row.token)}"
							>
								${(row) => row.token}
							</button>
							<span class="muted">${(row) => row.reason}</span>
						</li>`
					)}
				</ul>
			</section>
		`
	)}
`;

export const historyViewTemplate = html<TokenTreeEditor>`
	${when(
		(x) => !x.loading && x.historyRows.length === 0,
		html<TokenTreeEditor>`
			<violet-empty-state
				heading="No changes yet"
				message="Edits to tokens and nodes appear here with their actor and reason."
			></violet-empty-state>
		`
	)}
	${when(
		(x) => x.historyRows.length > 0,
		html<TokenTreeEditor>`
			<div class="table-wrap">
				<table aria-label="Change history">
					<thead>
						<tr>
							<th scope="col">When</th>
							<th scope="col">Who</th>
							<th scope="col">Node</th>
							<th scope="col">Change</th>
							<th scope="col">Reason</th>
						</tr>
					</thead>
					<tbody>
						${repeat(
							(x) => x.historyRows,
							html<HistoryDisplay>`<tr>
								<td class="mono">${(row) => row.at}</td>
								<td>${(row) => row.actor}</td>
								<td class="mono">${(row) => row.node}</td>
								<td class="mono">
									${(row) =>
										`${row.operation}${row.token ? ` ${row.token}` : ''}: ${row.transition}`}
								</td>
								<td>${(row) => row.reason}</td>
							</tr>`
						)}
					</tbody>
				</table>
			</div>
		`
	)}
`;
