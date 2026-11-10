/**
 * @fileoverview The surface catalog, grant catalog, composition library and constants the rules
 * need (phase 1 specification, section 4). No validator and no DOM: the shell reads these at boot.
 */

export { LAYOUT_DEFAULTS_V0, type LayoutDefaultsV0 } from './layout-defaults.js';

/** One surface of the catalog. */
export interface SurfaceEntry {
	id: string;
	/** Where a manifest declares it: 'ui.surfaces.rail', 'commands[].expose.palette'. */
	place: string;
	/** The architecture's owner column. */
	owner: string;
	/** The architecture's rule on app switch. */
	onSwitch: string;
	/** The phase that first serves it. */
	servedFrom: number;
}

/** One host service. */
export interface GrantEntry {
	name: string;
	servedFrom: number | 'collaboration';
}

/** One composition. `servedFrom` is null when a later phase adds it for a first app that needs it. */
export interface CompositionEntry {
	name: string;
	parts: string[];
	servedFrom: number | null;
}

/** Surface catalog version 1: all 22 of the architecture's surfaces. */
export const SURFACE_CATALOG_V1: readonly SurfaceEntry[] = [
	{
		id: 'rail',
		place: 'ui.surfaces.rail',
		owner: 'Shell',
		onSwitch: 'Stays; the active item changes',
		servedFrom: 1,
	},
	{
		id: 'sidebar',
		place: 'ui.surfaces.sidebar',
		owner: 'App',
		onSwitch: 'Parked and restored',
		servedFrom: 1,
	},
	{
		id: 'header',
		place: 'ui.surfaces.header',
		owner: 'App',
		onSwitch: 'Replaced',
		servedFrom: 1,
	},
	{ id: 'main', place: 'ui.surfaces.main', owner: 'App', onSwitch: 'Replaced', servedFrom: 1 },
	{
		id: 'documents',
		place: 'ui.documents',
		owner: 'Shell',
		onSwitch: 'Stays',
		servedFrom: 2,
	},
	{ id: 'new', place: 'ui.new', owner: 'Shell', onSwitch: 'Filtered by scope', servedFrom: 2 },
	{
		id: 'editor',
		place: 'ui.documents',
		owner: "The document's plugin",
		onSwitch: 'Tabs stay; the active editor changes',
		servedFrom: 2,
	},
	{
		id: 'embed',
		place: 'ui.documents',
		owner: 'The embedding document',
		onSwitch: 'Follows its editor',
		servedFrom: 2,
	},
	{
		id: 'inspector',
		place: 'ui.surfaces.inspector',
		owner: 'App',
		onSwitch: 'Cleared',
		servedFrom: 1,
	},
	{
		id: 'panel',
		place: 'ui.surfaces.panel',
		owner: 'App',
		onSwitch: 'Parked and restored',
		servedFrom: 1,
	},
	{
		id: 'status',
		place: 'ui.surfaces.status',
		owner: 'Left: shell. Right: app',
		onSwitch: 'Right items removed',
		servedFrom: 1,
	},
	{
		id: 'palette',
		place: 'commands[].expose.palette',
		owner: 'Shell',
		onSwitch: 'Filtered by active app and scope',
		servedFrom: 1,
	},
	{ id: 'settings', place: 'ui.settings', owner: 'Shell', onSwitch: 'Stays', servedFrom: 4 },
	{ id: 'experiments', place: 'ui.experiments', owner: 'Shell', onSwitch: 'Stays', servedFrom: 4 },
	{
		id: 'notifications',
		place: 'commands, with no key',
		owner: 'Shell',
		onSwitch: 'Stays',
		servedFrom: 4,
	},
	{
		id: 'overlays',
		place: 'commands, with no key',
		owner: 'App session or shell',
		onSwitch: 'Per the overlay policy',
		servedFrom: 1,
	},
	{
		id: 'agent',
		place: 'contexts[], skills[]; later agent',
		owner: 'Shell',
		onSwitch: 'Contexts follow the active app and document',
		servedFrom: 5,
	},
	{ id: 'automations', place: 'ui.automations', owner: 'Shell', onSwitch: 'Stays', servedFrom: 7 },
	{
		id: 'keybindings',
		place: 'ui.surfaces.keybindings',
		owner: 'Shell',
		onSwitch: 'App-local bindings deactivate',
		servedFrom: 1,
	},
	{
		id: 'menus',
		place: 'ui.menus',
		owner: 'Shell',
		onSwitch: 'App entries deactivate',
		servedFrom: 4,
	},
	{
		id: 'project-summary',
		place: 'ui.project_summary',
		owner: 'Shell, rendered in the projects section',
		onSwitch: 'Stays',
		servedFrom: 2,
	},
	{ id: 'account', place: 'ui.account', owner: 'Shell', onSwitch: 'Stays', servedFrom: 3 },
];

