/**
 * Phase 4's overlays I (its 6.1 to 6.7, P4-E7's parts step 3 builds): toasts' `sticky` and `link`, the owner line,
 * agent toasts and their rate (F7), popovers on every path of 6.1's table, one per invoker, their anchors and menus,
 * and replay.
 */
import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { OverlayRefV1, OverlayResultV1, OverlayV1 } from '@lushly-dev/loam-sdk';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { PAGE_DECIDED } from './errors.js';
import { createKernel } from './kernel.js';
import { HUMAN_COMMANDS } from './late/identity-commands.js';
import { openerOf, ownerTitle } from './late/overlay-commands.js';
import { AGENT_PUSH_RATE, createPushRate, PUSH_WINDOW_MS } from './late/push-rate.js';
import { appOwner, createOverlayStore, landsInInbox, SHELL, TOAST_CAP } from './overlays.js';
import {
	createFixedEnvironment,
	createFixturePorts,
	PROBE_MANIFEST,
	probeDefinition,
	probeDeployment,
	replayKernel,
} from './testing.js';
import type { LoamKernelV5, OverlayAnchorsV1 } from './types.js';

const kernels: LoamKernelV5[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const sumsManifest = {
	...PROBE_MANIFEST,
	plugin: { ...PROBE_MANIFEST.plugin, id: 'sums', title: 'Sums', domains: ['sums'] },
	commands: [],
	grants: [],
	config: undefined,
	ui: { surfaces: { main: { element: 'sums-main' } } },
} as unknown as typeof PROBE_MANIFEST;

const entry = (instance: string) => ({ instance, app: instance, package: `apps/${instance}/` });

/**
 * A kernel with probe and sums, on a clock the test moves, and a page whose every anchor resolves unless the test gives
 * its own, or `null` for none at all.
 */
async function boot(options: { anchors?: OverlayAnchorsV1 | null } = {}) {
	let now = 1_800_000_000_000;
	const journal = new MemoryJournalSink();
	const auth = new MockAuthAdapter({ clock: { now: () => now } });
	const anchors = options.anchors === undefined ? { resolve: () => true } : options.anchors;
	const kernel = await createKernel({
		store: new MemoryAdapter(),
		storeKind: 'memory',
		journal,
		auth,
		environment: createFixedEnvironment(),
		host: 'test',
		clock: () => now,
		deployment: probeDeployment([entry('probe'), entry('sums')]),
		ports: createFixturePorts({
			'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
			'apps/sums/': { manifest: sumsManifest, definition: { sdk: 1, handlers: {} } as never },
		}),
		...(anchors ? { overlayAnchors: anchors } : {}),
	});
	kernels.push(kernel);
	await kernel.appsReady;
	return {
		kernel,
		journal,
		auth,
		probe: kernel.appPort('probe'),
		sums: kernel.appPort('sums'),
		advance: (ms: number) => {
			now += ms;
		},
	};
}

const list = async (kernel: LoamKernelV5) =>
	(await kernel.call<{ overlays: OverlayV1[] }>('overlay-list')).data?.overlays ?? [];

const info = (anchor = 'more', surface = 'main') => ({
	anchor: { surface, anchor },
	kind: 'info',
	body: 'Counts every report.',
});

describe('toasts (6.1, 6.4, 6.6)', () => {
	it("gives the shell's no owner line, an app's its title and an agent's its name, for the person", async () => {
		const { kernel, probe } = await boot();
		await kernel.call('toast-show', { message: 'Saved' });
		await probe.call('toast-show', { message: 'Counted' });
		const agent = await kernel.agent.call<OverlayRefV1>('toast-show', { message: 'Done' });
		expect(agent.data).toMatchObject({ owner: 'agent:shell-agent', kind: 'toast' });
		const [shell, app, agents] = await list(kernel);
		expect(shell).not.toHaveProperty('from');
		expect(app?.from).toEqual({ kind: 'app', title: expect.any(String) });
		expect(app?.owner).toBe('probe');
		expect(agents?.from).toEqual({ kind: 'agent', agent: 'shell-agent', person: null });
	});

	it('keeps sticky and a link, and refuses a link of another shape', async () => {
		const { kernel } = await boot();
		const link = { kind: 'document', document: 'doc_1', scope: { workspace: 'personal' } };
		await kernel.call('toast-show', { message: 'Kept', sticky: true, link });
		expect((await list(kernel))[0]?.input).toEqual({
			message: 'Kept',
			sticky: true,
			link,
			durationMs: 5000,
		});
		for (const bad of [
			{ kind: 'url', href: 'https://example.com', scope: { workspace: 'personal' } },
			{ kind: 'app', instance: 'probe', route: 'x', scope: { workspace: 'personal' } },
			{ ...link, extra: true },
		]) {
			const refused = await kernel.call('toast-show', { message: 'x', link: bad });
			expect(refused.error?.code).toBe('VALIDATION_ERROR');
		}
	});

	it('dismisses the oldest of any owner when a person or an app shows a sixth', async () => {
		const { kernel, probe } = await boot();
		for (let i = 0; i < TOAST_CAP; i++)
			await kernel.call('toast-show', { message: `${i}`, tone: 'danger' });
		await probe.call('toast-show', { message: 'sixth' });
		const shown = await list(kernel);
		expect(shown).toHaveLength(TOAST_CAP);
		expect(shown.map((overlay) => (overlay.input as { message: string }).message)).toEqual([
			'1',
			'2',
			'3',
			'4',
			'sixth',
		]);
	});

	it('returns detached records: changing one changes nothing the kernel holds', async () => {
		const { kernel } = await boot();
		await kernel.call('toast-show', { message: 'Saved' });
		const [first] = (await list(kernel)) as [OverlayV1];
		(first.input as { message: string }).message = 'Changed';
		const [again] = (await list(kernel)) as [OverlayV1];
		expect((again.input as { message: string }).message).toBe('Saved');
	});
});

describe('agent toasts (6.1, F7)', () => {
	it('allows five a minute per agent, then RATE_LIMITED with its details, journaled', async () => {
		const { kernel, journal, advance } = await boot();
		for (let i = 0; i < AGENT_PUSH_RATE; i++) {
			expect((await kernel.agent.call('toast-show', { message: `${i}` })).success).toBe(true);
			advance(1000);
		}
		const refused = await kernel.agent.call('toast-show', { message: 'sixth' });
		expect(refused.error).toMatchObject({
			code: 'RATE_LIMITED',
			retryable: true,
			details: { limit: 5, retryAfterMs: PUSH_WINDOW_MS - 5000 },
		});
		expect(refused.error?.suggestion).toContain('fixed');
		expect((await journal.read()).at(-1)?.result.error?.code).toBe('RATE_LIMITED');
		// The rate is the agent interface's, per person: another agent name the caller picks is refused all the same
		// (R-b), and a person has none.
		const renamed = await kernel.agent.call(
			'toast-show',
			{ message: 'other' },
			{ agent: 'helper' }
		);
		expect(renamed.error?.code).toBe('RATE_LIMITED');
		expect((await kernel.call('toast-show', { message: 'person' })).success).toBe(true);
		advance(PUSH_WINDOW_MS - 5000);
		expect((await kernel.agent.call('toast-show', { message: 'later' })).success).toBe(true);
	});

	it('never pushes off a shell or danger toast: refused when the region holds only those', async () => {
		const { kernel, probe } = await boot();
		for (let i = 0; i < 3; i++) await kernel.call('toast-show', { message: `shell ${i}` });
		await probe.call('toast-show', { message: 'app error', tone: 'danger', durationMs: 8000 });
		await probe.call('toast-show', { message: 'app note' });
		const evicted = await kernel.agent.call<OverlayRefV1>('toast-show', { message: 'agent' });
		expect(evicted.success).toBe(true);
		const shown = await list(kernel);
		expect(shown.map((overlay) => (overlay.input as { message: string }).message)).toEqual([
			'shell 0',
			'shell 1',
			'shell 2',
			'app error',
			'agent',
		]);
		// The agent's own toast is neither the shell's nor danger, so a second pushes off the first.
		expect((await kernel.agent.call('toast-show', { message: 'agent 2' })).success).toBe(true);
		const danger = await kernel.agent.call('toast-show', { message: 'agent 3', tone: 'danger' });
		expect(danger.success).toBe(true);
		const full = await kernel.agent.call('toast-show', { message: 'agent 4' });
		expect(full.error?.code).toBe('RATE_LIMITED');
		expect(full.error?.details).toEqual({ limit: 5, retryAfterMs: 5000 });
		expect(await list(kernel)).toHaveLength(TOAST_CAP);
	});

	it('waits a minute when every toast on screen is sticky', async () => {
		const { kernel } = await boot();
		for (let i = 0; i < TOAST_CAP; i++)
			await kernel.call('toast-show', { message: `${i}`, sticky: true });
		const refused = await kernel.agent.call('toast-show', { message: 'agent' });
		expect(refused.error?.details).toEqual({ limit: 5, retryAfterMs: 60_000 });
	});
});

describe('popover-open on each path of 6.1', () => {
	it("opens a person's as the shell's, anchored in the shell's own surface", async () => {
		const { kernel } = await boot();
		const opened = await kernel.call<OverlayRefV1>('popover-open', info('bell', 'shell'));
		expect(opened.data).toEqual({
			overlayId: 'ovl-1',
			owner: 'shell',
			kind: 'popover',
			lifetime: 'transient',
		});
		expect((await list(kernel))[0]).not.toHaveProperty('from');
		const elsewhere = await kernel.call('popover-open', info('bell', 'main'));
		expect(elsewhere.error?.code).toBe('OVERLAY_ANCHOR_NOT_FOUND');
		expect(elsewhere.error?.details).not.toHaveProperty(PAGE_DECIDED);
	});

	it("opens the active app's as its own, with its owner line", async () => {
		const { kernel, probe } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const opened = await probe.call<OverlayRefV1>('popover-open', info());
		expect(opened.data?.owner).toBe('probe');
		expect((await list(kernel))[0]?.from).toEqual({ kind: 'app', title: expect.any(String) });
		const shellSurface = await probe.call('popover-open', info('bell', 'shell'));
		expect(shellSurface.error?.code).toBe('OVERLAY_ANCHOR_NOT_FOUND');
	});

	it("refuses an inactive app's OVERLAY_OWNER_INACTIVE and the agent's HUMAN_REQUIRED", async () => {
		const { kernel, probe, journal } = await boot();
		await kernel.call('app-open', { instance: 'sums' });
		expect((await probe.call('popover-open', info())).error?.code).toBe('OVERLAY_OWNER_INACTIVE');
		const agent = await kernel.agent.call('popover-open', info('bell', 'shell'));
		expect(agent.error).toMatchObject({ code: 'HUMAN_REQUIRED', retryable: false });
		expect(agent.error?.suggestion).toContain('toast-show');
		expect((await journal.read()).at(-1)?.result.error?.code).toBe('HUMAN_REQUIRED');
		expect(await list(kernel)).toHaveLength(0);
	});

	it('refuses an anchor that does not match its pattern, or a surface outside the list', async () => {
		const { kernel } = await boot();
		for (const anchor of ['', 'a b', '"]', 'x'.repeat(65)]) {
			const refused = await kernel.call('popover-open', info(anchor, 'shell'));
			expect(refused.error?.code).toBe('VALIDATION_ERROR');
		}
		expect((await kernel.call('popover-open', info('x', 'rail'))).error?.code).toBe(
			'VALIDATION_ERROR'
		);
	});
});

describe('a menu popover (6.4)', () => {
	const menu = (items: unknown[], surface = 'main') => ({
		anchor: { surface, anchor: 'more' },
		kind: 'menu',
		label: 'More',
		items,
	});

	it("offers only the owner's own palette commands, and never a person's or an owner's", async () => {
		const { kernel, probe } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const own = await probe.call(
			'popover-open',
			menu([{ command: 'probe-count', label: 'Count' }])
		);
		expect(own.success).toBe(true);
		for (const command of ['layout-reset', 'sums-add', 'nothing-here', HUMAN_COMMANDS[0]]) {
			const refused = await probe.call('popover-open', menu([{ command, label: 'X' }]));
			expect(refused.error?.code, command).toBe('OVERLAY_ITEM_RESERVED');
			expect(refused.error?.suggestion).toBe('Let the person run it from the palette');
		}
		// One the palette does not list (`expose.palette: false`) is not offered either.
		const hidden = await probe.call(
			'popover-open',
			menu([{ command: 'probe-hidden', label: 'X' }])
		);
		expect(hidden.error?.code).toBe('OVERLAY_ITEM_RESERVED');
		expect(hidden.error?.message).toContain('palette');
		const shellMenu = await kernel.call(
			'popover-open',
			menu([{ command: 'layout-reset', label: 'Reset the layout' }], 'shell')
		);
		expect(shellMenu.success).toBe(true);
		// An item's input is checked against its command's schema when the popover opens.
		const invalid = await kernel.call(
			'popover-open',
			menu(
				[
					{ command: 'layout-reset', label: 'Reset' },
					{ command: 'app-open', label: 'Open' },
				],
				'shell'
			)
		);
		expect(invalid.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			details: { item: 1, command: 'app-open' },
		});
		for (const command of ['probe-count', 'app-call-refuse', HUMAN_COMMANDS[0]]) {
			const refused = await kernel.call('popover-open', menu([{ command, label: 'X' }], 'shell'));
			expect(refused.error?.code, command).toBe('OVERLAY_ITEM_RESERVED');
		}
	});

	it('records the picked item on confirm, and refuses an item it does not have', async () => {
		const { kernel } = await boot();
		const items = [
			{ command: 'layout-reset', label: 'Reset' },
			{ command: 'palette-open', label: 'Open the palette' },
		];
		const opened = await kernel.call<OverlayRefV1>('popover-open', menu(items, 'shell'));
		const overlayId = opened.data?.overlayId as string;
		for (const input of [
			{ overlayId, item: 2, result: 'confirm' },
			{ overlayId, item: 1 },
		]) {
			expect((await kernel.call('overlay-dismiss', input)).error?.code).toBe('VALIDATION_ERROR');
		}
		const picked = await kernel.call<OverlayResultV1>('overlay-dismiss', {
			overlayId,
			result: 'confirm',
			item: 1,
		});
		expect(picked.data).toEqual({ overlayId, result: 'confirm', reason: 'user', value: 1 });
		const toast = await kernel.call<OverlayRefV1>('toast-show', { message: 'x' });
		const onToast = await kernel.call('overlay-dismiss', {
			overlayId: toast.data?.overlayId,
			result: 'confirm',
			item: 0,
		});
		expect(onToast.error?.code).toBe('VALIDATION_ERROR');
	});
});

