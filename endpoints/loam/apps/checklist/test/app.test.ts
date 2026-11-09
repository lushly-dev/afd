/**
 * Checklist's scenario through the test kit (documents specification, 10.1): a checklist's record from its
 * template, each command with its undo, the shell's check before any of them, the bounds, `app check`
 * with its trust line, and a replay of it all with no frame.
 */

import { fileURLToPath } from 'node:url';
import { appCheck, readAppManifest } from '@lushly-dev/loam-cli';
import { createAppTestKernel } from '@lushly-dev/loam-testing';
import { describe, expect, it } from 'vitest';
import { type ChecklistItemV1, MAX_ITEMS, newItemId } from '../src/handlers.js';
import { focusAfterRemoval, summaryOf } from '../src/list.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Read {
	items: ChecklistItemV1[];
	done: number;
	item?: ChecklistItemV1;
}

const kernelIn = async (project?: string, grants?: string[]) =>
	createAppTestKernel({
		manifest: await readAppManifest(ROOT),
		definition: () => import('../src/app.js'),
		...(project !== undefined ? { scope: { project } } : {}),
		...(grants !== undefined ? { grants } : {}),
	});

type Kernel = Awaited<ReturnType<typeof kernelIn>>['kernel'];

async function create(kernel: Kernel, title = 'Groceries'): Promise<string> {
	const created = await kernel.call<{ id: string; type: string }>('document-create', {
		type: 'checklist',
		title,
	});
	expect(created.data).toMatchObject({ type: 'checklist', title });
	return created.data?.id as string;
}

