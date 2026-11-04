/**
 * @fileoverview `project-summary-get` (phase 2 specification, 7.7): a project's home, each enabled app's
 * summary of it. Only the definition is in the `late` chunk: the rows, and the readers, load on its first
 * call, from `project-summary-rows.ts` (2.4). A named project is checked by `decideAccess` first, and
 * missing and refused answer the same `PROJECT_NOT_FOUND` (3.4).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import {
	defineCommandWithSchema,
	success,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import * as z from 'zod/mini';
import type { AppsRuntime } from '../apps-runtime.js';
import type { KernelCallFields, KernelFieldContext } from '../context-fields.js';
import { kernelFailure } from '../errors.js';
import { actorKey } from '../scope/access.js';
import { projectNotFound } from '../scope/middleware.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import type { AppSummaryV2, CallOptionsV1 } from '../types.js';
import { forApp } from './scope-commands.js';

export interface ProjectSummaryDeps {
	scope: ScopeRuntime;
	apps(): AppsRuntime;
	/** `app-list`'s rows: the workspace's overrides, in the rail's order. */
	summaries(): AppSummaryV2[];
	/** The kernel's `run`: a call with `parent` is nested, journaled when it ends and never queued (11.1). */
	run<T>(
		iface: 'palette' | 'agent',
		name: string,
		input: unknown,
		options: CallOptionsV1,
		fields: KernelCallFields
	): Promise<CommandResult<T>>;
	/** Whether a command changes data: a summary that does is never run (defence in depth beside 8.3). */
	isMutation(name: string): boolean;
	/** The deadline, for tests; default 2,000 ms. */
	deadlineMs?: number;
}

const projectInput = z.strictObject({
	project: z.string().check(z.minLength(1), z.maxLength(128)),
});

export function createProjectSummaryCommand(deps: ProjectSummaryDeps): ZodCommandDefinition {
	const { scope } = deps;
	return defineCommandWithSchema<typeof projectInput, unknown>({
		name: 'project-summary-get',
		description: "Get a project's home: each app's summary of it, in the rail's order",
		category: 'project',
		mutation: false,
		executionTime: 'fast',
		input: projectInput,
		jsonSchema: {
			type: 'object',
			properties: { project: { type: 'string', minLength: 1, maxLength: 128 } },
			required: ['project'],
			additionalProperties: false,
		},
		async handler(input, context: CommandContext) {
			const project = scope.project(input.project);
			const at = { workspace: scope.workspace.id, project: project?.id as string };
			if (!project || !scope.allows(actorKey(context), at)) return projectNotFound();
			let rows: typeof import('./project-summary-rows.js');
			try {
				rows = await import('./project-summary-rows.js');
			} catch {
				return kernelFailure(
					'LATE_COMMANDS_UNAVAILABLE',
					"The project's summaries could not load",
					'Reload to try again, and check that the deployment serves its assets',
					{ retryable: true }
				);
			}
			const shown =
				(context as KernelFieldContext).caller === undefined ? project : forApp(project);
			const summaries = await rows.summaryRows(
				deps,
				at,
				context.traceId ?? '',
				context.interface === 'agent' ? 'agent' : 'palette'
			);
			const warnings = rows.droppedWarnings(summaries);
			return success({ project: shown, summaries }, warnings.length > 0 ? { warnings } : {});
		},
	}) as unknown as ZodCommandDefinition;
}
