/**
 * @fileoverview Two pieces of the kernel's dispatch, kept out of `kernel.ts`:
 *
 * - **The registry a call runs on** (phase 5 specification, 9.1): one per interface, `boot`'s, and the `apps`
 *   registry, AFD's `createAppCallRegistry`, which the `apps` chunk builds on the first app-to-app call after each
 *   change of commands, so first paint holds none of it. Every app call to another app's command runs there, with
 *   `interface: 'apps'`, and is refused AFD's fixed `CALL_NOT_GRANTED` before lookup unless the command sets
 *   `expose.apps` and `call-grant.ts`'s rule holds.
 * - **The copilot's traces** (3.2, 5.3): by trace ID while a call runs, and the traced calls that have ended, so a
 *   handler's client kept past its call is refused rather than run untraced.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { DirectCommandRegistry } from '@lushly-dev/afd-server/direct';
import type { CopilotTraceV1 } from './copilot/types.js';
import { kernelFailure } from './errors.js';

/** The kernel's registries: one per interface and `boot`'s; `apps` once an app has called another app's command. */
export type KernelRegistries = Record<'palette' | 'agent' | 'boot', DirectCommandRegistry> & {
	apps?: DirectCommandRegistry;
};

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
			// A confirmed re-run of the copilot's call, or of an app's call to another app made under its trace (9.1's step
			// 4, L2): the trace its confirmation stored, so a tainted session stays tainted.
			if (
				(iface === 'agent' || iface === 'apps') &&
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