describe('popovers: one per invoker, closed on a switch (6.1, 6.2)', () => {
	it('keeps one popover on screen: a new one replaces any other with reason replaced', async () => {
		const { kernel, probe } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const first = await probe.call<OverlayRefV1>('popover-open', info());
		const waited = probe.waitOverlay(first.data?.overlayId as string);
		const second = await probe.call<OverlayRefV1>('popover-open', info('other'));
		const shells = await kernel.call<OverlayRefV1>('popover-open', info('bell', 'shell'));
		await expect(waited).resolves.toEqual({
			overlayId: first.data?.overlayId,
			result: 'dismissed',
			reason: 'replaced',
		});
		await expect(probe.waitOverlay(second.data?.overlayId as string)).resolves.toMatchObject({
			reason: 'replaced',
		});
		expect((await list(kernel)).map((overlay) => overlay.overlayId)).toEqual([
			shells.data?.overlayId,
		]);
	});

	it("closes a shell popover when the first app opens from a shell section (the review's 7)", async () => {
		const { kernel } = await boot();
		await kernel.call('popover-open', info('bell', 'shell'));
		expect((await kernel.call('app-open', { instance: 'probe' })).success).toBe(true);
		expect(await list(kernel)).toEqual([]);
	});

	it('closes a popover the page lost its anchor for with reason anchor, never as the person', async () => {
		const { kernel } = await boot();
		const opened = await kernel.call<OverlayRefV1>('popover-open', info('bell', 'shell'));
		const closed = await kernel.call<OverlayResultV1>('overlay-dismiss', {
			overlayId: opened.data?.overlayId,
			reason: 'anchor',
		});
		expect(closed.data).toEqual({
			overlayId: opened.data?.overlayId,
			result: 'dismissed',
			reason: 'anchor',
		});
	});

	it("closes every popover on an app switch, the shell's too, and keeps the shell's toasts", async () => {
		const { kernel, probe } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		await probe.call('popover-open', info());
		await kernel.call('popover-open', info('bell', 'shell'));
		await kernel.call('toast-show', { message: 'Stays' });
		await kernel.call('app-open', { instance: 'sums' });
		expect((await list(kernel)).map((overlay) => overlay.kind)).toEqual(['toast']);
	});
});

