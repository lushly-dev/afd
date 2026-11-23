import type { JobDriver, JobDriverResult } from '../plugin.js';
import type {
	JobScenario,
	ResolvedJobCapture,
	SpecimenContext,
	SpecimenEntry,
	Target,
} from '../types.js';
import { installPinnedClock, type PinnedClockController } from './clock.js';
import type { InstalledPlugins } from './plugins.js';

type PendingBridgeCall = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
};

let nextBridgeId = 1;
const pendingBridge = new Map<number, PendingBridgeCall>();
let bridgeInstalled = false;
let pinnedClock: PinnedClockController | undefined;

export function pinClock(iso: string): void {
	pinnedClock?.restore();
	pinnedClock = installPinnedClock(iso);
}

export function advanceClock(ms: number): void {
	if (!pinnedClock) throw new Error('Cannot advance clock when pin.clock is not active.');
	pinnedClock.advance(ms);
}

export function withRealTimers<T>(fn: () => Promise<T>): Promise<T> {
	return pinnedClock ? pinnedClock.withRealTimers(fn) : fn();
}

export function disposeJobRuntime(): void {
	for (const waiter of pendingBridge.values()) {
		waiter.reject(new Error('Specimen disposed before job bridge replied.'));
	}
	pendingBridge.clear();
	pinnedClock?.restore();
	pinnedClock = undefined;
}

function ensureJobBridge(): void {
	if (bridgeInstalled) return;
	bridgeInstalled = true;
	(
		window as unknown as {
			__specimenJobDone?: (id: number, error: string | null, value?: unknown) => void;
		}
	).__specimenJobDone = (id, error, value) => {
		const entry = pendingBridge.get(id);
		if (!entry) return;
		pendingBridge.delete(id);
		if (error) entry.reject(new Error(error));
		else entry.resolve(value);
	};
}

function callJobBridge(
	token: string,
	op: string,
	payload: Record<string, unknown>
): Promise<unknown> {
	ensureJobBridge();
	const binding = (window as unknown as { __specimenJob?: (msg: string) => void }).__specimenJob;
	if (typeof binding !== 'function') {
		return Promise.reject(
			new Error('The Specimen host job bridge is not attached for this render.')
		);
	}
	const id = nextBridgeId++;
	return new Promise((resolve, reject) => {
		pendingBridge.set(id, { resolve, reject });
		binding(JSON.stringify({ id, token, op, ...payload }));
	});
}

function resolveJobDrivers(
	registry: InstalledPlugins
): Map<string, { plugin: string; driver: JobDriver }> {
	const drivers = new Map<string, { plugin: string; driver: JobDriver }>();
	for (const plugin of registry.plugins) {
		for (const [name, driver] of Object.entries(plugin.jobDrivers ?? {})) {
			const existing = drivers.get(name);
			if (existing) {
				throw new Error(
					`Job driver '${name}' is registered by '${existing.plugin}' and '${plugin.id}'.`
				);
			}
			if (typeof driver?.run !== 'function') {
				throw new Error(`Job driver '${name}' of plugin '${plugin.id}' has no run function.`);
			}
			drivers.set(name, { plugin: plugin.id, driver });
		}
	}
	return drivers;
}

export async function executeJobDriver(
	registry: InstalledPlugins,
	element: Element,
	entry: SpecimenEntry,
	context: SpecimenContext,
	payload: {
		driver: string;
		targets: Record<string, Target>;
		scenario: JobScenario;
		capturePlan: ResolvedJobCapture[];
		bridgeToken: string;
	},
	signal: AbortSignal,
	settle: () => Promise<void>
): Promise<JobDriverResult> {
	const jobDrivers = resolveJobDrivers(registry);
	const registered = jobDrivers.get(payload.driver);
	if (!registered) {
		const available = [...jobDrivers.keys()];
		throw new Error(
			`No job driver '${payload.driver}' is registered${available.length ? `; installed drivers: ${available.join(', ')}` : ''}.`
		);
	}
	const token = payload.bridgeToken;
	ensureJobBridge();
	return registered.driver.run({
		element,
		targets: payload.targets,
		entry,
		context,
		scenario: payload.scenario,
		capturePlan: payload.capturePlan,
		signal,
		async runCommand(runner, target, name, input) {
			return callJobBridge(token, 'command', { runner, target, name, input });
		},
		async runActions(actions) {
			let count = 0;
			for (const item of actions) {
				await callJobBridge(token, 'action', { action: item.action });
				count++;
			}
			return count;
		},
		async captureStep(args) {
			await settle();
			const res = (await callJobBridge(token, 'capture', {
				key: args.key,
				name: args.name,
				step: args.step,
				...(args.description !== undefined ? { description: args.description } : {}),
				...(args.actions !== undefined ? { actions: args.actions } : {}),
			})) as { screenshot?: string | null } | null;
			return { screenshot: res?.screenshot ?? null };
		},
		advanceClock,
	});
}
