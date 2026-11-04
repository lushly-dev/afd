import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { zodToJsonSchema } from '@lushly-dev/afd-server/define';
import { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { describe, expect, it } from 'vitest';
import { EMPTY_APPS } from '../apps-runtime.js';
import { createBootCommands } from '../boot-commands.js';
import { KERNEL_CONTEXT_FIELDS } from '../context-fields.js';
import { createScopeRuntime } from '../scope/runtime.js';
import { SHELL_COMMAND_NAMES } from '../shell-command-names.js';
import { registerShellState } from '../shell-state.js';
import { createFixedEnvironment } from '../testing.js';
import { createLateParts, createOverlayStore } from './index.js';

async function definitions() {
	const viewState = new ViewStateRegistry();
	const state = registerShellState(viewState);
	const auth = new MockAuthAdapter();
	const environment = createFixedEnvironment();
	const apps = () => EMPTY_APPS;
	const scope = createScopeRuntime({ id: 'personal', name: 'Personal' });
	const boot = createBootCommands({ state, environment, auth, apps, scope, summaries: () => [] });
	return {
		boot,
		all: (
			await createLateParts(boot, {
				viewState,
				state,
				environment,
				auth,
				host: 'test',
				storeKind: 'memory',
				overlays: createOverlayStore(),
				apps,
				paletteRows: () => [],
				commandSet: () => 0,
				scope,
				store: new MemoryAdapter(),
				generation: () => 'test',
				isMutation: () => false,
				summaries: () => [],
				run: () => Promise.resolve({ success: true }) as never,
			})
		).shell,
	};
}

describe('the shell commands on Zod Mini', () => {
	it('hold each written JSON Schema equal to its schema', async () => {
		for (const command of (await definitions()).all) {
			expect(command.jsonSchema, command.name).toEqual(zodToJsonSchema(command.inputSchema));
		}
	});

	it('list every name once, in order, with the boot commands among them', async () => {
		const { boot, all } = await definitions();
		expect(all.map((command) => command.name)).toEqual([...SHELL_COMMAND_NAMES]);
		expect(boot.map((command) => command.name).sort()).toEqual([
			'app-list',
			'appearance-get',
			'auth-session-get',
			'layout-get',
			'scope-get',
			'section-get',
		]);
	});

	it('parse a context field on Mini', async () => {
		const { safeParse } = await import('zod/v4/core');
		const caller = KERNEL_CONTEXT_FIELDS.find((field) => field.name === 'caller');
		expect(safeParse(caller?.schema as never, 'someone').success).toBe(true);
		expect(safeParse(caller?.schema as never, '').success).toBe(false);
	});
});
