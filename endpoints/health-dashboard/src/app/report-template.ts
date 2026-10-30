/** Light-DOM templates for one report: verdict, summary, targets and the checks table. */
import { html, repeat, when } from '@lushly-dev/fast-element';
import type { Outcome, Status } from '../report/types';
import type { Verdict } from '../report/verdict';
import {
	describeEvidence,
	type EvidenceItem,
	formatGeneratedAt,
	plural,
	SEVERITY_LABEL,
	STATUS_PRESENTATION,
} from '../report/view';
import type { Choice, ReportView, SummaryItem, TargetRow } from './report-view';

const eventValue = (event: Event) =>
	String((event.target as { value?: unknown } | null)?.value ?? '');

/** Status is always icon + words + color; the badge text is the accessible name. */
export const statusBadge = html<{ status: Status }>`<violet-badge
	class="status"
	data-status="${(x) => x.status}"
	color="${(x) => STATUS_PRESENTATION[x.status].color}"
	appearance="${(x) => STATUS_PRESENTATION[x.status].appearance}"
	icon="${(x) => STATUS_PRESENTATION[x.status].icon}"
	>${(x) => STATUS_PRESENTATION[x.status].label}</violet-badge
>`;

const verdictIcon = (verdict: Verdict) => (verdict.passed ? 'health/passed' : 'health/failed');

const optionTemplate = html<Choice>`<violet-option value="${(x) => x.value}"
	>${(x) => x.label}</violet-option
>`;

const summaryTemplate = html<SummaryItem>`
	<li class="summary-item" data-status="${(x) => x.status}">
		${statusBadge}
		<span class="summary-count">${(x) => x.count}</span>
		<span class="summary-description">${(x) => STATUS_PRESENTATION[x.status].description}</span>
	</li>
`;

const targetTemplate = html<TargetRow>`
	<tr>
		<th scope="row">${(x) => x.target.id}</th>
		<td>${(x) => x.target.language}</td>
		<td><code class="path">${(x) => x.target.path}</code></td>
		<td>
			<span class="verdict-chip" data-passed="${(x) => String(x.verdict.passed)}">
				<violet-icon icon="${(x) => verdictIcon(x.verdict)}" decorative></violet-icon>
				${(x) => x.verdict.label}
			</span>
		</td>
		<td>
			${(x) =>
				(Object.keys(x.counts) as Status[])
					.filter((status) => x.counts[status] > 0)
					.map((status) => `${x.counts[status]} ${STATUS_PRESENTATION[status].label.toLowerCase()}`)
					.join(', ') || 'No checks'}
		</td>
	</tr>
`;

const evidenceTemplate = html<EvidenceItem>`
	<div class="evidence-item">
		<dt>${(x) => x.label}</dt>
		${repeat((x) => x.values, html<string>`<dd><code>${(x) => x}</code></dd>`)}
	</div>
`;

const rowTemplate = html<Outcome>`
	<tr data-status="${(x) => x.status}" data-target="${(x) => x.target}">
		<td>${statusBadge}</td>
		<th scope="row"><code>${(x) => x.check_id}</code></th>
		<td>${(x) => x.target}</td>
		<td>
			<span class="severity" data-severity="${(x) => x.severity}"
				>${(x) => SEVERITY_LABEL[x.severity]}</span
			>
		</td>
		<td>${(x) => x.message}</td>
		<td>
			${when(
				(x) => describeEvidence(x.evidence).length > 0,
				html<Outcome>`<dl class="evidence">
					${repeat((x) => describeEvidence(x.evidence), evidenceTemplate)}
				</dl>`
			)}
		</td>
		<td>${(x) => x.remediation ?? 'No guidance'}</td>
	</tr>
`;

