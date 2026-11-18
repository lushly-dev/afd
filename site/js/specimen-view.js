// Drawing a comparison: two frames, a count for each channel and the list of
// differences. Both Specimen pages use it. Everything it draws comes from the
// two captures and from the result of specimen-diff.

import { CHANNELS, nameOf, screenshot, show, tally } from './specimen-runtime.js';

const SVG = 'http://www.w3.org/2000/svg';

export function el(tag, attributes = {}, ...children) {
	const node = document.createElement(tag);
	for (const [name, value] of Object.entries(attributes)) {
		if (value === undefined || value === null || value === false) continue;
		node.setAttribute(name, value === true ? '' : String(value));
	}
	node.append(...children.filter((child) => child !== undefined && child !== null && child !== ''));
	return node;
}

/** `Change bar/Token changed` → `Token changed`. */
export const stateName = (title) => title.split('/').at(-1);

/** `chromium 156.0.8078.4` → `Chromium 156`. */
export function browserName({ name, version }) {
	return `${name[0].toUpperCase()}${name.slice(1)} ${version.split('.')[0]}`;
}

/**
 * One capture's picture, with the boxes it measured drawn over it.
 * @returns {{ node: HTMLElement, show(id: string, observed: object, title: string, refs: string[]): void, point(ref: string | null): void }}
 */
export function createFrame(side) {
	const image = el('img', { alt: '', decoding: 'async' });
	const overlay = document.createElementNS(SVG, 'svg');
	overlay.setAttribute('aria-hidden', 'true');
	const title = el('b');
	const where = el('span');
	const node = el(
		'figure',
		{ class: 'sframe', 'data-side': side },
		el('figcaption', {}, el('span', { class: 'mono' }, side === 'left' ? 'Before' : 'After'), title),
		el('div', { class: 'sframe-shot' }, image, overlay),
		el('p', { class: 'sframe-where' }, where)
	);
	return {
		node,
		show(id, observed, name, refs) {
			const { viewport, theme } = observed.manifest.context;
			// The second capture of a state has no picture of its own: it is the same state.
			image.src = screenshot(id === 'bar-again' ? 'bar' : id);
			image.width = viewport.width;
			image.height = viewport.height;
			image.alt = `Screenshot of the change bar: ${name}.`;
			title.textContent = name;
			where.textContent = `${browserName(observed.manifest.browser)} · ${viewport.width} × ${viewport.height} · ${theme}`;
			overlay.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
			overlay.replaceChildren();
			for (const ref of refs) {
				const element = observed.channels.elements.find((item) => item.ref === ref);
				if (!element || ref === 'root' || !element.box.width || !element.box.height) continue;
				const rect = document.createElementNS(SVG, 'rect');
				// Half a pixel in, so a one-pixel line sits on the element's edge.
				rect.setAttribute('x', String(element.box.x + 0.5));
				rect.setAttribute('y', String(element.box.y + 0.5));
				rect.setAttribute('width', String(Math.max(0, element.box.width - 1)));
				rect.setAttribute('height', String(Math.max(0, element.box.height - 1)));
				rect.dataset.ref = ref;
				overlay.append(rect);
			}
		},
		point(ref) {
			for (const rect of overlay.children) rect.toggleAttribute('data-active', rect.dataset.ref === ref);
			overlay.toggleAttribute('data-pointing', ref !== null);
		},
	};
}

/**
 * The count for each channel, as a row of cells.
 * @param {'names' | 'keys'} [labels] The plain names, or the keys the result itself uses.
 */
export function renderTally(container, data, labels = 'names') {
	const counts = tally(data.differences);
	container.replaceChildren(
		...CHANNELS.map(([channel, label]) =>
			el(
				'div',
				{ 'data-channel': channel, 'data-changed': counts[channel] > 0 ? 'true' : 'false' },
				el('dt', {}, labels === 'keys' ? channel : label),
				el('dd', {}, counts[channel] > 0 ? String(counts[channel]) : 'Same')
			)
		)
	);
}

/** Lines of two snapshots, each marked if the other side does not have it at that place. */
function snapshotPair(before, after) {
	const lines = (text, other) => {
		const others = other.split('\n');
		return el(
			'pre',
			{},
			...text.split('\n').flatMap((line, index) => [
				el('span', { 'data-changed': line === others[index] ? undefined : 'true' }, line),
				'\n',
			])
		);
	};
	return el(
		'div',
		{ class: 'sdiff-snapshots' },
		el('div', {}, el('span', { class: 'mono' }, 'Before'), lines(before, after)),
		el('div', {}, el('span', { class: 'mono' }, 'After'), lines(after, before))
	);
}

/**
 * The differences, grouped by channel. A whole-tree accessibility difference is shown as the
 * two snapshots; a whole-tree markup difference is one row, since the attribute rows say where.
 * @param {(ref: string | null) => void} onPoint Called as a row is hovered or focused.
 */
export function renderDifferences(container, data, left, right, onPoint) {
	const groups = [];
	for (const [channel, label] of CHANNELS) {
		const items = data.differences.filter((item) => item.channel === channel);
		if (!items.length) continue;
		const rows = [];
		let snapshots = null;
		for (const item of items) {
			if (!item.target) {
				const tree = channel === 'a11y' && typeof item.left === 'string' && item.left.startsWith('- ');
				if (tree) snapshots = snapshotPair(item.left, item.right);
				else
					rows.push(
						el(
							'li',
							{},
							el('span', { class: 'sdiff-who' }, 'the whole tree'),
							el('span', { class: 'sdiff-what' }, channel === 'dom' ? 'serialized markup' : 'findings'),
							el('span', { class: 'sdiff-change' }, 'differs')
						)
					);
				continue;
			}
			const row = el(
				'li',
				{ tabindex: '0', 'data-ref': item.target },
				el('span', { class: 'sdiff-who' }, nameOf(left, item.target) === item.target ? nameOf(right, item.target) : nameOf(left, item.target)),
				el('span', { class: 'sdiff-what' }, (item.property ?? '').replace(/^(attributes|accessibility)\./, '')),
				el(
					'span',
					{ class: 'sdiff-change' },
					el('span', {}, show(item.left)),
					el('i', { 'aria-hidden': 'true' }, '→'),
					el('span', { class: 'sr-only' }, 'became'),
					el('b', {}, show(item.right))
				)
			);
			for (const type of ['pointerenter', 'focus']) row.addEventListener(type, () => onPoint(item.target));
			for (const type of ['pointerleave', 'blur']) row.addEventListener(type, () => onPoint(null));
			rows.push(row);
		}
		groups.push(
			el(
				'section',
				{ 'data-channel': channel },
				el('h4', {}, label, el('span', {}, String(items.length))),
				snapshots,
				rows.length ? el('ul', {}, ...rows) : null
			)
		);
	}
	container.replaceChildren(...groups);
}

/** The refs a comparison touched, for the frames to outline. */
export const touched = (data) => [...new Set(data.differences.map((item) => item.target).filter(Boolean))];