describe("the page's anchors (6.3)", () => {
	it('fails closed in a kernel given no anchors at all', async () => {
		const { kernel } = await boot({ anchors: null });
		const refused = await kernel.call('popover-open', info('bell', 'shell'));
		expect(refused.error?.code).toBe('OVERLAY_ANCHOR_NOT_FOUND');
	});

	it('resolves none until the chrome answers, then what it answers, as decided by the page', async () => {
		const anchors: OverlayAnchorsV1 = {};
		const { kernel, probe } = await boot({ anchors });
		await kernel.call('app-open', { instance: 'probe' });
		const early = await probe.call('popover-open', info());
		expect(early.error).toMatchObject({
			code: 'OVERLAY_ANCHOR_NOT_FOUND',
			suggestion: 'Set data-loam-anchor on the invoker',
			details: { surface: 'main', anchor: 'more', [PAGE_DECIDED]: true },
		});
		const asked: unknown[] = [];
		anchors.resolve = (owner, anchor) => {
			asked.push([owner, anchor]);
			return anchor.anchor === 'more';
		};
		expect((await probe.call('popover-open', info())).success).toBe(true);
		expect((await probe.call('popover-open', info('gone'))).error?.code).toBe(
			'OVERLAY_ANCHOR_NOT_FOUND'
		);
		expect(asked).toEqual([
			[
				{ kind: 'app', id: 'probe' },
				{ surface: 'main', anchor: 'more' },
			],
			[
				{ kind: 'app', id: 'probe' },
				{ surface: 'main', anchor: 'gone' },
			],
		]);
	});

	it('replays every move: the refusals the page decided come from the record', async () => {
		const anchors: OverlayAnchorsV1 = { resolve: (_owner, anchor) => anchor.anchor !== 'gone' };
		const { kernel, journal, advance } = await boot({ anchors });
		await kernel.call('popover-open', info('gone', 'shell'));
		const opened = await kernel.call<OverlayRefV1>('popover-open', info('bell', 'shell'));
		await kernel.call('popover-open', info('bell', 'shell'));
		await kernel.call('toast-show', { message: 'Saved', sticky: true });
		for (let i = 0; i <= AGENT_PUSH_RATE; i++) {
			await kernel.agent.call('toast-show', { message: `${i}` });
			advance(10);
		}
		await kernel.call('overlay-dismiss', { overlayId: opened.data?.overlayId });
		const { report } = await replayKernel(await journal.read(), {
			deployment: probeDeployment([entry('probe'), entry('sums')]),
			ports: createFixturePorts({
				'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
				'apps/sums/': { manifest: sumsManifest, definition: { sdk: 1, handlers: {} } as never },
			}),
		});
		expect(report.diverged).toBe(false);
		expect(report.same).toBe(report.entries.length);
		const codes = report.entries.map((each) => each.command);
		expect(codes.filter((name) => name === 'popover-open')).toHaveLength(3);
		expect(codes.filter((name) => name === 'toast-show')).toHaveLength(AGENT_PUSH_RATE + 2);
	});
});

