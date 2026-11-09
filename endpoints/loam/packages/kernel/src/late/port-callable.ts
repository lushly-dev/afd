/**
 * @fileoverview What an app may call besides its own commands, until the `calls` grant in phase 5 (phase 2
 * specification, 11.2; D68), in `late` and handed to the app port through the scope runtime, so `apps` does
 * not hold it (2.4).
 */

/**
 * `base`, phase 1's nine (`APP_CALLABLE_SHELL_COMMANDS_V1`), which the port passes: imported here, it would
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
		...(grants.has('projects') ? ['project-list', 'project-get'] : []),
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
