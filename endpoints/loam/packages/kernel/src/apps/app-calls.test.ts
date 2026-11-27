/**
 * P5-B1 (phase 5 specification, 9.1 and 18): native `calls` grants on AFD's `createAppCallRegistry`. An app's call to
 * another app's command, native or mounted, runs on the `apps` registry with `interface: 'apps'`; every other name an
 * app may not call, a boot-only one included, gets AFD's fixed `callNotGranted()` before lookup and validation, with one
 * `app-call-refuse` entry naming the caller and none of a granted callee's own refusals journaled twice; two mounts of
 * one plugin are told apart by their own commands; a handler's nested mutation stays refused, without telling an
 * ungranted command apart; and `replayKernel` replays the `apps` entries with no difference.
 */

import type { JournalEntry } from '@lushly-dev/afd-core';
import { callNotGranted } from '@lushly-dev/afd-core/internal/app-calls';
import type { ManifestV3 } from '@lushly-dev/loam-manifest';
import { afterEach, describe, expect, it } from 'vitest';
import { KEPT } from '../../scenarios/mailfix-mount.js';
import { P5_CALLER, p5Base, type SeededKernel } from '../../scenarios/seeds.js';
import { createTraces } from '../app-call-registry.js';
import { grantedInstances } from '../call-grant.js';
import { BOOT_ONLY } from '../commands.js';
import { TABLE as NOTIFICATION_TABLE } from '../settings/confirmation-parts.js';
import { replayKernel } from '../testing.js';

/** The overlay's granted caller (`p5-base.overlay.json`), by its instance: the shell's sources name no app. */
const CALLER = P5_CALLER.instance;
/** Its callee, an instance named as its app, the command the grant names, and two the callee holds that it does not. */
const CALLEE = P5_CALLER.app;
const READ = P5_CALLER.commands[0] as string;
const ADD = `${CALLEE}-add`;
const RESET = `${CALLEE}-reset`;
const WS = { workspace: 'personal' };

let seeded: SeededKernel | undefined;
afterEach(async () => {
	KEPT.client = undefined;
	await seeded?.dispose();
	seeded = undefined;
});

const base = async (mailfixb = false): Promise<SeededKernel> => {
	seeded = await p5Base({ provider: false, mailfixb });
	return seeded;
};

const since = async (made: SeededKernel, from: number): Promise<JournalEntry[]> =>
	(await made.journal.read()).filter((entry) => entry.seq > from);
const head = async (made: SeededKernel): Promise<number> =>
	(await made.journal.read()).at(-1)?.seq ?? 0;

