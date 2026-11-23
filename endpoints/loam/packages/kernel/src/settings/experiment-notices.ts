/**
 * @fileoverview What each person is told of the workspace's experiments (phase 4 specification, 5.2; D119): the
 * workspace's state of one experiment as a token, and the notice a change of token brings. Each person keeps the
 * tokens they were last told in their own `loam.settings`, so every affected person is told once, on their own next
 * call, whoever made the change and in whichever shell. Pure: the store is `experiments.ts`'s.
 */

import { live } from './experiment-rules.js';

/**
 * The workspace's state of one experiment, as a person is told it: `off`; `on:<digest>`, on for the `changes` shown
 * now; `stale:<digest>`, an enablement made for other `changes`, so off until an owner turns it on again; or
 * `removed:<at>`, its app removed it.
 */
export function workspaceToken(
	digest: string | undefined,
	row: { digest: string; updatedAt: number } | undefined,
	removedAt: number | undefined
): string {
	if (row && live(row.updatedAt, removedAt) && digest !== undefined)
		return row.digest === digest ? `on:${digest}` : `stale:${digest}`;
	return removedAt !== undefined ? `removed:${removedAt}` : 'off';
}

/** The kind of a token, before its colon. */
const kindOf = (token: string | undefined): string => (token ?? 'off').split(':')[0] as string;

/**
 * The notice a person gets when the workspace's token moves from `before` to `after` (5.2), or undefined: on for the
 * workspace (for new `changes` too); its `changes` changed under the workspace's enablement; off for the workspace;
 * its app removed it while the person had it from the workspace. Nothing from off to anything but on.
 */
export function workspaceNotice(
	title: string,
	changes: string | undefined,
	before: string | undefined,
	after: string
): { title: string; body: string; tone: 'info' | 'warning' } | undefined {
	if (before === after) return undefined;
	const was = kindOf(before);
	switch (kindOf(after)) {
		case 'on':
			return {
				title: `${title} is on for the workspace`,
				body: `An owner turned it on for everyone.${changes ? ` ${changes}` : ''} You can turn it off for yourself in Settings, Experiments.`,
				tone: 'info',
			};
		case 'stale':
			return was === 'on'
				? {
						title: `${title} has changed`,
						body: 'What it may change is new, so it is off until an owner turns it on again for the workspace, or you turn it on for yourself in Settings, Experiments.',
						tone: 'warning',
					}
				: undefined;
		case 'removed':
			return was === 'on' || was === 'stale'
				? {
						title: `${title} has ended`,
						body: 'Its app no longer offers it, so it is off, and turning it on again later starts afresh.',
						tone: 'info',
					}
				: undefined;
		default:
			return was === 'on'
				? {
						title: `${title} is off for the workspace`,
						body: 'An owner turned it off for everyone. You can still turn it on for yourself in Settings, Experiments.',
						tone: 'info',
					}
				: undefined;
	}
}
