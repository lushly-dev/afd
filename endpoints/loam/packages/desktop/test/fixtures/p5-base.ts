/**
 * `p5-base` on the desktop (phase 5 specification, Jobs and scenarios; P5-A1 and P5-A8): the deployment the slice's
 * files run on, and the seed's calls and rows made through the app's kernel as the person, as Chromium's runner makes
 * them (`web/test/browser/scenarios.test.ts`) and from the same lists (`kernel/scenarios/host-seed.ts`).
 *
 * The deployment holds the seed's apps (`hello`, `tally`, `checklist`); `mailfix` over stdio, started by the Rust host
 * from `kernel/scenarios/mailfix-stdio.ts` as P5-A6's suite starts it, so each start of the app holds a fresh state and
 * names its one peer its approver (7.2), with the entry `mailfixEntry` lists; `mailfixapp` with its `calls` grant; and,
 * for `p5-base`, `[copilot]` naming one provider, `test`, a local `openai-compatible` model that plays the kernel's
 * scenario scripts (`scenario-model.ts`) through the Rust host's model transport. `p5-no-provider` has no `[copilot]`.
 * The seed's fixed projects and documents, which the kernel writes to its store before it starts, are not made: no
 * slice file reads them. The agents' workspace row keeps its default, so 6.1's defaults hold.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandResult } from '@lushly-dev/afd-core';
import {
	mailfixappEntryToml,
	mailfixEntryToml,
	P5_AUTONOMY,
	P5_HOST_CALLS,
	writeMailfixPackages,
} from '../../../kernel/scenarios/host-seed.ts';
import type { ScenarioHost, ScenarioScope } from '../../../kernel/scenarios/runner.ts';
import { type Desktop, desktopDeployment, LOAM, packApp, untilInstance } from '../harness';
import { restrict } from './owner-only';
import { SCENARIO_MODEL, type ScenarioModel } from './scenario-model';

const KERNEL = join(LOAM, 'packages/kernel');
const MAILFIX_STDIO = join(KERNEL, 'scenarios/mailfix-stdio.ts');

/** The deployment file of `seed` (`p5-base` or `p5-no-provider`), with `model` as `p5-base`'s provider. */
export async function p5Deployment(seed: string, model: ScenarioModel): Promise<string> {
	if (seed !== 'p5-base' && seed !== 'p5-no-provider')
		throw new Error(`No desktop deployment for the seed '${seed}'`);
	const directory = await mkdtemp(join(tmpdir(), 'loam-desktop-p5-'));
	const written = await writeMailfixPackages(directory, 'stdio');
	const apps = [
		'[apps.hello]',
		'app = "hello"',
		`package = ${JSON.stringify(await packApp(join(LOAM, 'apps/hello'), 'manifests/native.toml'))}`,
		'',
		'[apps.tally]',
		'app = "tally"',
		`package = ${JSON.stringify(await packApp(join(LOAM, 'apps/tally')))}`,
		'',
		'[apps.checklist]',
		'app = "checklist"',
		`package = ${JSON.stringify(await packApp(join(LOAM, 'apps/checklist')))}`,
		'',
		...mailfixEntryToml(await packApp(written.mailfix), [
			'transport = "stdio"',
			`command = [${JSON.stringify(process.execPath)}, ${JSON.stringify(MAILFIX_STDIO)}]`,
			`cwd = ${JSON.stringify(KERNEL)}`,
		]),
		...mailfixappEntryToml(await packApp(written.mailfixapp)),
	];
	if (seed === 'p5-no-provider') return desktopDeployment(apps);
	// Only its owner may read it, as the Rust host requires of a key file (4.2), on Windows too.
	const keyFile = join(directory, 'key');
	await writeFile(keyFile, `sk-scenarios-${randomBytes(12).toString('hex')}`, { mode: 0o600 });
	restrict(keyFile);
	return [
		desktopDeployment(apps),
		'[copilot]',
		'default = "test"',
		'',
		'[[copilot.providers]]',
		'id = "test"',
		'kind = "openai-compatible"',
		`model = "${SCENARIO_MODEL}"`,
		`endpoint = ${JSON.stringify(model.url)}`,
		`key = { file = ${JSON.stringify(keyFile)} }`,
		'',
	].join('\n');
}

interface InPageCall {
	kind: 'person' | 'agent' | 'port';
	command: string;
	input: unknown;
	scope?: ScenarioScope;
	instance?: string;
}

/**
 * A call in the app's webview, as plain data. A call that throws answers as a failure whose code is `THROWN:<code>`,
 * which no scenario expects, so a throw fails its step here as it fails the kernel's units.
 */
export async function inApp(desktop: Desktop, call: InPageCall): Promise<CommandResult<unknown>> {
	// As JSON text: a value with a top-level `error` reads as WebDriver's own error to its client.
	const text = await desktop.browser.execute(async (call: InPageCall) => {
		type Port = { call(name: string, input: unknown): Promise<unknown> };
		const shell = document.querySelector('loam-shell') as unknown as {
			kernel: {
				call(name: string, input: unknown, options?: object): Promise<unknown>;
				agent: { call(name: string, input: unknown, options?: object): Promise<unknown> };
				appPort(instance: string): Port & { surface(binding: object): Port };
			};
		};
		const { kernel } = shell;
		const options = call.scope ? { scope: call.scope } : {};
		try {
			if (call.kind === 'agent')
				return JSON.stringify(await kernel.agent.call(call.command, call.input, options));
			if (call.kind === 'port') {
				const port = kernel.appPort(call.instance as string);
				return JSON.stringify(
					await (call.scope ? port.surface({ scope: call.scope }) : port).call(
						call.command,
						call.input
					)
				);
			}
			return JSON.stringify(await kernel.call(call.command, call.input, options));
		} catch (error) {
			const { code, message } = error as { code?: unknown; message?: unknown };
			return JSON.stringify({
				success: false,
				error: { code: `THROWN:${String(code ?? '')}`, message: String(message ?? error) },
			});
		}
	}, call);
	return JSON.parse(text as string) as CommandResult<unknown>;
}

/** The runner's host over the app's kernel; `[caller: <instance>, inactive]` opens `checklist`. */
export const desktopHost = (desktop: Desktop): ScenarioHost => ({
	inactiveApp: 'checklist',
	call: (command, input, scope) => inApp(desktop, { kind: 'person', command, input, scope }),
	agent: (command, input, scope) => inApp(desktop, { kind: 'agent', command, input, scope }),
	port: (instance, command, input, scope) =>
		inApp(desktop, { kind: 'port', command, input, scope, instance }),
});

/** Once `mailfix` is ready, the seed's calls and its autonomy rows, each the person's. */
export async function seedDesktop(desktop: Desktop): Promise<void> {
	await untilInstance(desktop, 'mailfix', 'ready');
	for (const { command, input } of P5_HOST_CALLS) {
		const done = await inApp(desktop, { kind: 'person', command, input });
		if (!done.success) throw new Error(`p5-base: ${command}: ${JSON.stringify(done.error)}`);
	}
	for (const [instance, command, mode] of P5_AUTONOMY) {
		const set = await inApp(desktop, {
			kind: 'person',
			command: 'autonomy-set',
			input: { level: 'workspace', instance, command, mode },
		});
		if (!set.success) throw new Error(`p5-base: ${JSON.stringify(set.error)}`);
	}
}
