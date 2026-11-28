/**
 * @fileoverview The members tab's agent members (phase 3 specification, 8.2, 8.3 and 14), in the `account` chunk with
 * `account.ts`, which alone imports it: each agent member listed apart from the people as "Agent · Sponsored by <name>",
 * in text, with its kind, its status in words (never by color alone) and the projects the viewer may see; an owner's
 * add form and remove buttons, absent for anyone else; the sponsor's confirm and decline on a pending one, and
 * withdraw on an active installed one. Every change is a command; a destructive or accountable one is confirmed in a
 * native modal dialog with its consequence.
 */

import type { AgentMemberRowV1, LoamKernel, MemberV1 } from '@lushly-dev/loam-kernel';
import { type Answer, button, confirmIn, el } from './account-parts.js';

/** What the members tab gives this part. */
export interface AgentMembersView {
	kernel: LoamKernel;
	root: ShadowRoot;
	agents: AgentMemberRowV1[];
	people: MemberV1[];
	/** The viewer's person id, so a sponsor sees confirm and decline. */
	me: string | undefined;
	/** Whether the viewer is an owner in `provider` mode: the add form and remove buttons, else absent. */
	owner: boolean;
	say(text: string): void;
	failed(answer: Answer): string;
	read(): Promise<void>;
}

const KINDS: Record<string, string> = { installed: 'Installed', connected: 'Connected' };
const WHY: Record<string, string> = {
	'sponsor-left': 'its sponsor left the workspace',
	'sponsor-declined': 'its sponsor declined',
	'sponsor-withdrew': 'its sponsor withdrew it',
	disconnected: 'it was disconnected',
	owner: 'by an owner',
};

const sponsorOf = (agent: AgentMemberRowV1) => agent.sponsorName ?? 'a former member';

/** The status in words (14): never a color alone. */
export function statusText(agent: AgentMemberRowV1): string {
	if (agent.status === 'active') return 'Active';
	if (agent.status === 'pending') return `Pending: waiting for ${sponsorOf(agent)} to confirm`;
	return `Suspended: ${WHY[agent.suspended ?? ''] ?? 'suspended'}`;
}

/** The projects the viewer may see, by name, and how many they may not (8.2). */
function projectsText(agent: AgentMemberRowV1, names: Map<string, string>): string {
	const parts: string[] = [];
	if (agent.access.workspace) parts.push('The workspace');
	if (agent.access.projects === 'sponsor') parts.push(`whatever ${sponsorOf(agent)} can open`);
	else parts.push(...agent.access.projects.map((id) => names.get(id) ?? id));
	if (agent.hiddenProjects > 0)
		parts.push(
			`${agent.hiddenProjects} ${agent.hiddenProjects === 1 ? 'project' : 'projects'} you can't see`
		);
	return parts.length > 0 ? parts.join(', ') : 'Nothing yet';
}

