/**
 * @fileoverview Kernel interface version 0 (phase 0 specification, 6.2): the only surface the
 * chrome binds to. The SDK wraps it in phase 1.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import type { CommandResult, JournalSink } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { DataAdapter } from '@lushly-dev/local-db';

export const KERNEL_INTERFACE_VERSION = 0;

export interface LoamKernelV0 {
	readonly version: 0;
	call<T = unknown>(
		name: string,
		input?: unknown,
		options?: CallOptionsV0
	): Promise<CommandResult<T>>;
	listCommands(): CommandSummaryV0[];
	subscribe(listener: (event: KernelEventV0) => void): () => void;
	readonly agent: Pick<LoamKernelV0, 'call' | 'listCommands'>;
	dispose(): Promise<void>;
}

export interface CallOptionsV0 {
	signal?: AbortSignal;
}

export interface CommandSummaryV0 {
	name: string;
	title?: string;
	description: string;
	mutation: boolean;
	needsInput: boolean;
	keybinding?: string;
}

export interface KernelEventV0 {
	command: string;
	interface: 'palette' | 'agent';
	success: boolean;
	mutation: boolean;
	seq?: number;
}

export interface KernelEnvironmentV0 {
	matches(query: string): boolean;
	onChange(query: string, listener: () => void): () => void;
}

export interface KernelOptionsV0 {
	store: DataAdapter;
	storeKind: 'memory' | 'indexeddb';
	journal: JournalSink;
	auth: AuthAdapter;
	environment: KernelEnvironmentV0;
	host: 'browser' | 'desktop' | 'hosted' | 'test';
	commands?: ZodCommandDefinition[];
	clock?: () => number;
	random?: () => number;
}

/** What `shell-info-get` returns. */
export interface ShellInfoV0 {
	kernelInterface: 0;
	layoutState: 0;
	storeInterface: 0;
	tokenContract: 1;
	host: KernelOptionsV0['host'];
	store: KernelOptionsV0['storeKind'];
}
