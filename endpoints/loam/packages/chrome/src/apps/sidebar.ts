/**
 * @fileoverview A `list` or `tree` sidebar's lists (phase 1 specification, 4.2; phase 2 specification, 7.4):
 * one list, or for a dual-scope app in a project two groups, `In <project>` at the active scope and `In
 * <workspace>` at the workspace's, each a `region` with its heading. Each list keeps the scope it was made
 * in, so a read queued before a change of scope still reads there, and a change of scope marks it stale,
 * so a selection made in it is ignored (7.6). A `tree`'s rows are read by `readTree`.
 */

import type { LoamKernelV2 } from '@lushly-dev/loam-kernel';
import type { LoamList } from '../elements/list.js';
import type { MainStateV1 } from '../url-sync.js';
import { readTree } from './tree-reader.js';

type Sidebar = { shape: string; command?: string; title?: string };

/** The lists of an app's sidebar, made for `state`'s scope. */
export function sidebarLists(
	create: () => LoamList,
	sidebar: Sidebar,
	title: string,
	levels: readonly string[],
	state: MainStateV1
): LoamList[] {
	const dual = state.project !== null && levels.includes('workspace') && levels.includes('project');
	return (dual ? (['project', 'workspace'] as const) : [undefined]).map((level) => {
		const list = create();
		list.label = sidebar.title ?? title;
		list.busy = true;
		list.scope = state.scope as LoamList['scope'];
		if (level) {
			list.level = level;
			list.heading = `In ${level === 'project' ? state.project?.name : (state.workspace.name ?? state.workspace.id)}`;
		}
		return list;
	});
}

/** Read one list's command at its level, in the scope it was made in, and show the rows or the failure. */
export async function readSidebarList(
	kernel: LoamKernelV2,
	sidebar: Sidebar | undefined,
	list: LoamList
): Promise<void> {
	const command = sidebar?.command;
	if (command === undefined || list.stale) return;
	const result = await kernel.call<{ items: LoamList['items'] }>(
		command,
		{},
		list.level === 'workspace' || !list.scope ? { scope: 'workspace' } : { scope: list.scope }
	);
	if (list.stale) return;
	list.busy = false;
	if (result.success && sidebar?.shape === 'tree') {
		const read = readTree(result.data);
		list.failure = read.failure ?? null;
		list.items = read.failure ? [] : read.items;
		return;
	}
	if (result.success && Array.isArray(result.data?.items)) {
		list.failure = null;
		list.items = result.data.items;
		return;
	}
	list.failure = {
		message: result.error?.message ?? `${command} did not return { items }`,
		...(result.error?.suggestion !== undefined ? { suggestion: result.error.suggestion } : {}),
	};
}

/** The selection shows in the group of its level, and in no other (7.4). */
export function selectInLists(lists: readonly LoamList[], id: string | null, level: string): void {
	for (const list of lists)
		list.selected = list.level === undefined || list.level === level ? id : null;
}