describe('the push rate and the inbox seam', () => {
	it('counts per source over a sliding minute, and forgets on reset', () => {
		const rate = createPushRate();
		for (let at = 0; at < 3; at++) rate.record('agent:a', at * 100);
		expect(rate.retryAfter('agent:a', 3, 300)).toBe(PUSH_WINDOW_MS - 300);
		expect(rate.retryAfter('agent:a', 4, 300)).toBeUndefined();
		expect(rate.retryAfter('agent:b', 1, 300)).toBeUndefined();
		expect(rate.retryAfter('agent:a', 3, PUSH_WINDOW_MS + 1)).toBeUndefined();
		rate.reset();
		expect(rate.retryAfter('agent:a', 1, 300)).toBeUndefined();
	});

	it('lands a sticky toast always, and others as toastSticky selects', () => {
		expect(landsInInbox({ sticky: true }, 'never')).toBe(true);
		expect(landsInInbox({ tone: 'danger' })).toBe(true);
		expect(landsInInbox({ tone: 'info' })).toBe(false);
		expect(landsInInbox({ tone: 'info' }, 'always')).toBe(true);
		expect(landsInInbox({ tone: 'danger' }, 'never')).toBe(false);
	});

	it("reports the toasts a switch dismissed, and closes others' popovers with it", () => {
		const store = createOverlayStore();
		store.open(appOwner('probe'), 'toast', { message: 'a' });
		store.open(SHELL, 'popover', {
			anchor: { surface: 'shell', anchor: 'x' },
			kind: 'info',
			body: 'b',
		});
		store.open(SHELL, 'toast', { message: 'c' });
		expect(store.closeForSwitch('probe').map((overlay) => overlay.owner)).toEqual(['probe']);
		expect(store.list().map((overlay) => overlay.kind)).toEqual(['toast']);
	});
});