/** The architecture's host services catalog, with the phase that first serves each. */
export const GRANT_CATALOG_V1: readonly GrantEntry[] = [
	{ name: 'store', servedFrom: 1 },
	{ name: 'clock', servedFrom: 1 },
	{ name: 'random', servedFrom: 1 },
	{ name: 'projects', servedFrom: 2 },
	{ name: 'documents', servedFrom: 2 },
	{ name: 'settings', servedFrom: 4 },
	{ name: 'collaboration', servedFrom: 'collaboration' },
	{ name: 'events', servedFrom: 5 },
	{ name: 'calls', servedFrom: 5 },
	{ name: 'http', servedFrom: 5 },
	{ name: 'secrets', servedFrom: 6 },
];

/** Composition library version 1. */
export const COMPOSITIONS_V1: readonly CompositionEntry[] = [
	{ name: 'console', parts: ['main'], servedFrom: 1 },
	{ name: 'list-detail', parts: ['sidebar', 'main'], servedFrom: 1 },
	{ name: 'split', parts: [], servedFrom: null },
	{ name: 'board', parts: [], servedFrom: null },
	{ name: 'document', parts: [], servedFrom: null },
	{ name: 'dashboard', parts: [], servedFrom: null },
	{ name: 'wizard', parts: [], servedFrom: null },
];

/** The system icons `violet-elements` generates that suit an app. */
export const ICONS_V1: readonly string[] = [
	'system/attach',
	'system/calendar',
	'system/checkmark',
	'system/clock',
	'system/document',
	'system/folder',
	'system/search',
	'system/warning',
];

/** The architecture's section 5 list, which holds `status` (D68), and the `auth-*` commands' domain. */
export const SHELL_DOMAINS_V1: readonly string[] = [
	'shell',
	'app',
	'project',
	'scope',
	'document',
	'presence',
	'thread',
	'copilot',
	'run',
	'automation',
	'autonomy',
	'approval',
	'agent',
	'pack',
	'view-state',
	'layout',
	'toast',
	'dialog',
	'modal',
	'popover',
	'prompt',
	'overlay',
	'appearance',
	'palette',
	'status',
	'setting',
	'experiment',
	'notification',
	'event',
	'account',
	'persona',
	'session',
	'auth',
	// Phase 2 specification, 4.3.
	'workspace',
	'section',
	'editor',
	'new',
	// Phase 3 specification, 12.
	'member',
];

/**
 * The grants this build serves: phase 1's, and `projects` from phase 2's step 4 (phase 2 specification,
 * 5), and `documents` from step 9 (documents specification, 11). A step that serves a grant adds it here.
 */
export const SERVED_GRANTS_V2: readonly string[] = [
	'store',
	'clock',
	'random',
	'projects',
	'documents',
];

/** The chords the shell keeps, as `SHELL_KEYBINDINGS_V0` does; the kernel's test holds them equal. */
export const SHELL_RESERVED_CHORDS_V1: readonly string[] = [
	'Mod+K',
	'Mod+B',
	'Mod+Alt+B',
	'Mod+J',
	'F6',
	'Shift+F6',
	'Mod+S',
];

/** What `app check`, `app-get` and an app's README say of each kind (D54). */
export const TRUST_LINES_V1 = {
	native: {
		code: 'TRUSTED_NOT_SANDBOXED',
		line: "Trusted, not sandboxed. Native apps share the shell's page, so this app's grants are a contract, not a boundary. Ship untrusted code as a view.",
	},
	view: { code: 'SANDBOXED', line: 'Sandboxed: its grants are enforced.' },
	mounted: { code: 'EXTERNAL', line: 'External: its results are labeled untrusted.' },
} as const;

/** The notices `app check`, `deployment check` and the console show (D55, D56, D65). */
export const NOTICES_V1 = {
	MOUNT_ANNOTATIONS_UNTRUSTED:
		"A mounted server's annotations are its own claim: they set display and defaults, never a security decision, and the deployment entry's overrides win.",
	TEAM_INSTANCE_NOTICE:
		'A team instance is mounted only where every member of its projects may read all of it.',
	TEAM_INSTANCE_SINGLE_PRINCIPAL:
		"Umbel sees one principal for every member of this instance's projects. Mount it only where each of them may read all of it.",
	STDIO_TRUSTED_CODE:
		"This instance runs as the host's OS user. It is trusted code, not sandboxed.",
	// Phase 3 specification, 2.1: `deployment check` says it of a `local` deployment.
	LOCAL_IDENTITY: '`local` identity: anyone with this browser profile is its owner.',
} as const;
