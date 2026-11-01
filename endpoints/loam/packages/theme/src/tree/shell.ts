/**
 * The shell ids (2.1), read only by `@lushly-dev/loam-chrome`, with their light values.
 */
import { ref, type TreeToken } from './types.js';

export const SHELL_TOKENS: readonly TreeToken[] = [
	{ id: 'shell.size.titlebar', value: '40px' },
	{ id: 'shell.size.statusbar', value: '24px' },
	{ id: 'shell.size.rail', value: '48px' },
	{ id: 'shell.size.tabbar', value: '56px' },
	{ id: 'shell.size.sidebar.default', value: '260px' },
	{ id: 'shell.size.sidebar.min', value: '200px' },
	{ id: 'shell.size.sidebar.max', value: '480px' },
	{ id: 'shell.size.inspector.default', value: '300px' },
	{ id: 'shell.size.inspector.min', value: '240px' },
	{ id: 'shell.size.inspector.max', value: '520px' },
	{ id: 'shell.size.panel.default', value: '240px' },
	{ id: 'shell.size.panel.min', value: '120px' },
	{ id: 'shell.size.main.min', value: '360px' },
	{ id: 'shell.size.drawer.max', value: '320px' },
	{ id: 'shell.size.handle', value: '4px' },
	{ id: 'shell.size.focus', value: '2px' },
	{ id: 'shell.color.handle.rest', value: ref('color.border.subtle') },
	{ id: 'shell.color.handle.hover', value: ref('color.border.strong') },
	{ id: 'shell.color.handle.active', value: ref('color.focus.ring') },
];

/**
 * Where each number of the kernel's `LAYOUT_DEFAULTS_V0` (5.2) lives in the tree, keyed by its
 * path in that constant. `theme:check` fails when a resolved value and the kernel disagree.
 */
export const LAYOUT_DEFAULT_TOKENS = {
	'sidebar.default': 'shell.size.sidebar.default',
	'sidebar.min': 'shell.size.sidebar.min',
	'sidebar.max': 'shell.size.sidebar.max',
	'inspector.default': 'shell.size.inspector.default',
	'inspector.min': 'shell.size.inspector.min',
	'inspector.max': 'shell.size.inspector.max',
	'panel.default': 'shell.size.panel.default',
	'panel.min': 'shell.size.panel.min',
	mainMin: 'shell.size.main.min',
} as const;
