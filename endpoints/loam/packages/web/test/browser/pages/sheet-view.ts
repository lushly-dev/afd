/**
 * Step 12's fixture view type, `sheet` (documents specification, 5.6 and 9.2): its editor and its embed, one
 * page on the SDK's real `connectView`, which reads `dev.loam/document` to know which. The editor holds a
 * draft in a text area, reports dirty on each edit and its selection as a `text-range`, saves on
 * `dev.loam/editor-save` through `sheet-write`, refusing a draft that holds "reject", and reads again on
 * `dev.loam/document-changed`. The embed shows the text read-only and tries a write and a query that writes,
 * keeping what each answered in `window.sheet`, as a hostile embed would.
 */
import type { CommandResult } from '@lushly-dev/loam-sdk';
import { connectView } from '@lushly-dev/loam-sdk/view';

interface Sheet {
	ready?: boolean;
	role?: 'editor' | 'embed';
	document?: unknown;
	saves: number;
	changes: number;
	teardowns: number;
	write?: CommandResult;
	queryWrite?: CommandResult;
	titles: string[];
}

const sheet: Sheet = { saves: 0, changes: 0, teardowns: 0, titles: [] };
(window as unknown as { sheet: Sheet }).sheet = sheet;

async function start(): Promise<void> {
	const view = await connectView({ name: 'sheet', version: '0.1.0' });
	const reference = view.hostContext['dev.loam/document'];
	sheet.document = reference;
	const id = reference?.id ?? '';
	const readOnly = reference?.readOnly !== false;
	sheet.role = readOnly ? 'embed' : 'editor';
	const main = document.createElement('main');
	const heading = document.createElement('h1');
	heading.textContent = reference?.title ?? 'Sheet';
	const label = document.createElement('label');
	label.textContent = 'Text';
	const area = document.createElement('textarea');
	area.id = 'text';
	area.readOnly = readOnly;
	label.append(area);
	main.append(heading, label);
	document.body.append(main);
	let saved = '';
	const read = async () => {
		const result = await view.client.call<{ text: string }>('sheet-read', { document: id });
		const text = result.data?.text ?? '';
		if (area.value === saved) area.value = text;
		saved = text;
	};
	await read();
	view.onHostContext((changed) => {
		const title = changed['dev.loam/document']?.title;
		if (title === undefined) return;
		heading.textContent = title;
		sheet.titles.push(title);
	});
	view.onDocumentChanged(() => {
		sheet.changes += 1;
		void read();
	});
	view.onTeardown(() => {
		sheet.teardowns += 1;
	});
	if (readOnly) {
		sheet.write = await view.client.call('sheet-write', { document: id, text: 'from an embed' });
		sheet.queryWrite = await view.client.call('sheet-peek-write', { document: id });
		sheet.ready = true;
		return;
	}
	area.addEventListener('input', () => view.reportDirty(area.value !== saved));
	area.addEventListener('select', () =>
		view.reportSelection({ kind: 'text-range', start: area.selectionStart, end: area.selectionEnd })
	);
	view.onSave(async () => {
		sheet.saves += 1;
		const text = area.value;
		// A test holds one save, with what it began with, until it calls `release`.
		const held = window as unknown as { holdNext?: boolean; release?: () => void };
		if (held.holdNext) {
			held.holdNext = false;
			await new Promise<void>((resolve) => {
				held.release = resolve;
			});
		}
		if (text.includes('reject')) throw new Error('This sheet refuses that text');
		const result = await view.client.call('sheet-write', { document: id, text });
		if (!result.success) throw new Error(result.error?.message ?? 'Not saved');
		saved = text;
		view.reportDirty(area.value !== saved);
	});
	sheet.ready = true;
}

void start();