/** The agent members' table, with the sponsor's and an owner's controls, then an owner's add form. */
export async function agentMembersPart(view: AgentMembersView): Promise<Node[]> {
	const { kernel, root, owner } = view;
	const listed = (await kernel.call('project-list')) as Answer<{
		projects: { id: string; name: string }[];
	}>;
	const projects = listed.data?.projects ?? [];
	const names = new Map(projects.map((project) => [project.id, project.name]));
	const nodes: Node[] = [];
	if (view.agents.length > 0) {
		const rows = view.agents.map((agent) => {
			const actions: Node[] = [];
			if (agent.status === 'pending' && agent.sponsor === view.me) {
				actions.push(
					button(`Confirm ${agent.name}`, async () => {
						const sure = await confirmIn(
							root,
							`Sponsor ${agent.name}?`,
							`You become accountable for what ${agent.name} does. It acts only within its access and yours, and the journal names you beside it.`,
							'Confirm'
						);
						if (!sure) return;
						const answer = (await kernel.call('agent-member-confirm', {
							agent: agent.id,
						})) as Answer;
						view.say(answer.success ? `${agent.name} is active.` : view.failed(answer));
						await view.read();
					}),
					button(`Decline ${agent.name}`, async () => {
						const sure = await confirmIn(
							root,
							`Decline to sponsor ${agent.name}?`,
							`${agent.name} is suspended and can do nothing. An owner can name a sponsor again.`,
							'Decline'
						);
						if (!sure) return;
						const answer = (await kernel.call('agent-member-decline', {
							agent: agent.id,
						})) as Answer;
						view.say(answer.success ? `You declined ${agent.name}.` : view.failed(answer));
						await view.read();
					})
				);
			}
			// The sponsor's withdrawal of an active installed one (8.2, #2781); a connected agent is disconnected in the
			// account section instead (5.3).
			if (agent.status === 'active' && agent.kind === 'installed' && agent.sponsor === view.me) {
				actions.push(
					button(`Withdraw ${agent.name}`, async () => {
						const sure = await confirmIn(
							root,
							`Withdraw ${agent.name}?`,
							`${agent.name} is suspended at once and can do nothing more in your name. It comes back only when an owner names a sponsor again and that sponsor confirms.`,
							'Withdraw'
						);
						if (!sure) return;
						const answer = (await kernel.call('agent-member-withdraw', {
							agent: agent.id,
						})) as Answer;
						view.say(answer.success ? `You withdrew ${agent.name}.` : view.failed(answer));
						await view.read();
					})
				);
			}
			if (owner) {
				actions.push(
					button(`Remove ${agent.name}`, async () => {
						const sure = await confirmIn(
							root,
							`Remove ${agent.name}?`,
							`${agent.name} can no longer act in the workspace. Undoing adds it again, waiting for its sponsor to confirm.`,
							'Remove agent'
						);
						if (!sure) return;
						const answer = (await kernel.call('agent-member-remove', {
							agent: agent.id,
						})) as Answer;
						view.say(answer.success ? `${agent.name} is removed.` : view.failed(answer));
						await view.read();
					})
				);
			}
			const warned = (agent.warnings ?? []).includes('SPONSOR_PROJECT_LOST');
			return el(
				'tr',
				{},
				el('th', { scope: 'row' }, agent.name),
				el('td', {}, `Agent · Sponsored by ${sponsorOf(agent)}`),
				el('td', {}, KINDS[agent.kind] ?? agent.kind),
				el(
					'td',
					{},
					statusText(agent),
					...(warned
						? [
								el(
									'p',
									{ class: 'note' },
									`${sponsorOf(agent)} can no longer open a project it names.`
								),
							]
						: [])
				),
				el('td', {}, projectsText(agent, names)),
				el('td', {}, el('div', { class: 'row' }, ...actions))
			);
		});
		nodes.push(
			el(
				'table',
				{},
				el('caption', {}, `Agents, not seats (${view.agents.length})`),
				el(
					'thead',
					{},
					el(
						'tr',
						{},
						...['Name', 'Sponsor', 'Kind', 'Status', 'Can act in', 'Actions'].map((text) =>
							el('th', { scope: 'col' }, text)
						)
					)
				),
				el('tbody', {}, ...rows)
			)
		);
	}
	if (owner) nodes.push(...addForm(view, projects));
	return nodes;
}

/** An owner's form to add an agent member (8.2): pending until its sponsor confirms, unless the owner is its sponsor. */
function addForm(view: AgentMembersView, projects: { id: string; name: string }[]): Node[] {
	const name = el('input', {
		id: 'agent-name',
		name: 'name',
		autocomplete: 'off',
		maxlength: '80',
		required: '',
	}) as HTMLInputElement;
	const sponsor = el('select', { id: 'agent-sponsor', required: '' }) as HTMLSelectElement;
	for (const person of view.people) {
		const option = el(
			'option',
			{ value: person.id },
			person.name || person.id
		) as HTMLOptionElement;
		option.selected = person.id === view.me;
		sponsor.append(option);
	}
	const workspace = el('input', { type: 'checkbox', id: 'agent-workspace' }) as HTMLInputElement;
	const boxes = projects.map((project) => {
		const box = el('input', {
			type: 'checkbox',
			id: `agent-project-${project.id}`,
			value: project.id,
		}) as HTMLInputElement;
		return { box, label: el('label', { class: 'check', for: box.id }, box, project.name) };
	});
	const form = el(
		'form',
		{ 'aria-label': 'Add an agent member' },
		el('label', { for: 'agent-name' }, 'Name', name),
		el('label', { for: 'agent-sponsor' }, 'Sponsor', sponsor),
		el(
			'fieldset',
			{},
			el('legend', {}, 'Where it can act'),
			el('label', { class: 'check', for: 'agent-workspace' }, workspace, 'The workspace'),
			...boxes.map((each) => each.label)
		),
		el('button', { type: 'submit', class: 'action primary' }, 'Add agent')
	);
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const answer = (await view.kernel.call('agent-member-add', {
			name: name.value.trim(),
			sponsor: sponsor.value,
			access: {
				workspace: workspace.checked,
				projects: boxes.filter((each) => each.box.checked).map((each) => each.box.value),
			},
		})) as Answer<AgentMemberRowV1>;
		const chosen = sponsor.selectedOptions[0]?.textContent ?? '';
		view.say(
			answer.success
				? answer.data?.status === 'pending'
					? `Added ${name.value.trim()}, waiting for ${chosen} to confirm.`
					: `Added ${name.value.trim()}.`
				: view.failed(answer)
		);
		if (answer.success) await view.read();
	});
	return [
		el('h2', {}, 'Add an agent member'),
		el(
			'p',
			{ class: 'note' },
			'An agent member has no account and cannot sign in. Its sponsor confirms it before it can act, and it never has more access than its sponsor.'
		),
		form,
	];
}
