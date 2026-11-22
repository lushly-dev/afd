/**
 * @fileoverview The request's principal on the server kernel (phase 3 specification, 9.5; step 7): types and the
 * empty membership a principal-gated kernel holds kernel-wide, in first paint because the scope runtime reads them.
 * The gate itself, and the registry that mints principals, are `server/principal-gate.ts`'s, loaded only by a kernel
 * built with `gate: 'principal'`.
 */

import type { Actor } from '@lushly-dev/afd-core';
import type { MembershipV1 } from './access.js';
import type { AgentMemberV1 } from './records.js';

/**
 * Who a call on the server kernel is for (9.5): `actor` the call runs as, `person` the one it is for, `membership`
 * that person's member row alone, read for this request, and `agent` the connected agent's row, so line 4 of
 * `decideAccess` has it. Minted only by the kernel's `admitPrincipal`, frozen, never journaled whole (the journal keeps
 * `actor`) and never on an app handler's context.
 */
export interface KernelPrincipalV1 {
	readonly actor: Readonly<Actor>;
	readonly person: string;
	readonly membership: MembershipV1;
	readonly agent?: Readonly<AgentMemberV1>;
}

/** What `admitPrincipal` takes: the person's role read for this request, `null` when they hold none. */
export interface PrincipalInputV1 {
	actor: Actor;
	person: string;
	role: 'owner' | 'admin' | 'member' | null;
	/** The provider's digest of the person's membership, or empty. */
	digest?: string;
	agent?: AgentMemberV1;
}

/**
 * The membership a principal-gated kernel holds kernel-wide: no members, so a read that skips the call's principal
 * refuses rather than decides for anyone (9.5: "nothing on the server reads kernel-wide membership").
 */
export const NO_MEMBERS: MembershipV1 = Object.freeze({
	mode: 'provider',
	members: new Map(),
	digest: '',
});

/** How the scope runtime finds a call's principal: by its actor, which the gate set from the principal. */
export type PrincipalLookup = (actor: unknown) => KernelPrincipalV1 | undefined;
