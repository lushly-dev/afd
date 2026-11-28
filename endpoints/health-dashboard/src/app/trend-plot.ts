/**
 * `<health-trend-plot>`: one measure's points as an SVG line. It builds the SVG with
 * `createElementNS` (a FAST template would create HTML-namespace children inside it) and
 * styles it only through classes, which the page's policy allows. The table beside it
 * carries the same values for keyboard and screen-reader readers; the plot is one image
 * with a text alternative, and its hover readout is a pointer convenience.
 */
import { FASTElement, observable } from '@lushly-dev/fast-element';
import {
	describeTrend,
	formatValue,
	formatValueWithUnit,
	GAP_TEXT,
	type PlotGeometry,
	plotGeometry,
	type Trend,
} from '../report/trend';
import { formatGeneratedAt } from '../report/view';

const SVG = 'http://www.w3.org/2000/svg';

function node<K extends keyof SVGElementTagNameMap>(
	name: K,
	attributes: Record<string, string | number>,
	text?: string
): SVGElementTagNameMap[K] {
	const element = document.createElementNS(SVG, name);
	for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
	if (text !== undefined) element.textContent = text;
	return element;
}

export class HealthTrendPlot extends FASTElement {
	declare trend: Trend | null;
	#geometry: PlotGeometry | null = null;
	#readout: HTMLParagraphElement | null = null;
	#crosshair: SVGLineElement | null = null;
	#focus: SVGCircleElement | null = null;

	constructor() {
		super();
		this.trend = null;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.#render();
	}

	trendChanged(): void {
		if (this.isConnected) this.#render();
	}

	#render(): void {
		this.replaceChildren();
		const trend = this.trend;
		if (!trend) return;
		const geometry = plotGeometry(trend);
		this.#geometry = geometry;
		const { plot, width, height } = geometry;
		const svg = node('svg', {
			class: 'trend-svg',
			viewBox: `0 0 ${width} ${height}`,
			role: 'img',
			'aria-label': describeTrend(trend),
		});

		for (const tick of geometry.yTicks) {
			svg.append(
				node('line', {
					class: 'trend-grid',
					x1: plot.left,
					x2: plot.right,
					y1: tick.y,
					y2: tick.y,
				}),
				node(
					'text',
					{
						class: 'trend-tick',
						x: plot.left - 8,
						y: tick.y,
						'text-anchor': 'end',
						'dominant-baseline': 'middle',
					},
					formatValue(tick.value)
				)
			);
		}
		svg.append(
			node('line', {
				class: 'trend-axis',
				x1: plot.left,
				x2: plot.right,
				y1: plot.bottom,
				y2: plot.bottom,
			}),
			node(
				'text',
				{
					class: 'trend-unit',
					x: 14,
					y: (plot.top + plot.bottom) / 2,
					'text-anchor': 'middle',
					transform: `rotate(-90 14 ${(plot.top + plot.bottom) / 2})`,
				},
				trend.measure.unit
			)
		);
		for (const tick of geometry.xTicks)
			svg.append(
				node(
					'text',
					{ class: 'trend-tick', x: tick.x, y: plot.bottom + 22, 'text-anchor': 'middle' },
					tick.label
				)
			);

		// A report without the measure is marked on the axis, so a gap reads as a gap.
		for (const { x, point } of geometry.slots)
			if (point.gap) {
				const gap = node('line', {
					class: 'trend-gap',
					x1: x,
					x2: x,
					y1: plot.bottom - 10,
					y2: plot.bottom,
				});
				gap.append(
					node('title', {}, `${formatGeneratedAt(point.generatedAt)}: ${GAP_TEXT[point.gap]}`)
				);
				svg.append(gap);
			}
		for (const d of geometry.runs) svg.append(node('path', { class: 'trend-line', d }));

		this.#crosshair = node('line', {
			class: 'trend-crosshair',
			x1: 0,
			x2: 0,
			y1: plot.top,
			y2: plot.bottom,
			visibility: 'hidden',
		});
		svg.append(this.#crosshair);
		for (const marker of geometry.markers) {
			const circle = node('circle', { class: 'trend-marker', cx: marker.x, cy: marker.y, r: 4 });
			circle.append(node('title', {}, this.#describe(marker.point)));
			svg.append(circle);
		}
		this.#focus = node('circle', {
			class: 'trend-focus',
			cx: 0,
			cy: 0,
			r: 7,
			visibility: 'hidden',
		});
		svg.append(this.#focus);

		// The whole plot is the hit target: the nearest point in time answers.
		svg.addEventListener('pointermove', (event) => this.#point(svg, event));
		svg.addEventListener('pointerleave', () => this.#clear());

		this.#readout = document.createElement('p');
		this.#readout.className = 'trend-readout';
		this.#readout.setAttribute('aria-hidden', 'true');
		this.#readout.textContent = 'Point at the plot to read a value.';
		this.append(svg, this.#readout);
	}

	#describe(point: Trend['points'][number]): string {
		const unit = this.trend?.measure.unit ?? '';
		const value =
			point.value === null
				? GAP_TEXT[point.gap ?? 'missing']
				: formatValueWithUnit(point.value, unit);
		return `${formatGeneratedAt(point.generatedAt)}: ${value} (${point.source})`;
	}

	#point(svg: SVGSVGElement, event: PointerEvent): void {
		const geometry = this.#geometry;
		const box = svg.getBoundingClientRect();
		if (!geometry || !box.width) return;
		const x = ((event.clientX - box.left) / box.width) * geometry.width;
		let nearest = geometry.slots[0];
		for (const slot of geometry.slots)
			if (nearest && Math.abs(slot.x - x) < Math.abs(nearest.x - x)) nearest = slot;
		if (!nearest) return;
		this.#crosshair?.setAttribute('x1', String(nearest.x));
		this.#crosshair?.setAttribute('x2', String(nearest.x));
		this.#crosshair?.setAttribute('visibility', 'visible');
		const marker = geometry.markers.find((item) => item.point === nearest.point);
		if (marker && this.#focus) {
			this.#focus.setAttribute('cx', String(marker.x));
			this.#focus.setAttribute('cy', String(marker.y));
			this.#focus.setAttribute('visibility', 'visible');
		} else this.#focus?.setAttribute('visibility', 'hidden');
		if (this.#readout) this.#readout.textContent = this.#describe(nearest.point);
	}

	#clear(): void {
		this.#crosshair?.setAttribute('visibility', 'hidden');
		this.#focus?.setAttribute('visibility', 'hidden');
		if (this.#readout) this.#readout.textContent = 'Point at the plot to read a value.';
	}
}

observable(HealthTrendPlot.prototype, 'trend');

export async function defineHealthTrendPlot(): Promise<void> {
	if (customElements.get('health-trend-plot')) return;
	await FASTElement.define(HealthTrendPlot, { name: 'health-trend-plot', shadowOptions: null });
}
