/**
 * Compact density (2.1): a `custom` node under each theme. It tightens spacing, targets and the
 * shell's bars, and never takes a target below 24px (WCAG 2.2 target size, minimum). The status
 * bar is already 24px, and `size.target.compact` and `size.space.xs` are already at their
 * floors, so compact leaves them as they are.
 */
import { ref, type TreeToken } from './types.js';

const space = (step: number) => ref(`ref.space.${step}`);

export const COMPACT_OVERRIDES: readonly TreeToken[] = [
	{ id: 'size.space.sm', value: space(2) },
	{ id: 'size.space.md', value: space(6) },
	{ id: 'size.space.lg', value: space(8) },
	{ id: 'size.space.xl', value: space(16) },
	{ id: 'space.inline.sm', value: space(2) },
	{ id: 'space.inline.md', value: space(6) },
	{ id: 'space.inline.lg', value: space(8) },
	{ id: 'space.stack.xs', value: space(2) },
	{ id: 'space.stack.sm', value: space(4) },
	{ id: 'space.stack.md', value: space(8) },
	{ id: 'size.target.natural', value: '28px' },
	{ id: 'size.target.comfortable', value: '32px' },
	{ id: 'shell.size.titlebar', value: '32px' },
	{ id: 'shell.size.rail', value: '40px' },
	{ id: 'shell.size.tabbar', value: '48px' },
];

/** The ids compact must keep at or above 24px: targets and the shell's bars. */
export const TARGET_IDS: readonly string[] = [
	'size.target.compact',
	'size.target.natural',
	'size.target.comfortable',
	'shell.size.titlebar',
	'shell.size.statusbar',
	'shell.size.rail',
	'shell.size.tabbar',
];