describe("whose an overlay is, by kind (the review's R-d)", () => {
	it('never takes an app instance named shell for the shell', () => {
		const store = createOverlayStore();
		const app = store.open(
			appOwner('shell'),
			'toast',
			{ message: 'an app named shell' },
			{
				from: { kind: 'app', title: 'Shell' },
			}
		);
		const own = store.open(
			SHELL,
			'toast',
			{ message: "the shell's" },
			{
				from: { kind: 'app', title: 'forged' },
			}
		);
		expect(store.ownerOf(app.overlayId)).toEqual({ kind: 'app', id: 'shell' });
		expect(store.ownerOf(own.overlayId)).toEqual({ kind: 'shell', id: 'shell' });
		expect(store.list('shell').map((overlay) => overlay.overlayId)).toEqual([app.overlayId]);
		// The shell's own never carries an owner line, whatever the caller passed.
		expect(store.get(own.overlayId)).not.toHaveProperty('from');
		store.closeForSwitch('shell');
		expect(store.list().map((overlay) => overlay.overlayId)).toEqual([own.overlayId]);
		const modal = store.open(appOwner('shell'), 'modal', { title: 'T', body: 'B' });
		expect(store.ownerOf(modal.overlayId)?.kind).toBe('app');
	});

	it('takes a port call as the app, the agent interface as the agent, and only a gesture as the shell', () => {
		const human = () => true;
		const nobody = () => false;
		expect(openerOf({ caller: 'shell', interface: 'palette' } as never, human)).toMatchObject({
			kind: 'app',
			owner: { kind: 'app', id: 'shell' },
		});
		expect(
			openerOf(
				{ interface: 'agent', actor: { kind: 'agent', id: 'helper', onBehalfOf: 'p1' } },
				human
			)
		).toMatchObject({ kind: 'agent', bucket: 'agents:p1', owner: { id: 'agent:helper' } });
		expect(
			openerOf(
				{ interface: 'agent', actor: { kind: 'agent', id: 'copilot', onBehalfOf: 'p1' } },
				human
			)
		).toMatchObject({ bucket: 'copilot:p1' });
		expect(openerOf({ interface: 'palette' }, human).kind).toBe('shell');
		expect(openerOf({ interface: 'mcp' } as never, nobody).kind).toBe('none');
	});

	it('refuses an agent named shell, loam or as an app is, and an agent confirm', async () => {
		const { kernel } = await boot();
		for (const agent of ['shell', 'loam', 'probe']) {
			const refused = await kernel.agent.call('toast-show', { message: 'x' }, { agent });
			expect(refused.error?.code, agent).toBe('AGENT_NAME_RESERVED');
		}
		const opened = await kernel.call<OverlayRefV1>('modal-open', { title: 'T', body: 'B' });
		const confirm = await kernel.agent.call('overlay-dismiss', {
			overlayId: opened.data?.overlayId,
			result: 'confirm',
		});
		expect(confirm.error?.code).toBe('HUMAN_REQUIRED');
		expect(
			(await kernel.agent.call('overlay-dismiss', { overlayId: opened.data?.overlayId })).success
		).toBe(true);
	});
});