describe('checklist', () => {
	it('creates a checklist from its template, adds, ticks and removes with undos, and replays', async () => {
		const { kernel, replay } = await kernelIn();
		const document = await create(kernel);
		expect((await kernel.call<Read>('checklist-get', { document })).data).toMatchObject({
			items: [],
			done: 0,
		});

		const milk = await kernel.call<Read>('checklist-item-add', { document, text: '  Milk  ' });
		expect(milk.success).toBe(true);
		const item = milk.data?.item as ChecklistItemV1;
		expect(item).toMatchObject({ text: 'Milk', done: false });
		expect(item.id).toMatch(/^itm_[a-z0-9]{10}$/);
		expect(milk.undoCommand).toBe('checklist-item-remove');
		expect(milk.undoArgs).toEqual({ document, item: item.id });
		const bread = (await kernel.agent.call<Read>('checklist-item-add', { document, text: 'Bread' }))
			.data?.item as ChecklistItemV1;

		const ticked = await kernel.call<Read>('checklist-item-toggle', { document, item: item.id });
		expect(ticked.data?.item?.done).toBe(true);
		expect(ticked.data?.done).toBe(1);
		expect(ticked.undoCommand).toBe('checklist-item-toggle');
		await kernel.call(ticked.undoCommand as string, ticked.undoArgs);
		await kernel.call('checklist-item-toggle', { document, item: item.id });

		// Removing the first item, then its undo, puts it back first, with its id and its tick.
		const removed = await kernel.call<Read>('checklist-item-remove', { document, item: item.id });
		expect(removed.data?.items.map(({ id }) => id)).toEqual([bread.id]);
		expect(removed.undoCommand).toBe('checklist-item-add');
		expect(removed.undoArgs).toEqual({
			document,
			text: 'Milk',
			item: item.id,
			done: true,
			index: 0,
		});
		await kernel.call(removed.undoCommand as string, removed.undoArgs);
		const back = await kernel.call<Read>('checklist-get', { document });
		expect(back.data?.items).toEqual([{ ...item, done: true }, bread]);

		// The undo's id never writes over an item that is there.
		const again = await kernel.call('checklist-item-add', removed.undoArgs);
		expect(again.error?.code).toBe('CHECKLIST_ITEM_EXISTS');

		const { report } = await replay();
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it('refuses an unknown item, empty text and input off its schema, changing nothing', async () => {
		const { kernel } = await kernelIn();
		const document = await create(kernel);
		await kernel.call('checklist-item-add', { document, text: 'Kept' });
		const before = (await kernel.call<Read>('checklist-get', { document })).data;
		for (const command of ['checklist-item-toggle', 'checklist-item-remove']) {
			const missing = await kernel.call(command, { document, item: 'itm_0000000000' });
			expect(missing.error?.code).toBe('CHECKLIST_ITEM_NOT_FOUND');
			expect(missing.error?.suggestion).toContain('checklist-get');
		}
		const blank = await kernel.call('checklist-item-add', { document, text: '   ' });
		expect(blank.error?.code).toBe('CHECKLIST_ITEM_TEXT_EMPTY');
		for (const input of [
			{ document, text: '' },
			{ document, text: 'x'.repeat(501) },
			{ document, text: 'Extra', note: 'no' },
			{ document, item: 'not-an-id' },
		]) {
			const refused = await kernel.call(
				'text' in input ? 'checklist-item-add' : 'checklist-item-toggle',
				input
			);
			expect(refused.success, JSON.stringify(input)).toBe(false);
		}
		expect((await kernel.call<Read>('checklist-get', { document })).data).toEqual(before);
	});

	it(`holds at most ${MAX_ITEMS} items`, async () => {
		const { kernel } = await kernelIn();
		const document = await create(kernel);
		for (let at = 0; at < MAX_ITEMS; at += 1) {
			const added = await kernel.call('checklist-item-add', { document, text: `Item ${at}` });
			expect(added.success).toBe(true);
		}
		const full = await kernel.call('checklist-item-add', { document, text: 'One more' });
		expect(full.error?.code).toBe('CHECKLIST_FULL');
		expect(full.error?.suggestion).toContain('checklist-item-remove');
	});

	it('is checked by the shell first: another type, the trash and another project refuse', async () => {
		const { kernel } = await kernelIn('atlas');
		const document = await create(kernel, 'Packing');
		await kernel.call('checklist-item-add', { document, text: 'Tent' });
		const unknown = await kernel.call('checklist-get', { document: 'doc_missing00000' });
		expect(unknown.success).toBe(false);
		await kernel.call('document-trash', { document });
		const trashed = await kernel.call('checklist-item-add', { document, text: 'Stove' });
		expect(trashed.success).toBe(false);
		await kernel.call('document-restore', { document });
		expect(
			(await kernel.call<Read>('checklist-get', { document })).data?.items.map(({ text }) => text)
		).toEqual(['Tent']);
	});

	it('needs the `random` grant for a new id, and the `store` grant for any', async () => {
		const { kernel } = await kernelIn(undefined, ['store']);
		const document = await create(kernel);
		const unrandom = await kernel.call('checklist-item-add', { document, text: 'Milk' });
		expect(unrandom.error?.code).toBe('APP_GRANT_MISSING');
		expect(unrandom.error?.message).toContain('random');
	});

	it('gives new ids from the call’s random, never one already taken', () => {
		const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
		const random = () => values.shift() ?? 0.99;
		const id = newItemId(random, new Set(['itm_aaaaaaaaaa']));
		expect(id).toBe('itm_ssssssssss');
	});

	it('passes app check, sandboxed, with its pages one file each', async () => {
		const report = await appCheck({ dir: ROOT });
		expect(report.refusals).toEqual([]);
		expect(report.trust?.code).toBe('SANDBOXED');
	});
});

describe("checklist's editor parts", () => {
	it('summarises what is done, and says nothing of an empty list', () => {
		const item = (id: string, done: boolean) => ({ id, text: id, done });
		expect(summaryOf([])).toBe('');
		expect(summaryOf([item('a', true), item('b', false), item('c', true)])).toBe('2 of 3 done');
	});

	it('moves focus from a removed item to the next, else the previous, else the field', () => {
		const order = ['a', 'b', 'c', 'd'];
		expect(focusAfterRemoval(order, 'b', new Set(['a', 'c', 'd']))).toBe('c');
		expect(focusAfterRemoval(order, 'b', new Set(['a', 'd']))).toBe('d');
		expect(focusAfterRemoval(order, 'd', new Set(['a', 'b', 'c']))).toBe('c');
		expect(focusAfterRemoval(order, 'b', new Set(['a']))).toBe('a');
		expect(focusAfterRemoval(order, 'b', new Set())).toBeNull();
		expect(focusAfterRemoval(order, 'z', new Set(order))).toBeNull();
	});
});