describe('P5-B1: native calls grants on createAppCallRegistry', () => {
	it('P5-B1: runs a granted call to a native command on the apps interface, as the caller', async () => {
		const made = await base();
		const from = await head(made);
		const read = await made.kernel.appPort(CALLER).call(READ, {});
		expect(read.success, JSON.stringify(read.error)).toBe(true);
		expect(read.data).toMatchObject({ total: 3 });
		const entries = await since(made, from);
		expect(entries.map((entry) => entry.command)).toEqual([READ]);
		expect(entries[0]?.contextDigest.interface).toBe('apps');
		expect(entries[0]?.context?.caller).toBe(CALLER);
	});

	it('P5-B1: refuses every other name with AFD’s fixed bytes before lookup and validation, journaled once as call-refused', async () => {
		const made = await base();
		const hello = made.kernel.appPort('hello');
		const granted = made.kernel.appPort(CALLER);
		const from = await head(made);
		const refused = [
			// No grant at all.
			await hello.call(ADD, {}),
			await hello.call(READ, {}),
			// A grant that does not name it, valid and invalid input, a name nothing holds, an uncallable shell command and
			// a boot-only one (closing the port's old `COMMAND_NOT_FOUND`, which told it apart).
			await granted.call(ADD, { by: 1 }),
			await granted.call(ADD, { nope: true }),
			await granted.call(`${CALLEE}-nothing`, {}),
			await granted.call('layout-set', { sidebar: { open: false } }),
			await granted.call(BOOT_ONLY[0] as string, {}),
		];
		for (const result of refused) {
			expect(result.success).toBe(false);
			expect(result.error).toEqual(callNotGranted());
		}
		const entries = await since(made, from);
		expect(entries.map((entry) => entry.command)).toEqual(refused.map(() => 'app-call-refuse'));
		expect(entries.map((entry) => entry.context?.caller)).toEqual([
			'hello',
			'hello',
			CALLER,
			CALLER,
			CALLER,
			CALLER,
			CALLER,
		]);
		expect(entries[0]?.input).toEqual({ command: ADD });
		expect(JSON.stringify(entries)).not.toContain('nope');
		// Nothing ran: the count is the seed's.
		expect((await made.kernel.call(READ, {})).data).toMatchObject({ total: 3 });
	});

	it('P5-B1: journals a granted callee’s own refusal once, as its own entry, never as call-refused', async () => {
		const made = await base();
		const from = await head(made);
		// Admitted, then refused by the callee's own validation, before any middleware: no entry, and no `call-refused`.
		const invalid = await made.kernel.appPort(CALLER).call(READ, { nope: true });
		expect(invalid.error?.code).toBe('VALIDATION_ERROR');
		expect((await since(made, from)).map((entry) => entry.command)).toEqual([]);
		// Admitted, then refused by the mounted callee's handler: its own entry, once.
		const missing = await made.kernel
			.appPort('mailfixapp')
			.call('mailfix-thread-open', { thread: 'thr_missing' });
		expect(missing.success).toBe(false);
		expect(missing.error?.code).not.toBe('CALL_NOT_GRANTED');
		const entries = await since(made, from);
		expect(entries.map((entry) => entry.command)).toEqual(['mailfix-thread-open']);
		expect(entries[0]?.contextDigest.interface).toBe('apps');
	});

	it('P5-B1: refuses the callee itself through the grant, and a disabled callee as any ungranted name', async () => {
		const made = await base();
		// Its own command is its own port's, on the palette interface, never `[[calls]]`.
		const own = await made.kernel.appPort(CALLEE).call(READ, {});
		expect(own.success).toBe(true);
		const disabled = await made.kernel.call('workspace-app-set', {
			instance: CALLEE,
			enabled: false,
		});
		expect(disabled.success, JSON.stringify(disabled.error)).toBe(true);
		const read = await made.kernel.appPort(CALLER).call(READ, {});
		expect(read.error).toEqual(callNotGranted());
	});

	it('P5-B1: tells two mounts of one plugin apart by their own commands (call.app === callee.app)', async () => {
		const made = await base(true);
		const peek = await made.kernel
			.appPort('mailfixapp')
			.call('mailfixapp-thread-peek', { thread: 'thr_1' });
		expect(peek.success, JSON.stringify(peek.error)).toBe(true);
		// `mailfixb` is the same plugin; `[[calls]]` names `mailfixb-thread-open` by its app, `mailfix`.
		const other = await made.kernel.appPort('mailfixapp').call('mailfixb-thread-open', {
			thread: 'thr_1',
		});
		expect(other.success, JSON.stringify(other.error)).toBe(true);
		// Neither's draft is in the other's name: `mailfixb-draft-create` is named by no `[[calls]]` entry.
		const draft = await made.kernel
			.appPort('mailfixapp')
			.call('mailfixb-draft-create', { thread: 'thr_1', body: 'x' });
		expect(draft.error).toEqual(callNotGranted());
		const owners = new Map([
			['mailfix-thread-open', { app: 'mailfix', instance: 'mailfix', apps: true as const }],
			['mailfixb-thread-open', { app: 'mailfix', instance: 'mailfixb', apps: true as const }],
			['mailfixw-thread-open', { app: 'mailfix', instance: 'mailfixw' }],
		]);
		const calls = [{ app: 'mailfix', commands: ['mailfix-thread-open', 'mailfixw-thread-open'] }];
		expect([...grantedInstances(owners, 'mailfixapp', new Set(['calls']), calls)]).toEqual([
			'mailfix',
		]);
		expect([...grantedInstances(owners, 'mailfixapp', new Set(), calls)]).toEqual([]);
		expect([...grantedInstances(owners, 'mailfix', new Set(['calls']), calls)]).toEqual([]);
	});

	it('P5-B1: keeps a handler’s nested mutation refused, telling no ungranted command apart', async () => {
		const made = await base();
		const port = made.kernel.appPort('mailfixapp');
		expect((await port.call('mailfixapp-client-keep', {})).success).toBe(true);
		const kept = KEPT.client as { call(name: string, input?: unknown): Promise<unknown> };
		const granted = (await kept.call('mailfix-draft-create', { thread: 'thr_1', body: 'x' })) as {
			error?: { code: string };
		};
		expect(granted.error?.code).toBe('NESTED_MUTATION_REFUSED');
		const ungranted = (await kept.call(ADD, { by: 1 })) as { error?: unknown };
		expect(ungranted.error).toEqual(callNotGranted());
	});

	it('P5-B1: raises a confirmation for an apps call as apps, and re-runs it there once confirmed, re-checking the grant', async () => {
		const overlay = {
			[CALLEE]: (manifest: ManifestV3): ManifestV3 => ({
				...manifest,
				commands: (manifest.commands ?? []).map((command) =>
					command.name === RESET
						? { ...command, expose: { ...command.expose, apps: true } }
						: command
				),
			}),
			[CALLER]: (manifest: ManifestV3): ManifestV3 => ({
				...manifest,
				calls: [...(manifest.calls ?? []), { app: CALLEE, commands: [RESET] }],
			}),
		};
		for (const revoke of [false, true]) {
			seeded = await p5Base({ provider: false, overlay });
			const made = seeded;
			const asked = await made.kernel.appPort(CALLER).call(RESET, {});
			expect(asked.error?.code, JSON.stringify(asked.error)).toBe('CONFIRMATION_PENDING');
			const notification = (asked.error?.details as { notification?: string } | undefined)
				?.notification as string;
			const row = await made.store?.get<{ ciface?: string }>(NOTIFICATION_TABLE, notification);
			expect(row?.ciface).toBe('apps');
			if (revoke) {
				// The callee's app disabled since: the re-run's own grant check refuses it, and nothing runs.
				await made.kernel.call('workspace-app-set', { instance: CALLEE, enabled: false });
			}
			const from = await head(made);
			const acted = await made.kernel.call('notification-act', {
				notification,
				answer: 'confirm',
			});
			expect(acted.success, JSON.stringify(acted.error)).toBe(true);
			const reset = (await since(made, from)).find((entry) => entry.command === RESET);
			if (revoke) expect(reset).toBeUndefined();
			else {
				expect(reset?.contextDigest.interface).toBe('apps');
				expect(reset?.context?.caller).toBe(CALLER);
				expect((await made.kernel.call(READ, {})).data).toMatchObject({ total: 0 });
			}
			await made.dispose();
			seeded = undefined;
		}
	});

	it('P5-B1: never lets a sandboxed view frame call another app, native or mounted, though its port may', async () => {
		const overlay = {
			[CALLER]: (manifest: ManifestV3): ManifestV3 => ({
				...manifest,
				calls: [...(manifest.calls ?? []), { app: 'mailfix', commands: ['mailfix-thread-open'] }],
			}),
		};
		seeded = await p5Base({ provider: false, overlay });
		const made = seeded;
		const port = made.kernel.appPort(CALLER);
		const view = port.surface({ scope: WS }).view;
		expect(view).toBeDefined();
		const fromFrame = async (name: string, input: unknown) =>
			(
				(await view?.toolsCall({ name, arguments: input })) as
					| { structuredContent?: { success?: boolean; error?: unknown } }
					| undefined
			)?.structuredContent;
		for (const [name, input] of [
			[READ, {}],
			['mailfix-thread-open', { thread: 'thr_1' }],
		] as const) {
			// Through the frame: refused before the grant is asked, as any name the app may not call.
			const refused = await fromFrame(name, input);
			expect(refused?.success, name).toBe(false);
			expect(refused?.error, name).toEqual(callNotGranted());
			// Through the port (the chrome's, and a handler frame's nested client): the grant admits it.
			const granted = await port.call(name, input);
			expect(granted.success, `${name}: ${JSON.stringify(granted.error)}`).toBe(true);
		}
	});

	it('P5-B1: admits a call only where the callee opens, by its project list', async () => {
		// `mailfix` serves Beacon alone; `mailfixapp`'s grant names its thread read.
		seeded = await p5Base({ provider: false, mailfixEntry: { projects: ['beacon'] } });
		const port = seeded.kernel.appPort('mailfixapp');
		const read = (project: string) =>
			port.surface({ scope: { ...WS, project } }).call('mailfix-thread-open', { thread: 'thr_1' });
		expect((await read('prj_atlas')).error).toEqual(callNotGranted());
		const beacon = await read('prj_beacon');
		expect(beacon.success, JSON.stringify(beacon.error)).toBe(true);
	});

	it('P5-B1: refuses an embed’s mutation EMBED_READ_ONLY once admitted, and CALL_NOT_GRANTED otherwise', async () => {
		const overlay = {
			[CALLEE]: (manifest: ManifestV3): ManifestV3 => ({
				...manifest,
				commands: (manifest.commands ?? []).map((command) =>
					command.name === RESET
						? { ...command, expose: { ...command.expose, apps: true } }
						: command
				),
			}),
			[CALLER]: (manifest: ManifestV3): ManifestV3 => ({
				...manifest,
				calls: [...(manifest.calls ?? []), { app: CALLEE, commands: [RESET] }],
			}),
		};
		seeded = await p5Base({ provider: false, overlay });
		const embed = seeded.kernel.appPort(CALLER).surface({ scope: WS, readOnly: true });
		expect((await embed.call(RESET, {})).error?.code).toBe('EMBED_READ_ONLY');
		expect((await embed.call(ADD, { by: 1 })).error).toEqual(callNotGranted());
	});

	it('P5-B1: restores a confirmed apps call’s trace, as an agent’s (L2)', () => {
		const traces = createTraces();
		const trace = { session: 'cps_00000000000000c6', turn: 1, call: 'cpc_0001' } as never;
		expect(traces.of('apps', undefined, { confirmation: 'ntf_1', trace })).toBe(trace);
		expect(traces.of('palette', undefined, { confirmation: 'ntf_1', trace })).toBeUndefined();
		expect(traces.of('apps', trace, {})).toBeUndefined();
	});

	it('P5-B1: replays apps entries and their refusals with no difference', async () => {
		const made = await base();
		await made.kernel.appPort(CALLER).call(READ, {});
		await made.kernel.appPort('hello').call(ADD, {});
		await made.kernel.appPort('mailfixapp').call('mailfixapp-thread-peek', { thread: 'thr_1' });
		const journal = await made.journal.read();
		expect(journal.some((entry) => entry.contextDigest.interface === 'apps')).toBe(true);
		const { report } = await replayKernel(journal, {
			...(made.deployment ? { deployment: made.deployment } : {}),
			...(made.ports ? { ports: made.ports } : {}),
		});
		expect(report.diverged).toBe(false);
		for (const entry of report.entries) expect(entry.status, entry.command).not.toBe('different');
	});
});
