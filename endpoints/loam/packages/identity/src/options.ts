/**
 * @fileoverview `createLoamAuthOptions` (phase 3 specification, 2.6, 7.1 and 7.5): Better Auth's options for
 * a `provider` deployment. Every Loam rule about the organization is written into the provider, since a
 * person can call its endpoints directly, around Loam's commands.
 *
 * Seams left for later steps, each named where it lands: passkey registration with `requireSession: false`
 * and the hooks that restore its checks (5.8, step 3); invitation mail, the join and recovery paths, and
 * `bootstrapOrganization` (5.6 and 5.7, step 4); the OAuth provider, its JWT plugin and Client ID Metadata
 * Documents (9.4, step 7).
 */

import { passkey } from '@better-auth/passkey';
import type { IdentityMethodV1 } from '@lushly-dev/loam-manifest';
import type { BetterAuthOptions } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { organization } from 'better-auth/plugins/organization';
import { createOrganizationHooks } from './hooks.js';
import { type LoamProviderState, loamServerPlugin } from './plugin.js';
import { loamAccessControl, loamRoles } from './roles.js';
import {
	FRESH_AGE_SECONDS,
	methodOfPath,
	requireFreshPasskeySession,
	SESSION_METHOD_FIELD,
} from './sessions.js';

/** A message the provider sends: invitations and recovery, from step 4 (5.6, 5.7). */
export interface LoamMailV1 {
	to: string;
	subject: string;
	text: string;
}

/** A deployer's single sign-on provider, `oidc:<id>` in `methods` (2.6). */
export interface LoamOidcProviderV1 {
	id: string;
	clientId: string;
	clientSecret: string;
	discoveryUrl: string;
}

export interface LoamAuthConfig {
	/**
	 * The deployment's exact origin and the provider's path: `<origin><site.base_path><identity.path>`, such
	 * as `https://acme.example/loam/api/auth`.
	 */
	baseURL: string;
	/** At least 32 characters: the hosted lane's, never the deployment file's (D63). */
	secret: string;
	database: BetterAuthOptions['database'];
	/** The workspace's id, whose binding the provider keeps (2.3). */
	workspace: string;
	/** `[identity] organization`: the bound organization's slug at first binding (2.2, 2.3). */
	organization: string;
	/** `[identity] methods` (D99). */
	methods: readonly IdentityMethodV1[];
	/** The mail sender, for invitations and recovery (5.6, 5.7; step 4). */
	mail: { send(message: LoamMailV1): Promise<void> };
	/** The single sign-on providers `methods` names as `oidc:<id>`, and no other. */
	oidc?: readonly LoamOidcProviderV1[];
}

/** Better Auth's routes no Loam deployment serves (5.7, 9.4): resets and email change are recovery's. */
export const LOAM_DISABLED_PATHS: readonly string[] = Object.freeze([
	'/token',
	'/request-password-reset',
	'/reset-password',
	'/reset-password/:token',
	'/forget-password/email-otp',
	'/change-email',
	// The session's active organization is never an input (2.3): Loam never reads or sets it. Better Auth sets
	// it on accepting an invitation, so the role endpoints' hook resolves it as Better Auth does.
	'/organization/set-active',
]);

export { FRESH_AGE_SECONDS };

/** The genericOAuth callback, the one path on which a user may be created in step 1 (5.6). */
const OIDC_CALLBACK = '/oauth2/callback/';

/**
 * Better Auth's options for a deployment (2.6):
 *
 * - cookies and sessions: the cookie cache off, `freshAge` 300 s, secure cookies, no `bearer` plugin;
 * - origins: `baseURL` and `trustedOrigins` the deployment's exact origin; the passkey `rpID` its exact
 *   host and `origin` the same origin, with resident keys and user verification required;
 * - Better Auth's reset, email-change and JWT `/token` routes disabled, and `user.changeEmail` off;
 * - no open sign-up: `emailAndPassword` only with `password` in `methods`, `disableSignUp`, verified email
 *   required, and a user created only by a configured OIDC sign-in with a verified email (the join path is
 *   step 4's);
 * - the organization plugin with Loam's roles, no organization created or deleted by any user, verified
 *   email to accept an invitation, and the hooks of 7.5.
 *
 * @throws Error when the secret is short, the URL is not an origin and path, or `methods` names an OIDC
 *   provider `oidc` does not configure, or the reverse
 */
