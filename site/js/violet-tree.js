// The Violet tree as the pages draw it: one tile per node, each a small
// screen painted with that node's resolved tokens. Both Violet pages use it,
// so the design side and the dev side show the same tree the same way.

import { LABELS } from './violet-seed.js';

/** Make an element: el('span', { class: 'x', 'aria-hidden': 'true' }, 'text', child). */
export function el(tag, attributes = {}, ...children) {
	const node = document.createElement(tag);
	for (const [name, value] of Object.entries(attributes)) {
		if (value === false || value == null) continue;
		node.setAttribute(name, value === true ? '' : value);
	}
	node.append(...children);
	return node;
}

export const label = (id) => LABELS[id] ?? id;
export const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
export const isHex = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

/** A small screen: a card, a title, two lines of text, a button and a field. */
export function makeTile() {
	return el(
		'span',
		{ class: 'vnode-tile', 'aria-hidden': 'true' },
		el(
			'span',
			{ class: 'tile-card' },
			el('span', { class: 'tile-title' }, 'Aa'),
			el('span', { class: 'tile-line' }),
			el('span', { class: 'tile-line tile-line--short' }),
			el(
				'span',
				{ class: 'tile-row' },
				el('span', { class: 'tile-button' }, 'Save'),
				el('span', { class: 'tile-ghost' })
			)
		)
	);
}

/** Paint a tile with a node's resolved tokens, as --v-* custom properties. */
export function paintTile(tile, node) {
	tile.removeAttribute('style');
	for (const token of node.tokens) {
		if (token.referenceError) continue;
		tile.style.setProperty(`--v-${token.id.replaceAll('.', '-')}`, String(token.resolvedValue));
	}
}

/** How many values a node holds itself: its own settings plus what it removed. */
export const ownCount = (node) =>
	node.tokens.filter((token) => token.resolvedAt === node.id).length + node.removed.length;

function nodeButton(node) {
	return el(
		'button',
		{ type: 'button', class: 'vnode', 'data-node': node.id },
		el('span', { class: 'vnode-head' }, el('b', {}, label(node.id)), el('span', {}, node.type)),
		makeTile(),
		el('span', { class: 'vnode-foot' }, el('span', { 'data-count': true }), el('span', { 'data-rule': true }))
	);
}

/**
 * Draw a snapshot (see violet-runtime.js) into a list as a chart, parents
 * above children. The list is rebuilt only when nodes come or go, so focus
 * and the tiles' transitions survive an ordinary change.
 *
 * @param {HTMLElement} list A `<ul class="vtree">`.
 * @param {{ onSelect?: (nodeId: string) => void }} [options]
 */
export function createTree(list, { onSelect } = {}) {
	let shape = '';

	const branch = (nodes, parentId) =>
		nodes
			.filter((node) => node.parentId === parentId)
			.map((node) => {
				const item = el('li', {}, nodeButton(node));
				const children = branch(nodes, node.id);
				if (children.length) item.append(el('ul', {}, ...children));
				return item;
			});

	list.addEventListener('click', (event) => {
		const button = event.target.closest('[data-node]');
		if (button) onSelect?.(button.dataset.node);
	});

	return {
		/**
		 * @param {{ nodes: object[] }} snap
		 * @param {{ selected?: string, effects?: Record<string, string> }} [state]
		 *   `effects` marks what a previewed change would do to each node.
		 */
		render(snap, { selected, effects } = {}) {
			const next = snap.nodes.map((node) => `${node.id}<${node.parentId}`).join('|');
			if (next !== shape) {
				shape = next;
				list.replaceChildren(...branch(snap.nodes, null));
			}
			list.toggleAttribute('data-preview', Boolean(effects));
			for (const node of snap.nodes) {
				const button = list.querySelector(`[data-node="${node.id}"]`);
				paintTile(button.querySelector('.vnode-tile'), node);
				const own = ownCount(node);
				const counted = node.parentId
					? own
						? plural(own, 'change')
						: 'No changes'
					: plural(node.tokens.length, 'token');
				const failing = node.failures.length
					? plural(node.failures.length, 'rule fails', 'rules fail')
					: '';
				button.querySelector('[data-count]').textContent = counted;
				button.querySelector('[data-rule]').textContent = failing;
				button.toggleAttribute('data-failing', node.failures.length > 0);
				if (selected !== undefined) button.setAttribute('aria-pressed', String(node.id === selected));
				const effect = effects?.[node.id];
				if (effect) button.dataset.impact = effect;
				else delete button.dataset.impact;
				button.setAttribute(
					'aria-label',
					[`${label(node.id)}, ${node.type}`, counted, failing, effect && `Preview: ${effect}`]
						.filter(Boolean)
						.join('. ')
				);
			}
		},
	};
}
