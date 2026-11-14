/**
 * @fileoverview The inputs the command sweeps call each shell command with (phase 2 specification, 3.4; phase 3
 * specification, 6.2): decided once, shared by `call-scope.test.ts` (P2-D6) and `persona-sweep.test.ts` (P3-E2),
 * so a new command fails both until someone decides how it is called. Test data alone: nothing ships it.
 */

/** The project's id in each twin's call: the restricted one's, or one no record has. */
export const PROJECT = '$P';
/** The member's document in the restricted project, the same id in both twins. */
export const DOCUMENT = '$D';
/** The member's link from their document to itself, the same id in both twins (documents specification, 9.3). */
export const LINK = '$L';

/**
 * Each shell command's input, decided once: what reaches its handler, so the loop proves more than
 * validation. `$P` is the twin's project, `$D` the member's document.
 */
export const SHELL_INPUTS: Readonly<Record<string, unknown>> = {
	'view-state-get': { id: `loam.layout@${PROJECT}` },
	'view-state-set': { id: `loam.layout@${PROJECT}`, state: { sidebar: { open: false } } },
	'view-state-list': {},
	'layout-get': {},
	'layout-set': { sidebar: { open: false } },
	'layout-reset': {},
	'appearance-get': {},
	'appearance-set': { theme: 'dark' },
	'palette-open': {},
	'palette-close': {},
	'palette-search': { query: 'vault' },
	'auth-sign-in': { method: 'credentials', email: 'person@example.com', password: 'x' },
	'auth-sign-out': {},
	'auth-session-get': {},
	'shell-info-get': {},
	'app-list': {},
	'app-get': { instance: 'dual' },
	'app-open': { instance: 'dual' },
	'app-close': {},
	'app-command-list': { instance: 'dual' },
	'app-instance-list': {},
	'app-instance-refresh': { instance: 'dual' },
	'app-selection-get': { instance: 'dual' },
	'app-selection-set': { instance: 'dual', id: 'probe-id' },
	'status-item-set': { id: 'count', value: 'v' },
	'toast-show': { message: 'Hello' },
	'modal-open': { title: 'Sure?', body: 'Really.' },
	'overlay-dismiss': { overlayId: 'none' },
	'overlay-list': {},
	'scope-get': {},
	'section-get': {},
	'scope-set': { project: PROJECT },
	'section-open': { section: 'documents' },
	'app-route-set': { instance: 'dual', path: 'items' },
	'project-create': { name: 'Delta' },
	'project-list': {},
	'project-get': { project: PROJECT },
	'project-update': { project: PROJECT, name: 'Renamed' },
	'project-archive': { project: PROJECT },
	'project-restore': { project: PROJECT },
	'project-summary-get': { project: PROJECT },
	'workspace-get': {},
	'workspace-app-list': {},
	'workspace-app-set': { instance: 'solo', title: 'Solo two' },
	'document-type-list': {},
	'new-list': {},
	'document-create': { type: 'probe', title: 'New', recent: true },
	'document-get': { document: DOCUMENT },
	'document-list': {},
	'document-rename': { document: DOCUMENT, title: 'Renamed' },
	'document-update': { document: DOCUMENT, tags: ['t'] },
	'document-move': { document: DOCUMENT, project: null },
	'document-trash': { document: DOCUMENT },
	'document-restore': { document: DOCUMENT },
	'document-export': { document: DOCUMENT },
	'document-import': {
		type: 'probe',
		envelope: { loam_document: 1, type: 'probe', content_version: 1, content: { text: 'x' } },
	},
	'document-link-add': { from: DOCUMENT, to: DOCUMENT, kind: 'embed' },
	'document-link-remove': { link: LINK },
	'document-link-list': { document: DOCUMENT },
	'document-open': { document: DOCUMENT },
	// `t1` is the member's tab of their document, in the restricted project's editor record.
	'editor-get': {},
	'editor-activate': { tab: 't1' },
	'editor-close': { tab: 't1', discard: true },
	'editor-pin': { tab: 't1', pinned: true },
	'editor-move': { tab: 't1', group: 'new' },
	'editor-dirty-set': { tab: 't1', dirty: true },
	'editor-selection-set': { tab: 't1', selection: { kind: 'text-range', start: 0, end: 1 } },
	'session-list': {},
	'session-revoke': { session: 'others' },
	'account-passkey-list': {},
	'account-passkey-add': { name: 'Laptop' },
	'account-passkey-rename': { passkey: 'none', name: 'x' },
	'account-passkey-remove': { passkey: 'none' },
	'persona-list': {},
	'persona-create': { title: 'Reviewer', emphasis: { apps: ['dual'] } },
	'persona-update': { persona: 'per_none', title: 'Writer' },
	'persona-remove': { persona: 'per_none' },
	'persona-set': { persona: 'default' },
};

/**
 * The registered commands the loop does not call, each with its reason. Boot-only commands are in no
 * registry a caller reaches, so the palette registry never holds them.
 */
export const NOT_CALLED: Readonly<Record<string, string>> = {
	'app-call-refuse':
		'Internal: only the port runs it, to journal its own refusal (INTERNAL_COMMANDS)',
	'app-modal-refuse':
		'Internal: only the port runs it, to journal its own refusal (INTERNAL_COMMANDS)',
	'app-nested-refuse':
		'Internal: only the port runs it, to journal its own refusal (INTERNAL_COMMANDS)',
	'app-scope-refuse':
		'Internal: only the port runs it, to journal its own refusal (INTERNAL_COMMANDS)',
	'app-embed-refuse':
		'Internal: only the port runs it, to journal its own refusal (INTERNAL_COMMANDS)',
};

/** An app's command, called with what its schema requires: an app's own commands take lines 2 to 6. */
export function appInput(schema: unknown): Record<string, unknown> {
	const { properties = {}, required = [] } = schema as {
		properties?: Record<string, { type?: string }>;
		required?: string[];
	};
	return Object.fromEntries(
		required.map((name) => [
			name,
			name === 'document'
				? DOCUMENT
				: name === 'command'
					? 'document-get'
					: properties[name]?.type === 'string'
						? 'k'
						: {},
		])
	);
}

/** Every value, with `$P`, `$D` and `$L` in place. */
export function filled(value: unknown, project: string, document: string, link: string): unknown {
	return JSON.parse(
		JSON.stringify(value ?? {})
			.replaceAll(PROJECT, project)
			.replaceAll(DOCUMENT, document)
			.replaceAll(LINK, link)
	);
}
