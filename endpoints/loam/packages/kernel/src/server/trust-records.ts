/**
 * @fileoverview The hosted server's half of the trust-record transport (phase 6 specification, 6.1; A6; step 5): the
 * `trust-record-snapshot` query, which only the transport serves, and `persona-list` answering `default` alone, since
 * the server holds no personas. Loaded only by a principal-gated kernel, so no browser's graph holds it.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { DocumentKit } from '../scope/command-kit.js';
import type { ProjectV1, WorkspaceAppV1 } from '../scope/records.js';
import {
	canonicalJson,
	type TrustRecordAgentV1,
	type TrustRecordSnapshotV1,
} from '../trust-records.js';

export interface ServerTrustDeps {
	/** A registered command's definition, read when the snapshot runs, so it is the one the registry holds. */
	definitionOf(name: string): ZodCommandDefinition | undefined;
	workspace: string;
	digest(text: string): Promise<string>;
	kit: Pick<DocumentKit, 'define' | 'success' | 'z'>;
}

/**
 * `trust-record-snapshot` (6.1): `{}` to {@link TrustRecordSnapshotV1}, exactly what `project-list { status: 'all' }`,
 * `workspace-app-list` and `agent-member-list { status: 'all' }` answer the call's person, from their own handlers, and the
 * SHA-256 of the three as canonical JSON. A refusal of any of them is the snapshot's.
 */
export function createTrustSnapshot(deps: ServerTrustDeps): ZodCommandDefinition {
	const { kit } = deps;
	const empty = kit.z.strictObject({});
	return kit.define<typeof empty, TrustRecordSnapshotV1>({
		name: 'trust-record-snapshot',
		description:
			"What the hosted server's trust records show you: your projects, the workspace's apps and agents",
		category: 'project',
		mutation: false,
		executionTime: 'fast',
		input: empty,
		jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
		async handler(_input, context: CommandContext) {
			// Each read's own handler, on this call's context, so its answer is exactly what that command answers this person,
			// with no nested entry: the snapshot is unjournaled, as the transport reads it after every call (step 5's review).
			const nested = async <T>(name: string, input: unknown): Promise<CommandResult<T>> => {
				const command = deps.definitionOf(name);
				if (!command) throw new Error(`The server kernel has no '${name}'`);
				return (await command.handler(input as never, {
					...context,
					scope: { workspace: deps.workspace },
				})) as CommandResult<T>;
			};
			const projects = await nested<{ projects: ProjectV1[] }>('project-list', { status: 'all' });
			if (!projects.success) return projects as CommandResult<never>;
			const apps = await nested<{ apps: WorkspaceAppV1[] }>('workspace-app-list', {});
			if (!apps.success) return apps as CommandResult<never>;
			const agents = await nested<{ agents: TrustRecordAgentV1[] }>('agent-member-list', {
				status: 'all',
			});
			if (!agents.success) return agents as CommandResult<never>;
			const seen = {
				projects: projects.data?.projects ?? [],
				workspaceApps: apps.data?.apps ?? [],
				agents: agents.data?.agents ?? [],
			};
			return kit.success({ generation: await deps.digest(canonicalJson(seen)), ...seen });
		},
	}) as unknown as ZodCommandDefinition;
}

/** `persona-list` on the server (A6): only `default`, since the server holds no person's personas. */
export function defaultPersonaOnly(command: ZodCommandDefinition): ZodCommandDefinition {
	return {
		...command,
		async handler(input: unknown, context: CommandContext) {
			const result = (await command.handler(input, context)) as CommandResult<{
				personas: Array<{ id: string }>;
				active: string;
			}>;
			if (!result.success || !result.data) return result;
			return {
				...result,
				data: {
					personas: result.data.personas.filter((persona) => persona.id === 'default'),
					active: 'default',
				},
			};
		},
	} as ZodCommandDefinition;
}
