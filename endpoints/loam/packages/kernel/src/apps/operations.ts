/**
 * @fileoverview What the app commands do once a deployment is loaded (phase 1 specification, 9.1 and
 * section 8), and the two internal commands the port refuses through, in the lazy chunk.
 */

import { type CommandError, type CommandResult, failure, success } from '@lushly-dev/afd-core';
import { defineCommand, type ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { ManifestRefusal, ManifestV1, ProjectionAppV1 } from '@lushly-dev/loam-manifest';
import { z } from 'zod';
import { type AppCommandRowV1, type AppsRuntime, unknownApp } from '../apps-runtime.js';
import { kernelFailure, LoamKernelError } from '../errors.js';
import { appLayoutId } from '../layout.js';
import { SHELL_OWNER } from '../overlays.js';
import type {
	AppDetailV1,
	AppInstanceV1,
	AppKindV1,
	AppPortV1,
	AppStateV1,
	AppSummaryV2,
} from '../types.js';
import { boundRecorded, type MountedHost } from './mounted.js';
import type { AppsHost } from './types.js';

/** One entry of the deployment, whatever became of it. */
export interface AppRecord {
	readonly instance: string;
	readonly app: string;
	readonly kind: AppKindV1;
	readonly title: string;
	readonly icon: string;
	readonly order: number;
	/** The levels it serves, and whether the rail lists it (phase 2 specification, 2.2). */
	readonly scopeLevels: Array<'workspace' | 'project'>;
	readonly rail: boolean;
	readonly entry: ProjectionAppV1;
	/** Absent when the manifest was refused or could not be read. */
	readonly manifest?: ManifestV1;
	port?: AppPortV1;
	/** A mounted `http` instance's discovery and calls. */
	mounted?: MountedHost;
	state: AppStateV1;
	error?: CommandError;
	readonly warnings: ManifestRefusal[];
	readonly notices: Array<{ code: string; message: string }>;
	/** The fields of `app-get` that a manifest fixes. */
	readonly detail: Pick<
		AppDetailV1,
		| 'version'
		| 'trust'
		| 'trustLine'
		| 'surfaces'
		| 'compositions'
		| 'grants'
		| 'contexts'
		| 'skills'
	>;
	/** Its commands' full names, empty when refused. */
	commands: readonly string[];
	/** The status items the manifest declares. */
	readonly statusItemIds: ReadonlySet<string>;
	/** Not persisted: `app-selection-set` sets it, and leaving the app clears it (4.4). */
	selection: string | null;
	readonly statusValues: Map<string, string>;
}

function summaryOf(record: AppRecord): AppSummaryV2 & { state: AppStateV1 } {
	return {
		instance: record.instance,
		app: record.app,
		title: record.title,
		kind: record.kind,
		icon: record.icon,
		order: record.order,
		state: record.state,
		...(record.error !== undefined ? { error: record.error } : {}),
		scopeLevels: [...record.scopeLevels],
		rail: record.rail,
		// No project is active until step 4, so only what serves the workspace can open.
		available: record.scopeLevels.includes('workspace'),
	};
}

/** A mounted record as `app-instance-list` reports it: never a location or a credential. */
function instanceOf(record: AppRecord, host: AppsHost): AppInstanceV1 {
	const { entry, mounted } = record;
	return {
		instance: record.instance,
		app: record.app,
		prefix: entry.prefix ?? record.manifest?.mount?.prefix ?? record.instance,
		audience: entry.audience ?? 'person',
		transport: entry.transport ?? record.manifest?.mount?.transport ?? 'http',
		state: record.state,
		commands: record.commands.length,
		hidden: record.commands.length - host.commandRows(record.instance).length,
		...(mounted?.reading.protocolVersion !== undefined
			? { protocolVersion: mounted.reading.protocolVersion }
			: {}),
		...(mounted?.reading.toolStrategy !== undefined
			? { toolStrategy: mounted.reading.toolStrategy }
			: {}),
		...(mounted?.reading.discoveredAt !== undefined
			? { discoveredAt: mounted.reading.discoveredAt }
			: {}),
		...(record.error !== undefined ? { error: record.error } : {}),
		warnings: [...record.warnings, ...(mounted?.reading.warnings ?? [])].map(
			({ code, message }) => ({ code, message })
		),
		notices: [...record.notices],
	};
}

type Operations = Omit<AppsRuntime, 'commands' | 'owners' | 'keybindings' | 'dispose'>;

/** A refused instance is not there to discover, and stays out of `startInstances`. */
const startable = (record: AppRecord): boolean =>
	record.kind === 'mounted' && record.state !== 'refused';

export function createOperations(
	records: ReadonlyMap<string, AppRecord>,
	host: AppsHost
): Operations {
	const { state, overlays } = host;

	/**
	 * Leave the active app (section 8): atomically and before the next app's surfaces render, its
	 * overlays close and its selection clears. A shell-owned modal stays and refuses the switch.
	 */
	function leaveActive(): CommandResult<never> | undefined {
		if (overlays.modalOpen()?.owner === SHELL_OWNER) {
			return kernelFailure(
				'OVERLAY_MODAL_BUSY',
				"The shell's modal is open, so the app cannot change",
				'Close the modal first',
				{ retryable: true }
			);
		}
		const previous = state.activeApp();
		if (previous !== null) {
			overlays.closeForSwitch(previous);
			const record = records.get(previous);
			if (record) record.selection = null;
		}
		return undefined;
	}

	return {
		port(instance) {
			const record = records.get(instance);
			if (record?.port) return record.port;
			throw new LoamKernelError(
				record
					? {
							code: 'APP_NOT_READY',
							message: `The app '${instance}' has no port: it is ${record.state}, with no commands`,
							suggestion: record.error?.suggestion ?? 'Fix the app',
						}
					: {
							code: 'APP_NOT_FOUND',
							message: `No app instance '${instance}' is deployed`,
							suggestion: 'List the instances with app-list',
						}
			);
		},
		reconcileLayouts() {
			for (const { instance } of records.values()) {
				const id = appLayoutId(instance);
				const layout = state.layoutOf(id);
				if (!layout) continue;
				const declared = state.declaredParts(id);
				const open = (['sidebar', 'inspector', 'panel'] as const).filter(
					(part) => !declared.has(part) && layout[part].open
				);
				const { drawer, sheet } = layout.compact;
				const closeDrawer = drawer !== null && !declared.has(drawer);
				const closeSheet = sheet && !declared.has('panel');
				if (open.length === 0 && !closeDrawer && !closeSheet) continue;
				host.viewState.set(id, {
					...Object.fromEntries(open.map((part) => [part, { open: false }])),
					...(closeDrawer || closeSheet
						? {
								compact: {
									...(closeDrawer ? { drawer: null } : {}),
									...(closeSheet ? { sheet: false } : {}),
								},
							}
						: {}),
				});
			}
		},
		mountedInstances: () =>
			[...records.values()].filter(startable).map((record) => record.instance),
		summaries: () =>
			[...records.values()]
				.sort((a, b) => a.order - b.order || (a.instance < b.instance ? -1 : 1))
				.map(summaryOf),
		detail(instance) {
			const record = records.get(instance);
			if (!record) return unknownApp(instance);
			return success({
				...summaryOf(record),
				...record.detail,
				warnings: [...record.warnings],
				notices: [...record.notices],
				statusItems: Object.fromEntries(record.statusValues),
			});
		},
		open(instance) {
			const record = records.get(instance);
			if (!record) return unknownApp(instance);
			const previous = state.activeApp();
			if (previous !== instance) {
				const refused = leaveActive();
				if (refused) return refused;
				record.selection = null;
				state.setActiveApp(instance);
			}
			return success(
				{ active: instance, previous },
				previous === null
					? { undoCommand: 'app-close', undoArgs: {} }
					: { undoCommand: 'app-open', undoArgs: { instance: previous } }
			);
		},
		close() {
			const previous = state.activeApp();
			if (previous !== null) {
				const refused = leaveActive();
				if (refused) return refused;
				state.setActiveApp(null);
			}
			return success(
				{ active: null, previous },
				previous === null ? {} : { undoCommand: 'app-open', undoArgs: { instance: previous } }
			);
		},
		commandList(instance) {
			const record = records.get(instance);
			if (!record) return unknownApp(instance);
			const commands: AppCommandRowV1[] = host.commandRows(instance).map((row) => {
				if (!record.mounted) return row;
				const approval = record.mounted.approvalOf(row.name);
				return { ...row, replay: 'recorded', ...(approval ? { approval } : {}) };
			});
			return success({ commands, hidden: record.commands.length - commands.length });
		},
		instances: () =>
			[...records.values()]
				.filter((record) => record.kind === 'mounted')
				.map((record) => instanceOf(record, host)),
		contextOf(name, input) {
			if (name === 'app-instance-refresh') {
				const asked = (input as { instance?: unknown } | null | undefined)?.instance;
				const record = typeof asked === 'string' ? records.get(asked) : undefined;
				return {
					replay: 'recorded',
					...(record?.kind === 'mounted' ? { app: record.app, instance: record.instance } : {}),
				};
			}
			const owner = host.owners().get(name);
			if (!owner) return {};
			return {
				app: owner.app,
				instance: owner.instance,
				...(owner.recorded ? { replay: 'recorded' } : {}),
			};
		},
		redact: boundRecorded,
		applyCatalog(instance, catalog) {
			records.get(instance)?.mounted?.applyCatalog(catalog);
		},
		async refreshInstance(instance) {
			const record = records.get(instance);
			if (record?.kind !== 'mounted') {
				return kernelFailure(
					'APP_NOT_FOUND',
					`No mounted instance '${instance}' is deployed`,
					'List the mounted instances with app-instance-list'
				);
			}
			if (record.mounted) return record.mounted.refresh();
			return failure(
				record.error ?? {
					code: 'MOUNT_TRANSPORT_UNAVAILABLE',
					message: 'This instance cannot be refreshed',
					suggestion: 'Use `http`, or the desktop or hosted lane.',
					retryable: false,
				}
			);
		},
		selection(instance) {
			const record = records.get(instance);
			return record ? success({ id: record.selection }) : unknownApp(instance);
		},
		resetSession() {
			for (const record of records.values()) {
				record.selection = null;
				record.statusValues.clear();
			}
		},
		setSelection(instance, id) {
			const record = records.get(instance);
			if (!record) return unknownApp(instance);
			const previous = record.selection;
			record.selection = id;
			return success(
				{ id },
				{ undoCommand: 'app-selection-set', undoArgs: { instance, id: previous } }
			);
		},
		setStatusItem(caller, id, value) {
			const record = caller === undefined ? undefined : records.get(caller);
			if (!record?.statusItemIds.has(id)) {
				return kernelFailure(
					'STATUS_ITEM_UNKNOWN',
					caller === undefined
						? 'Only the app that declares a status item may set it'
						: `The app '${caller}' declares no status item '${id}'`,
					'Declare the item under `ui.surfaces.status.items`, and set it from that app'
				);
			}
			record.statusValues.set(id, value);
			return success({ id, value });
		},
	};
}

const refuseInput = z.strictObject({ command: z.string().max(256) });

/** The commands the port refuses through, so a refusal reaches the journal (5.3). */
export function createRefusalCommands(): ZodCommandDefinition[] {
	return [
		defineCommand<typeof refuseInput, never>({
			name: 'app-call-refuse',
			description: 'Refuses a call an app may not make, so the refusal reaches the journal',
			category: 'app',
			mutation: false,
			executionTime: 'instant',
			input: refuseInput,
			async handler(input) {
				return kernelFailure(
					'CALL_NOT_GRANTED',
					`An app may not call '${input.command}'`,
					'An app calls its own commands and a fixed list of shell commands; the calls grant arrives in phase 5',
					{ details: { command: input.command } }
				);
			},
		}),
		defineCommand<typeof refuseInput, never>({
			name: 'app-modal-refuse',
			description: 'Refuses a modal from a view a person just closed one of, and journals it',
			category: 'app',
			mutation: false,
			executionTime: 'instant',
			input: refuseInput,
			async handler() {
				return kernelFailure(
					'OVERLAY_COOLDOWN',
					'A person just closed a modal of this view, so it cannot open another yet',
					'Ask again in a few seconds, or show a toast',
					{ retryable: true }
				);
			},
		}),
		defineCommand<typeof refuseInput, never>({
			name: 'app-nested-refuse',
			description: 'Refuses a mutation from inside a handler, so the refusal reaches the journal',
			category: 'app',
			mutation: false,
			executionTime: 'instant',
			input: refuseInput,
			async handler(input) {
				return kernelFailure(
					'NESTED_MUTATION_REFUSED',
					`A handler's nested call may only be a query, and '${input.command}' is a mutation (D68): its effect would run twice on replay`,
					"Do the mutation from the surface, or move it into this command's handler",
					{ details: { command: input.command } }
				);
			},
		}),
	] as unknown as ZodCommandDefinition[];
}