describe("owner lines (6.6, the review's R-c and 8)", () => {
	it('names a duplicate title by its instance, and never a title that says Loam', () => {
		const apps = [
			{ instance: 'notes', title: 'Notes' },
			{ instance: 'notes2', title: 'notes' },
			{ instance: 'odd', title: 'Loam notes' },
			{ instance: 'ok', title: 'Loamy notes' },
		];
		expect(ownerTitle(apps, 'notes')).toBe('Notes (notes)');
		expect(ownerTitle(apps, 'odd')).toBe('odd');
		expect(ownerTitle(apps, 'ok')).toBe('Loamy notes');
		expect(ownerTitle(apps, 'gone')).toBe('gone');
	});

	it("shows the person's name, never an email, for an agent's toast", async () => {
		const { kernel, auth } = await boot();
		auth._setUser({ id: 'usr_ada', email: 'ada@example.com', name: 'ada@example.com' } as never);
		await kernel.agent.call('toast-show', { message: 'Done' });
		auth._setUser({ id: 'usr_ada', email: 'ada@example.com', name: 'Ada' } as never);
		await kernel.agent.call('toast-show', { message: 'Done again' });
		const shown = await list(kernel);
		expect(JSON.stringify(shown)).not.toContain('@');
		expect(shown.map((overlay) => overlay.from)).toEqual([
			{ kind: 'agent', agent: 'shell-agent', person: null },
			{ kind: 'agent', agent: 'shell-agent', person: 'Ada' },
		]);
	});
});

