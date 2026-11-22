/**
 * @fileoverview `createLoamAuthOptions` (phase 3 specification, 2.6, 7.1 and 7.5): Better Auth's options for
 * a `provider` deployment. Every Loam rule about the organization is written into the provider, since a
 * person can call its endpoints directly, around Loam's commands.
 *
 * Passkey registration runs with `requireSession: false`, for the join and recovery pages, with every check that
 * removes restored at the provider (5.8, step 4); invitations send a join link (5.6). The OAuth provider, its JWT
 * plugin and Client ID Metadata Documents are `oauth.ts`'s (9.4, step 7).
 */

import { passkey } from '@better-auth/passkey';
import type { IdentityMethodV1 } from '@lushly-dev/loam-manifest';
import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { organization } from 'better-auth/plugins/organization';
import { membershipOf } from './binding.js';
import { invitationMailer, JOIN_INVITATION_MS } from './enrolment.js';
import { createOrganizationHooks, type MemberRemovedV1 } from './hooks.js';
import {
	type LoamOAuthConfig,
	OAUTH_DISABLED_PATHS,
	oauthPlugins,
	refuseClientPolicy,
} from './oauth.js';
import { adapterOf, type LoamProviderState, loamServerPlugin } from './plugin.js';
import { passkeyRegistration } from './registration.js';
import { isOwnerRole, loamAccessControl, loamRoles } from './roles.js';
import {
	FRESH_AGE_SECONDS,
	methodOfPath,
	OIDC_CALLBACK,
	SESSION_METHOD_FIELD,
	SESSION_PROVIDER_FIELD,
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
	/** The mail sender, for invitations and recovery (5.6, 5.7). */
	mail: { send(message: LoamMailV1): Promise<void> };
	/**
	 * The shell's address, `<origin><site.base_path>`, the root of the join and recovery links (5.6, 5.7). Default:
	 * `baseURL` less its last two segments when it ends with `/api/auth`, the default `[identity] path`; else the origin.
	 */
	shell?: string;
	/** The single sign-on providers `methods` names as `oidc:<id>`, and no other. */
	oidc?: readonly LoamOidcProviderV1[];
	/**
	 * Tests only: a higher limit for a suite that legitimately makes many requests from one address. It raises the
	 * limit, Better Auth's default and its stricter sign-in and mail rules alike; nothing turns the limiter off.
	 */
	rateLimit?: { window: number; max: number };
	/** The authorization server's options (9.4): the MCP resource, the metadata documents' transport, registration. */
	oauth?: LoamOAuthConfig;
	/**
	 * The host's removal callback (phase 3's A4, phase 6's 3.7): run exactly once per removal of a member of the bound
	 * organization, by Better Auth's `afterRemoveMember` or Loam's own `leave` endpoint, after their sessions are revoked.
	 * The hosted server runs its kernel's `agent-member-settle` from it. A failure is logged and changes nothing else.
	 */
	onMemberRemoved?: (event: MemberRemovedV1) => Promise<void> | void;
}

/**
 * Better Auth 1.7.26 always adds `BETTER_AUTH_TRUSTED_ORIGINS` to the trusted origins, and reads it again on every
 * request (`context/helpers.mjs:83`, `auth/base.mjs:42`). The coordinator's decision of 2026-11-16 (the final check of
 * phase 6 step 3, IMPROVEMENT 1): building the options refuses while it is set, so a caller that skips `loam-host`'s
 * check is covered too; and `originHook` checks every request's `Origin` against the deployment's alone, so a value
 * set after start widens nothing.
 */
const TRUSTED_ORIGINS_VARIABLE = 'BETTER_AUTH_TRUSTED_ORIGINS';

/** Throws `HOST_ENV_OVERRIDE`, with its suggestion, while `BETTER_AUTH_TRUSTED_ORIGINS` is non-empty. */
function refuseTrustedOriginsEnvironment(): void {
	if ((process.env[TRUSTED_ORIGINS_VARIABLE] ?? '') === '') return;
	throw Object.assign(
		new Error(
			`\`${TRUSTED_ORIGINS_VARIABLE}\` is set: Better Auth would trust its origins over the deployment's.`
		),
		{
			code: 'HOST_ENV_OVERRIDE',
			suggestion: `Unset ${TRUSTED_ORIGINS_VARIABLE}: Loam takes its origins and secret only from the deployment and server configuration.`,
		}
	);
}

/**
 * A request's `Origin`, when it sends one, is the deployment's origin or the request is refused `403 INVALID_ORIGIN`,
 * whatever Better Auth's trusted origins hold at that moment. A request with no `Origin` (a navigation, a direct
 * `auth.api` call) is left to Better Auth's own checks.
 */
