/**
 * E4's scripted session (phase 2 specification, 10): two projects and a restricted one, a switch, each kind
 * of app at each level, a refused cross-project call, archive and restore, a project's home, and a reload
 * in the middle with a sign-in after it. The chrome's own reads join the journal, as a person's session has
 * them, and a replay of it has zero differences.
 */
import type { Page } from 'playwright';
import { agentCall, kernelCall, surfacesIdle } from '../harness';

/** The person the Mock signs in, and so a member of what they create (3.4). */
export const PERSON = 'mock-user-person@example.com';

/** A call with options, as the palette's interface makes it: `scope: 'workspace'` widens. */
export function scopedCall(page: Page, name: string, input: unknown, scope: unknown) {
	return page.evaluate(
		({ name, input, scope }) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { call(name: string, input: unknown, options: unknown): Promise<unknown> };
			};
			return shell.kernel.call(name, input, { scope });
		},
		{ name, input, scope }
	);
}

const signIn = (page: Page) =>
	kernelCall(page, 'auth-sign-in', {
		method: 'credentials',
		email: 'person@example.com',
		password: 'x',
	});

export interface ScopeSessionResult {
	/** What each refusal in the session answered, by step. */
	refused: Record<string, unknown>;
}

/** The session; `reload` reloads the page as a person does, and resolves once the shell is back. */
export async function runScopeSession(
	page: Page,
	reload: () => Promise<void>
): Promise<ScopeSessionResult> {
	const person = async (name: string, input: unknown = {}) => {
		const result = await kernelCall(page, name, input);
		await surfacesIdle(page);
		return result;
	};
	const refused: Record<string, unknown> = {};
	await signIn(page);
	await person('project-create', { name: 'Atlas' });
	await person('project-create', { name: 'Beacon' });
	await person('project-create', {
		name: 'Vault',
		access: { mode: 'restricted', members: [PERSON] },
	});
	// Atlas: the project-only app, the dual-scope app at each level, and the workspace-only app narrowed.
	await person('scope-set', { project: 'atlas' });
	await person('app-open', { instance: 'tasks' });
	await person('tasks-add', { title: 'Plan' });
	await person('app-open', { instance: 'hello' });
	await person('hello-greet', { name: 'Ada' });
	await scopedCall(page, 'hello-greet', { name: 'Grace' }, 'workspace');
	await agentCall(page, 'tally-add', { by: 2 });
	await surfacesIdle(page);
	// Beacon: hello stays; Atlas's task refused here, naming Atlas.
	await person('scope-set', { project: 'beacon' });
	refused.crossProject = await person('tasks-complete', { task: 't-1' });
	// Beacon's home, its summary journaled with its nested query.
	await person('section-open', { section: 'projects' });
	await person('project-summary-get', { project: 'beacon' });
	// Archive the active project, which moves the scope to the workspace, then restore it.
	await person('project-archive', { project: 'beacon' });
	await person('project-restore', { project: 'beacon' });
	// Into the restricted project, then a reload, which signs the Mock out: stage B leaves Vault.
	await person('scope-set', { project: 'vault' });
	await person('app-open', { instance: 'tasks' });
	await person('tasks-add', { title: 'Secret' });
	await reload();
	// Signed out now: Vault is refused, the same as a project that does not exist.
	refused.afterReload = await person('scope-set', { project: 'vault' });
	await signIn(page);
	await surfacesIdle(page);
	await person('scope-set', { project: 'vault' });
	await person('project-summary-get', { project: 'vault' });
	await person('scope-set', { project: null });
	return { refused };
}
