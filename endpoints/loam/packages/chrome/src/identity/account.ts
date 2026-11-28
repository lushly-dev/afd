/**
 * @fileoverview The `account` chunk (phase 3 specification, 5.1 to 5.4, 5.6, 5.7, 7.2 and 14), loaded when the account
 * section shows, when a person who is no member asks for their invitations, or on a join or recovery link:
 *
 * - `loam-account-section`, main's account section at `/<workspace>/~/account[/<tab>]`: a tablist of links over
 *   `profile`, `passkeys`, `sessions` and `members` (`passkeys` and `sessions` in `provider` mode only; the owner
 *   controls of `members` for an owner only, absent for anyone else), then a tab per app's `ui.account` section at
 *   `~/account/<instance>/<id>` (5.5, `account-apps.ts`). Every change is a command.
 * - `loam-account-invitations`, the invitations a signed-in person who is no member may accept (5.3).
 * - `mountLinkPage`, the join and recovery pages (5.6, 5.7): top-level pages over the provider alone, with no kernel.
 *
 * Text is always text: every element is built with its strings as text nodes and its attributes as values. A
 * destructive action is confirmed in a native modal dialog with its consequence in words, as the sign-in dialog is.
 */

import type {
	AccountV1,
	AgentMemberRowV1,
	LoamKernel,
	MemberInvitationV1,
	MemberV1,
	OwnInvitationV1,
} from '@lushly-dev/loam-kernel';
import type { LoamShell } from '../elements/shell.js';
import {
	type AppAccountTab,
	type AppTabHost,
	appTabs,
	type ShownAppTab,
	showAppTab,
} from './account-apps.js';
import {
	AccountElement,
	type Answer,
	askName,
	button,
	confirmIn,
	dateText,
	defineOnce,
	el,
	ROLE_NAMES,
} from './account-parts.js';
import { type AgentAccess, accessText, askAccess } from './agent-access.js';
import { agentMembersPart } from './agent-members.js';

export {
	type LinkPageOptions,
	type LinkProviderV1,
	LoamLinkPage,
	mountLinkPage,
} from './link-pages.js';
export {
	clientHostOf,
	LoamOAuthPage,
	mountOAuthPage,
	type OAuthPageOptions,
	type OAuthProviderV1,
	redirectOf,
	scopeWords,
} from './oauth-pages.js';

const TABS = ['profile', 'passkeys', 'sessions', 'members', 'agents'] as const;
type Tab = (typeof TABS)[number];
const TAB_NAMES: Record<Tab, string> = {
	profile: 'Profile',
	passkeys: 'Passkeys',
	sessions: 'Sessions',
	members: 'Members',
	agents: 'Agents',
};

/** `loam-account-section` (5.1): the person's account, at workspace level. */
export class LoamAccountSection extends AccountElement {
	kernel: LoamKernel | null = null;
	/** The deployment's root, for the tabs' addresses. */
	base = '';
	workspace = '';
	/** Whether the deployment is `provider` mode: sessions and passkeys exist, and owners have controls. */
	provider = false;
	/** What an app's section needs of the shell (5.5); none, and no app's tab shows. */
	host: AppTabHost | null = null;
	/** A built-in tab, or an app's section's `<instance>/<id>`. */
	tab: string = 'profile';
	#status: HTMLElement | undefined;
	#panel: HTMLElement | undefined;
	/** The built-in tabs' content; an app's surface goes beside it, so a view leaving after it stays in the page. */
	#content: HTMLElement | undefined;
	#reads = 0;
	#shows = 0;
	/** The tab last asked for, set before any await, so an event's re-read keeps a newer press. */
	#wanted = 'profile';
	#apps: AppAccountTab[] = [];
	#shown: ShownAppTab | undefined;
	#unsubscribe: (() => void) | undefined;
	#unwatch: (() => void) | undefined;

