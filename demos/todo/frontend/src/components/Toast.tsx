import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { CommandResult } from '../types';
import './Toast.css';

export interface ToastData {
	id: string;
	type: 'success' | 'error' | 'warning' | 'info';
	message: string;
	icon?: string;
	confidence?: number;
	executionTimeMs?: number;
	warnings?: Array<{ code: string; message: string }>;
	isRemote?: boolean;
	duration?: number;
}

interface ToastProps {
	toast: ToastData;
	onRemove: (id: string) => void;
}

const Toast: React.FC<ToastProps> = ({ toast, onRemove }) => {
	useEffect(() => {
		const duration = toast.duration || (toast.warnings?.length ? 6000 : 5000);
		const timer = setTimeout(() => {
			onRemove(toast.id);
		}, duration);
		return () => clearTimeout(timer);
	}, [toast.id, toast.duration, toast.warnings?.length, onRemove]);

	const confidencePercent =
		toast.confidence !== undefined ? Math.round(toast.confidence * 100) : null;

	const confidenceClass =
		toast.confidence !== undefined
			? toast.confidence >= 0.9
				? ''
				: toast.confidence >= 0.7
					? 'medium'
					: 'low'
			: '';

	return (
		<div className={`toast ${toast.type} ${toast.isRemote ? 'remote-change' : ''}`}>
			<span className="toast-icon">
				{toast.icon || (toast.type === 'success' ? '✓' : toast.type === 'error' ? '✗' : '⚠️')}
			</span>
			<div className="toast-content">
				<div className="toast-message">{toast.message}</div>
				<div className="toast-meta">
					{confidencePercent !== null && (
						<span className="toast-confidence">
							<span className="confidence-bar">
								<span
									className={`confidence-fill ${confidenceClass}`}
									style={{ width: `${confidencePercent}%` }}
								/>
							</span>
							{confidencePercent}%
						</span>
					)}
					{toast.executionTimeMs !== undefined && <span>⚡ {toast.executionTimeMs}ms</span>}
					{toast.isRemote && <span>🌐 Remote change</span>}
				</div>
				{toast.warnings && toast.warnings.length > 0 && (
					<div className="toast-warnings">
						{toast.warnings.map((w, i) => (
							<div key={`${w.code}-${i}`} className="toast-warning-item">
								⚠️ {w.message}
							</div>
						))}
					</div>
				)}
			</div>
			<button type="button" className="toast-close" onClick={() => onRemove(toast.id)}>
				×
			</button>
		</div>
	);
};

// Remote changes type - must be defined before useToast
export type RemoteChanges = {
	added: Array<{ id: string; title: string }>;
	deleted: Array<{ id: string; title: string }>;
	completed: Array<{ id: string; title: string }>;
	uncompleted: Array<{ id: string; title: string }>;
	updated: Array<{ id: string; title: string }>;
};

// Toast container and hook
let toastIdCounter = 0;

export const useToast = () => {
	const [toasts, setToasts] = useState<ToastData[]>([]);

	const addToast = useCallback((toast: Omit<ToastData, 'id'>) => {
		const id = `toast-${++toastIdCounter}`;
		setToasts((prev) => [...prev, { ...toast, id }]);
		return id;
	}, []);

	const removeToast = useCallback((id: string) => {
		setToasts((prev) => prev.filter((t) => t.id !== id));
	}, []);

	// Show toast from CommandResult
	const showResultToast = useCallback(
		(result: CommandResult<unknown>, commandName: string) => {
			addToast({
				type: result.success ? 'success' : 'error',
				message: result.success
					? result.reasoning || `${commandName} completed`
					: result.error?.message || 'Operation failed',
				confidence: result.confidence,
				executionTimeMs: result.metadata?.executionTimeMs,
				warnings: result.warnings,
			});
		},
		[addToast]
	);

	// Show batched remote change toasts
	const showRemoteChanges = useCallback(
		(changes: RemoteChanges) => {
			const notifications: Omit<ToastData, 'id'>[] = [];

			if (changes.added.length > 0) {
				const count = changes.added.length;
				const titles = changes.added
					.slice(0, 3)
					.map((t) => `"${t.title}"`)
					.join(', ');
				const extra = count > 3 ? ` and ${count - 3} more` : '';
				notifications.push({
					type: 'success',
					icon: '➕',
					message: count === 1 ? `Added: ${titles}` : `${count} items added: ${titles}${extra}`,
					isRemote: true,
				});
			}

			if (changes.deleted.length > 0) {
				const count = changes.deleted.length;
				const titles = changes.deleted
					.slice(0, 3)
					.map((t) => `"${t.title}"`)
					.join(', ');
				const extra = count > 3 ? ` and ${count - 3} more` : '';
				notifications.push({
					type: 'warning',
					icon: '🗑️',
					message: count === 1 ? `Deleted: ${titles}` : `${count} items deleted: ${titles}${extra}`,
					isRemote: true,
				});
			}

			if (changes.completed.length > 0) {
				const count = changes.completed.length;
				const titles = changes.completed
					.slice(0, 3)
					.map((t) => `"${t.title}"`)
					.join(', ');
				const extra = count > 3 ? ` and ${count - 3} more` : '';
				notifications.push({
					type: 'success',
					icon: '✅',
					message:
						count === 1 ? `Completed: ${titles}` : `${count} items completed: ${titles}${extra}`,
					isRemote: true,
				});
			}

			if (changes.uncompleted.length > 0) {
				const count = changes.uncompleted.length;
				const titles = changes.uncompleted
					.slice(0, 3)
					.map((t) => `"${t.title}"`)
					.join(', ');
				const extra = count > 3 ? ` and ${count - 3} more` : '';
				notifications.push({
					type: 'info',
					icon: '🔄',
					message:
						count === 1 ? `Reopened: ${titles}` : `${count} items reopened: ${titles}${extra}`,
					isRemote: true,
				});
			}

			if (changes.updated.length > 0) {
				const count = changes.updated.length;
				const titles = changes.updated
					.slice(0, 3)
					.map((t) => `"${t.title}"`)
					.join(', ');
				const extra = count > 3 ? ` and ${count - 3} more` : '';
				notifications.push({
					type: 'info',
					icon: '✏️',
					message: count === 1 ? `Updated: ${titles}` : `${count} items updated: ${titles}${extra}`,
					isRemote: true,
				});
			}

			for (const n of notifications) {
				addToast(n);
			}
		},
		[addToast]
	);

	return { toasts, addToast, removeToast, showResultToast, showRemoteChanges };
};

export const ToastContainer: React.FC<{ toasts: ToastData[]; onRemove: (id: string) => void }> = ({
	toasts,
	onRemove,
}) => {
	return (
		<div className="toast-container">
			{toasts.map((toast) => (
				<Toast key={toast.id} toast={toast} onRemove={onRemove} />
			))}
		</div>
	);
};

export default Toast;
