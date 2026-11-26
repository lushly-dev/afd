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
	'popover-open': { anchor: { surface: 'shell', anchor: 'probe' }, kind: 'info', body: 'Hi' },
	'dialog-open': { title: 'Note', body: 'Kept.' },
	'prompt-open': { title: 'Name?' },
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
	// Step 4 (5.1, 5.3, 7.2): at the provider, which a local workspace has none of.
	'account-get': {},
	'account-update': { name: 'Bea' },
	'account-invitation-list': {},
	'account-invitation-accept': { invitation: 'none' },
	'account-invitation-reject': { invitation: 'none' },
	// Step 7's connected agents (5.3): the person's own, from the provider's table.
	'account-agent-list': {},
	'account-agent-disconnect': { agent: 'agt_aaaaaaaaaaaaaaaaaaaa' },
	'member-list': {},
	'member-invite': { email: 'new@example.com', role: 'member' },
	'member-invitation-list': {},
	'member-invitation-cancel': { invitation: 'none' },
	'member-remove': { member: 'none' },
	// Phase 6's step 5 (S4): the person's own leave, at the provider.
	'member-leave': {},
	'member-role-set': { member: 'none', role: 'member' },
	'persona-list': {},
	'persona-create': { title: 'Reviewer', emphasis: { apps: ['dual'] } },
	'persona-update': { persona: 'per_none', title: 'Writer' },
	'persona-remove': { persona: 'per_none' },
	'persona-set': { persona: 'default' },
	// Step 6 (8.2): the sponsor is the signed-out `local` person, an owner, who may not enter the twin's project.
	'agent-member-add': {
		name: 'Reviewer',
		sponsor: 'local',
		access: { workspace: false, projects: [PROJECT] },
	},
	'agent-member-list': {},
	'agent-member-get': { agent: 'agt_aaaaaaaaaaaaaaaaaaaa' },
	'agent-member-update': { agent: 'agt_aaaaaaaaaaaaaaaaaaaa', name: 'Writer' },
	'agent-member-remove': { agent: 'agt_aaaaaaaaaaaaaaaaaaaa' },
	'agent-member-confirm': { agent: 'agt_aaaaaaaaaaaaaaaaaaaa' },
	'agent-member-decline': { agent: 'agt_aaaaaaaaaaaaaaaaaaaa' },
	// Phase 5's step 1: the copilot's commands, with a session no one holds.
	'copilot-session-start': {},
	'copilot-message-send': { session: 'cps_0000000000000000', text: 'Hello' },
	'copilot-turn-stop': { session: 'cps_0000000000000000', turn: 1 },
	'copilot-session-list': {},
	'copilot-session-get': { session: 'cps_0000000000000000' },
	'copilot-provider-list': {},
	'approval-health-get': {},
	// Phase 4's step 1: the settings, a person's own appearance, which every caller here may read and a person write.
	'setting-schema-get': { section: 'loam.appearance' },
	'setting-list': { section: 'loam.appearance' },
	'setting-get': { section: 'loam.appearance', key: 'theme' },
	'setting-set': { section: 'loam.appearance', key: 'theme', value: 'dark', level: 'person' },
	'setting-reset': { section: 'loam.appearance', key: 'theme', level: 'person' },
	// Phase 4's step 5: the inbox, the person's own, each decided at the call's scope (10.1).
	'notification-push': { title: 'A notice' },
	'notification-list': {},
	'notification-read': { all: true },
	'notification-archive': { all: true },
	'notification-act': { notification: 'ntf_0000000000000000' },
	// Phase 4's step 8: autonomy, each naming the twin's project, which no caller here may enter (4.3, 4.4).
	'autonomy-get': { command: 'project-get', instance: 'shell', project: PROJECT },
	'autonomy-list': { project: PROJECT },
	'autonomy-set': { level: 'project', project: PROJECT, mode: 'ask' },
	// Phase 4's step 9: experiments, none of which reads a project (5.4).
	'experiment-list': {},
	'experiment-check': { experiment: 'hello.inspector-v2' },
	'experiment-enable': { experiment: 'hello.inspector-v2', audience: 'person' },
	'experiment-disable': { experiment: 'hello.inspector-v2', audience: 'person' },
	// Phase 4's step 6: the palette's input prompt (7.1), and a caller's own confirmation (7.2), each the call's scope's.
	'palette-run': { command: 'project-get' },
	'confirmation-get': { notification: 'ntf_0000000000000000' },
	'confirmation-withdraw': { notification: 'ntf_0000000000000000' },
	// Phase 4's step 10: the limits' usage, an owner's read of the workspace (section 11).
	'limit-usage-get': {},
	// Phase 4's step 7: the bindings in force, the person's own overrides among them (8.5).
	'keybinding-list': { all: true },
	'shell-focus-next': {},
	'shell-focus-previous': {},
	'shell-save': {},
	'shell-project-switcher': {},
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
	'app-limit-refuse':
		'Internal: only the port runs it, to journal its own refusal (INTERNAL_COMMANDS)',
	'overlay-global-set':
		'Internal: only the shell sets its strip under the title bar (INTERNAL_COMMANDS)',
	'copilot-port-refuse':
		"Internal: only the copilot's agent port runs it, to journal its own refusal (INTERNAL_COMMANDS)",
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
