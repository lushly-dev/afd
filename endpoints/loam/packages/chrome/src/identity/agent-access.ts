/**
 * @fileoverview A connected agent's access in the agents tab (phase 3 specification, 5.3 and 9.2; #2784), in the
 * `account` chunk with `account.ts`, which alone imports it: where the agent may act, in words, and the native modal
 * dialog in which its person narrows or widens it. Saving is `account-agent-update`; nothing here decides access.
 */

import { button, el } from './account-parts.js';

/** `AgentMemberV1['access']`, as `account-agent-list` answers it. */
export interface AgentAccess {
	workspace: boolean;
	projects: string[] | 'sponsor';
}

/** A project the person may open, as `project-list` answers it. */
export interface OpenableProject {
	id: string;
	name: string;
}

/** Where a connected agent may act, in words (14), with the projects the person can no longer open counted. */
export function accessText(access: AgentAccess, names: ReadonlyMap<string, string>): string {
	if (access.projects === 'sponsor')
		return access.workspace
			? 'Every project you can open, and workspace-wide work'
			: 'Every project you can open, nothing workspace-wide';
	const shown = access.projects.flatMap((id) => {
		const name = names.get(id);
		return name === undefined ? [] : [name];
	});
	const lost = access.projects.length - shown.length;
	const parts = [
		...shown,
		...(lost > 0 ? [`${lost} ${lost === 1 ? 'project' : 'projects'} you can't open`] : []),
	];
	if (parts.length === 0) return access.workspace ? 'Workspace-wide work only' : 'Nothing';
	return `${access.workspace ? 'Workspace-wide work, and only ' : 'Only '}${parts.join(', ')}`;
}

/**
 * Ask where `name` may act, in a native modal dialog: every project the person can open, or only the ones they tick,
 * and whether it may do workspace-wide work. Undefined when cancelled. Projects the person can no longer open are not
 * offered, so saving leaves them out.
 */
export function askAccess(
	root: ShadowRoot,
	name: string,
	current: AgentAccess,
	projects: readonly OpenableProject[]
): Promise<AgentAccess | undefined> {
	return new Promise((resolve) => {
		const radio = (value: 'all' | 'only', label: string) => {
			const input = el('input', {
				type: 'radio',
				name: 'access-reach',
				id: `access-${value}`,
				value,
			}) as HTMLInputElement;
			return { input, label: el('label', { class: 'check', for: input.id }, input, label) };
		};
		const all = radio('all', 'Every project you can open');
		const only = radio('only', 'Only these projects');
		const chosen = current.projects === 'sponsor' ? [] : current.projects;
		const offered = new Set(projects.map((project) => project.id));
		const lost = chosen.filter((id) => !offered.has(id)).length;
		all.input.checked = current.projects === 'sponsor';
		only.input.checked = !all.input.checked;
		const boxes = projects.map((project) => {
			const box = el('input', {
				type: 'checkbox',
				id: `access-project-${project.id}`,
				value: project.id,
			}) as HTMLInputElement;
			box.checked = chosen.includes(project.id);
			return { box, label: el('label', { class: 'check', for: box.id }, box, project.name) };
		});
		const list = el(
			'fieldset',
			{},
			el('legend', {}, 'Projects it can act in'),
			...(boxes.length > 0
				? boxes.map((each) => each.label)
				: [el('p', { class: 'note' }, 'You cannot open any project yet.')])
		) as HTMLFieldSetElement;
		const note =
			lost > 0
				? el(
						'p',
						{ class: 'note' },
						`It also names ${lost} ${lost === 1 ? 'project' : 'projects'} you can no longer open. Saving leaves ${lost === 1 ? 'it' : 'them'} out.`
					)
				: undefined;
		const sync = () => {
			list.disabled = !only.input.checked;
			if (note) note.hidden = !only.input.checked;
		};
		sync();
		all.input.addEventListener('change', sync);
		only.input.addEventListener('change', sync);
		const workspace = el('input', {
			type: 'checkbox',
			id: 'access-workspace',
		}) as HTMLInputElement;
		workspace.checked = current.workspace;
		const form = el(
			'form',
			{ method: 'dialog' },
			el('h2', { id: 'access-title' }, `Where can ${name} act?`),
			el(
				'p',
				{ class: 'note' },
				'It never does more than you may. Its next request uses what you choose; it stays connected.'
			),
			el('fieldset', {}, el('legend', {}, 'Projects'), all.label, only.label, list),
			...(note ? [note] : []),
			el(
				'label',
				{ class: 'check', for: workspace.id },
				workspace,
				'Workspace-wide work too: reading and changing what is outside any project, such as creating projects'
			),
			el(
				'div',
				{ class: 'row' },
				button('Cancel', () => close(undefined)),
				el('button', { type: 'submit', class: 'action primary' }, 'Save access')
			)
		);
		const dialog = el('dialog', { 'aria-labelledby': 'access-title' }, form) as HTMLDialogElement;
		const close = (answer: AgentAccess | undefined) => {
			dialog.close();
			dialog.remove();
			resolve(answer);
		};
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			close({
				workspace: workspace.checked,
				projects: all.input.checked
					? 'sponsor'
					: boxes.filter((each) => each.box.checked).map((each) => each.box.value),
			});
		});
		dialog.addEventListener('cancel', () => close(undefined));
		root.append(dialog);
		dialog.showModal();
		(all.input.checked ? all.input : only.input).focus();
	});
}