	connectedCallback(): void {
		const kernel = this.kernel;
		// A change of person drops the app's surface made for the one before, and reads every tab again; an app's own
		// settings reach its surface, as main's do (phase 3 specification, 4.4; phase 4 specification, 3.8).
		this.#unsubscribe ??= kernel?.subscribe((event) => {
			if (
				event.actorChanged ||
				/^(session|membership)-settle$/.test(event.command) ||
				// An experiment's change opens or closes a gate, which may name an app's section's surface (phase 4's 5.3).
				event.experiments ||
				(event.success && event.mutation && event.command.startsWith('auth-'))
			) {
				void this.drop();
				void this.show(this.#wanted);
			} else if (event.success && (event as { settings?: string[] }).settings?.length)
				this.#shown?.settingsChanged((event as { settings: string[] }).settings);
		});
		// Main's gate (signed out, no member, the wrong binding) is set after the shell's own read: show again on it.
		this.#unwatch ??= this.host?.watchGate(() => {
			void this.drop();
			void this.show(this.#wanted);
		});
		const root = this.shadowRoot as ShadowRoot;
		if (root.querySelector('.section')) return;
		const heading = el('h1', { tabindex: '-1', id: 'account-heading' }, 'Account');
		this.#status = el('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
		this.#content = el('div', { class: 'content' });
		this.#panel = el('div', { role: 'tabpanel', id: 'account-panel' }, this.#content);
		root.append(
			el(
				'section',
				{ class: 'section', 'aria-labelledby': 'account-heading' },
				heading,
				el('div', { role: 'tablist', 'aria-label': 'Account' }),
				this.#status,
				this.#panel
			)
		);
	}

	/** The tabs this deployment has: no passkeys or sessions in `local` mode (5.1). */
	get tabs(): readonly Tab[] {
		return this.provider ? TABS : TABS.filter((tab) => tab === 'profile' || tab === 'members');
	}

	focusHeading(): void {
		this.shadowRoot?.querySelector<HTMLElement>('h1')?.focus();
	}

	#say(text: string): void {
		if (this.#status) this.#status.textContent = text;
	}

	/** An answer's failure in words: its message and what to do, never a code alone. */
	#failed(answer: Answer): string {
		const { message, suggestion } = answer.error ?? {};
		return [message ?? 'That did not work', suggestion].filter(Boolean).join('. ');
	}

	/** Show `tab`, reading what it shows. */
	async show(tab: string): Promise<void> {
		const shows = ++this.#shows;
		this.#wanted = tab;
		// The apps' sections, read again each time: an app enabled, disabled or failed since changes the list (5.5).
		const apps = this.host?.open() && this.kernel ? await appTabs(this.kernel) : [];
		// A later show, or the section's leaving, took its place while the list was read.
		if (shows !== this.#shows) return;
		this.#apps = apps;
		const tabs: Array<{ key: string; id: string; name: string }> = [
			...this.tabs.map((each) => ({
				key: each as string,
				id: `tab-${each}`,
				name: TAB_NAMES[each],
			})),
			// Each names its app, so no app's tab passes for one of the shell's (5.5).
			...apps.map((each, index) => ({
				key: each.key,
				id: `tab-app-${index}`,
				name: `${each.section.title} (${each.app})`,
			})),
		];
		this.tab = tabs.some((each) => each.key === tab) ? tab : 'profile';
		const selected = tabs.find((each) => each.key === this.tab) as { id: string };
		const list = this.shadowRoot?.querySelector('[role="tablist"]');
		// A tab pressed keeps focus: the list is rebuilt, so the selected tab takes it again.
		const onTab = this.shadowRoot?.activeElement?.getAttribute('role') === 'tab';
		list?.replaceChildren(
			...tabs.map(({ key, id, name }) => {
				const link = el(
					'a',
					{
						role: 'tab',
						id,
						href: `${this.base}${this.workspace}/~/account${key === 'profile' ? '' : `/${key}`}`,
						'aria-selected': String(key === this.tab),
						'aria-controls': 'account-panel',
						...(key === this.tab ? { 'aria-current': 'page' } : {}),
					},
					name
				);
				link.addEventListener('click', (event) => {
					event.preventDefault();
					void this.kernel?.call('section-open', {
						section: 'account',
						...(key === 'profile' ? {} : { path: key }),
					});
				});
				return link;
			})
		);
		this.#panel?.setAttribute('aria-labelledby', selected.id);
		if (onTab) this.shadowRoot?.querySelector<HTMLElement>(`#${selected.id}`)?.focus();
		await this.read();
	}

	/** The app's section's surface stays while its tab shows; another tab, or the section's leaving, drops it. */
	drop(): Promise<void> {
		const was = this.#shown;
		this.#shown = undefined;
		return was?.dispose() ?? Promise.resolve();
	}

	/** Leave main: hidden at once, removed once an app's view has answered its teardown (6.2). */
	async leave(): Promise<void> {
		this.hidden = true;
		this.dataset.leaving = '';
		this.#stop();
		await this.drop();
		this.remove();
	}

	disconnectedCallback(): void {
		this.#stop();
		void this.drop();
	}

	/** Nothing read before this lands, and no event reaches the section again. */
	#stop(): void {
		this.#reads++;
		this.#shows++;
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		this.#unwatch?.();
		this.#unwatch = undefined;
	}

	/** Read the tab's records again and render them. */
	async read(): Promise<void> {
		const kernel = this.kernel;
		const panel = this.#panel;
		const content = this.#content;
		if (!kernel || !panel || !content) return;
		const generation = ++this.#reads;
		const app = this.#apps.find((each) => each.key === this.tab);
		if (app && this.host) {
			// A surface that showed stays; one that could not is tried again.
			if (this.#shown?.key === app.key && !this.#shown.failed) return;
			void this.drop();
			const shown = await showAppTab(
				app,
				this.host,
				() => generation !== this.#reads || !this.isConnected
			);
			if (generation !== this.#reads || this.#shown) {
				void shown.dispose();
				return;
			}
			this.#shown = shown;
			content.replaceChildren();
			panel.append(shown.node);
			return;
		}
		void this.drop();
		const rendered =
			this.tab === 'passkeys'
				? await this.#passkeys(kernel)
				: this.tab === 'sessions'
					? await this.#sessions(kernel)
					: this.tab === 'members'
						? await this.#members(kernel)
						: this.tab === 'agents'
							? await this.#agents(kernel)
							: await this.#profile(kernel);
		if (generation === this.#reads) content.replaceChildren(...rendered);
	}

	async #profile(kernel: LoamKernel): Promise<Node[]> {
		const read = (await kernel.call<AccountV1>('account-get')) as Answer<AccountV1>;
		if (!read.success || !read.data) return [el('p', {}, this.#failed(read))];
		const account = read.data;
		const nodes: Node[] = [];
		if (account.recoveredAt) {
			nodes.push(
				el(
					'p',
					{ role: 'note' },
					`Your access was restored on ${dateText(account.recoveredAt)}. If this wasn't you, contact an owner.`
				)
			);
		}
		const name = el('input', {
			id: 'profile-name',
			name: 'name',
			autocomplete: 'name',
			maxlength: '80',
			required: '',
		}) as HTMLInputElement;
		name.value = account.name;
		const form = el(
			'form',
			{ 'aria-label': 'Your name' },
			el('label', { for: 'profile-name' }, 'Name', name),
			el('button', { type: 'submit', class: 'action primary' }, 'Save name')
		);
		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			if (!this.provider) {
				this.#say('A local workspace has no account to rename.');
				return;
			}
			const saved = (await kernel.call('account-update', { name: name.value.trim() })) as Answer;
			this.#say(saved.success ? 'Your name is saved.' : this.#failed(saved));
		});
		nodes.push(form, el('p', {}, `Email: ${account.email || 'none'}`));
		if (account.organizations.length > 0) {
			nodes.push(
				el(
					'table',
					{},
					el('caption', {}, 'Your organizations'),
					el(
						'thead',
						{},
						el(
							'tr',
							{},
							el('th', { scope: 'col' }, 'Name'),
							el('th', { scope: 'col' }, 'Role'),
							el('th', { scope: 'col' }, 'This workspace')
						)
					),
					el(
						'tbody',
						{},
						...account.organizations.map((organization) =>
							el(
								'tr',
								{},
								el('th', { scope: 'row' }, organization.name),
								el('td', {}, ROLE_NAMES[organization.role] ?? organization.role),
								el('td', {}, organization.bound ? 'Bound to this workspace' : '')
							)
						)
					)
				)
			);
		}
		nodes.push(
			el(
				'p',
				{ class: 'note' },
				this.provider
					? 'Use your own browser profile on a shared computer.'
					: '`local` identity: anyone with this browser profile is its owner.'
			)
		);
		return nodes;
	}

	/** A command that needs a fresh passkey session (5.2): on `REAUTH_REQUIRED`, a passkey sign-in, then once again. */
	async #fresh(kernel: LoamKernel, name: string, input: unknown): Promise<Answer> {
		const first = (await kernel.call(name, input)) as Answer;
		if (first.error?.code !== 'REAUTH_REQUIRED') return first;
		this.#say('This needs a fresh sign-in with a passkey. Confirm with your passkey to continue.');
		const signed = (await kernel.call('auth-sign-in', { method: 'passkey' })) as Answer;
		if (!signed.success) return signed;
		return (await kernel.call(name, input)) as Answer;
	}

	async #passkeys(kernel: LoamKernel): Promise<Node[]> {
		const read = (await kernel.call<{
			passkeys: { id: string; name: string | null; createdAt: string; deviceType: string | null }[];
		}>('account-passkey-list')) as Answer<{
			passkeys: { id: string; name: string | null; createdAt: string; deviceType: string | null }[];
		}>;
		if (!read.success || !read.data) return [el('p', {}, this.#failed(read))];
		const rows = read.data.passkeys.map((passkey) => {
			const label = passkey.name ?? 'Passkey';
			const rename = button(`Rename ${label}`, async () => {
				const next = await askName(this.shadowRoot as ShadowRoot, `Rename ${label}`, label);
				if (!next) return;
				const answer = (await kernel.call('account-passkey-rename', {
					passkey: passkey.id,
					name: next.slice(0, 64),
				})) as Answer;
				this.#say(answer.success ? `Renamed ${label} to ${next}.` : this.#failed(answer));
				if (answer.success) await this.read();
			});
			const remove = button(`Remove ${label}`, async () => {
				const sure = await confirmIn(
					this.shadowRoot as ShadowRoot,
					`Remove ${label}?`,
					'You will no longer be able to sign in with it. This cannot be undone.',
					'Remove passkey'
				);
				if (!sure) return;
				const answer = await this.#fresh(kernel, 'account-passkey-remove', { passkey: passkey.id });
				this.#say(answer.success ? `Removed ${label}.` : this.#failed(answer));
				if (answer.success) await this.read();
			});
			return el(
				'tr',
				{},
				el('th', { scope: 'row' }, label),
				el('td', {}, dateText(passkey.createdAt)),
				el('td', {}, passkey.deviceType === 'multiDevice' ? 'Synced' : 'This device only'),
				el('td', {}, el('div', { class: 'row' }, rename, remove))
			);
		});
		const add = button(
			'Add a passkey',
			async () => {
				const answer = await this.#fresh(kernel, 'account-passkey-add', {});
				this.#say(answer.success ? 'Your passkey is added.' : this.#failed(answer));
				if (answer.success) await this.read();
			},
			{ class: 'action primary' }
		);
		return [
			el(
				'table',
				{},
				el('caption', {}, 'Your passkeys'),
				el(
					'thead',
					{},
					el(
						'tr',
						{},
						el('th', { scope: 'col' }, 'Name'),
						el('th', { scope: 'col' }, 'Added'),
						el('th', { scope: 'col' }, 'Kind'),
						el('th', { scope: 'col' }, 'Actions')
					)
				),
				el('tbody', {}, ...rows)
			),
			el('div', { class: 'row' }, add),
		];
	}

	async #sessions(kernel: LoamKernel): Promise<Node[]> {
		type Row = { id: string; current: boolean; device: string | null; createdAt: string };
		const read = (await kernel.call<{ sessions: Row[] }>('session-list')) as Answer<{
			sessions: Row[];
		}>;
		if (!read.success || !read.data) return [el('p', {}, this.#failed(read))];
		const rows = read.data.sessions.map((session) => {
			const device = session.device ?? 'Another device';
			const signOut = button(`Sign out ${session.current ? 'this device' : device}`, async () => {
				const sure = await confirmIn(
					this.shadowRoot as ShadowRoot,
					`Sign out ${session.current ? 'this device' : device}?`,
					session.current
						? 'You will be signed out here.'
						: 'That device is signed out at once; it shows "Sign in" when it next checks.',
					'Sign out'
				);
				if (!sure) return;
				const answer = await this.#fresh(kernel, 'session-revoke', { session: session.id });
				this.#say(answer.success ? `Signed out ${device}.` : this.#failed(answer));
				if (answer.success && !session.current) await this.read();
			});
			return el(
				'tr',
				{},
				el('th', { scope: 'row' }, device),
				el('td', {}, dateText(session.createdAt)),
				el('td', {}, session.current ? 'This device' : ''),
				el('td', {}, signOut)
			);
		});
		const others = button('Sign out everywhere else', async () => {
			const sure = await confirmIn(
				this.shadowRoot as ShadowRoot,
				'Sign out everywhere else?',
				'Every other device is signed out at once. This device stays signed in.',
				'Sign out others'
			);
			if (!sure) return;
			const answer = await this.#fresh(kernel, 'session-revoke', { session: 'others' });
			this.#say(answer.success ? 'Every other device is signed out.' : this.#failed(answer));
			if (answer.success) await this.read();
		});
		return [
			el(
				'table',
				{},
				el('caption', {}, 'Where you are signed in'),
				el(
					'thead',
					{},
					el(
						'tr',
						{},
						el('th', { scope: 'col' }, 'Device'),
						el('th', { scope: 'col' }, 'Signed in'),
						el('th', { scope: 'col' }, 'This device'),
						el('th', { scope: 'col' }, 'Actions')
					)
				),
				el('tbody', {}, ...rows)
			),
			el('div', { class: 'row' }, others),
		];
	}

	/**
	 * The agents tab (5.3): the external agents the person connected over MCP, each with where it may act, Change access
	 * (9.2, #2784) and Disconnect.
	 */
	async #agents(kernel: LoamKernel): Promise<Node[]> {
		type Row = {
			agent: string;
			name: string;
			clientHost: string;
			scopes: string[];
			connectedAt: string;
			access: AgentAccess;
			status: 'active' | 'suspended';
			suspended?: string;
		};
		// Archived projects too: one the person may still open stays theirs to keep in an agent's access.
		const [read, listed] = (await Promise.all([
			kernel.call<{ agents: Row[] }>('account-agent-list'),
			kernel.call('project-list', { status: 'all' }),
		])) as [Answer<{ agents: Row[] }>, Answer<{ projects: { id: string; name: string }[] }>];
		if (!read.success || !read.data) return [el('p', {}, this.#failed(read))];
		// With no project list, no access is offered for change: saving would leave out every project it names.
		const projects = listed.success ? (listed.data?.projects ?? []) : undefined;
		const names = new Map((projects ?? []).map((project) => [project.id, project.name]));
		const intro = el(
			'p',
			{},
			'Apps you connected over MCP act for you, within what you may do, and owners see each one. You choose where each can act. Disconnecting one ends its access within 10 minutes.'
		);
		if (read.data.agents.length === 0)
			return [intro, el('p', {}, 'You have not connected any app.')];
		const statusOf = (row: Row) =>
			row.status === 'active'
				? 'Connected'
				: row.suspended === 'owner'
					? 'Removed by an owner'
					: 'Disconnected';
		const rows = read.data.agents.map((row) => {
			// One an owner removed stays removed until an owner allows it again (9.2): nothing to disconnect.
			const removed = row.status === 'suspended' && row.suspended === 'owner';
			const label = `Change access for ${row.name}`;
			const change = button(
				label,
				async () => {
					if (!projects) return;
					const root = this.shadowRoot as ShadowRoot;
					const access = await askAccess(root, row.name, row.access, projects);
					if (!access) return;
					// What the dialog showed: a change made since, in another tab, is refused rather than overwritten.
					const answer = (await kernel.call('account-agent-update', {
						agent: row.agent,
						access,
						expected: row.access,
					})) as Answer<{ access: AgentAccess }>;
					// The read builds the row again: focus returns to its Change access, by the agent's id, not to the page (14).
					// A row with no such button now (an owner removed the agent, it was disconnected elsewhere, a read failed)
					// sends focus to the section's heading instead.
					const refocus = () => {
						const again = root.querySelector<HTMLButtonElement>(
							`button[data-agent="${CSS.escape(row.agent)}"]`
						);
						if (again) again.focus();
						else this.focusHeading();
					};
					// Changed elsewhere since this tab read it (another tab, an agent's person in another window): the tab reads
					// it again and says so, rather than leaving a row every retry is refused on (15).
					if (answer.error?.code === 'AGENT_ACCESS_CHANGED') {
						await this.read();
						this.#say(
							`${row.name}'s access changed elsewhere. It is shown as it is now; choose again.`
						);
						refocus();
						return;
					}
					// Any other refusal about the record itself is stale state too: read again, then say why.
					const stale =
						answer.error?.code === 'AGENT_MEMBER_NOT_FOUND' ||
						answer.error?.code === 'AGENT_DISCONNECTED_BY_OWNER' ||
						answer.error?.code === 'PROJECT_NOT_FOUND';
					if (answer.success || stale) await this.read();
					this.#say(
						answer.success && answer.data
							? `${row.name} can act in: ${accessText(answer.data.access, names)}.`
							: this.#failed(answer)
					);
					if (answer.success || stale) refocus();
				},
				{ 'data-agent': row.agent }
			);
			const disconnect = button(`Disconnect ${row.name}`, async () => {
				const sure = await confirmIn(
					this.shadowRoot as ShadowRoot,
					`Disconnect ${row.name}?`,
					'It can no longer act for you. Its last access token still works for up to 10 minutes.',
					'Disconnect'
				);
				if (!sure) return;
				const answer = (await kernel.call('account-agent-disconnect', {
					agent: row.agent,
				})) as Answer;
				this.#say(answer.success ? `${row.name} is disconnected.` : this.#failed(answer));
				if (answer.success) await this.read();
			});
			return el(
				'tr',
				{},
				el('th', { scope: 'row' }, `${row.name} (name given by the app)`),
				el('td', {}, row.clientHost || 'Registered by the deployer'),
				el('td', {}, row.scopes.includes('loam:write') ? 'Read and change' : 'Read'),
				el('td', {}, accessText(row.access, names)),
				el('td', {}, dateText(row.connectedAt)),
				el('td', {}, statusOf(row)),
				el(
					'td',
					{},
					...(removed
						? ['Ask an owner to allow it again']
						: [el('div', { class: 'row' }, ...(projects ? [change] : []), disconnect)])
				)
			);
		});
		return [
			intro,
			...(projects
				? []
				: [
						el(
							'p',
							{ role: 'note' },
							`Where your apps can act cannot be changed now. ${this.#failed(listed)}`
						),
					]),
			el(
				'table',
				{},
				el('caption', {}, 'Connected apps'),
				el(
					'thead',
					{},
					el(
						'tr',
						{},
						el('th', { scope: 'col' }, 'App'),
						el('th', { scope: 'col' }, 'From'),
						el('th', { scope: 'col' }, 'Access'),
						el('th', { scope: 'col' }, 'Can act in'),
						el('th', { scope: 'col' }, 'Connected'),
						el('th', { scope: 'col' }, 'Status'),
						el('th', { scope: 'col' }, 'Actions')
					)
				),
				el('tbody', {}, ...rows)
			),
		];
	}

	async #members(kernel: LoamKernel): Promise<Node[]> {
		const [read, me] = (await Promise.all([
			kernel.call('member-list'),
			kernel.call('account-get'),
		])) as [
			Answer<{
				people: MemberV1[];
				agents: AgentMemberRowV1[];
				total: number;
			}>,
			Answer<AccountV1>,
		];
		if (!read.success || !read.data) return [el('p', {}, this.#failed(read))];
		// Owner controls are absent, not disabled, for anyone else; in `local` mode too (5.1, 14).
		const owner = this.provider && me.data?.workspace.owner === true;
		const people = read.data.people;
		const rows = people.map((person) => {
			const cells: Node[] = [
				el('th', { scope: 'row' }, person.name || person.email || person.id),
				el('td', {}, ROLE_NAMES[person.role] ?? person.role),
			];
			if (owner) {
				cells.push(el('td', {}, person.email ?? ''));
				const role = el('select', { 'aria-label': `Role of ${person.name}` }) as HTMLSelectElement;
				for (const value of ['member', 'admin', 'owner']) {
					const option = el('option', { value }, ROLE_NAMES[value] as string) as HTMLOptionElement;
					option.selected = value === person.role;
					role.append(option);
				}
				role.addEventListener('change', async () => {
					const answer = (await kernel.call('member-role-set', {
						member: person.id,
						role: role.value,
					})) as Answer;
					this.#say(
						answer.success
							? `${person.name} is now ${ROLE_NAMES[role.value]}.`
							: this.#failed(answer)
					);
					await this.read();
				});
				const remove = button(`Remove ${person.name}`, async () => {
					const sure = await confirmIn(
						this.shadowRoot as ShadowRoot,
						`Remove ${person.name}?`,
						`${person.name} leaves the workspace and is signed out everywhere at once. To bring them back, invite them again.`,
						'Remove member'
					);
					if (!sure) return;
					const answer = (await kernel.call('member-remove', { member: person.id })) as Answer;
					this.#say(answer.success ? `${person.name} is removed.` : this.#failed(answer));
					await this.read();
				});
				cells.push(el('td', {}, el('div', { class: 'row' }, role, remove)));
			}
			return el('tr', {}, ...cells);
		});
		const head = ['Name', 'Role', ...(owner ? ['Email', 'Actions'] : [])];
		const nodes: Node[] = [
			el(
				'table',
				{},
				el('caption', {}, `People (${read.data.total})`),
				el('thead', {}, el('tr', {}, ...head.map((text) => el('th', { scope: 'col' }, text)))),
				el('tbody', {}, ...rows)
			),
		];
		// Agent members, apart from the people and never seats (7.2, 8.3).
		nodes.push(
			...(await agentMembersPart({
				kernel,
				root: this.shadowRoot as ShadowRoot,
				agents: read.data.agents,
				people,
				me: me.data?.id,
				owner,
				say: (text) => this.#say(text),
				failed: (answer) => this.#failed(answer),
				read: () => this.read(),
			}))
		);
		if (owner)
			nodes.push(...(await this.#invitations(kernel, me.data?.workspace.role === 'owner')));
		return nodes;
	}

	/** The owner's invite form and the pending invitations (7.2). */
	async #invitations(kernel: LoamKernel, ownerRole: boolean): Promise<Node[]> {
		const email = el('input', {
			id: 'invite-email',
			type: 'email',
			autocomplete: 'off',
			required: '',
		}) as HTMLInputElement;
		const role = el('select', { id: 'invite-role' }) as HTMLSelectElement;
		for (const value of ownerRole ? ['member', 'admin', 'owner'] : ['member', 'admin']) {
			role.append(el('option', { value }, ROLE_NAMES[value] as string));
		}
		const form = el(
			'form',
			{ 'aria-label': 'Invite a person' },
			el('label', { for: 'invite-email' }, 'Email', email),
			el('label', { for: 'invite-role' }, 'Role', role),
			el('button', { type: 'submit', class: 'action primary' }, 'Invite')
		);
		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			const answer = (await kernel.call('member-invite', {
				email: email.value.trim(),
				role: role.value,
			})) as Answer;
			this.#say(answer.success ? `Invited ${email.value.trim()}.` : this.#failed(answer));
			if (answer.success) await this.read();
		});
		const listed = (await kernel.call('member-invitation-list')) as Answer<{
			invitations: MemberInvitationV1[];
		}>;
		const pending = listed.data?.invitations ?? [];
		return [
			el('h2', {}, 'Invite a person'),
			form,
			el(
				'p',
				{ class: 'note' },
				'A person removed and invited again regains the restricted projects that still list them.'
			),
			el(
				'table',
				{},
				el('caption', {}, 'Pending invitations'),
				el(
					'tbody',
					{},
					...pending.map((invitation) =>
						el(
							'tr',
							{},
							el('th', { scope: 'row' }, invitation.email),
							el('td', {}, ROLE_NAMES[invitation.role] ?? invitation.role),
							el('td', {}, `Expires ${dateText(invitation.expiresAt)}`),
							el(
								'td',
								{},
								button(`Cancel invitation to ${invitation.email}`, async () => {
									const answer = (await kernel.call('member-invitation-cancel', {
										invitation: invitation.id,
									})) as Answer;
									this.#say(
										answer.success
											? `Cancelled the invitation to ${invitation.email}.`
											: this.#failed(answer)
									);
									await this.read();
								})
							)
						)
					)
				)
			),
		];
	}
}

