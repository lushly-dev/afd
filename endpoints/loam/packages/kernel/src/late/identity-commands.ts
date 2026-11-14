/**
 * @fileoverview Step 3's identity commands (phase 3 specification, 3.4, 4.6 and 5.2), in the `late-identity`
 * chunk with `session-settle`: `session-list`, `session-revoke` and the passkey commands, each a human command
 * whose whole effect is at the provider, so a replay answers it from its entry; the sign-in method check on
 * `auth-sign-in`; `HUMAN_REQUIRED` on the agent interface; and what a signed-out `provider` page answers of
 * `palette-search`. Everything reaches this chunk through the kit: an import of a first-paint module would part
 * first paint's shared modules into a chunk of their own (13).
 */

import type { AuthAdapter, MockAuthAdapter, PasskeyRow, SessionRow } from '@lushly-dev/afd-auth';
import { withMockCapabilities } from '@lushly-dev/afd-auth/mock-capabilities';
import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import type { LoamKernelErrorCode } from '../errors.js';
import type { DocumentKit } from './document-kit.js';
import {
	type LoamAuthAdapter,
	MEMBER_PROVIDER_COMMANDS,
	OWNER_COMMANDS,
} from './member-commands.js';

/**
 * Human commands (3.4's second and third rows): an agent never changes or lists a person's credentials,
 * sessions, personas or invitations, so the agent interface is refused `HUMAN_REQUIRED`, and none is served over
 * MCP. Frozen here, with the names later steps build, so a step that adds one adds no exemption by mistake.
 */
export const HUMAN_COMMANDS: readonly string[] = Object.freeze([
	'account-update',
	'account-passkey-list',
	'account-passkey-add',
	'account-passkey-rename',
	'account-passkey-remove',
	'account-invitation-list',
	'account-invitation-accept',
	'account-invitation-reject',
	'account-agent-list',
	'account-agent-disconnect',
	'session-list',
	'session-revoke',
	'persona-create',
	'persona-update',
	'persona-remove',
	'persona-set',
	'member-leave',
	'agent-member-confirm',
	'agent-member-decline',
]);

/**
 * The step 3 commands whose whole effect is at the provider (3.4): recorded, so a replay answers each from its
 * entry and never reaches a provider, and one with no entry stops as `REPLAY_NOT_RECORDED`.
 */
export const PROVIDER_COMMANDS: readonly string[] = Object.freeze([
	'session-list',
	'session-revoke',
	'account-passkey-list',
	'account-passkey-add',
	'account-passkey-rename',
	'account-passkey-remove',
	// Step 4's account and member commands (3.4).
	...MEMBER_PROVIDER_COMMANDS,
]);

/** `SessionRowV1` (4.6): a session by its handle, never its token, dates as ISO strings. */
export interface SessionRowV1 {
	id: string;
	current: boolean;
	device: string | null;
	createdAt: string;
	updatedAt: string;
	expiresAt: string | null;
}

/** `PasskeyRowV1` (5.2). */
export interface PasskeyRowV1 {
	id: string;
	name: string | null;
	createdAt: string;
	deviceType: 'singleDevice' | 'multiDevice' | null;
	backedUp: boolean | null;
}

/** What `session-revoke` answers (4.6). */
export interface SessionRevokeResultV1 {
	revoked: number;
	signedOut: boolean;
	disconnected: number;
}

export interface IdentityCommandsDeps {
	auth: AuthAdapter;
	identity?: IdentityV1 | undefined;
	kit: Pick<DocumentKit, 'define' | 'success' | 'z' | 'kernelFailure'>;
}

/** The codes a provider or an adapter answers that the kernel keeps as its own (15). */
const KEPT: ReadonlySet<string> = new Set([
	'REAUTH_REQUIRED',
	'SESSION_NOT_FOUND',
	'PASSKEY_NOT_FOUND',
	'PASSKEY_CANCELLED',
	'PASSKEY_UNSUPPORTED',
]);

const SUGGESTIONS: Readonly<Record<string, string>> = {
	REAUTH_REQUIRED:
		'Sign in with a passkey again, then retry within five minutes: this needs a fresh session made by a passkey',
	SESSION_NOT_FOUND: 'List your sessions with session-list and name one of them',
	PASSKEY_NOT_FOUND: 'List your passkeys with account-passkey-list and name one of them',
	PASSKEY_CANCELLED: 'Try again, and complete the passkey prompt',
	PASSKEY_UNSUPPORTED: 'Use a browser and device that support passkeys',
};