describe('a change of person closes every overlay (6.2)', () => {
	it("in local mode, on a sign-in and a sign-out, with reason person, the shell's sticky toast too", async () => {
		const { kernel, probe } = await boot();
		const sticky = await kernel.call<OverlayRefV1>('toast-show', {
			message: 'Stays',
			sticky: true,
		});
		const own = await probe.call<OverlayRefV1>('toast-show', { message: 'For whoever' });
		const waited = probe.waitOverlay(own.data?.overlayId as string);
		const signedIn = await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'ada@example.com',
			password: 'secret-password',
		});
		expect(signedIn.success).toBe(true);
		expect(await list(kernel)).toEqual([]);
		await expect(waited).resolves.toMatchObject({ reason: 'person' });
		expect(sticky.success).toBe(true);
		const next = await probe.call<OverlayRefV1>('toast-show', { message: 'For Ada' });
		const left = probe.waitOverlay(next.data?.overlayId as string);
		expect((await kernel.call('auth-sign-out', {})).success).toBe(true);
		await expect(left).resolves.toMatchObject({ reason: 'person' });
	});
});

describe("a journal recorded before step 3 (the review's 14)", () => {
	it("replays an agent's toast recorded as the shell's with one named difference, at data.owner", async () => {
		const { kernel, journal } = await boot();
		await kernel.agent.call('toast-show', { message: 'Done' });
		// As phase 1 to step 2 recorded it: an agent's toast was the shell's.
		const entries = (await journal.read()).map((entry) =>
			entry.command === 'toast-show'
				? {
						...entry,
						result: { ...entry.result, data: { ...(entry.result.data as object), owner: 'shell' } },
					}
				: entry
		);
		await expect(
			replayKernel(entries, {
				deployment: probeDeployment([entry('probe'), entry('sums')]),
				ports: createFixturePorts({
					'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
					'apps/sums/': { manifest: sumsManifest, definition: { sdk: 1, handlers: {} } as never },
				}),
			})
		).rejects.toMatchObject({
			code: 'REPLAY_DIVERGED',
			details: { firstDifference: { command: 'toast-show', difference: { path: 'data.owner' } } },
		});
	});
});