const SECTION = 'loam-account-section';

/** `loam-account-invitations` (5.3): a signed-in person who is no member, and their invitations to accept. */
export class LoamAccountInvitations extends AccountElement {
	kernel: LoamKernel | null = null;
	/** After an invitation is accepted: the shell reads the session and membership again. */
	accepted: (() => void) | undefined;

	async read(): Promise<void> {
		const kernel = this.kernel;
		const root = this.shadowRoot as ShadowRoot;
		if (!kernel) return;
		const status = el('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
		const listed = (await kernel.call('account-invitation-list')) as Answer<{
			invitations: OwnInvitationV1[];
		}>;
		const invitations = listed.data?.invitations ?? [];
		const rows = invitations.map((invitation) =>
			el(
				'li',
				{},
				el(
					'p',
					{},
					`${invitation.organization.name}, as ${ROLE_NAMES[invitation.role] ?? invitation.role}. Expires ${dateText(invitation.expiresAt)}.`
				),
				el(
					'div',
					{ class: 'row' },
					button(
						`Accept the invitation to ${invitation.organization.name}`,
						async () => {
							const answer = (await kernel.call('account-invitation-accept', {
								invitation: invitation.id,
							})) as Answer;
							status.textContent = answer.success
								? `You joined ${invitation.organization.name}.`
								: [answer.error?.message, answer.error?.suggestion].filter(Boolean).join('. ');
							if (answer.success) this.accepted?.();
						},
						{ class: 'action primary' }
					),
					button(`Decline the invitation to ${invitation.organization.name}`, async () => {
						const answer = (await kernel.call('account-invitation-reject', {
							invitation: invitation.id,
						})) as Answer;
						status.textContent = answer.success ? 'Declined.' : (answer.error?.message ?? '');
						await this.read();
					})
				)
			)
		);
		root.replaceChildren(
			el(
				'section',
				{ class: 'section', 'aria-labelledby': 'invitations-heading' },
				el('h2', { id: 'invitations-heading' }, 'Your invitations'),
				invitations.length > 0 ? el('ul', {}, ...rows) : el('p', {}, 'You have no invitations.'),
				status
			)
		);
	}
}

const INVITATIONS = 'loam-account-invitations';

/** Both elements, defined once. */
function define(): void {
	defineOnce(SECTION, LoamAccountSection);
	defineOnce(INVITATIONS, LoamAccountInvitations);
}

/** Follow the state: show, update or remove the account section in main (5.1). */
export async function syncAccount(shell: LoamShell): Promise<void> {
	const kernel = shell.kernel as LoamKernel;
	const main = shell.shadowRoot?.querySelector<HTMLElement>('loam-main');
	if (!kernel || !main) return;
	const state = await shell.readState();
	const held = main.querySelector<LoamAccountSection>(`${SECTION}:not([data-leaving])`);
	if (state.section !== 'account' || state.active !== null) {
		if (!held) return;
		void held.leave();
		if (main.dataset.section === 'account') delete main.dataset.section;
		return;
	}
	define();
	let section = held;
	const entering = !section;
	if (!section) {
		section = shell.ownerDocument.createElement(SECTION) as LoamAccountSection;
		section.kernel = kernel;
		section.base = shell.base;
		section.workspace = state.workspace.id;
		section.provider = shell.identity !== null;
		section.host = {
			kernel,
			workspace: state.workspace.id,
			// A reload straight into an app's tab can come before the shell has loaded the app surfaces: wait for them,
			// as long as main waits for its owner (15 s), rather than show the tab unavailable.
			surfaces: async (stale) => {
				for (let tries = 0; !shell.apps && shell.appCount > 0 && tries < 150 && !stale(); tries++)
					await new Promise((resolve) => setTimeout(resolve, 100));
				return shell.apps?.host() ?? null;
			},
			theme: () => (shell.appearance.resolved === 'dark' ? 'dark' : 'light'),
			open: () => shell.gate === '',
			// Main carries the shell's gate as its attribute: watched there, with nothing of FAST's in this chunk.
			watchGate: (listener) => {
				const observer = new MutationObserver(listener);
				observer.observe(main, { attributes: true, attributeFilter: ['gate'] });
				return () => observer.disconnect();
			},
		};
		main.dataset.section = 'account';
		main.append(section);
	}
	await section.show(state.path);
	// Focus goes to the heading as the section opens, never as a tab changes, where it stays on the tab (14).
	if (entering) section.focusHeading();
}

/** Show the person's invitations under main's "not a member" notice (5.3, E7). */
export async function showInvitations(shell: LoamShell, accepted: () => void): Promise<void> {
	const main = shell.shadowRoot?.querySelector<HTMLElement>('loam-main');
	if (!main || !shell.kernel) return;
	define();
	let panel = main.querySelector<LoamAccountInvitations>(INVITATIONS);
	if (!panel) {
		panel = shell.ownerDocument.createElement(INVITATIONS) as LoamAccountInvitations;
		main.append(panel);
	}
	panel.kernel = shell.kernel as LoamKernel;
	panel.accepted = () => {
		panel?.remove();
		accepted();
	};
	void panel.read();
}