function originHook(origin: string) {
	return createAuthMiddleware(async (ctx) => {
		// No client turns PKCE off or skips consent, whichever route registers or changes it (9.4).
		refuseClientPolicy(ctx);
		const sent = ctx.request?.headers.get('origin');
		if (sent !== null && sent !== undefined && sent !== origin) {
			throw APIError.from('FORBIDDEN', {
				code: 'INVALID_ORIGIN',
				message: 'Invalid origin',
			});
		}
	});
}

/** Better Auth 1.7.26's default rate limit: 100 requests in 10 s per address and path. */
const DEFAULT_RATE_LIMIT = Object.freeze({ window: 10, max: 100 });
/** The most a test may raise `max` to (the final check's NIT 3): a limit, never one that reads as none. */
const MAX_RAISED_RATE_LIMIT = 1_000_000;

/** Better Auth's own stricter rules (1.7.26's `getDefaultSpecialRules`), which a test's higher limit raises too. */
const SPECIAL_RATE_LIMIT_PATHS = [
	'/sign-in/*',
	'/sign-up/*',
	'/change-password',
	'/change-email',
	'/request-password-reset',
	'/send-verification-email',
] as const;

/**
 * The provider's rate limit, on in every mode (the coordinator's decision of 2026-11-15, phase 3's 5.8): Better Auth
 * turns its limiter on only when `NODE_ENV` is `production`, and Loam's safety never rests on `NODE_ENV`. It keys
 * each request by A7's `x-loam-client-ip`.
 */
function rateLimitOf(
	raised: LoamAuthConfig['rateLimit']
): NonNullable<BetterAuthOptions['rateLimit']> {
	if (!raised) return { enabled: true };
	// Only a raise (N2): a finite `max` of at least Better Auth's default, over a window no longer than its default, so
	// no value lowers a rule or reads as unlimited.
	if (
		!Number.isInteger(raised.max) ||
		raised.max < DEFAULT_RATE_LIMIT.max ||
		raised.max > MAX_RAISED_RATE_LIMIT ||
		!Number.isInteger(raised.window) ||
		raised.window < 1 ||
		raised.window > DEFAULT_RATE_LIMIT.window
	)
		throw new Error(
			`A raised rate limit is a max of ${DEFAULT_RATE_LIMIT.max} to ${MAX_RAISED_RATE_LIMIT} over a window of 1 to ${DEFAULT_RATE_LIMIT.window} s`
		);
	const rule = { window: raised.window, max: raised.max };
	return {
		enabled: true,
		...rule,
		customRules: Object.fromEntries(SPECIAL_RATE_LIMIT_PATHS.map((path) => [path, rule])),
	};
}

/**
 * The header the hosted server sets from the socket's address before any route, after deleting any incoming
 * copy and `x-forwarded-for` (A7): the only one the provider reads a client's address from.
 */
export const CLIENT_ADDRESS_HEADER = 'x-loam-client-ip';

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
	// Both answer every member's email to any member, where 7.2 shows an email only to an owner: `member-list` reads
	// Loam's `/loam/members` (step 4's re-check of the organization routes).
	'/organization/list-members',
	'/organization/get-full-organization',
	// Sessions are Loam's own `/loam/sessions` and `/loam/revoke-person` (4.6), by handle and under 5.8's freshness
	// rule. Better Auth's own list answers every session's token, and its revocations skip D99's passkey rule (the
	// review of step 3's B2); a session's fields are the provider's alone, so none is updated from a page.
	'/list-sessions',
	'/revoke-session',
	'/revoke-sessions',
	'/revoke-other-sessions',
	'/update-session',
	// A linked provider's tokens never reach page script, and linking or unlinking a sign-in is step 4's, behind
	// 5.8's rule, if the account section ever offers it (5.1).
	'/get-access-token',
	'/refresh-token',
	'/account-info',
	'/list-accounts',
	'/link-social',
	'/unlink-account',
	// Passwords: no open sign-up (5.6), changing one is recovery's (5.7), and no page tests a guess against one.
	'/sign-up/email',
	'/change-password',
	'/verify-password',
	// Account deletion is a follow-up with its retention rule (Follow-ups).
	'/delete-user',
	'/delete-user/callback',
	// Better Auth's leave deletes the member without the organization hooks, so it neither revokes the leaver's
	// sessions nor runs Loam's last-owner check (7.5). Loam's own leave endpoint, with both, comes with
	// `member-leave` (phase 6's A4); until then a member leaves by being removed (the re-check of step 3's NEW-5).
	'/organization/leave',
	// A client is registered or changed only by the deployer, a metadata document or dynamic registration (9.4).
	...OAUTH_DISABLED_PATHS,
]);

