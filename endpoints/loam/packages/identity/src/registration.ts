/**
 * @fileoverview Passkey registration at the provider (phase 3 specification, 5.8). The join and recovery pages register
 * a passkey with no session, so the plugin runs with `requireSession: false`, which drops its own session and
 * freshness checks for every registration; this puts each back. `resolveUser` only names whom a join or recovery
 * registration is for, writing nothing; `afterVerification`, once the authenticator has proved itself, re-reads the
 * session, applies every row of 5.8 again, and does the join's or the recovery's writes through the plugin's own
 * transaction, so the user, the accepted invitation, the consumed token, the revocations, the passkey and the session
 * commit together or not at all.
 */

import type { AuthContext } from 'better-auth';
import { getCurrentAdapter } from 'better-auth';
import { getAuthoritativeSessionFromCtx } from 'better-auth/api';
import {
	completeJoin,
	consumeOnce,
	invitationNotFound,
	joinName,
	type LinkAdapter,
	linkRefusal,
	parseLinkContext,
	readJoin,
	requireNoAccount,
	signOutFirst,
} from './enrolment.js';
import { RECOVERY_MODEL, readRecovery, recoverPerson, recoveryInvalid } from './recovery.js';
import { reauthRequired, requireFreshPasskeySession } from './sessions.js';

type Ctx = {
	context: AuthContext;
	body?: unknown;
	request?: Request | undefined;
};

const malformed = () =>
	linkRefusal(
		'BAD_REQUEST',
		'VALIDATION_ERROR',
		'A registration context is join:<invitation>.<token> or recover:<token>'
	);

const sessionRequired = () =>
	linkRefusal(
		'UNAUTHORIZED',
		'UNAUTHORIZED',
		'Sign in first, or open your join or recovery link: a passkey is registered for someone'
	);

export interface RegistrationDeps {
	/** A recovery's announcement, sent once the route has answered and the transaction committed (5.7). */
	hold(request: object | undefined, userId: string, at: Date): void;
}

/** The passkey plugin's `registration` options: `requireSession: false` with 5.8's checks restored. */
export function passkeyRegistration(deps: RegistrationDeps) {
	return {
		requireSession: false,
		/**
		 * Whom a session-less registration is for, at generation: the join's reserved id and the invitation's email, or
		 * the recovery token's person. It writes nothing, so generating options never consumes a token. A registration
		 * with no `context` and no session is refused here (5.8: "No `context`, no session: 401").
		 */
		async resolveUser({ ctx, context }: { ctx: Ctx; context: string | null }) {
			const link = parseLinkContext(context);
			if (link === undefined) throw sessionRequired();
			if (link === 'malformed') throw malformed();
			const adapter = ctx.context.adapter as unknown as LinkAdapter;
			if (link.kind === 'join') {
				const row = await readJoin(adapter, link.invitation, link.token);
				await requireNoAccount(adapter, row.email);
				// The name other members will see is given first, on the join page (5.6, I1): a join without one is refused
				// before any ceremony, and nothing is taken from the email.
				return { id: row.pendingUserId, name: row.email, displayName: joinName(row.name) };
			}
			const row = await readRecovery(adapter, link.token);
			const user = await ctx.context.internalAdapter.findUserById(row.userId);
			if (!user) throw invitationNotFound();
			return { id: user.id, name: user.email, displayName: user.name || user.email };
		},
		/**
		 * At verification, before the passkey is stored (5.8): the session read again from the store, every row applied
		 * again, then the join's or the recovery's writes in the plugin's transaction. Returns whom the passkey is for.
		 */
		async afterVerification({
			ctx,
			context,
			user,
		}: {
			ctx: Ctx;
			context?: string | null;
			user: { id: string };
		}) {
			const found = await getAuthoritativeSessionFromCtx(ctx as never);
			const link = parseLinkContext(context);
			if (link === undefined) {
				// No `context`: a session, fresh, made by a passkey for a person who holds one, or marked `recovery`.
				if (!found?.session) throw reauthRequired();
				await requireFreshPasskeySession(ctx.context, found, { allowRecovery: true });
				return {};
			}
			if (link === 'malformed') throw malformed();
			if (found?.session) throw signOutFirst();
			// The join and the recovery happen only with the session they make, in the plugin's one transaction.
			if ((ctx.body as { createSession?: unknown } | undefined)?.createSession !== true) {
				throw linkRefusal(
					'BAD_REQUEST',
					'VALIDATION_ERROR',
					'A join or recovery registration signs in: send createSession: true'
				);
			}
			const adapter = (await getCurrentAdapter(ctx.context.adapter)) as unknown as LinkAdapter;
			if (link.kind === 'join') {
				const row = await readJoin(adapter, link.invitation, link.token);
				// The link sent again since these options were made reserves another id: this registration's is stale.
				if (row.pendingUserId !== user.id) throw invitationNotFound();
				return { userId: await completeJoin(adapter, row) };
			}
			const row = await readRecovery(adapter, link.token);
			if (row.userId !== user.id) throw invitationNotFound();
			const at = new Date();
			// Consumed first, by a conditional update that must change one row, so two uses racing find one refused (I4).
			await consumeOnce(adapter, RECOVERY_MODEL, row.id, recoveryInvalid, at);
			await recoverPerson(adapter, row.userId, { now: at });
			deps.hold(ctx.request, row.userId, at);
			return { userId: row.userId };
		},
	};
}
