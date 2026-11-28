/** The trend section: a measure picker, its unit and direction in words, the plot and its table. */
import { html, repeat, when } from '@lushly-dev/fast-element';
import { eventValue, optionTemplate } from './report-template';
import type { TrendRow, TrendView } from './trend-view';

const rowTemplate = html<TrendRow>`
	<tr data-gap="${(x) => String(x.gap)}">
		<th scope="row"><time datetime="${(x) => x.generatedAt}">${(x) => x.when}</time></th>
		<td>${(x) => x.source}</td>
		<td class="trend-value">${(x) => x.value}</td>
	</tr>
`;

export const trendTemplate = html<TrendView>`
	<section class="trend" aria-labelledby="trend-heading">
		<h2 id="trend-heading">Trend across reports</h2>
		<p class="note">
			One measure from every loaded report, oldest first by generation time. A report without the
			measure is a gap, not a zero.
		</p>
		<div class="controls">
			<violet-select
				class="trend-measure"
				label="Measure"
				value="${(x) => x.selected}"
				@change="${(x, c) => x.select(eventValue(c.event))}"
			>
				${repeat((x) => x.measureOptions, optionTemplate)}
			</violet-select>
		</div>
		${when(
			(x) => x.trend,
			html<TrendView>`
				<dl class="trend-facts">
					<div><dt>Unit</dt><dd class="trend-unit-text">${(x) => x.measure?.unit}</dd></div>
					<div><dt>Direction</dt><dd class="trend-direction">${(x) => x.direction}</dd></div>
				</dl>
				<p class="trend-summary" role="status">${(x) => x.summary}</p>
				<health-trend-plot :trend="${(x) => x.trend}"></health-trend-plot>
				<h3 id="trend-points-heading">Values</h3>
				<div class="table-scroll" role="region" tabindex="0" aria-labelledby="trend-heading trend-points-heading">
					<table class="trend-points">
						<thead>
							<tr>
								<th scope="col">Generated</th>
								<th scope="col">Report</th>
								<th scope="col">Value</th>
							</tr>
						</thead>
						<tbody>
							${repeat((x) => x.rows, rowTemplate)}
						</tbody>
					</table>
				</div>
			`
		)}
	</section>
`;
