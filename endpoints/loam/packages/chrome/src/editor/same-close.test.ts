/** The close prompt's identity (phase 4 specification, 7.3; step 6's third round, H): all three present, all the same. */
import { describe, expect, it } from 'vitest';
import type { AskedClose } from '../elements/events.js';
import { askClose, sameClose } from './same-close.js';

const atlas = { workspace: 'personal', project: 'prj_atlas' };

describe('sameClose', () => {
	it('matches only a tab, scope and document all present and the same', () => {
		const asked = { tab: 't1', scope: atlas, document: 'doc_a' };
		expect(sameClose(asked, { tab: 't1', scope: { ...atlas }, document: 'doc_a' })).toBe(true);
		expect(sameClose(asked, { tab: 't2', scope: atlas, document: 'doc_a' })).toBe(false);
		expect(
			sameClose(asked, { tab: 't1', scope: { workspace: 'personal' }, document: 'doc_a' })
		).toBe(false);
		expect(sameClose(asked, { tab: 't1', scope: atlas, document: 'doc_b' })).toBe(false);
		// A missing one never matches: a closed tab that kept its mark, or a question that named no document.
		expect(sameClose(asked, { tab: 't1', scope: atlas, document: undefined })).toBe(false);
		expect(
			sameClose({ tab: 't1', scope: atlas }, { tab: 't1', scope: atlas, document: undefined })
		).toBe(false);
		expect(
			sameClose({ tab: 't1', document: 'doc_a' }, { tab: 't1', scope: atlas, document: 'doc_a' })
		).toBe(false);
		expect(sameClose(asked, { tab: 't1', scope: undefined, document: 'doc_a' })).toBe(false);
	});
});

describe('askClose', () => {
	/** A kernel whose `editor-close` answers with the kernel's close prompt, as a dirty tab's does. */
	const kernel = {
		call: async () => ({
			success: false,
			error: { code: 'EDITOR_TAB_DIRTY', details: { prompt: { overlayId: 'ovl-9' } } },
		}),
	} as never;
	const shown = { tab: 't1', scope: atlas, document: 'doc_a' };

	it("acts on the tab button's close only where the answer is about the tab it holds", async () => {
		const answer = async (about: AskedClose) => {
			const modals = new Map<string, (result: string, asked?: AskedClose) => void>();
			const asking = askClose(kernel, modals, 't1', { scope: atlas }, shown);
			await Promise.resolve();
			await Promise.resolve();
			modals.get('ovl-9')?.('discard', about);
			return asking;
		};
		expect(await answer({ tab: 't1', scope: atlas, document: 'doc_a' })).toBe('discard');
		// Another document under the same tab id, or none named: nothing is discarded.
		expect(await answer({ tab: 't1', scope: atlas, document: 'doc_b' })).toBe('cancel');
		expect(await answer({ tab: 't1', scope: atlas })).toBe('cancel');
	});
});
