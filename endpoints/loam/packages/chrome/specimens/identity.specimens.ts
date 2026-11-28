/**
 * Phase 3's captures (phase 3 specification, 14; P3-E11): the sign-in dialog and the account menu over the shell; the
 * join, recovery, OAuth login and consent pages over a provider the fixture gives; and the account section's every tab
 * over a kernel that answers its reads. None has a real provider behind it, so each shows the page's own markup and
 * words. Specimen renders each in the light, dark and high-contrast contexts (D53); the web package's Chromium suite
 * captures them.
 */

import type {
	AccountV1,
	AgentMemberRowV1,
	MemberInvitationV1,
	MemberV1,
	OwnInvitationV1,
} from '@lushly-dev/loam-kernel';
import themeCss from '@lushly-dev/loam-theme/loam-theme.css?inline';
import type { SpecimenDefinition } from '@lushly-dev/specimen';
import {
	type LinkProviderV1,
	LoamAccountSection,
	mountLinkPage,
	mountOAuthPage,
	type OAuthProviderV1,
} from '../dist/identity/account.js';
import { openAccountMenu } from '../dist/identity/account-menu.js';
import { defineOnce } from '../dist/identity/account-parts.js';
import { openSignIn } from '../dist/identity/sign-in.js';
import { mediaKernel, shellFixture, themePart, until } from './support.js';

const ok = <T>(data?: T) => Promise.resolve({ success: true, ...(data ? { data } : {}) });
/** A fixed expiry far ahead, so the link's expiry reads in words, the same in every render. */
const expiresAt = '2099-01-01T14:30:00.000Z';

/** The sign-in dialog, open over the shell, for a deployment with a passkey, a password and single sign-on. */
export const IdentitySignIn = {
	render: () =>
		shellFixture(
			async () => ({ kernel: (await mediaKernel()).kernel }),
			async (shell) => {
				// The deployment's identity, as a `provider` shell holds it: the organization's name and every method.
				Object.assign(shell, {
					identity: {
						...shell.identity,
						organization: 'Acme',
						methods: ['passkey', 'password', 'oidc:corp'],
						recover: async () => {},
						recoverWith: async () => {},
					},
				});
				const dialog = await openSignIn(shell);
				await until(() => dialog.dialog?.open === true);
			}
		),
} satisfies SpecimenDefinition;

/** The account menu, open under the title bar, for a signed-in person. */
export const IdentityAccountMenu = {
	render: () =>
		shellFixture(
			async () => {
				const { kernel } = await mediaKernel();
				await kernel.call('auth-sign-in', {
					method: 'credentials',
					email: 'bea@example.com',
					password: 'x',
				});
				return { kernel };
			},
			async (shell) => {
				await openAccountMenu(shell);
				await until(() =>
					Boolean(
						shell.shadowRoot
							?.querySelector('loam-titlebar')
							?.shadowRoot?.querySelector('loam-account-menu')
					)
				);
			}
		),
} satisfies SpecimenDefinition;

const linkProvider: LinkProviderV1 = {
	checkJoin: () =>
		ok({
			organization: { name: 'Acme' },
			role: 'member',
			email: 'newcomer@example.com',
			expiresAt,
			password: false,
		}),
	checkRecover: () => ok({ expiresAt, password: false }),
	completeOidc: () => ok(),
	registerPasskey: () => ok(),
	setName: () => ok(),
	setPassword: () => ok(),
	signOut: () => Promise.resolve(),
};

const oauthProvider: OAuthProviderV1 = {
	client: (clientId) => ok({ client_id: clientId, client_name: 'Claude Code' }),
	whoami: () => Promise.resolve({ signedIn: true, organization: 'Acme' }),
	signInWithPasskey: () => ok(),
	signInWithPassword: () => ok(),
	signInWithProvider: () => ok(),
	consent: () => ok({ url: 'http://127.0.0.1:9/callback' }),
	authorizeUrl: '/api/auth/oauth2/authorize',
};
/** The login page's provider: no one signed in yet, so the page asks for a sign-in. */
const signedOutProvider: OAuthProviderV1 = {
	...oauthProvider,
	whoami: () => Promise.resolve({ signedIn: false, organization: 'Acme' }),
};

