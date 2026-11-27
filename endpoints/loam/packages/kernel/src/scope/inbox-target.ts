/**
 * @fileoverview `canOpenInboxTarget` (phase 5 specification, 9.3): whether a call may open the inbox at a notice or a
 * confirmation, one rule for `shell-open`'s two ways in and an agent's `section-open` by path. In `scope/`, which both
 * read, so `late/` reaches it and `scope/` imports nothing of `late/`.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { AppsRuntime } from '../apps-runtime.js';
import { type CallsV1, grantedInstances } from '../call-grant.js';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure } from '../errors.js';
import { type AccessActorV1, personOf } from './access.js';
import { canOpen } from './main-state.js';
import type { ScopeV1 } from './records.js';
import type { ScopeRuntime } from './runtime.js';

/** What the rule reads: the store that keeps the inbox, the scope's access, and the apps' grants. */
export interface InboxTargetDeps {
	store: DataAdapter;
	scope: ScopeRuntime;
	apps: () => AppsRuntime;
}

/** A notice's or confirmation's row as the inbox keeps it: what the rule reads. */
interface InboxRow {
	id: string;
	workspace: string;
	person: string;
	kind: 'notice' | 'confirmation';
	source?: string;
	scope?: ScopeV1;
	cbucket?: string;
	cslot?: true;
	raiserAgent?: string;
	confirmation?: { command?: string; session?: unknown };
}

const notFound = () =>
	kernelFailure(
		'NOTIFICATION_NOT_FOUND',
		'There is no such notice in your inbox',
		'Open the inbox with no path, and pick a notice there'
	);

/**
 * Whether the call may open the inbox at `notification` (9.3), as `shell-open` and an agent's `section-open` both ask:
 * the person's own row in this workspace and an enterable scope; a confirmation (never a slot's) to the person, to the
 * copilot session that raised it, to the agent that raised it (`raiserAgent`), and to an app that raised it or whose
 * own or granted instance it targets; a notice to an app only from itself. Anything else is `NOTIFICATION_NOT_FOUND`,
 * one refusal for a row that is not there and one that is not the caller's.
 */
export async function canOpenInboxTarget(
	deps: InboxTargetDeps,
	notification: string,
	context: CommandContext,
	options: { requireConfirmation: boolean; scope?: ScopeV1 }
): Promise<CommandResult<never> | undefined> {
	const row = await deps.store.get<InboxRow>('notification', notification).catch(() => null);
	const person = personOf(context as { actor?: AccessActorV1 });
	const at: ScopeV1 = row?.scope ?? { workspace: row?.workspace ?? '' };
	if (
		!row ||
		row.workspace !== deps.scope.workspace.id ||
		row.person !== person ||
		!deps.scope.allows(context.actor as AccessActorV1, at)
	)
		return notFound();
	// The link's own scope is the row's, or the row is not the one it names: the same refusal, so no scope is probed.
	if (
		options.scope !== undefined &&
		(options.scope.workspace !== at.workspace || options.scope.project !== at.project)
	)
		return notFound();
	const caller = (context as KernelFieldContext).caller;
	// An app reaches the row's real scope only as it reaches any: its levels, which `opensIn` does not read for a
	// project (as `scope-set` checks them itself), and `canOpen`'s enablement in that project. Defence in depth:
	// `shell-open` refuses such a caller by its own scope checks before it asks, so only another caller of this rule
	// reaches it; it is kept so the rule holds alone, and tested so directly.
	if (caller !== undefined && at.project !== undefined) {
		const apps = deps.apps();
		const levels = apps.summaries().find((app) => app.instance === caller)?.scopeLevels ?? [];
		if (!levels.includes('project') || canOpen(apps, deps.scope, caller, at.project) !== undefined)
			return notFound();
	}
	if (row.kind !== 'confirmation') {
		if (options.requireConfirmation) return notFound();
		return caller === undefined || row.source === caller ? undefined : notFound();
	}
	if (row.cslot !== undefined) return notFound();
	if (caller !== undefined) {
		const apps = deps.apps();
		const target = apps.owners.get(row.confirmation?.command ?? '')?.instance;
		if (row.cbucket === `app:${caller}` || target === caller) return undefined;
		return target !== undefined && grantedOf(apps, caller).has(target) ? undefined : notFound();
	}
	const session = (context as { copilotSession?: unknown }).copilotSession;
	if (typeof session === 'string')
		return row.confirmation?.session === session ? undefined : notFound();
	if (context.actor?.kind === 'agent')
		return row.raiserAgent === context.actor.id ? undefined : notFound();
	return undefined;
}

/** The instances `caller`'s `calls` grant reaches (9.2's `grantedInstances`), read live. */
function grantedOf(apps: AppsRuntime, caller: string): Set<string> {
	const detail = apps.detail(caller);
	let calls: CallsV1;
	try {
		calls = apps.port(caller).manifest.calls as CallsV1;
	} catch {
		return new Set();
	}
	const grants = new Set(
		detail.success
			? (detail.data?.grants ?? []).filter((each) => each.served).map((each) => each.name)
			: []
	);
	return grantedInstances(apps.owners, caller, grants, calls);
}