export const reportTemplate = html<ReportView>`
	<section class="report" aria-labelledby="${(x) => `${x.id}-title`}" data-source="${(x) => x.source}">
		<header class="report-header">
			<h2 id="${(x) => `${x.id}-title`}">${(x) => x.source}</h2>
			<p class="report-meta">
				Health ${(x) => x.report.generator.version} · report schema
				${(x) => x.report.schema_version} · ${(x) => plural(x.report.targets.length, 'target', 'targets')}
				· ${(x) => plural(x.report.outcomes.length, 'check result', 'check results')} · generated
				<time datetime="${(x) => x.report.generated_at}">${(x) => formatGeneratedAt(x.report.generated_at)}</time>
			</p>
		</header>

		<div
			class="verdict"
			data-passed="${(x) => String(x.verdict.passed)}"
			data-state="${(x) => x.verdict.state}"
		>
			<p class="verdict-label">
				<violet-icon icon="${(x) => verdictIcon(x.verdict)}" decorative></violet-icon>
				<strong>Overall: ${(x) => x.verdict.label}</strong>
			</p>
			<ul class="verdict-reasons">
				${repeat((x) => x.verdict.reasons, html<string>`<li>${(x) => x}</li>`)}
			</ul>
			<p class="verdict-rule">
				A report passes only when it has required checks and every required check passed. Checks
				disabled by policy aren't counted. Health records this verdict, and the dashboard checks it
				against the results.
			</p>
		</div>

		<h3 id="${(x) => `${x.id}-summary`}">Summary</h3>
		<ul class="summary" aria-labelledby="${(x) => `${x.id}-summary`}">
			${repeat((x) => x.summary, summaryTemplate)}
		</ul>

		<h3 id="${(x) => `${x.id}-targets`}">Targets</h3>
		<div class="table-scroll" role="region" tabindex="0" aria-labelledby="${(x) => `${x.id}-title ${x.id}-targets`}">
			<table class="targets">
				<thead>
					<tr>
						<th scope="col">Target</th>
						<th scope="col">Language</th>
						<th scope="col">Path</th>
						<th scope="col">Result</th>
						<th scope="col">Checks</th>
					</tr>
				</thead>
				<tbody>
					${repeat((x) => x.targetRows, targetTemplate)}
				</tbody>
			</table>
		</div>

		<h3 id="${(x) => `${x.id}-checks`}">Checks</h3>
		${when(
			(x) => x.report.outcomes.length === 0,
			html<ReportView>`<p class="note">This report has no check results.</p>`
		)}
		${when(
			(x) => x.report.outcomes.length > 0,
			html<ReportView>`
				<div class="controls">
					<violet-select
						class="filter-status"
						label="Status"
						value="${(x) => x.query.status}"
						@change="${(x, c) => x.setStatus(eventValue(c.event))}"
					>
						${repeat((x) => x.statusChoices, optionTemplate)}
					</violet-select>
					<violet-select
						class="filter-target"
						label="Target"
						value="${(x) => x.query.target}"
						@change="${(x, c) => x.setTarget(eventValue(c.event))}"
					>
						${repeat((x) => x.targetChoices, optionTemplate)}
					</violet-select>
					<violet-select
						class="sort"
						label="Sort by"
						value="${(x) => x.query.sort}"
						@change="${(x, c) => x.setSort(eventValue(c.event))}"
					>
						${repeat((x) => x.sortChoices, optionTemplate)}
					</violet-select>
				</div>
				<p class="row-count" role="status">
					Showing ${(x) => x.rows.length} of
					${(x) => plural(x.report.outcomes.length, 'check result', 'check results')}
				</p>
				<p class="note">
					Evidence lists the inputs each check declares. Checks are heuristics over configuration,
					not proof that a rule runs.
				</p>
				${when(
					(x) => x.rows.length === 0,
					html<ReportView>`<div class="no-match">
						<p>No check results match these filters.</p>
						<violet-button class="clear-filters" @click="${(x) => x.clearFilters()}"
							>Clear filters</violet-button
						>
					</div>`
				)}
				${when(
					(x) => x.rows.length > 0,
					html<ReportView>`
						<div class="table-scroll" role="region" tabindex="0" aria-labelledby="${(x) => `${x.id}-title ${x.id}-checks`}">
							<table class="checks">
								<thead>
									<tr>
										<th scope="col" aria-sort="${(x) => x.ariaSort('status')}">Status</th>
										<th scope="col" aria-sort="${(x) => x.ariaSort('check')}">Check</th>
										<th scope="col" aria-sort="${(x) => x.ariaSort('target')}">Target</th>
										<th scope="col" aria-sort="${(x) => x.ariaSort('severity')}">Severity</th>
										<th scope="col">Message</th>
										<th scope="col">Evidence</th>
										<th scope="col">Remediation</th>
									</tr>
								</thead>
								<tbody>
									${repeat((x) => x.rows, rowTemplate)}
								</tbody>
							</table>
						</div>
					`
				)}
			`
		)}
	</section>
`;
