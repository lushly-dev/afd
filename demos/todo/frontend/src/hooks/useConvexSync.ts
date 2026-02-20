/**
 * @fileoverview Convex sync hook for background synchronization
 *
 * Syncs local store changes to Convex in the background.
 * Hydrates local store from Convex on initial load.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useConvexTodos } from './useConvexTodos';
import type { LocalStore } from './useLocalStore';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/** How often to sync pending operations to Convex */
const SYNC_INTERVAL_MS = 2000;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface UseConvexSyncResult {
	/** Whether the local store has been hydrated from Convex */
	isHydrated: boolean;
	/** Number of pending operations waiting to sync */
	pendingOperations: number;
	/** Force a sync now */
	syncNow: () => Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════════

export function useConvexSync(localStore: LocalStore): UseConvexSyncResult {
	const [isHydrated, setIsHydrated] = useState(false);
	const [pendingOperations, setPendingOperations] = useState(0);
	const syncInProgress = useRef(false);
	const hydrationDone = useRef(false);

	// Get Convex todos and mutations
	const {
		todos: convexTodos,
		create,
		update,
		toggle,
		remove,
		clearCompleted,
		batchToggle,
		batchDelete,
		isLoading,
	} = useConvexTodos();

	// Hydrate local store from Convex on initial load
	useEffect(() => {
		if (!isLoading && convexTodos && !hydrationDone.current) {
			hydrationDone.current = true;

			// Convert Convex todos to local format
			const localTodos = convexTodos.map((t) => ({
				id: t._id,
				title: t.title,
				description: t.description || '',
				priority: t.priority as 'low' | 'medium' | 'high',
				completed: t.completed,
				createdAt: t.createdAt,
				updatedAt: t.updatedAt,
			}));

			localStore.hydrate(localTodos);
			setIsHydrated(true);
		}
	}, [convexTodos, isLoading, localStore]);

	// Process pending operations
	const processPendingOps = useCallback(async () => {
		if (syncInProgress.current) return;

		const pendingOps = localStore.getPendingOperations();
		if (pendingOps.length === 0) {
			setPendingOperations(0);
			return;
		}

		setPendingOperations(pendingOps.length);
		syncInProgress.current = true;

		const processedIds: string[] = [];

		for (const op of pendingOps) {
			try {
				switch (op.type) {
					case 'create':
						if (op.data?.title) {
							const newConvexId = await create(op.data.title, {
								description: op.data.description,
								priority: op.data.priority,
							});
							// Replace local temp ID with Convex ID
							if (newConvexId && op.todoId) {
								localStore.updateTodoId(op.todoId, String(newConvexId));
							}
						}
						break;

					case 'update':
						if (op.todoId && op.data) {
							// Skip local-only IDs (not yet synced to Convex)
							if (!op.todoId.startsWith('local-')) {
								await update(op.todoId, op.data);
							}
						}
						break;

					case 'toggle':
						if (op.todoId && !op.todoId.startsWith('local-')) {
							await toggle(op.todoId);
						}
						break;

					case 'delete':
						if (op.todoId && !op.todoId.startsWith('local-')) {
							await remove(op.todoId);
						}
						break;

					case 'clearCompleted':
						await clearCompleted();
						break;

					case 'batchToggle':
						if (op.todoIds && op.data?.completed !== undefined) {
							const serverIds = op.todoIds.filter((id) => !id.startsWith('local-'));
							if (serverIds.length > 0) {
								await batchToggle(serverIds, op.data.completed);
							}
						}
						break;

					case 'batchDelete':
						if (op.todoIds) {
							const serverIds = op.todoIds.filter((id) => !id.startsWith('local-'));
							if (serverIds.length > 0) {
								await batchDelete(serverIds);
							}
						}
						break;
				}

				processedIds.push(op.id);
			} catch (error) {
				console.error(`[ConvexSync] Failed to sync operation ${op.id}:`, error);
				// Don't mark as processed - will retry later
			}
		}

		// Mark successfully processed operations
		if (processedIds.length > 0) {
			localStore.markSynced(processedIds);
		}

		syncInProgress.current = false;
		setPendingOperations(localStore.getPendingOperations().length);
	}, [localStore, create, update, toggle, remove, clearCompleted, batchToggle, batchDelete]);

	// Sync pending operations periodically
	useEffect(() => {
		if (!isHydrated) return;

		// Initial sync
		processPendingOps();

		// Periodic sync every 2 seconds
		const interval = setInterval(processPendingOps, SYNC_INTERVAL_MS);

		return () => clearInterval(interval);
	}, [isHydrated, processPendingOps]);

	// Force sync function
	const syncNow = useCallback(async () => {
		await processPendingOps();
	}, [processPendingOps]);

	return {
		isHydrated,
		pendingOperations,
		syncNow,
	};
}
