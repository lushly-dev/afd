/**
 * @fileoverview The trust records on the hosted lane (phase 6 specification, section 6; D103; step 5): the commands a
 * browser runs on the hosted server in a hosted `provider` deployment, and the snapshot its copy is settled from. Shared
 * by the browser's kernel, the server's and `loam-host`; nothing here runs at import, so first paint pays for none of
 * it unless a module it already loads names it.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { ProjectV1, WorkspaceAppV1 } from './scope/records.js';

/** Run on the hosted server from a browser, in a hosted provider deployment (6.1). */
export const SERVER_COMMANDS = Object.freeze([
	'project-create',
	'project-update',
	'project-archive',
	'project-restore',
	'workspace-app-set',
	'agent-member-add',
	'agent-member-update',
	'agent-member-remove',
	'agent-member-confirm',
	'agent-member-decline',
	'agent-member-withdraw',
	'trust-record-snapshot',
] as const);

export type ServerCommandV1 = (typeof SERVER_COMMANDS)[number];

/** The routed writes: every server command but the snapshot, which only the transport and the copy's refresh read. */
export const ROUTED_WRITES: readonly string[] = Object.freeze(
	SERVER_COMMANDS.filter((name) => name !== 'trust-record-snapshot')
);

/** One agent member as `agent-member-list` answers it, filtered for the caller (phase 3 specification, 8.2). */
export interface TrustRecordAgentV1 {
	id: string;
	kind: 'installed' | 'connected';
	sponsor: string;
	status: 'pending' | 'active' | 'suspended';
	[field: string]: unknown;
}

/** What `trust-record-snapshot` answers (6.1): what the session's person sees of the server's trust records. */
export interface TrustRecordSnapshotV1 {
	/** SHA-256 of this snapshot's canonical JSON, without this field: a digest of what this person sees, never a global counter. */
	generation: string;
	/** Only those `project-list` shows this person. */
	projects: ProjectV1[];
	workspaceApps: WorkspaceAppV1[];
	/** Filtered for the caller, as phase 3's 8.2; installed and connected. */
	agents: TrustRecordAgentV1[];
}

/** Why the copy is settled (6.3). */
export type TrustRecordSettleReasonV1 = 'boot' | 'call' | 'refresh' | 'session';

/** `trust-record-settle`'s input (6.3): journaled as data, so a replay re-runs it. */
export interface TrustRecordSettleInputV1 {
	reason: TrustRecordSettleReasonV1;
	snapshot: TrustRecordSnapshotV1;
	/** A snapshot refused for its size, by its size: `snapshot` is then empty, so the journal keeps the entry whole. */
	oversized?: number;
}

/** The largest snapshot the copy takes, as JSON (6.3): a larger one is `TRUST_RECORDS_TOO_LARGE`. */
export const TRUST_RECORDS_MAX_BYTES = 2 * 1024 * 1024;

/** What one routed call sends (6.1): the command, its input and the call's scope. */
export interface ServerCallRequestV1 {
	command: string;
	input: unknown;
	scope: { workspace: string; project?: string };
	/**
	 * The person the shell made the call as, sent beside the body (the `Loam-Person` header), never in it: the server
	 * refuses the call `SESSION_CHANGED` when the session is now another person's, and takes the principal only from the
	 * session (6.2, step 5's trust review).
	 */
	person?: string;
}

/**
 * What the transport answers (6.2), as `server-call.ts` maps it: the server's `CommandResult` unchanged, and the
 * person's snapshot digest after the call when the server answered `200`.
 */
export interface ServerCallAnswerV1 {
	result: CommandResult;
	generation?: string;
}

/** The host's port to the transport (6.1): only a hosted `provider` deployment's browser host gives it. */
export type ServerCallV1 = (request: ServerCallRequestV1) => Promise<ServerCallAnswerV1>;

/** JSON with object keys sorted at every level: the snapshot's digest is over this form (6.1). */
export function canonicalJson(value: unknown): string {
	const sort = (item: unknown): unknown =>
		Array.isArray(item)
			? item.map(sort)
			: item && typeof item === 'object'
				? Object.fromEntries(
						Object.keys(item)
							.sort()
							.map((key) => [key, sort((item as Record<string, unknown>)[key])])
					)
				: item;
	return JSON.stringify(sort(value)) ?? 'null';
}
