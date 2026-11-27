/**
 * @fileoverview What an app may call besides its own commands, until the `calls` grant in phase 5 (phase 2
 * specification, 11.2; D68), in `late` and handed to the app port through the scope runtime, so `apps` does
 * not hold it (2.4).
 */

/**
 * `base`, phase 1's nine (`APP_CALLABLE_SHELL_COMMANDS_BASE`), which the port passes: imported here, it would
 * part first paint's chunks (2.4). Then `scope-get` and `app-route-set` always, `project-list` and `project-get` with `projects`,
 * and `document-get`, `document-list`, `document-link-list`, `document-open` and `editor-get` with
 * `documents`, and `document-link-add` and `-remove`, which a handler's nested client refuses as mutations
 * (documents specification, 11; D68). Anything else is `CALL_NOT_GRANTED`, so a port's `editor-*` is
 * `editor-get` alone.
 */
export function appCallable(
	grants: ReadonlySet<string>,
	base: readonly string[]
): ReadonlySet<string> {
	return new Set<string>([
		...base,
		'scope-get',
		'app-route-set',
		// Kernel interface 4's overlays (phase 4 specification, 6.1, 12): while the app is active, or owns the active tab.
		'popover-open',
		// Kernel interface 4's inbox (phase 4 specification, 10.2, 12): a notice to the person, at the app's own rate.
		'notification-push',
		// And step 4's dialog and prompt (6.1), on the same terms.
		'dialog-open',
		'prompt-open',
		// Step 6's confirmations (7.2, 12): the ones this app raised, read and withdrawn.
		'confirmation-get',
		'confirmation-withdraw',
		// Step 9's experiments (5.4, 12): whether one of the app's own is on for the person, `EXPERIMENT_NOT_OWNED` past them.
		'experiment-check',
		// Phase 5's step 10 (9.2): whatever the grants, so an app without `events` hears `GRANT_REQUIRED` from its handler.
		'event-list',
		// And its 9.3: the active app's or the active document editor's alone, which its handler checks.
		'shell-open',
		...(grants.has('projects') ? ['project-list', 'project-get'] : []),
		// Kernel interface 4's (phase 4 specification, 3.8 and 12): the app's own sections, `SETTING_NOT_OWNED` past them.
		...(grants.has('settings') ? ['setting-get', 'setting-list'] : []),
		...(grants.has('documents')
			? [
					'document-get',
					'document-list',
					'document-open',
					'editor-get',
					'document-link-add',
					'document-link-remove',
					'document-link-list',
				]
			: []),
	]);
}