export function createLoamAuthOptions(config: LoamAuthConfig): BetterAuthOptions {
	if (config.secret.length < 32)
		throw new Error('The provider secret needs at least 32 characters');
	const url = new URL(config.baseURL);
	if (url.search || url.hash || url.username)
		throw new Error('baseURL is an origin and a path, no more');
	const configured = (config.oidc ?? []).map((provider) => provider.id).sort();
	const named = config.methods.flatMap((method) =>
		method.startsWith('oidc:') ? [method.slice(5)] : []
	);
	if (JSON.stringify(configured) !== JSON.stringify([...named].sort())) {
		throw new Error(
			'Each `oidc:<id>` method needs its provider in `oidc`, and each provider its method'
		);
	}
	const state: LoamProviderState = {
		workspace: config.workspace,
		organization: config.organization,
	};
	const password = config.methods.includes('password');
	const oidc = config.oidc ?? [];

	return {
		baseURL: url.origin,
		basePath: url.pathname.replace(/\/$/, ''),
		secret: config.secret,
		database: config.database,
		trustedOrigins: [url.origin],
		session: { cookieCache: { enabled: false }, freshAge: FRESH_AGE_SECONDS },
		advanced: { useSecureCookies: true },
		disabledPaths: [...LOAM_DISABLED_PATHS],
		user: { changeEmail: { enabled: false } },
		emailAndPassword: password
			? { enabled: true, disableSignUp: true, requireEmailVerification: true }
			: { enabled: false },
		account: {
			accountLinking: {
				// Only to a deployer's OIDC provider whose ID token says the email is verified, never another email.
				enabled: oidc.length > 0,
				trustedProviders: [],
				allowDifferentEmails: false,
			},
		},
		databaseHooks: {
			session: {
				create: {
					/**
					 * How the session was made (2.6, D99): by a passkey, a password or single sign-on, which 5.2's
					 * freshness rule reads. A session made any other way is marked by none, so it is never a passkey's.
					 */
					async before(session, context) {
						const method = methodOfPath(context?.path);
						return { data: { ...session, [SESSION_METHOD_FIELD]: method ?? null } };
					},
				},
			},
			user: {
				create: {
					/**
					 * No open sign-up (5.6): a new user only from a configured OIDC sign-in with a verified email.
					 * Step 4 adds the join path, which completes an invitation.
					 */
					async before(user, context) {
						// The route's template names the provider in its parameters; a resolved path names it last.
						const path = context?.path ?? '';
						const provider = path.startsWith(OIDC_CALLBACK)
							? ((context?.params as { providerId?: string } | undefined)?.providerId ??
								path.slice(OIDC_CALLBACK.length))
							: undefined;
						const fromOidc = oidc.some(({ id }) => id === provider);
						// Better Auth's own refusal: the user is not created, and its caller answers so.
						return fromOidc && user.emailVerified === true;
					},
				},
			},
		},
		plugins: [
			organization({
				ac: loamAccessControl,
				roles: loamRoles,
				allowUserToCreateOrganization: false,
				disableOrganizationDeletion: true,
				requireEmailVerificationOnInvitation: true,
				organizationHooks: createOrganizationHooks(state),
			}),
			passkey({
				rpID: url.hostname,
				rpName: config.organization,
				origin: url.origin,
				authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
				// The plugin's own session and freshness checks stay until step 4 sets `requireSession: false` for the
				// join and recovery paths (5.8); D99's passkey rule is added on generation (`loamServerPlugin`'s hook)
				// and here again, at verification, from the session the plugin read, before the passkey is stored.
				registration: {
					async afterVerification({ ctx }) {
						const found = (
							ctx.context as { session?: Parameters<typeof requireFreshPasskeySession>[1] }
						).session;
						if (found) await requireFreshPasskeySession(ctx.context, found);
						return {};
					},
				},
			}),
			...(oidc.length > 0
				? [
						genericOAuth({
							config: oidc.map((provider) => ({
								providerId: provider.id,
								clientId: provider.clientId,
								clientSecret: provider.clientSecret,
								discoveryUrl: provider.discoveryUrl,
								scopes: ['openid', 'email', 'profile'],
								pkce: true,
								requireIdTokenVerification: true,
							})),
						}),
					]
				: []),
			loamServerPlugin(state),
		],
	};
}
