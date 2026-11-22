/**
 * @fileoverview Two pieces of the kernel's dispatch for phase 5's step 4, kept out of `kernel.ts`:
 *
 * - **The app-call registry** (phase 5 specification, 7.5): a mounted command an entry lets apps call carries a twin
 *   exposed to the palette's interface (`apps/mounted.ts`), registered only on a registry an app port's call reaches
 *   (`fields.caller`), so `expose.apps` widens neither the person's palette nor an agent's reach. A stopgap until
 *   milestone B runs app calls through AFD's `createAppCallRegistry`.
 * - **The copilot's traces** (3.2, 5.3): by trace ID while a call runs, and the traced calls that have ended, so a
 *   handler's client kept past its call is refused rather than run untraced.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { DirectCommandRegistry } from '@lushly-dev/afd-server/direct';
import type { CopilotTraceV1 } from './copilot/types.js';
import { kernelFailure } from './errors.js';

/** The kernel's registries: one per interface, `boot`'s, and the app-call registry when an entry lets apps call. */
export type KernelRegistries = Record<'palette' | 'agent' | 'boot', DirectCommandRegistry> & {
	apps?: DirectCommandRegistry;
};

/** A mounted definition's twin on the app-call registry, by `Symbol.for`, so this module imports nothing of `apps/`. */
const APPS_TWIN = Symbol.for('dev.loam/apps-twin');

/** The commands with each twin in its place, or undefined when no command has one. */
export function appCallTwins<T extends object>(commands: readonly T[]): T[] | undefined {
	const twins = commands.map(
		(command) => ((command as Record<symbol, unknown>)[APPS_TWIN] ?? command) as T
	);
	return twins.some((twin, index) => twin !== commands[index]) ? twins : undefined;
}

/** The registry a call runs on: an app port's palette call reaches the app-call registry when there is one. */
export function registryFor(
	registries: KernelRegistries,
	iface: 'palette' | 'agent',
	caller: unknown
): DirectCommandRegistry {
	return (
		(iface === 'palette' && caller !== undefined ? registries.apps : undefined) ?? registries[iface]
	);
}

/** The copilot's traces by trace ID, and the traced calls that have ended (B12). */
export function createTraces() {
	const live = new Map<string, CopilotTraceV1>();
	const ended = new Set<string>();
	return {
		/**
		 * A call's trace: from the agent port's minted options alone (`minted`), else, for the shell's run of a copilot
		 * call a person confirmed (a kernel path with a confirmation id), the trace its confirmation stored, else the
		 * outer call's, which a nested call carries. A caller's own `trace` is never read.
		 */
		of(
			iface: string,
			minted: CopilotTraceV1 | undefined,
			fields: { parent?: string; confirmation?: unknown; trace?: CopilotTraceV1 }
		): CopilotTraceV1 | undefined {
			if (iface === 'agent' && minted !== undefined) return minted;
			if (
				iface === 'agent' &&
				typeof fields.confirmation === 'string' &&
				fields.trace !== undefined
			)
				return fields.trace;
			return fields.parent !== undefined ? live.get(fields.parent) : undefined;
		},
		set: (traceId: string, trace: CopilotTraceV1) => void live.set(traceId, trace),
		/** A call naming `parent` after its traced call ended: `CALL_ABORTED`, never run untraced. */
		refusal: (parent: string): CommandResult<never> | undefined =>
			ended.has(parent)
				? kernelFailure(
						'CALL_ABORTED',
						'The call this client was made for has ended',
						'Make the call inside the handler, before it returns'
					)
				: undefined,
		end(traceId: string) {
			if (!live.delete(traceId)) return;
			ended.add(traceId);
			if (ended.size > 4_096) ended.delete(ended.values().next().value as string);
		},
	};
}
