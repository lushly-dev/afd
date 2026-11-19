/** The close prompt's identity (phase 4 specification, 7.3; step 6's third round, H): all three present, all the same. */
import { describe, expect, it } from 'vitest';
import { sameClose } from './same-close.js';

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