const iso = (value: Date | string | number | undefined): string | null =>
	value === undefined ? null : new Date(value).toISOString();

const sessionRow = (row: SessionRow): SessionRowV1 => ({
	id: row.handle,
	current: row.current,
	device: row.device ?? null,
	createdAt: iso(row.createdAt) as string,
	updatedAt: iso(row.updatedAt) as string,
	expiresAt: iso(row.expiresAt),
});

const passkeyRow = (row: PasskeyRow): PasskeyRowV1 => ({
	id: row.id,
	name: row.name ?? null,
	createdAt: iso(row.createdAt) as string,
	deviceType: row.deviceType ?? null,
	backedUp: row.backedUp ?? null,
});

/** The method `auth-sign-in`'s input names, as `identity.methods` spells it (2.2, D99). */
const methodOf = (input: unknown): string => {
	const { method, provider } = (input ?? {}) as { method?: string; provider?: string };
	return method === 'credentials'
		? 'password'
		: method === 'oauth'
			? `oidc:${String(provider)}`
			: String(method);
};

export function createIdentityCommands(deps: IdentityCommandsDeps) {
	const { kit, auth } = deps;
	const { z } = kit;
	const provider = deps.identity?.mode === 'provider';
	// `local` mode's Mock answers the sessions and passkeys in memory (4.1, 4.6): its capabilities attached once,
	// here, before any command that reads them is registered. A host's own adapter, or one attached, is left alone.
	const mock = auth as Partial<MockAuthAdapter>;
	if (!provider && typeof mock._setUser === 'function' && auth.sessions === undefined) {
		withMockCapabilities(auth as MockAuthAdapter);
	}
	const fail = (code: string, message: string, retryable = false): CommandResult<never> =>
		kit.kernelFailure(
			code as LoamKernelErrorCode,
			message,
			SUGGESTIONS[code] ?? 'Try again in a moment; the sign-in provider did not answer',
			{ retryable }
		);
	/** A provider's or an adapter's failure as the kernel answers it: its own code where it has one (15). */
	/**
	 * A provider's answer the kernel does not map (the review of step 4's N1): a definite refusal, any 4xx, is not
	 * retryable; an outage (a 5xx, or no answer at all) is.
	 */
	const providerFailure = (cause: unknown, text: string): CommandResult<never> => {
		const status = (cause as { status?: unknown } | null)?.status;
		const refused = typeof status === 'number' && status >= 400 && status < 500;
		return refused
			? kit.kernelFailure(
					'IDENTITY_PROVIDER_UNAVAILABLE',
					text,
					'The sign-in provider refused this request; read its message, then change the request',
					{ retryable: false }
				)
			: fail('IDENTITY_PROVIDER_UNAVAILABLE', text, true);
	};
	const refusal = (cause: unknown): CommandResult<never> => {
		const { code, message } = (cause ?? {}) as { code?: unknown; message?: unknown };
		const text = typeof message === 'string' ? message : 'The sign-in provider refused the request';
		if (typeof code === 'string' && KEPT.has(code)) return fail(code, text);
		return providerFailure(cause, text);
	};
	const unsupported = (): CommandResult<never> =>
		fail(
			'IDENTITY_PROVIDER_UNAVAILABLE',
			'This deployment cannot manage sessions or passkeys here'
		);

	const empty = z.strictObject({});
	const EMPTY_JSON: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };
	const name = z.string().check(z.minLength(1), z.maxLength(64));
	const id = z.string().check(z.minLength(1), z.maxLength(256));

	const sessionList = kit.define<typeof empty, { sessions: SessionRowV1[] }>({
		name: 'session-list',
		description:
			'List your sessions on every device, this one marked current; handles, never tokens',
		category: 'session',
		mutation: false,
		executionTime: 'fast',
		input: empty,
		jsonSchema: EMPTY_JSON,
		async handler() {
			const sessions = auth.sessions;
			if (!sessions) return unsupported();
			try {
				return kit.success({ sessions: (await sessions.listSessions()).map(sessionRow) });
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	const revokeInput = z.strictObject({ session: id });
	const sessionRevoke = kit.define<typeof revokeInput, SessionRevokeResultV1>({
		name: 'session-revoke',
		title: 'Sign out a session',
		description:
			"Sign out one of your sessions by its handle, 'others' or 'all'; 'others' and 'all' need a fresh passkey session. No undo",
		category: 'session',
		mutation: true,
		destructive: true,
		executionTime: 'fast',
		input: revokeInput,
		jsonSchema: {
			type: 'object',
			properties: { session: { type: 'string', minLength: 1, maxLength: 256 } },
			required: ['session'],
			additionalProperties: false,
		},
		async handler(input) {
			const sessions = auth.sessions;
			if (!sessions) return unsupported();
			try {
				// Loam's provider answers how many it revoked; a provider that answers nothing revoked the one named,
				// or every session for `all`, of which this page knows only its own.
				const answered = (await sessions.revokeSession(input.session)) as unknown as
					| { revoked?: number }
					| undefined;
				// This tab learns at once: the provider refuses a revoked session (4.3).
				await auth.refresh?.().catch(() => undefined);
				const signedOut = auth.getSession().status !== 'authenticated';
				return kit.success({
					revoked:
						typeof answered?.revoked === 'number'
							? answered.revoked
							: input.session === 'others'
								? 0
								: 1,
					signedOut,
					// Connected agents are step 7's (9.4): none to disconnect yet.
					disconnected: 0,
				});
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	const passkeyList = kit.define<typeof empty, { passkeys: PasskeyRowV1[] }>({
		name: 'account-passkey-list',
		description: 'List your passkeys',
		category: 'account',
		mutation: false,
		executionTime: 'fast',
		input: empty,
		jsonSchema: EMPTY_JSON,
		async handler() {
			const passkeys = auth.passkeys;
			if (!passkeys) return unsupported();
			try {
				return kit.success({ passkeys: (await passkeys.listPasskeys()).map(passkeyRow) });
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	const addInput = z.strictObject({ name: z.optional(name) });
	const passkeyAdd = kit.define<typeof addInput, PasskeyRowV1>({
		name: 'account-passkey-add',
		title: 'Add a passkey',
		description:
			"Create a passkey on this device for your account; needs a fresh session, made by a passkey if you hold one, and a person's press",
		category: 'account',
		mutation: true,
		executionTime: 'slow',
		input: addInput,
		jsonSchema: {
			type: 'object',
			properties: { name: { type: 'string', minLength: 1, maxLength: 64 } },
			additionalProperties: false,
		},
		async handler(input) {
			const passkeys = auth.passkeys;
			if (!passkeys) return unsupported();
			try {
				return kit.success(
					passkeyRow(
						await passkeys.addPasskey(input.name === undefined ? {} : { name: input.name })
					)
				);
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	/** A passkey of the person's, by id, or `PASSKEY_NOT_FOUND`. */
	const find = async (passkey: string): Promise<PasskeyRow[] | CommandResult<never>> => {
		const rows = await (auth.passkeys as NonNullable<AuthAdapter['passkeys']>).listPasskeys();
		return rows.some((row) => row.id === passkey)
			? rows
			: fail('PASSKEY_NOT_FOUND', 'You hold no passkey with this id');
	};

	const renameInput = z.strictObject({ passkey: id, name });
	const passkeyRename = kit.define<typeof renameInput, PasskeyRowV1>({
		name: 'account-passkey-rename',
		title: 'Rename a passkey',
		description: 'Rename one of your passkeys',
		category: 'account',
		mutation: true,
		executionTime: 'fast',
		input: renameInput,
		jsonSchema: {
			type: 'object',
			properties: {
				passkey: { type: 'string', minLength: 1, maxLength: 256 },
				name: { type: 'string', minLength: 1, maxLength: 64 },
			},
			required: ['passkey', 'name'],
			additionalProperties: false,
		},
		async handler(input) {
			const passkeys = auth.passkeys;
			if (!passkeys) return unsupported();
			try {
				const rows = await find(input.passkey);
				if (!Array.isArray(rows)) return rows;
				await passkeys.renamePasskey(input.passkey, input.name);
				const row = rows.find((held) => held.id === input.passkey) as PasskeyRow;
				return kit.success(passkeyRow({ ...row, name: input.name }));
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	const removeInput = z.strictObject({ passkey: id });
	const passkeyRemove = kit.define<typeof removeInput, { removed: true }>({
		name: 'account-passkey-remove',
		title: 'Remove a passkey',
		description:
			'Remove one of your passkeys; needs a fresh passkey session, and refuses your last one when you would have no other way in. No undo',
		category: 'account',
		mutation: true,
		destructive: true,
		executionTime: 'fast',
		input: removeInput,
		jsonSchema: {
			type: 'object',
			properties: { passkey: { type: 'string', minLength: 1, maxLength: 256 } },
			required: ['passkey'],
			additionalProperties: false,
		},
		async handler(input) {
			const passkeys = auth.passkeys;
			if (!passkeys) return unsupported();
			try {
				const rows = await find(input.passkey);
				if (!Array.isArray(rows)) return rows;
				// `PASSKEY_LAST` (5.2, 5.7): the last passkey of a person with no way back in, whose account's `recovery`
				// is `none` (an unverified email and no single sign-on) and whose deployment allows no other method.
				const identity = deps.identity;
				const methods = identity?.mode === 'provider' ? identity.methods : ['passkey'];
				const account = (auth as LoamAuthAdapter).account;
				const recovery =
					rows.length === 1 && identity?.mode === 'provider' && account
						? (await account.get()).recovery
						: 'none';
				if (
					rows.length === 1 &&
					recovery === 'none' &&
					methods.every((method) => method === 'passkey')
				) {
					return kit.kernelFailure(
						'PASSKEY_LAST',
						'This is your only passkey, and you would have no other way to sign in',
						'Add another passkey first, on this device or another, then remove this one'
					);
				}
				await passkeys.removePasskey(input.passkey);
				return kit.success({ removed: true as const });
			} catch (cause) {
				return refusal(cause);
			}
		},
	});

	const commands = [
		sessionList,
		sessionRevoke,
		passkeyList,
		passkeyAdd,
		passkeyRename,
		passkeyRemove,
	] as unknown as ZodCommandDefinition[];

	return {
		commands,
		/**
		 * `auth-sign-in` with the kernel's wrapper (4.6): in `provider` mode a method `identity.methods` does not
		 * allow is `SIGN_IN_METHOD_UNAVAILABLE`, before the adapter is called.
		 */
		signIn(command: ZodCommandDefinition): ZodCommandDefinition {
			const identity = deps.identity;
			if (identity?.mode !== 'provider') return command;
			const allowed: readonly string[] = identity.methods;
			return {
				...command,
				async handler(input: unknown, context: CommandContext) {
					if (!allowed.includes(methodOf(input))) {
						return kit.kernelFailure(
							'SIGN_IN_METHOD_UNAVAILABLE',
							'This deployment does not offer that way to sign in',
							`Sign in with one of: ${allowed.join(', ')}`
						);
					}
					return command.handler(input, context);
				},
			} as ZodCommandDefinition;
		},
		/**
		 * `palette-search` signed out in `provider` mode (2.1): only the signed-out commands, so a page with no one
		 * signed in lists nothing it could not run.
		 */
		paletteSearch(
			command: ZodCommandDefinition,
			signedOut: readonly string[]
		): ZodCommandDefinition {
			if (!provider) return command;
			return {
				...command,
				async handler(input: unknown, context: CommandContext) {
					const result = (await command.handler(input, context)) as CommandResult<{
						items: { name: string; kind?: string }[];
					}>;
					if (!result.success || auth.getSession().status === 'authenticated') return result;
					return {
						...result,
						data: {
							items: (result.data?.items ?? []).filter(
								(item) => item.kind === undefined && signedOut.includes(item.name)
							),
						},
					};
				},
			} as ZodCommandDefinition;
		},
		/**
		 * `HUMAN_REQUIRED` (3.4, 15): a human or an owner command on any interface but the palette's, which the chrome
		 * and the person's own calls use, journaled: the agent interface, and an MCP server should one ever serve it.
		 */
		humanRequired(call: CommandContext, name: string): CommandResult<never> | undefined {
			if (
				call.interface === 'palette' ||
				!(HUMAN_COMMANDS.includes(name) || OWNER_COMMANDS.includes(name))
			)
				return undefined;
			return kit.kernelFailure(
				'HUMAN_REQUIRED',
				`'${name}' changes or lists what only the person may, so an agent cannot run it`,
				'A person must do this in the shell'
			);
		},
	};
}

export type IdentityCommands = ReturnType<typeof createIdentityCommands>;
