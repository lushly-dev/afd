/**
 * A failed save's toast (documents specification, 5.5; phase 4 specification, 10.2): an unseen one is sticky, so it
 * also lands in the inbox whatever the person's `toastSticky` says.
 */
import { describe, expect, it } from 'vitest';
import { notSaved } from './not-saved.js';

describe('notSaved', () => {
	it('is a timed danger toast, and sticky when the page was hidden', () => {
		const cause = Object.assign(new Error('The disk is full'), {
			code: 'X',
			suggestion: 'Free space',
		});
		expect(notSaved('Plan', cause)).toEqual({
			message: 'Plan was not saved: The disk is full (X). Free space',
			tone: 'danger',
			durationMs: 30_000,
		});
		expect(notSaved('Plan', cause, true)).toMatchObject({ tone: 'danger', sticky: true });
	});
});
