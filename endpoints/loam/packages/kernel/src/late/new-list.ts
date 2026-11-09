/**
 * @fileoverview New (documents specification, 7): `new-list`, and the recents `document-create` keeps when
 * the New menu calls it with `recent: true`, in the view-state record `loam.new.recent`, in the `late` chunk.
 * What a person may create here: every template of each type whose levels hold the call's level, and each
 * `ui.new` entry whose levels hold it, of an app that can open here. `new-list` acts at the call's own scope,
 * which the middleware decides first (`AT_CALL_SCOPE`), so a restricted project answers as a missing one.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import {
	defineCommandWithSchema,
	success,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import type { ViewStateHandler, ViewStateRegistry } from '@lushly-dev/afd-view-state';
import type { NewItemV1 } from '@lushly-dev/loam-sdk';
import type { AppsRuntime } from '../apps-runtime.js';
import { callScope, EMPTY_INPUT_JSON, emptyInput } from '../boot-commands.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import type { DocumentCheck } from './document-types.js';
import { canOpen } from './main-state.js';

/** The recents record, read-only through `view-state-set` (scope and projects specification, 3.4). */
export const NEW_RECENT_ID = 'loam.new.recent';

/** How many distinct types and templates New keeps first (7). */
export const NEW_RECENT_MAX = 5;

/** One recent: a type and its template. */
type Recent = { type: string; template: string };

export interface NewDeps {
	viewState: ViewStateRegistry;
	scope: ScopeRuntime;
	apps(): AppsRuntime;
	check: DocumentCheck;
}

export interface NewParts {
	command: ZodCommandDefinition;
	/** `document-create`, which keeps a recent when called with `recent: true`. */
	recording(create: ZodCommandDefinition): ZodCommandDefinition;
	/** Registers the record and reads it, before anything writes it (scope and projects specification, 7.6). */
	read: Promise<void>;
}

export function createNewParts(deps: NewDeps): NewParts {
	const { viewState, scope, check } = deps;
	let recent: Recent[] = [];
	// A persisted record of any other shape is ignored, and what is held stays.
	const accept = (value: unknown) => {
		const items = (value as { items?: unknown } | null)?.items;
		if (
			Array.isArray(items) &&
			items.length <= NEW_RECENT_MAX &&
			items.every(
				(item) =>
					typeof item?.type === 'string' &&
					typeof item.template === 'string' &&
					Object.keys(item).length === 2
			)
		)
			recent = items;
	};
	viewState.register(NEW_RECENT_ID, {
		get: () => ({ items: recent.map((item) => ({ ...item })) }),
		set: accept,
		replace: accept,
	} as unknown as ViewStateHandler);
	const read = viewState.hydrateOne(NEW_RECENT_ID);
	const at = (type: string, template: string) =>
		recent.findIndex((held) => held.type === type && held.template === template);

	const command = defineCommandWithSchema<typeof emptyInput, { items: NewItemV1[] }>({
		name: 'new-list',
		description: "List what New creates at the call's scope, recents first",
		category: 'document',
		mutation: false,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler(_input, context) {
			await read;
			const here = callScope(context);
			const level = here.project === undefined ? 'workspace' : 'project';
			const apps = deps.apps();
			const rows: Array<[NewItemV1, { order: number; instance: string }]> = [];
			for (const type of check.types().types.values()) {
				if (type.scopeLevels.includes(level) && !check.opens(type, here)) {
					for (const { id, title } of type.templates) {
						rows.push([
							{
								kind: 'document',
								type: type.id,
								template: id,
								title,
								icon: type.icon,
								recent: at(type.id, id) >= 0,
							},
							apps.summaries().find((app) => app.instance === type.instance) as {
								order: number;
								instance: string;
							},
						]);
					}
				}
			}
			for (const app of apps.summaries()) {
				if (app.state !== 'ready' && app.state !== 'loading') continue;
				for (const { title, icon, command, scope_levels } of apps.port(app.instance).manifest.ui
					?.new ?? []) {
					if (
						(scope_levels ?? app.scopeLevels).includes(level) &&
						!canOpen(apps, scope, app.instance, here.project)
					)
						rows.push([{ kind: 'creator', instance: app.instance, command, title, icon }, app]);
				}
			}
			// Recents first, most recent first; then by the rail's order, `order` then the instance, each app's in
			// its manifest's order (phase 2 specification, 7.3). The sort is stable.
			const recency = ([item]: (typeof rows)[number]) =>
				item.kind === 'document' && item.recent ? at(item.type, item.template) : NEW_RECENT_MAX;
			rows.sort(
				(a, b) =>
					recency(a) - recency(b) ||
					a[1].order - b[1].order ||
					(a[1].instance < b[1].instance ? -1 : a[1].instance > b[1].instance ? 1 : 0)
			);
			return success({ items: rows.map(([item]) => item) });
		},
	});

	return {
		command: command as unknown as ZodCommandDefinition,
		read,
		recording: (create) => ({
			...create,
			async handler(input: unknown, context: CommandContext) {
				const result = (await create.handler(input, context)) as CommandResult<unknown>;
				const { type, template, recent: keep } = input as Recent & { recent?: boolean };
				const id = template ?? check.types().types.get(type)?.templates[0]?.id;
				if (result.success && keep && id !== undefined) {
					await read;
					viewState.set(NEW_RECENT_ID, {
						items: [
							{ type, template: id },
							...recent.filter((_, index) => index !== at(type, id)),
						].slice(0, NEW_RECENT_MAX),
					});
				}
				return result;
			},
		}),
	};
}
