/**
 * @fileoverview Where `late/` meets phase 6's trust records (its 6.1, 6.3, 6.4; step 5): on the server's kernel, the
 * snapshot query and `persona-list`'s `default`; in a hosted `provider` deployment's browser, or a replay of one, the
 * `late-hosted` chunk's routing and copy. Each loads only where it is used; anywhere else nothing changes, and every
 * command keeps its phase 3 handler (P6-E3).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { LateScope } from '../scope/middleware.js';
import { DOCUMENT_KIT } from './document-kit.js';
import type { HostedDeps, HostedParts } from './hosted.js';
import type { LateCommandDeps } from './index.js';
import type { SessionSettle } from './session-settle.js';

/** The settles the server's kernel does not register (9.5): it holds no person's session or membership. */
export const SERVER_UNSETTLED: readonly string[] = Object.freeze([
	'session-settle',
	'membership-settle',
]);

/** Registered with the shell's own, though `SHELL_COMMAND_NAMES` does not name it: the server's alone (6.1). */
export const TRUST_COMMAND_NAMES: readonly string[] = Object.freeze(['trust-record-snapshot']);

/** What `late/` built that the wiring reads. */
export interface TrustWiringParts {
	/** The `agent-member` cache, and the hold on the browser's own suspensions: the server's hook makes them here (A4). */
	agentMembers: { cache: HostedDeps['agents']; holdSettles(): void };
	/**
	 * The kernel's hearing of the adapter, absent on the server: a routed write skips its membership re-read (phase 3's
	 * 7.6), since the server reads the person's member row for that very request, so the server decides it, or the shell
	 * hears `SERVER_UNAVAILABLE` (6.1).
	 */
	sessions?: Pick<SessionSettle, 'reread' | 'rereadsBefore' | 'follow'> | undefined;
	/** The identity commands, whose `humanRequired` the session's line −1 runs first: A6 joins it. */
	identityCommands: {
		humanRequired(call: CommandContext, name: string): CommandResult<never> | undefined;
	};
	shellPerson(): string | undefined;
	lateScope: Pick<LateScope, 'applyScopeChange'>;
	sha256(text: string): Promise<string>;
}

/** What `late/` asks of the wiring after it has run; absent where nothing is routed. */
export type TrustWiring = Pick<
	HostedParts,
	'recorded' | 'routed' | 'after' | 'begin' | 'stop' | 'connected'
>;

/**
 * Wire phase 6's trust records into `byName`, the late commands by name, before they are registered. Returns the
 * browser's routing parts, or undefined on the server and wherever nothing is routed.
 */
export async function wireTrustRecords(
	byName: Map<string, ZodCommandDefinition>,
	deps: LateCommandDeps,
	built: TrustWiringParts
): Promise<TrustWiring | undefined> {
	const workspace = deps.scope.workspace.id;
	if (deps.gated) {
		const { createTrustSnapshot, defaultPersonaOnly } = await import('../server/trust-records.js');
		const snapshot = createTrustSnapshot({
			definitionOf: (name) => byName.get(name),
			workspace,
			digest: built.sha256,
			kit: DOCUMENT_KIT,
		});
		byName.set(snapshot.name, snapshot);
		const personas = byName.get('persona-list');
		if (personas) byName.set('persona-list', defaultPersonaOnly(personas));
		return undefined;
	}
	const ports = deps.identityPorts ?? deps.ports;
	const hostedReplay =
		(deps.internals as { hostedReplay?: boolean } | undefined)?.hostedReplay === true;
	if (deps.identity?.mode !== 'provider' || (!ports?.serverCall && !hostedReplay)) return undefined;
	// A deployment the kernel was given that names another host routes nothing, whatever port the host gives (6.1).
	const kind = (deps.deployment as { host?: { kind?: unknown } } | undefined)?.host?.kind;
	if (!hostedReplay && deps.deployment !== undefined && kind !== 'hosted') return undefined;
	const { createHostedParts } = await import('./hosted.js');
	const parts = createHostedParts({
		store: deps.store,
		scope: deps.scope,
		agents: built.agentMembers.cache,
		serverCall: hostedReplay ? undefined : ports?.serverCall,
		runBoot: deps.runBoot,
		replaying: () => deps.internals?.replaying === true,
		follow: (job) => built.sessions?.follow(job),
		person: built.shellPerson,
		leave: (context) => built.lateScope.applyScopeChange({ workspace }, 'actor', context),
		watch: ports?.watchMembership?.bind(ports),
		strip: (message) =>
			deps.overlays.setGlobal(
				'trust-records',
				message === null ? null : { id: 'trust-records', message, tone: 'warning' }
			),
		journalBytes: () => deps.limits?.values().journalEntryBytes ?? Number.POSITIVE_INFINITY,
		kit: DOCUMENT_KIT,
	});
	byName.set(parts.settle.name, parts.settle);
	// The server suspends a removed sponsor's agent members (A4): the browser's own settle would write the copy (6.1).
	built.agentMembers.holdSettles();
	// A replay follows each period's host, from each apply it replays (A5).
	const apply = byName.get('workspace-deployment-apply');
	if (apply && hostedReplay)
		byName.set('workspace-deployment-apply', {
			...apply,
			handler: (input: unknown, context: CommandContext) => {
				parts.applied(input);
				return apply.handler(input as never, context);
			},
		} as ZodCommandDefinition);
	const sessions = built.sessions;
	if (sessions) {
		const reread = sessions.reread.bind(sessions);
		const rereadsBefore = sessions.rereadsBefore.bind(sessions);
		sessions.reread = (name, input) =>
			parts.routed(name) ? Promise.resolve(undefined) : reread(name, input);
		sessions.rereadsBefore = (name) => !parts.routed(name) && rereadsBefore(name);
	}
	// A6 before anything else decides the call: the session's line −1 reads `humanRequired` at each call.
	const held = built.identityCommands.humanRequired.bind(built.identityCommands);
	built.identityCommands.humanRequired = (call, name) =>
		held(call, name) ?? parts.agentRefusal(call, name);
	for (const [name, command] of byName) byName.set(name, parts.route(command));
	return parts;
}

/**
 * The projection stage B applies, naming the host when the browser routes and the projection does not (a boot whose
 * deployment lists no app gives the kernel none): the apply's journaled input is what a replay reads it from (A5).
 */
export const withHost = <T extends { host?: { kind: 'static' | 'hosted' | 'desktop' } }>(
	trust: TrustWiring | undefined,
	projection: T
): T =>
	trust && !projection.host ? { ...projection, host: { kind: 'hosted' as const } } : projection;

/** The scope middleware's preparation of a call, skipped for a routed write: the server prepares it (6.1). */
export const preparedUnlessRouted =
	(
		trust: () => TrustWiring | undefined,
		prepare: (
			name: string,
			input: unknown,
			call: CommandContext
		) => Promise<CommandResult<never> | undefined>
	) =>
	(name: string, input: unknown, call: CommandContext) =>
		trust()?.routed(name) ? Promise.resolve(undefined) : prepare(name, input, call);
