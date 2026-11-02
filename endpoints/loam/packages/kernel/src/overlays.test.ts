import type { OverlayRefV1, OverlayResultV1, OverlayV1 } from '@lushly-dev/loam-sdk';
import { describe, expect, it } from 'vitest';
import { createOverlayStore, TOAST_CAP } from './overlays.js';
import { createSteppingClock, createTestKernel } from './testing.js';

const toast = { message: 'Saved' };
const modal = { title: 'Delete?', body: 'This cannot be undone.' };

async function boot() {
	return createTestKernel({ clock: createSteppingClock() });
}

describe('toast-show and modal-open', () => {
	it('gives each overlay a counted id and the shell as owner of a person or agent', async () => {
		const { kernel } = await boot();
		const first = await kernel.call<OverlayRefV1>('toast-show', toast);
		const second = await kernel.agent.call<OverlayRefV1>('modal-open', modal);
		expect(first.data).toEqual({
			overlayId: 'ovl-1',
			owner: 'shell',
			kind: 'toast',
			lifetime: 'transient',
		});
		expect(second.data).toEqual({
			overlayId: 'ovl-2',
			owner: 'shell',
			kind: 'modal',
			lifetime: 'session',
		});
		const { data } = await kernel.call<{ overlays: OverlayV1[] }>('overlay-list');
		expect(data?.overlays.map((overlay) => overlay.overlayId)).toEqual(['ovl-1', 'ovl-2']);
		expect(data?.overlays[0]?.input).toEqual({ message: 'Saved', durationMs: 5000 });
	});

	it('refuses out-of-range input before it reaches the journal', async () => {
		const { kernel, journal } = await boot();
		expect((await kernel.call('toast-show', { message: '' })).error?.code).toBe('VALIDATION_ERROR');
		expect((await kernel.call('toast-show', { message: 'x'.repeat(201) })).success).toBe(false);
		expect((await kernel.call('toast-show', { message: 'x', durationMs: 999 })).success).toBe(
			false
		);
		expect((await kernel.call('modal-open', { title: 'x'.repeat(81), body: 'y' })).success).toBe(
			false
		);
		expect(await journal.read()).toHaveLength(0);
	});

	it('dismisses the oldest toast when a sixth arrives, with reason cap', async () => {
		const store = createOverlayStore();
		const refs = Array.from({ length: TOAST_CAP + 1 }, () => store.open('shell', 'toast', toast));
		const first = refs[0] as OverlayRefV1;
		await expect(store.whenClosed(first.overlayId)?.settled).resolves.toEqual({
			overlayId: first.overlayId,
			result: 'dismissed',
			reason: 'cap',
		});
		expect(store.list()).toHaveLength(TOAST_CAP);
	});

	it('refuses a second modal, journaled, and refuses the palette while one is open', async () => {
		const { kernel, journal } = await boot();
		await kernel.call('modal-open', modal);
		expect((await kernel.call('modal-open', modal)).error?.code).toBe('OVERLAY_MODAL_BUSY');
		expect((await kernel.call('palette-open')).error?.code).toBe('OVERLAY_MODAL_BUSY');
		const entries = await journal.read();
		expect(entries.map((entry) => entry.result.error?.code)).toEqual([
			undefined,
			'OVERLAY_MODAL_BUSY',
			'OVERLAY_MODAL_BUSY',
		]);
		const overlay = (await kernel.call<{ overlays: OverlayV1[] }>('overlay-list')).data
			?.overlays[0];
		await kernel.call('overlay-dismiss', { overlayId: overlay?.overlayId });
		expect((await kernel.call('palette-open')).success).toBe(true);
	});
});

describe('overlay-dismiss', () => {
	it('defaults a toast to dismissed and a modal to cancel, and takes a result and reason', async () => {
		const { kernel } = await boot();
		await kernel.call('toast-show', toast);
		await kernel.call('modal-open', modal);
		const dismissed = await kernel.call<OverlayResultV1>('overlay-dismiss', {
			overlayId: 'ovl-1',
			reason: 'timeout',
		});
		expect(dismissed.data).toEqual({ overlayId: 'ovl-1', result: 'dismissed', reason: 'timeout' });
		const closed = await kernel.call<OverlayResultV1>('overlay-dismiss', { overlayId: 'ovl-2' });
		expect(closed.data).toEqual({ overlayId: 'ovl-2', result: 'cancel', reason: 'user' });
		await kernel.call('modal-open', modal);
		const confirmed = await kernel.call<OverlayResultV1>('overlay-dismiss', {
			overlayId: 'ovl-3',
			result: 'confirm',
		});
		expect(confirmed.data?.result).toBe('confirm');
	});

	it('answers OVERLAY_NOT_FOUND for what is not open', async () => {
		const { kernel } = await boot();
		const missing = await kernel.call('overlay-dismiss', { overlayId: 'ovl-9' });
		expect(missing.error?.code).toBe('OVERLAY_NOT_FOUND');
		expect(missing.error?.suggestion).toContain('overlay-list');
	});
});

describe('the overlay store', () => {
	it('answers a wait after the overlay has closed, and names the owner', async () => {
		const store = createOverlayStore();
		const { overlayId } = store.open('sums', 'modal', { title: 'T', body: 'B' });
		const waiting = store.whenClosed(overlayId);
		expect(waiting?.owner).toBe('sums');
		store.close(overlayId, 'confirm', 'user');
		await expect(waiting?.settled).resolves.toMatchObject({ result: 'confirm' });
		await expect(store.whenClosed(overlayId)?.settled).resolves.toMatchObject({
			result: 'confirm',
		});
		expect(store.whenClosed('ovl-99')).toBeUndefined();
	});

	it('forgets old closed overlays', () => {
		const store = createOverlayStore();
		const { overlayId } = store.open('shell', 'toast', toast);
		store.close(overlayId, 'dismissed', 'user');
		for (let i = 0; i < 80; i++) {
			const next = store.open('shell', 'toast', toast);
			store.close(next.overlayId, 'dismissed', 'user');
		}
		expect(store.whenClosed(overlayId)).toBeUndefined();
	});
});
