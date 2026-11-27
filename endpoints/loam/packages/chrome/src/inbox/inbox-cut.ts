/**
 * @fileoverview What a list cut of a confirmation (phase 4 specification, 10.2): its input past 2 KiB (the trust
 * review's blocker 9) and its preview past 8 KiB (#2801), which the person reads whole by its id before Confirm is
 * offered.
 */

import type { ConfirmationRecordV1 } from '@lushly-dev/loam-sdk';

/** The parts a list cut, in words ("input", "preview" or "input and preview"), or '' when none, or once read whole. */
export function cutWords(
	confirmation: ConfirmationRecordV1 | undefined,
	readWhole: boolean
): string {
	if (!confirmation || readWhole) return '';
	const input = (confirmation.input as { truncated?: unknown } | undefined)?.truncated === true;
	const preview = confirmation.preview?.truncated === true;
	return [...(input ? ['input'] : []), ...(preview ? ['preview'] : [])].join(' and ');
}
