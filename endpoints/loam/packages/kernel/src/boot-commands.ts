/**
 * @fileoverview The commands boot calls, the only ones in first paint (phase 2 specification, 2.2 and
 * 2.3): `appearance-get`, `layout-get`, `auth-session-get` and `app-list`. Every other shell command is
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
import type { LayoutStateV0 } from './layout.js';
import type { ShellState } from './shell-state.js';
import type { AppSummaryV1, KernelEnvironmentV0 } from './types.js';

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
}

export function createBootCommands(deps: BootCommandDeps): ZodCommandDefinition[] {
	const { state, environment, apps } = deps;

	const layoutGet = defineCommandWithSchema<typeof emptyInput, LayoutStateV0>({
		name: 'layout-get',
		description: 'Get the shell layout: which parts are open and their sizes',
		category: 'layout',
		mutation: false,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler() {
			return success(state.layout());
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
		{ active: string | null; apps: AppSummaryV1[] }
	>({
		name: 'app-list',
		description: 'List the deployed apps with their state, and which one is active',
		category: 'app',
		mutation: false,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler() {
			return success({ active: state.activeApp(), apps: apps().summaries() });
		},
	});

	return [
		layoutGet,
		appearanceGet,
		createAuthSessionGetCommand(deps.auth),
		appList,
	] as unknown as ZodCommandDefinition[];
}