export { FRESH_AGE_SECONDS };

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
	refuseTrustedOriginsEnvironment();
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
	const password = config.methods.includes('password');
	const oidc = config.oidc ?? [];
	const shell =
		config.shell ??
		(url.pathname.replace(/\/$/, '').endsWith('/api/auth')
			? `${url.origin}${url.pathname.replace(/\/$/, '').slice(0, -'api/auth'.length)}`
			: `${url.origin}/`);
	if (!shell.endsWith('/')) throw new Error("shell is the shell's address, ending with a slash");
	const state: LoamProviderState = {
		workspace: config.workspace,
		organization: config.organization,
		shell,
		mail: config.mail,
		password,
		oidc: oidc.map((provider) => provider.id),
		...(config.onMemberRemoved ? { onMemberRemoved: config.onMemberRemoved } : {}),
	};

	return {
		baseURL: url.origin,
		basePath: url.pathname.replace(/\/$/, ''),
		secret: config.secret,
		// The secret given, never one from the environment: Better Auth 1.7.26 takes `BETTER_AUTH_SECRETS` over `secret`
		// when no `secrets` are passed (B1 of step 3's review; the coordinator's decision of 2026-11-16). `loam-host`
		// also refuses to start while that variable is set.
		secrets: [{ version: 1, value: config.secret }],
		// Off, and `loam-host` refuses `BETTER_AUTH_TELEMETRY`, which Better Auth 1.7.26 ORs with this option.
		telemetry: { enabled: false },
		database: config.database,
		trustedOrigins: [url.origin],
		hooks: { before: originHook(url.origin) },
		session: { cookieCache: { enabled: false }, freshAge: FRESH_AGE_SECONDS },
		rateLimit: rateLimitOf(config.rateLimit),
		advanced: {
			useSecureCookies: true,
			// Better Auth skips its origin and CSRF checks when `NODE_ENV` is `test`; Loam's provider never does.
			disableOriginCheck: false,
			disableCSRFCheck: false,
			// A7 (phase 6 specification): the client's address only from the header the hosted server sets from
			// the socket, after deleting any incoming copy and `x-forwarded-for`, so no client picks its own
			// rate-limit bucket, and no two clients share one for want of an address.
			ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] },
		},
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
						const path = context?.path;
						const method = methodOfPath(path);
						// The single sign-on provider an `oidc` session came from, for 5.7's ceremony.
						const provider =
							method === 'oidc'
								? ((context?.params as { id?: string } | undefined)?.id ??
									path?.slice(OIDC_CALLBACK.length))
								: undefined;
						return {
							data: {
								...session,
								[SESSION_METHOD_FIELD]: method ?? null,
								[SESSION_PROVIDER_FIELD]: provider ?? null,
							},
						};
					},
				},
			},
			user: {
				create: {
					/**
					 * No open sign-up (5.6): a new user only from a configured OIDC sign-in with a verified email. The
					 * join path, which completes an invitation, writes its user in its own transaction (5.8), never here.
					 */
					async before(user, context) {
						const path = context?.path ?? '';
						// The core callback, the one path on which a user may be created in step 1 (5.6), names the
						// provider in its `id` parameter, or last in a resolved path.
						const provider = path.startsWith(OIDC_CALLBACK)
							? ((context?.params as { id?: string } | undefined)?.id ??
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
				invitationExpiresIn: JOIN_INVITATION_MS / 1_000,
				sendInvitationEmail: invitationMailer({
					shell,
					send: (message) => config.mail.send(message),
					context: () => state.context,
				}) as never,
				organizationHooks: createOrganizationHooks(state),
			}),
			passkey({
				rpID: url.hostname,
				rpName: config.organization,
				origin: url.origin,
				authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
				// `requireSession: false` for the join and recovery pages (5.8), with every check it drops restored: on
				// generation by `loamServerPlugin`'s hook and `resolveUser`, and at verification, from the session read
				// again from the store, before the passkey is stored.
				registration: passkeyRegistration({
					hold: (request, userId, at) => state.announcer?.hold(request, userId, at),
				}) as never,
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
			// The authorization server (9.4, step 7): the JWT plugin, `oauthProvider` and Client ID Metadata Documents.
			...oauthPlugins({
				shell,
				resource: config.oauth?.resource ?? `${shell}mcp`,
				config: config.oauth ?? {},
				isOwner: async (userId) => {
					const membership = await membershipOf(adapterOf(state), state.workspace, userId);
					return membership !== null && isOwnerRole(membership.role);
				},
			}),
			loamServerPlugin(state),
		],
	};
}