/** A page that mounts itself over the document, in a box, once Loam's theme is applied. */
function page(mount: (target: HTMLElement) => Promise<void>, ready: string): SpecimenDefinition {
	return {
		render: () => {
			const element = document.createElement('div');
			element.dataset.fixture = 'identity-page';
			element.style.setProperty('display', 'grid');
			element.style.setProperty('inline-size', '720px');
			return {
				element,
				ready: (async () => {
					await themePart();
					await mount(element);
					await until(() => {
						const host = element.firstElementChild;
						return (host?.shadowRoot?.textContent ?? '').includes(ready);
					});
				})(),
			};
		},
	};
}

/** The join page (5.6): who invited, the expiry in words, one primary action. */
export const IdentityJoin = page(
	(target) =>
		mountLinkPage(target, {
			themeCss,
			base: '/',
			query: new URLSearchParams({ invitation: 'inv_fixture', token: 'fixture-token' }),
			kind: 'join',
			provider: linkProvider,
		}),
	'Join Acme'
);

/** The recovery page (5.7). */
export const IdentityRecover = page(
	(target) =>
		mountLinkPage(target, {
			themeCss,
			base: '/',
			query: new URLSearchParams({ token: 'fixture-token' }),
			kind: 'recover',
			provider: linkProvider,
		}),
	'Restore your access'
);

const authorization = new URLSearchParams({
	response_type: 'code',
	client_id: 'https://tools.example.org/oauth/client.json',
	redirect_uri: 'http://127.0.0.1:9/callback',
	scope: 'loam:read loam:write',
	state: 'fixture',
});

/** The OAuth login page (9.4): passkey first, the deployer's single sign-on, then a password. */
export const IdentityOAuthLogin = page(
	(target) =>
		mountOAuthPage(target, {
			themeCss,
			base: '/',
			query: authorization,
			kind: 'login',
			provider: signedOutProvider,
			methods: ['passkey', 'oidc:corp', 'password'],
			navigate: () => {},
		}),
	'Sign in with a passkey'
);

/** The OAuth consent page (9.4): the client id's host in bold, the scopes in words, the warnings as text. */
export const IdentityOAuthConsent = page(
	(target) =>
		mountOAuthPage(target, {
			themeCss,
			base: '/',
			query: authorization,
			kind: 'consent',
			provider: oauthProvider,
			methods: ['passkey'],
			navigate: () => {},
		}),
	'Connect Claude Code to Acme?'
);

/**
 * The account section's reads, answered as an owner's (5.1 to 5.4, 7.2, 8.2): what the kernel would answer, each held
 * to the kernel's own result type where its root exports one, so a change to a result fails the type check here.
 */
