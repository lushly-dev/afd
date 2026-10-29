/**
 * `<health-dashboard>`: the page. It renders into light DOM so landmarks, headings and
 * tables are part of the document, and it keeps every loaded report in memory only.
 */
import { FASTElement, html, observable, repeat, when } from '@lushly-dev/fast-element';
import { fetchReport, type ReportRequest } from '../report/url';
import {
	type LoadFailure,
	type LoadResult,
	MAX_REPORT_BYTES,
	readReportFile,
	SUPPORTED_SCHEMA_VERSION,
} from '../report/validate';
import { plural } from '../report/view';
import { reportTemplate } from './report-template';
import { ReportView } from './report-view';

const AUDIT_EXAMPLE =
	'python -m botcore_health audit --targets targets.toml --policy policy.toml --output-dir health-reports';

const failureTemplate = html<LoadFailure>`
	<violet-alert class="load-failure" tone="danger" data-kind="${(x) => x.kind}" data-source="${(x) => x.source}">
		<span slot="title">${(x) => `${x.title}: ${x.source}`}</span>
		<p>${(x) => x.message}</p>
		${when(
			(x) => x.details.length > 0,
			html<LoadFailure>`<ul class="failure-details">
				${repeat((x) => x.details, html<string>`<li>${(x) => x}</li>`)}
			</ul>`
		)}
	</violet-alert>
`;

const template = html<HealthDashboard>`
	<header class="banner">
		<div class="banner-inner">
			<h1>Health reports</h1>
			<p>
				Review Health audit reports on this device. Files are read in your browser and never
				uploaded, stored or sent anywhere.
			</p>
		</div>
	</header>
	<main id="main" class="page">
		<section class="load" aria-labelledby="load-heading">
			<h2 id="load-heading">Load reports</h2>
			<violet-file-upload
				class="report-files"
				appearance="dropzone"
				label="Report files"
				supporting-text="${() => `Health report JSON files, schema ${SUPPORTED_SCHEMA_VERSION}, up to ${MAX_REPORT_BYTES / 1024 / 1024} MB each.`}"
				accept=".json,application/json"
				max-file-size="${() => String(MAX_REPORT_BYTES)}"
				multiple
				@change="${(x, c) => x.filesChanged(c.event as CustomEvent<{ files?: File[] }>)}"
			></violet-file-upload>
			<p class="status-line" role="status">${(x) => x.statusText}</p>
		</section>

		${when(
			(x) => x.failures.length > 0,
			html<HealthDashboard>`
				<section class="failures" aria-labelledby="failures-heading">
					<h2 id="failures-heading">Files that can't be shown</h2>
					${repeat((x) => x.failures, failureTemplate)}
				</section>
			`
		)}
		${when(
			(x) => x.reports.length === 0 && !x.loading,
			html<HealthDashboard>`
				<violet-empty-state
					class="empty"
					heading="No reports loaded"
					message="Select or drop a Health report file to see its results."
				>
					<p>Health writes a report when you run:</p>
					<pre><code>${() => AUDIT_EXAMPLE}</code></pre>
				</violet-empty-state>
			`
		)}
		${repeat((x) => x.reports, reportTemplate)}
	</main>
	<footer class="footer">
		<p>
			Reads Health report schema ${() => SUPPORTED_SCHEMA_VERSION}. No network requests beyond
			<code>?report=</code> paths on this page's own server, no telemetry and no storage.
		</p>
	</footer>
`;

export class HealthDashboard extends FASTElement {
	declare reports: ReportView[];
	declare failures: LoadFailure[];
	declare loading: boolean;
	#fileResults: LoadResult[] = [];
	#urlResults: LoadResult[] = [];
	#views = new Map<LoadResult, ReportView>();
	#generation = 0;

	constructor() {
		super();
		this.reports = [];
		this.failures = [];
		this.loading = false;
	}

	get statusText(): string {
		if (this.loading) return 'Reading reports…';
		const total = this.reports.length + this.failures.length;
		if (total === 0) return 'No reports loaded.';
		const parts = [`Showing ${plural(this.reports.length, 'report', 'reports')}.`];
		if (this.failures.length)
			parts.push(`${plural(this.failures.length, "file can't", "files can't")} be shown.`);
		return parts.join(' ');
	}

	/** Reads every currently selected file again, so removing one removes its report. */
	async filesChanged(event: CustomEvent<{ files?: File[] }>): Promise<void> {
		const files = event.detail?.files ?? [];
		const generation = ++this.#generation;
		this.loading = true;
		const results = await Promise.all(files.map((file) => readReportFile(file)));
		if (generation !== this.#generation) return;
		this.#fileResults = results;
		this.loading = false;
		this.#publish();
	}

	async loadRequests(requests: readonly ReportRequest[]): Promise<void> {
		if (!requests.length) return;
		this.loading = true;
		this.#urlResults = await Promise.all(requests.map((request) => fetchReport(request)));
		this.loading = false;
		this.#publish();
	}

	/** Valid reports become views (kept while their result stays); failures render alone. */
	#publish(): void {
		const results = [
			...this.#urlResults.map((result) => ({ result, origin: 'url' as const })),
			...this.#fileResults.map((result) => ({ result, origin: 'file' as const })),
		];
		const views = new Map<LoadResult, ReportView>();
		for (const { result, origin } of results)
			if (result.ok)
				views.set(
					result,
					this.#views.get(result) ?? new ReportView(result.source, origin, result.report)
				);
		this.#views = views;
		this.reports = [...views.values()];
		this.failures = results.flatMap(({ result }) => (result.ok ? [] : [result]));
	}
}

observable(HealthDashboard.prototype, 'reports');
observable(HealthDashboard.prototype, 'failures');
observable(HealthDashboard.prototype, 'loading');

export async function defineHealthDashboard(): Promise<void> {
	if (customElements.get('health-dashboard')) return;
	await FASTElement.define(HealthDashboard, {
		name: 'health-dashboard',
		template,
		shadowOptions: null,
	});
}
