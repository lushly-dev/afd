/**
 * Phase 3's captures (phase 3 specification, 14; P3-E11): the sign-in dialog and the account menu over the shell, and
 * the join, recovery, OAuth login and consent pages over a provider the fixture gives, each with no provider behind
 * it, so they show the page's own markup and words. Specimen renders each in the light, dark and high-contrast
 * contexts (D53); the web package's Chromium suite captures them. The account section, which reads the provider
 * through the kernel's ports, is captured under axe in the Chromium suite instead.
 */

import themeCss from '@lushly-dev/loam-theme/loam-theme.css?inline';
import type { SpecimenDefinition } from '@lushly-dev/specimen';
import {
	type LinkProviderV1,
	mountLinkPage,
	mountOAuthPage,
	type OAuthProviderV1,
} from '../dist/identity/account.js';
import { openAccountMenu } from '../dist/identity/account-menu.js';
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
