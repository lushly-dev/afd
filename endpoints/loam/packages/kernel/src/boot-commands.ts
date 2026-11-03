/**
 * @fileoverview The commands boot calls, the only ones in first paint (phase 2 specification, 2.2 and
 * 2.3): `appearance-get`, `layout-get`, `auth-session-get`, `app-list`, `scope-get` and `section-get`. Every other shell command is
 * in `late/`. Each schema's JSON Schema is written beside it, so nothing converts one at run time, and
 * `late/literals.test.ts` holds the two equal.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import { createAuthSessionGetCommand } from '@lushly-dev/afd-auth/commands';
import {
	defineCommandWithSchema,
	type JsonSchema,
	success,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import * as z from 'zod/mini';
import { type AppearanceStateV0, type AppearanceV0, resolveTheme } from './appearance.js';
import type { AppsRuntime } from './apps-runtime.js';
import type { KernelFieldContext } from './context-fields.js';
import type { LayoutStateV0 } from './layout.js';
import { actorKey } from './scope/access.js';
import type { ProjectV1, ScopeV1 } from './scope/records.js';
import type { ScopeRuntime } from './scope/runtime.js';
import type { ShellState } from './shell-state.js';
import type { AppSummaryV2, KernelEnvironmentV0 } from './types.js';

export const emptyInput = z.strictObject({});

export const EMPTY_INPUT_JSON: JsonSchema = {
	type: 'object',
	properties: {},
	additionalProperties: false,
};

export function withResolved(
	state: AppearanceStateV0,
	environment: KernelEnvironmentV0
): AppearanceV0 {
	return { ...state, resolved: resolveTheme(state.theme, environment) };
}

export interface BootCommandDeps {
	state: ShellState;
	environment: KernelEnvironmentV0;
	auth: AuthAdapter;
	apps(): AppsRuntime;
	/** `app-list`'s rows, read against the active scope and the workspace's overrides. */
	summaries(): AppSummaryV2[];
	scope: ScopeRuntime;
}

/** Whether the app `instance` takes a project, so its layout is kept per project (7.6). */
export const takesProject =
	(apps: () => AppsRuntime) =>
	(instance: string): boolean =>
		apps()
			.summaries()
			.some((app) => app.instance === instance && app.scopeLevels.includes('project'));

/** The call's effective scope, which the scope middleware sets on every call. */
export const callScope = (context: unknown): ScopeV1 =>
	(context as KernelFieldContext).scope as ScopeV1;

export function createBootCommands(deps: BootCommandDeps): ZodCommandDefinition[] {
	const { state, environment, apps, scope } = deps;

	const layoutGet = defineCommandWithSchema<typeof emptyInput, LayoutStateV0>({
		name: 'layout-get',
		description: 'Get the shell layout: which parts are open and their sizes',
		category: 'layout',
		mutation: false,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler(_input, context) {
			// The call's scope's record, not the active scope's, so a replay finds the same one (3.4).
			const id = await state.scopedLayoutId(callScope(context).project, takesProject(apps));
			return success(state.layoutOf(id) as LayoutStateV0);
		},
	});

	const appearanceGet = defineCommandWithSchema<typeof emptyInput, AppearanceV0>({
		name: 'appearance-get',
		description: 'Get the theme and density, and the theme the system setting resolves to',
		category: 'appearance',
		mutation: false,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler() {
			return success(withResolved(state.appearance(), environment));
		},
	});

	const appList = defineCommandWithSchema<
		typeof emptyInput,
		{ active: string | null; apps: AppSummaryV2[] }
	>({
		name: 'app-list',
		description: 'List the deployed apps with their state, and which one is active',
		category: 'app',
		mutation: false,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler() {
			return success({ active: state.activeApp(), apps: deps.summaries() });
		},
	});

	const scopeGet = defineCommandWithSchema<
		typeof emptyInput,
		{
			scope: ScopeV1;
			workspace?: { id: string; name: string };
			project?: ProjectV1 | null;
			pending?: boolean;
		}
	>({
		name: 'scope-get',
		description: "Get the call's scope",
		category: 'scope',
		mutation: false,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler(_input, context) {
			const current = callScope(context);
			// Through a port, the scope alone: no app reads a project's record or its members (4.3).
			if ((context as KernelFieldContext).caller !== undefined) return success({ scope: current });
			// A project's record only where the actor may enter it, as every named project (3.4). `pending`:
			// stage A's active scope is not the one `loam.scope` records, so the chrome journals it with
			// `scope-set` in stage B (6.3). It names no project.
			return success({
				scope: current,
				workspace: scope.workspace,
				project: scope.allows(actorKey(context), current)
					? (scope.projects.get(current.project as string) ?? null)
					: null,
				pending: (scope.active().project ?? null) !== state.scopeProject(),
			});
		},
	});

	const sectionGet = defineCommandWithSchema<
		typeof emptyInput,
		{ section: string | null; path: string; active: string | null }
	>({
		name: 'section-get',
		description: "Get main's section",
		category: 'section',
		mutation: false,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler() {
			// What the URL shows (6.3), in one read the chrome need not journal.
			const { section, path, active } = state.main();
			return success({ section, path, active });
		},
	});

	return [
		layoutGet,
		appearanceGet,
		createAuthSessionGetCommand(deps.auth),
		appList,
		scopeGet,
		sectionGet,
	] as unknown as ZodCommandDefinition[];
}
