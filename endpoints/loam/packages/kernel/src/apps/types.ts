/**
 * @fileoverview What `apps/` is given by the kernel that loads it: a seam, so this chunk reaches the
 * registries, the journal and the shell state only through trusted functions (phase 1 specification,
 * 9.1).
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import type { ProjectionV1 } from '@lushly-dev/loam-manifest';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { AppCommandRowV1, CommandOwner } from '../apps-runtime.js';
import type { KernelCallFields } from '../context-fields.js';
import type { LoamKernelErrorCode } from '../errors.js';
import type { OverlayStore } from '../overlays.js';
import type { ShellState } from '../shell-state.js';
import type { CallOptionsV1, KernelPortsV1 } from '../types.js';

export interface AppsHost {
	deployment: ProjectionV1;
	/** Absent when the host gave none: each app is then refused, and not the kernel. */
	ports?: KernelPortsV1;
	store: DataAdapter;
	/** Every command name the shell and `options.commands` hold. */
	taken: ReadonlySet<string>;
	state: ShellState;
	viewState: ViewStateRegistry;
	overlays: OverlayStore;
	owners(): ReadonlyMap<string, CommandOwner>;
	isMutation(name: string): boolean;
	/** The palette registry's commands of `instance`. */
	commandRows(instance: string): AppCommandRowV1[];
	/** Run a command on the palette registry with fields set by trusted code. */
	runAs<T>(
		name: string,
		input: unknown,
		options: CallOptionsV1 | undefined,
		fields: KernelCallFields
	): Promise<CommandResult<T>>;
	clock(): number;
}

/** What a frame's refused request answers with. */
export interface HandlerRefusal {
	code: LoamKernelErrorCode;
	rpcCode: number;
	message: string;
	suggestion: string;
}