const ACCOUNT_ANSWERS: Record<string, unknown> = {
	'account-get': {
		id: 'usr_bea',
		email: 'bea@example.com',
		name: 'Bea Ortiz',
		image: null,
		organizations: [{ id: 'org-acme', slug: 'acme', name: 'Acme', role: 'owner', bound: true }],
		workspace: { member: true, role: 'owner', owner: true },
		persona: 'default',
		methods: ['passkey', 'password'],
		recovery: 'email',
		recoveredAt: null,
	} satisfies AccountV1,
	'account-passkey-list': {
		passkeys: [
			{
				id: 'pk_laptop',
				name: 'Laptop',
				createdAt: '2026-11-01T10:00:00.000Z',
				deviceType: 'multiDevice',
			},
			{
				id: 'pk_key',
				name: null,
				createdAt: '2026-11-02T10:00:00.000Z',
				deviceType: 'singleDevice',
			},
		],
	},
	'session-list': {
		sessions: [
			{
				id: '0123456789abcdef',
				current: true,
				device: 'Chrome on macOS',
				createdAt: '2026-11-21T09:00:00.000Z',
				updatedAt: '2026-11-21T09:30:00.000Z',
				expiresAt: '2026-11-28T09:00:00.000Z',
			},
			{
				id: 'fedcba9876543210',
				current: false,
				device: 'Safari on iOS',
				createdAt: '2026-11-20T09:00:00.000Z',
				updatedAt: '2026-11-20T09:30:00.000Z',
				expiresAt: '2026-11-27T09:00:00.000Z',
			},
		],
	},
	'account-agent-list': {
		agents: [
			{
				agent: 'agt_aaaaaaaaaaaaaaaaaaaa',
				name: 'Claude Code',
				clientHost: '',
				scopes: ['loam:read', 'loam:write'],
				connectedAt: '2026-11-21T09:00:00.000Z',
				access: { workspace: true, projects: 'sponsor' },
				status: 'active',
			},
		],
	},
	'member-list': {
		people: [
			{ id: 'usr_bea', name: 'Bea Ortiz', image: null, role: 'owner', email: 'bea@example.com' },
			{ id: 'usr_cy', name: 'Cy Park', image: null, role: 'member', email: 'cy@example.com' },
		] satisfies MemberV1[],
		agents: [
			{
				id: 'agt_bbbbbbbbbbbbbbbbbbbb',
				kind: 'installed',
				name: 'Reviewer',
				sponsor: 'usr_cy',
				sponsorName: 'Cy Park',
				installedBy: 'usr_bea',
				access: { workspace: true, projects: 'sponsor' },
				hiddenProjects: 0,
				status: 'pending',
				createdAt: 1,
				updatedAt: 1,
				updatedBy: 'usr_bea',
			},
		] satisfies AgentMemberRowV1[],
		total: 2,
	},
	'persona-list': {
		personas: [
			{ id: 'default', title: 'Default', presentation: {} },
			{
				id: 'per_reviewer00000000',
				title: 'Reviewer',
				presentation: { name: 'Bea O.', pronouns: 'she/her' },
			},
		],
		active: 'per_reviewer00000000',
	},
	'member-invitation-list': { invitations: [] satisfies MemberInvitationV1[] },
	'account-invitation-list': { invitations: [] satisfies OwnInvitationV1[] },
	'project-list': { projects: [] },
};

/** A kernel that answers the section's reads from `ACCOUNT_ANSWERS`, and refuses anything else. */
const accountKernel = {
	call: (name: string) =>
		Promise.resolve(
			name in ACCOUNT_ANSWERS
				? { success: true, data: ACCOUNT_ANSWERS[name] }
				: { success: false, error: { code: 'COMMAND_NOT_FOUND', message: `No ${name} here` } }
		),
	subscribe: () => () => {},
};

/** The account section at one tab, over `accountKernel`, as an owner in `provider` mode. */
function accountTab(
	tab: 'profile' | 'passkeys' | 'sessions' | 'personas' | 'members' | 'agents',
	ready: string
) {
	return page(async (target) => {
		defineOnce('loam-account-section', LoamAccountSection);
		const section = document.createElement('loam-account-section') as LoamAccountSection;
		Object.assign(section, {
			kernel: accountKernel,
			provider: true,
			base: '/',
			workspace: 'personal',
		});
		target.replaceChildren(section);
		await section.show(tab);
	}, ready);
}

/** The account section's profile (5.4). */
export const IdentityAccountProfile = accountTab('profile', 'Save name');
/** Its passkeys (5.2). */
export const IdentityAccountPasskeys = accountTab('passkeys', 'Laptop');
/** Its sessions (4.6). */
export const IdentityAccountSessions = accountTab('sessions', 'Safari on iOS');
/** Its personas, `default` first and one in use (6.1, 6.3). */
export const IdentityAccountPersonas = accountTab('personas', 'Make persona');
/** Its members, with an agent member and its sponsor (7.2, 8.2), as an owner sees them. */
export const IdentityAccountMembers = accountTab('members', 'Reviewer');
/** Its connected agents (5.3). */
export const IdentityAccountAgents = accountTab('agents', 'Claude Code');
