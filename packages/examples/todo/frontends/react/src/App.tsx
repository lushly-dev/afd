import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { callTool } from './api';
import { CommandLog, useCommandLog } from './components/CommandLog';
import { ConfirmModal } from './components/ConfirmModal';
import { ErrorRecovery } from './components/ErrorRecovery';
import type { RemoteChanges } from './components/Toast';
import { ToastContainer, useToast } from './components/Toast';
import { TodoForm } from './components/TodoForm';
import { TodoItem } from './components/TodoItem';
import { TodoStats } from './components/TodoStats';
import { TrustPanel } from './components/TrustPanel';
import { useConfirm } from './hooks/useConfirm';
import type { CommandResult, TodoStats as ITodoStats, Todo } from './types';
import './App.css';

const POLL_INTERVAL = 3000; // 3 seconds

type FilterType = 'all' | 'pending' | 'completed';

interface LastOperation {
	command: string;
	args: Record<string, unknown>;
}

const App: React.FC = () => {
	const [todos, setTodos] = useState<Todo[]>([]);
	const [stats, setStats] = useState<ITodoStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [connected, setConnected] = useState(false);
	const [filter, setFilter] = useState<FilterType>('all');

	// Selection state for batch operations
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	// Trust panel state
	const [lastResult, setLastResult] = useState<CommandResult<unknown> | null>(null);
	const [lastCommandName, setLastCommandName] = useState('');
	const [showTrustPanel, setShowTrustPanel] = useState(false);

	// Error recovery state
	const [lastOperation, setLastOperation] = useState<LastOperation | null>(null);
	const [errorState, setErrorState] = useState<{
		isVisible: boolean;
		commandName: string;
		message: string;
		suggestion?: string;
	}>({ isVisible: false, commandName: '', message: '' });

	const { toasts, removeToast, showResultToast, showRemoteChanges } = useToast();
	const { entries: logEntries, log } = useCommandLog();
	const { state: confirmState, confirm, handleConfirm, handleCancel } = useConfirm();

	// Track previous todos for remote change detection
	const previousTodosRef = useRef<Map<string, Todo>>(new Map());
	// Track whether we've established a baseline (to avoid false positives on first load)
	const hasBaselineRef = useRef(false);

	// Detect changes between previous and current todos
	const detectRemoteChanges = useCallback((currentTodos: Todo[]): RemoteChanges => {
		const changes: RemoteChanges = {
			added: [],
			deleted: [],
			completed: [],
			uncompleted: [],
			updated: [],
		};

		const currentMap = new Map(currentTodos.map((t) => [t.id, t]));
		const previousMap = previousTodosRef.current;

		// Find deleted and modified todos
		for (const [id, prevTodo] of previousMap) {
			const currentTodo = currentMap.get(id);
			if (!currentTodo) {
				changes.deleted.push({ id: prevTodo.id, title: prevTodo.title });
			} else {
				if (!prevTodo.completed && currentTodo.completed) {
					changes.completed.push({ id: currentTodo.id, title: currentTodo.title });
				} else if (prevTodo.completed && !currentTodo.completed) {
					changes.uncompleted.push({ id: currentTodo.id, title: currentTodo.title });
				} else if (
					prevTodo.title !== currentTodo.title ||
					prevTodo.priority !== currentTodo.priority
				) {
					changes.updated.push({ id: currentTodo.id, title: currentTodo.title });
				}
			}
		}

		// Find added todos
		for (const todo of currentTodos) {
			if (!previousMap.has(todo.id)) {
				changes.added.push({ id: todo.id, title: todo.title });
			}
		}

		return changes;
	}, []);

	// Update the previous todos map
	const updatePreviousTodos = useCallback((todos: Todo[]) => {
		previousTodosRef.current = new Map(todos.map((t) => [t.id, { ...t }]));
		hasBaselineRef.current = true;
	}, []);

	// Check connection health
	const checkConnection = useCallback(async () => {
		try {
			const response = await fetch('http://localhost:3100/health');
			const data = await response.json();
			setConnected(data.status === 'ok');
			return data.status === 'ok';
		} catch {
			setConnected(false);
			return false;
		}
	}, []);

	// Fetch data (silent mode for polling)
	const fetchData = useCallback(
		async (options: { silent?: boolean; detectChanges?: boolean } = {}) => {
			const { silent = false, detectChanges = false } = options;

			try {
				if (!silent) setLoading(true);

				const [todosRes, statsRes] = await Promise.all([
					callTool<{ todos: Todo[] }>('todo-list', { limit: 100 }),
					callTool<ITodoStats>('todo-stats', {}),
				]);

				if (todosRes.success && todosRes.data) {
					const newTodos = todosRes.data.todos;

					// Detect and notify remote changes
					// Only detect if we have established a baseline (prevents false positives on first load)
					if (detectChanges && hasBaselineRef.current) {
						const changes = detectRemoteChanges(newTodos);
						const hasChanges =
							changes.added.length > 0 ||
							changes.deleted.length > 0 ||
							changes.completed.length > 0 ||
							changes.uncompleted.length > 0 ||
							changes.updated.length > 0;

						if (hasChanges) {
							showRemoteChanges(changes);
						}
					}

					updatePreviousTodos(newTodos);
					setTodos(newTodos);
				}

				if (statsRes.success && statsRes.data) {
					setStats(statsRes.data);
				}

				setError(null);
			} catch (err) {
				if (!silent) {
					setError('Failed to fetch data from MCP server');
				}
				console.error(err);
			} finally {
				if (!silent) setLoading(false);
			}
		},
		[detectRemoteChanges, updatePreviousTodos, showRemoteChanges]
	);

	// Initial load
	useEffect(() => {
		const init = async () => {
			const isConnected = await checkConnection();
			if (isConnected) {
				await fetchData();
			}
		};
		init();
	}, [checkConnection, fetchData]);

	// Polling for external changes
	useEffect(() => {
		const interval = setInterval(async () => {
			const isConnected = await checkConnection();
			if (isConnected) {
				await fetchData({ silent: true, detectChanges: true });
			}
		}, POLL_INTERVAL);

		return () => clearInterval(interval);
	}, [checkConnection, fetchData]);

	// Helper to track operation and show trust panel
	const trackOperation = (
		commandName: string,
		args: Record<string, unknown>,
		result: CommandResult<unknown>
	) => {
		setLastOperation({ command: commandName, args });
		setLastResult(result);
		setLastCommandName(commandName);

		// Show trust panel if result has confidence/reasoning/sources
		if (
			result.confidence !== undefined ||
			result.reasoning ||
			result.sources?.length ||
			result.plan?.length
		) {
			setShowTrustPanel(true);
		}

		// Handle errors with recovery
		if (!result.success && result.error) {
			setErrorState({
				isVisible: true,
				commandName,
				message: result.error.message,
				suggestion: result.error.suggestion,
			});
		}
	};

	const handleAddTodo = async (
		title: string,
		priority: string = 'medium',
		description?: string
	) => {
		log(`Calling todo-create...`);
		const args = { title, priority, description };
		const res = await callTool<Todo>('todo-create', args);
		trackOperation('todo-create', args, res as CommandResult<unknown>);
		if (res.success) {
			const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : '';
			log(`✓ todo-create - ${res.reasoning || 'Todo created'}${time}`, 'success');
			fetchData();
		} else {
			log(`✗ todo-create: ${res.error?.message}`, 'error');
		}
		showResultToast(res, 'todo-create');
	};

	const handleToggleTodo = async (id: string) => {
		log(`Calling todo-toggle...`);
		const args = { id };
		const res = await callTool<Todo>('todo-toggle', args);
		trackOperation('todo-toggle', args, res as CommandResult<unknown>);
		if (res.success) {
			const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : '';
			log(`✓ todo-toggle - ${res.reasoning || 'Todo toggled'}${time}`, 'success');
			fetchData();
		} else {
			log(`✗ todo-toggle: ${res.error?.message}`, 'error');
		}
		showResultToast(res, 'todo-toggle');
	};

	const handleDeleteTodo = async (id: string) => {
		const todo = todos.find((t) => t.id === id);
		const confirmed = await confirm({
			title: 'Delete Todo',
			message: `Are you sure you want to delete "${todo?.title || 'this todo'}"?`,
			warning: 'This action cannot be undone.',
			confirmText: 'Delete',
			cancelText: 'Cancel',
		});

		if (!confirmed) return;

		log(`Calling todo-delete...`);
		const args = { id };
		const res = await callTool<{ id: string }>('todo-delete', args);
		trackOperation('todo-delete', args, res as CommandResult<unknown>);
		if (res.success) {
			const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : '';
			log(`✓ todo-delete - ${res.reasoning || 'Todo deleted'}${time}`, 'success');
			setSelectedIds((prev) => {
				const next = new Set(prev);
				next.delete(id);
				return next;
			});
			fetchData();
		} else {
			log(`✗ todo-delete: ${res.error?.message}`, 'error');
		}
		showResultToast(res, 'todo-delete');
	};

	const handleEditTodo = async (id: string) => {
		const todo = todos.find((t) => t.id === id);
		if (!todo) return;

		const newTitle = window.prompt('Edit todo title:', todo.title);
		if (!newTitle || newTitle === todo.title) return;

		log(`Calling todo-update...`);
		const args = { id, title: newTitle };
		const res = await callTool<Todo>('todo-update', args);
		trackOperation('todo-update', args, res as CommandResult<unknown>);
		if (res.success) {
			const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : '';
			log(`✓ todo-update - ${res.reasoning || 'Todo updated'}${time}`, 'success');
			fetchData();
		} else {
			log(`✗ todo-update: ${res.error?.message}`, 'error');
		}
		showResultToast(res, 'todo-update');
	};

	const handleClearCompleted = async () => {
		const confirmed = await confirm({
			title: 'Clear Completed',
			message: `Are you sure you want to clear all ${stats?.completed || 0} completed todos?`,
			warning: 'This action cannot be undone.',
			confirmText: 'Clear All',
			cancelText: 'Cancel',
		});

		if (!confirmed) return;

		log(`Calling todo-clear...`);
		const args = {};
		const res = await callTool<{ count: number }>('todo-clear', args);
		trackOperation('todo-clear', args, res as CommandResult<unknown>);
		if (res.success) {
			const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : '';
			log(`✓ todo-clear - ${res.reasoning || 'Cleared completed'}${time}`, 'success');
			fetchData();
		} else {
			log(`✗ todo-clear: ${res.error?.message}`, 'error');
		}
		showResultToast(res, 'todo-clear');
	};

	// Batch operations
	const toggleSelection = (id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const toggleSelectAll = () => {
		if (selectedIds.size === filteredTodos.length) {
			setSelectedIds(new Set());
		} else {
			setSelectedIds(new Set(filteredTodos.map((t) => t.id)));
		}
	};

	const handleToggleSelected = async () => {
		if (selectedIds.size === 0) return;

		log(`Calling todo-toggle-batch (${selectedIds.size} todos)...`);
		const ids = Array.from(selectedIds);
		const args = { ids };
		const res = await callTool<{ results: unknown[] }>('todo-toggle-batch', args);
		trackOperation('todo-toggle-batch', args, res as CommandResult<unknown>);
		if (res.success) {
			const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : '';
			log(
				`✓ todo-toggle-batch - ${res.reasoning || `Toggled ${ids.length} todos`}${time}`,
				'success'
			);
			fetchData();
		} else {
			log(`✗ todo-toggle-batch: ${res.error?.message}`, 'error');
		}
		showResultToast(res, 'todo-toggle-batch');
	};

	const handleDeleteSelected = async () => {
		if (selectedIds.size === 0) return;

		const confirmed = await confirm({
			title: 'Delete Selected',
			message: `Are you sure you want to delete ${selectedIds.size} selected todo(s)?`,
			warning: 'This action cannot be undone.',
			confirmText: 'Delete All',
			cancelText: 'Cancel',
		});

		if (!confirmed) return;

		log(`Calling todo-delete-batch (${selectedIds.size} todos)...`);
		const ids = Array.from(selectedIds);
		const args = { ids };
		const res = await callTool<{ results: unknown[] }>('todo-delete-batch', args);
		trackOperation('todo-delete-batch', args, res as CommandResult<unknown>);
		if (res.success) {
			const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : '';
			log(
				`✓ todo-delete-batch - ${res.reasoning || `Deleted ${ids.length} todos`}${time}`,
				'success'
			);
			setSelectedIds(new Set());
			fetchData();
		} else {
			log(`✗ todo-delete-batch: ${res.error?.message}`, 'error');
		}
		showResultToast(res, 'todo-delete-batch');
	};

	// Error recovery retry
	const handleRetry = async () => {
		if (!lastOperation) return;

		setErrorState({ ...errorState, isVisible: false });
		log(`Retrying ${lastOperation.command}...`);
		const res = await callTool<unknown>(lastOperation.command, lastOperation.args);
		trackOperation(lastOperation.command, lastOperation.args, res as CommandResult<unknown>);
		if (res.success) {
			const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : '';
			log(`✓ ${lastOperation.command} - Retry successful${time}`, 'success');
			fetchData();
		} else {
			log(`✗ ${lastOperation.command}: Retry failed - ${res.error?.message}`, 'error');
		}
		showResultToast(res, lastOperation.command);
	};

	const handleDismissError = () => {
		setErrorState({ ...errorState, isVisible: false });
	};

	// Filter todos based on current filter
	const filteredTodos = todos.filter((todo) => {
		if (filter === 'pending') return !todo.completed;
		if (filter === 'completed') return todo.completed;
		return true;
	});

	return (
		<div className="app-container">
			<ToastContainer toasts={toasts} onRemove={removeToast} />
			<ConfirmModal
				isOpen={confirmState.isOpen}
				title={confirmState.title}
				message={confirmState.message}
				warning={confirmState.warning}
				confirmText={confirmState.confirmText}
				cancelText={confirmState.cancelText}
				onConfirm={handleConfirm}
				onCancel={handleCancel}
			/>

			<header>
				<h1>
					AFD Todo <span className="badge">React</span>
				</h1>
				<p className="subtitle">Agent-First Development Example</p>
				<div className="connection-status">
					<span className={`status-dot ${connected ? 'connected' : ''}`}></span>
					<span>{connected ? 'Connected to todo-app' : 'Disconnected'}</span>
				</div>
			</header>

			<main>
				<TodoStats stats={stats} />

				{showTrustPanel && lastResult && (
					<TrustPanel
						result={lastResult}
						commandName={lastCommandName}
						onClose={() => setShowTrustPanel(false)}
					/>
				)}

				{errorState.isVisible && (
					<ErrorRecovery
						isVisible={errorState.isVisible}
						commandName={errorState.commandName}
						errorMessage={errorState.message}
						suggestion={errorState.suggestion}
						onRetry={handleRetry}
						onDismiss={handleDismissError}
					/>
				)}

				<TodoForm onAdd={handleAddTodo} />

				<div className="todo-list-card">
					<div className="filters">
						<button
							type="button"
							className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
							onClick={() => setFilter('all')}
						>
							All
						</button>
						<button
							type="button"
							className={`filter-btn ${filter === 'pending' ? 'active' : ''}`}
							onClick={() => setFilter('pending')}
						>
							Pending
						</button>
						<button
							type="button"
							className={`filter-btn ${filter === 'completed' ? 'active' : ''}`}
							onClick={() => setFilter('completed')}
						>
							Completed
						</button>
						{stats && stats.completed > 0 && (
							<button type="button" className="clear-btn" onClick={handleClearCompleted}>
								Clear Completed
							</button>
						)}
					</div>

					{/* Batch controls */}
					{filteredTodos.length > 0 && (
						<div className="batch-controls">
							<label className="select-all-label">
								<input
									type="checkbox"
									checked={selectedIds.size === filteredTodos.length && filteredTodos.length > 0}
									onChange={toggleSelectAll}
								/>
								<span>
									Select All ({selectedIds.size}/{filteredTodos.length})
								</span>
							</label>
							{selectedIds.size > 0 && (
								<div className="batch-actions">
									<button type="button" className="batch-btn toggle" onClick={handleToggleSelected}>
										Toggle Selected
									</button>
									<button type="button" className="batch-btn delete" onClick={handleDeleteSelected}>
										Delete Selected
									</button>
								</div>
							)}
						</div>
					)}

					{loading && <div className="loading">Loading todos...</div>}
					{error && <div className="error">{error}</div>}

					<div className="todo-list">
						{filteredTodos.length === 0 && !loading ? (
							<p className="empty-state">No todos yet. Add one above!</p>
						) : (
							filteredTodos.map((todo) => (
								<TodoItem
									key={todo.id}
									todo={todo}
									onToggle={handleToggleTodo}
									onDelete={handleDeleteTodo}
									onEdit={handleEditTodo}
									selected={selectedIds.has(todo.id)}
									onSelect={toggleSelection}
									showSelect={true}
								/>
							))
						)}
					</div>
				</div>

				<CommandLog entries={logEntries} />
			</main>

			<footer>
				<p>
					Built with{' '}
					<a href="https://github.com/lushly-dev/afd" target="_blank" rel="noopener noreferrer">
						Agent-First Development
					</a>
					. Same commands work via CLI, MCP, and this UI.
				</p>
			</footer>
		</div>
	);
};

export default App;
