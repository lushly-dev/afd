/**
 * @fileoverview Checklist's editor (documents specification, 10.1), compiled into `dist/editor.html`: one
 * page in a sandboxed frame on `connectView`. A list of items, each a `checkbox` that ticks it off and a
 * Remove button, and a field that adds one. Every change is a command at once, so it holds no draft and
 * never reports dirty; a save asks for nothing. It reads again on `dev.loam/document-changed`, whoever made
 * the change, and reports the focused item as its selection, `{ kind: 'item', id }`, or null.
 */

import type { CommandResult } from '@lushly-dev/loam-sdk';
import { connectView, type ViewConnectionV1 } from '@lushly-dev/loam-sdk/view';
import { EDITOR_STYLES } from './editor-styles.js';
import type { ChecklistItemV1 } from './handlers.js';
import { focusAfterRemoval, summaryOf } from './list.js';

interface Read {
	items: ChecklistItemV1[];
	done: number;
}

const element = <K extends keyof HTMLElementTagNameMap>(
	name: K,
	properties: Partial<HTMLElementTagNameMap[K]> = {}
): HTMLElementTagNameMap[K] => Object.assign(document.createElement(name), properties);

function applyScheme(theme: 'light' | 'dark' | undefined): void {
	document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
}

export async function startEditor(): Promise<void> {
	const style = element('style', { textContent: EDITOR_STYLES });
	document.head.append(style);
	const view: ViewConnectionV1 = await connectView({ name: 'checklist', version: '0.1.0' });
	applyScheme(view.hostContext.theme);
	const reference = view.hostContext['dev.loam/document'];
	const documentId = reference?.id ?? '';
	const readOnly = reference?.readOnly !== false;

	const heading = element('h1', { id: 'title', textContent: reference?.title ?? 'Checklist' });
	const summary = element('p', { className: 'summary', id: 'summary' });
	const field = element('input', {
		id: 'new-item',
		name: 'text',
		autocomplete: 'off',
		maxLength: 500,
	});
	const label = element('label', { htmlFor: 'new-item', textContent: 'New item' });
	label.append(field);
	const add = element('button', { type: 'submit', className: 'add', textContent: 'Add' });
	const form = element('form', { id: 'add' });
	form.setAttribute('aria-label', 'Add an item');
	form.append(label, add);
	const list = element('ul', { id: 'items' });
	list.setAttribute('aria-labelledby', 'title');
	const empty = element('p', { className: 'empty', textContent: 'No items yet.' });
	const status = element('p', { className: 'status', id: 'status' });
	status.setAttribute('role', 'status');
	const main = element('main');
	main.append(heading, summary, ...(readOnly ? [] : [form]), list, empty, status);
	document.body.append(main);
	document.title = heading.textContent ?? 'Checklist';

	const rows = new Map<string, HTMLLIElement>();
	let items: ChecklistItemV1[] = [];
	let selected: string | null = null;

	const say = (text: string, tone?: 'danger') => {
		status.textContent = text;
		if (tone) status.dataset.tone = tone;
		else delete status.dataset.tone;
	};

	const refused = (result: CommandResult, what: string): boolean => {
		if (result.success) return false;
		say(`${what}: ${result.error?.message ?? 'it did not work'}.`, 'danger');
		return true;
	};

	const select = (id: string | null) => {
		if (id === selected) return;
		selected = id;
		view.reportSelection(id === null ? null : { kind: 'item', id });
	};

	const focusRow = (id: string | undefined, part: 'item' | 'remove' = 'item') => {
		const row = id === undefined ? undefined : rows.get(id);
		const target = row?.querySelector<HTMLButtonElement>(`button.${part}`);
		(target ?? field).focus();
	};

	function rowFor(item: ChecklistItemV1): HTMLLIElement {
		const row = element('li');
		row.dataset.item = item.id;
		const toggle = element('button', { type: 'button', className: 'item' });
		toggle.setAttribute('role', 'checkbox');
		const box = element('span', { className: 'box' });
		box.setAttribute('aria-hidden', 'true');
		const text = element('span', { className: 'text' });
		toggle.append(box, text);
		const remove = element('button', {
			type: 'button',
			className: 'remove',
			textContent: 'Remove',
		});
		toggle.disabled = readOnly;
		remove.disabled = readOnly;
		toggle.addEventListener('click', () => void run('checklist-item-toggle', item.id));
		remove.addEventListener('click', () => void run('checklist-item-remove', item.id));
		row.addEventListener('focusin', () => select(item.id));
		row.append(toggle, ...(readOnly ? [] : [remove]));
		return row;
	}

	function paint(row: HTMLLIElement, item: ChecklistItemV1): void {
		const toggle = row.querySelector('button.item') as HTMLButtonElement;
		toggle.setAttribute('aria-checked', String(item.done));
		(toggle.querySelector('.box') as HTMLElement).textContent = item.done ? '✓' : '';
		(toggle.querySelector('.text') as HTMLElement).textContent = item.text;
		row.querySelector('button.remove')?.setAttribute('aria-label', `Remove ${item.text}`);
	}

	/**
	 * Brings the list to `next` by id. Items never reorder, so rows that go are removed first and new ones
	 * inserted, and no row that stays is moved, which would blur it. Focus in a row that goes moves to the
	 * next item, else the previous, else the field.
	 */
	function render(next: ChecklistItemV1[]): void {
		const focused = (document.activeElement as HTMLElement | null)?.closest('li')?.dataset.item;
		const kept = new Set(next.map(({ id }) => id));
		const refocus =
			focused !== undefined && !kept.has(focused)
				? focusAfterRemoval(
						items.map(({ id }) => id),
						focused,
						kept
					)
				: undefined;
		for (const [id, row] of rows) {
			if (kept.has(id)) continue;
			row.remove();
			rows.delete(id);
		}
		let before: ChildNode | null = list.firstChild;
		for (const item of next) {
			let row = rows.get(item.id);
			if (!row) {
				row = rowFor(item);
				rows.set(item.id, row);
				list.insertBefore(row, before);
			} else before = row.nextSibling;
			paint(row, item);
		}
		items = next;
		summary.textContent = summaryOf(next);
		empty.hidden = next.length > 0;
		list.hidden = next.length === 0;
		if (refocus !== undefined) focusRow(refocus ?? undefined);
		if (selected !== null && !kept.has(selected)) select(null);
	}

	async function read(): Promise<void> {
		const result = await view.client.call<Read>('checklist-get', { document: documentId });
		if (refused(result, 'Could not read this checklist')) return;
		render(result.data?.items ?? []);
	}

	async function run(command: string, item: string): Promise<void> {
		const before = items.find(({ id }) => id === item);
		const result = await view.client.call<Read & { item: ChecklistItemV1 }>(command, {
			document: documentId,
			item,
		});
		const what = command === 'checklist-item-remove' ? 'Not removed' : 'Not changed';
		if (refused(result, what)) return;
		render(result.data?.items ?? items);
		if (command === 'checklist-item-remove') say(`Removed ${before?.text ?? 'the item'}.`);
		else say('');
	}

	form.addEventListener('submit', (event) => {
		event.preventDefault();
		const text = field.value.trim();
		if (text === '') {
			field.setAttribute('aria-invalid', 'true');
			field.setAttribute('aria-describedby', 'status');
			say('Write the item first.', 'danger');
			field.focus();
			return;
		}
		void (async () => {
			const result = await view.client.call<Read & { item: ChecklistItemV1 }>(
				'checklist-item-add',
				{ document: documentId, text }
			);
			if (refused(result, 'Not added')) return;
			field.value = '';
			field.removeAttribute('aria-invalid');
			field.removeAttribute('aria-describedby');
			render(result.data?.items ?? items);
			say(`Added ${result.data?.item.text ?? text}.`);
		})();
	});
	field.addEventListener('input', () => {
		if (field.getAttribute('aria-invalid') !== 'true') return;
		field.removeAttribute('aria-invalid');
		field.removeAttribute('aria-describedby');
		say('');
	});
	field.addEventListener('focus', () => select(null));

	view.onHostContext((changed) => {
		if (changed.theme) applyScheme(changed.theme);
		const title = changed['dev.loam/document']?.title;
		if (title === undefined) return;
		heading.textContent = title;
		document.title = title;
	});
	view.onDocumentChanged(() => void read());
	await read();
	document.documentElement.dataset.ready = 'true';
}

void startEditor();
