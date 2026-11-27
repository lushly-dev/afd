/**
 * @fileoverview Stage B's `workspace-deployment-apply` (phase 2 specification, 2.2, step 5), split from `late/index.ts`,
 * which re-exports it.
 */

import type { ShellStores } from '../scope/stores.js';

/** A projection as stage B keeps it in the workspace store (4.1). */
export interface AppliedProjection {
	generation: string;
	workspace: { id: string; name: string };
	apps: readonly object[];
	/** A version 4 projection's host (phase 6 specification, 3.3). */
	host?: { kind: 'static' | 'hosted' | 'desktop' };
}

/**
 * Stage B's own journaled work (phase 2 specification, 2.2, step 5): `workspace-deployment-apply` when
 * the generation differs from the workspace row's. An empty projection with no row does nothing, so an
 * empty shell's journal is unchanged. `run` is boot's own: `BOOT_FIELDS`, past the queue. True when the
 * store holds the projection's entries afterwards, so a workspace row may take its generation.
 */
export async function applyDeployment(
	stores: ShellStores,
	projection: AppliedProjection,
	run: (name: string, input: unknown) => Promise<{ success: boolean }>
): Promise<boolean> {
	const row = await stores.workspace();
	// A hosted one is applied even with no app, so its journal records the host a replay reads (phase 6's A5).
	const empty = projection.apps.length === 0 && projection.host?.kind !== 'hosted';
	if (row ? row.generation === projection.generation : empty) return true;
	const result = await run('workspace-deployment-apply', {
		generation: projection.generation,
		workspace: projection.workspace,
		entries: projection.apps.map((entry) => {
			const { boot: _boot, ...kept } = entry as { boot?: unknown };
			return kept;
		}),
		// The kind alone, journaled with the entries, so a replay reads it from this entry (phase 6's 3.3, A5).
		...(projection.host ? { host: { kind: projection.host.kind } } : {}),
	});
	return result.success;
}
