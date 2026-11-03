/**
 * @fileoverview The store functions of the workspace and project tables (phase 2 specification, 4):
 * every record carries its workspace, the actor that wrote it and its timestamps, and a write without
 * them is refused (architecture section 7). Each writes through to the first-paint cache.
 */

import type { DataAdapter } from '@lushly-dev/local-db';
import { LoamKernelError } from '../errors.js';
import { createRecordCache, type RecordCache } from '../scope/cache.js';
import {
	PROJECT_TABLE,
	type ProjectV1,
	WORKSPACE_APP_TABLE,
	WORKSPACE_TABLE,
	type WorkspaceAppV1,
	type WorkspaceV1,
} from '../scope/records.js';
import type { ScopeRuntime } from '../scope/runtime.js';

/** What every stored record of these tables carries. */
interface Stamped {
	id: string;
	workspace?: string;
	updatedAt: number;
	updatedBy: string;
}

/**
 * Refuse a record with no workspace, no actor or no time, before it reaches the adapter (E10).
 *
 * @throws LoamKernelError `VALIDATION_ERROR`
 */
export function checkStamped(table: string, record: Stamped): void {
	const missing = [
		...(table === WORKSPACE_TABLE || typeof record.workspace === 'string' ? [] : ['workspace']),
		...(typeof record.updatedBy === 'string' && record.updatedBy !== '' ? [] : ['updatedBy']),
		...(Number.isFinite(record.updatedAt) ? [] : ['updatedAt']),
	];
	if (missing.length > 0) {
		throw new LoamKernelError({
			code: 'VALIDATION_ERROR',
			message: `A ${table} record needs ${missing.join(', ')}`,
			suggestion: 'Write records through the shell commands, which fill these from the call',
			details: { table, missing },
		});
	}
}

export interface ShellStores {
	/** The workspace row, read once from the store: only late commands use it, so first paint holds none. */
	workspace(): Promise<WorkspaceV1 | undefined>;
	putWorkspace(record: WorkspaceV1): Promise<void>;
	putWorkspaceApp(record: WorkspaceAppV1): Promise<void>;
	putProject(record: ProjectV1): Promise<void>;
}

export function createShellStores(store: DataAdapter, scope: ScopeRuntime): ShellStores {
	const workspaces = createRecordCache<WorkspaceV1>(WORKSPACE_TABLE);
	let loading: Promise<void> | undefined;
	async function put<T extends Stamped>(
		table: string,
		record: T,
		cache: RecordCache<T>
	): Promise<void> {
		checkStamped(table, record);
		// A batch's PUT upserts; `update` does so only in the adapter's named tables.
		const { summary } = await store.batch([
			{ method: 'PUT', path: `/${table}/${encodeURIComponent(record.id)}`, body: record },
		]);
		if (summary.failed > 0) throw new Error(`The store could not write '${record.id}'`);
		cache.put(record);
	}
	return {
		async workspace() {
			loading ??= workspaces.load(store);
			await loading;
			return workspaces.get(scope.workspace.id);
		},
		putWorkspace: (record) => put(WORKSPACE_TABLE, record, workspaces),
		putWorkspaceApp: (record) => put(WORKSPACE_APP_TABLE, record, scope.workspaceApps),
		putProject: (record) => put(PROJECT_TABLE, record, scope.projects),
	};
}
