import { useAuthActions } from '@convex-dev/auth/react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { callTool } from './api'; // Still needed for retry functionality
import { ChatSidebar } from './components/ChatSidebar';
import { CommandLog, useCommandLog } from './components/CommandLog';
import { ConfirmModal } from './components/ConfirmModal';
import { DevModeDrawer } from './components/DevModeDrawer';
import { ErrorRecovery } from './components/ErrorRecovery';
import { KeyboardHelp } from './components/KeyboardHelp';
import { NotesView } from './components/NotesView';
import type { ViewType } from './components/Sidebar';
import { Sidebar } from './components/Sidebar';
import { ToastContainer, useToast } from './components/Toast';
import { TodoDetailModal } from './components/TodoDetailModal';
import { TodoForm } from './components/TodoForm';
import { TodoItem } from './components/TodoItem';
import { TodoStats } from './components/TodoStats';
import { TrustPanel } from './components/TrustPanel';
import { useBatchOperations } from './hooks/useBatchOperations';
import { useConfirm } from './hooks/useConfirm';
import { useConvexLists } from './hooks/useConvexLists';
import { useConvexSync } from './hooks/useConvexSync';
import type { KeyboardShortcut } from './hooks/useKeyboard';
import { useKeyboard } from './hooks/useKeyboard';
import { computeStats, useLocalStore } from './hooks/useLocalStore';
import { useTheme } from './hooks/useTheme';
import { useTodoOperations } from './hooks/useTodoOperations';
import type { CommandResult, Note, NoteFolder, Todo } from './types';
import './App.css';

type FilterType = 'all' | 'pending' | 'completed';

interface LastOperation {
	command: string;
	args: Record<string, unknown>;
}

const App: React.FC = () => {
	// Authentication
	const { signOut } = useAuthActions();

	// Local-first store (source of truth)
	const localStore = useLocalStore();
	const todos = localStore.todos;
	const stats = computeStats(todos);

	// Convex sync (background sync to Convex)
	const { isHydrated, pendingOperations } = useConvexSync(localStore);

	const [error] = useState<string | null>(null);
	// Connected is true when we have data (either from local store or hydrated from Convex)
	const connected = todos.length > 0 || isHydrated;
	const [filter, setFilter] = useState<FilterType>('all');

	// Sidebar and view state
	const [activeView, setActiveView] = useState<ViewType>('inbox');
	const [activeListId, setActiveListId] = useState<string | null>(null);
	const { lists, create: createList } = useConvexLists();
	const [sidebarOpen, setSidebarOpen] = useState(false);

	// Notes state
	const [notes, setNotes] = useState<Note[]>([]);
	const [noteFolders, setNoteFolders] = useState<NoteFolder[]>([]);
	const [activeNoteFolderId] = useState<string | null>(null);

	// Selection state and operations handled by useBatchOperations hook

	// Dev mode drawer state
	const [devDrawerOpen, setDevDrawerOpen] = useState(false);
	const [showCommandLog, setShowCommandLog] = useState(true);

	// Backend health state
	const [isBackendReady, setIsBackendReady] = useState(false);
	const [isChatReady, setIsChatReady] = useState(false);

	// Chat sidebar state
	const [chatSidebarOpen, setChatSidebarOpen] = useState(true);

	// Detail modal state
	const [detailTodo, setDetailTodo] = useState<Todo | null>(null);

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

	// Keyboard navigation state
	const [focusedIndex, setFocusedIndex] = useState(-1);
	const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
	const titleInputRef = useRef<HTMLInputElement>(null);

	const { toasts, removeToast, showResultToast } = useToast();
	const { entries: logEntries, log } = useCommandLog();
	const { state: confirmState, confirm, handleConfirm, handleCancel } = useConfirm();
	const { theme, toggleTheme } = useTheme();

	// Note: Removed remote change detection and connection health checks -
	// Convex handles real-time updates and connection management automatically
	// Lists are now handled by useConvexLists hook

	// Backend health check
	useEffect(() => {
		const checkBackend = async () => {
			try {
				const res = await fetch('http://localhost:3101/health');
				setIsBackendReady(res.ok);
			} catch {
				setIsBackendReady(false);
			}
		};
		checkBackend();
		const interval = setInterval(checkBackend, 30000); // Check every 30s
		return () => clearInterval(interval);
	}, []);

	// Fetch notes
	const fetchNotes = useCallback(async () => {
		try {
			const res = await callTool<{ notes: Note[] }>('note-list', {});
			if (res.success && res.data) {
				setNotes(res.data.notes);
			}
		} catch (err) {
			console.error('Failed to fetch notes:', err);
		}
	}, []);

	// Fetch note folders
	const fetchNoteFolders = useCallback(async () => {
		try {
			const res = await callTool<{ noteFolders: NoteFolder[] }>('notefolder-list', {});
			if (res.success && res.data) {
				setNoteFolders(res.data.noteFolders);
			}
		} catch (err) {
			console.error('Failed to fetch note folders:', err);
		}
	}, []);

	// Initial load - only fetch notes since todos come from local store
	useEffect(() => {
		fetchNotes();
		fetchNoteFolders();
	}, [fetchNotes, fetchNoteFolders]);

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

	// View change handler
	const handleViewChange = (view: ViewType, listId?: string) => {
		setActiveView(view);
		setActiveListId(listId || null);
		setSidebarOpen(false);
	};

	// Create list handler (using Convex)
	const handleCreateList = async () => {
		const name = window.prompt('Enter list name:');
		if (!name) return;

		log(`Creating list...`);
		try {
			await createList({ name });
			log(`✓ List created: ${name}`, 'success');
		} catch (err) {
			log(`✗ Failed to create list: ${err}`, 'error');
		}
	};

	// View detail handler - opens modal with full todo details
	const handleViewDetail = (id: string) => {
		const todo = todos.find((t) => t.id === id);
		if (todo) {
			setDetailTodo(todo);
		}
	};

	// Error recovery retry (Note: This still uses legacy API pattern for operations tracking)
	const handleRetry = async () => {
		if (!lastOperation) return;

		setErrorState({ ...errorState, isVisible: false });
		log(`Retrying ${lastOperation.command}...`);
		// Note: Using legacy callTool for retry - may need updating when fully migrating error tracking
		const res = await callTool<unknown>(lastOperation.command, lastOperation.args);
		trackOperation(lastOperation.command, lastOperation.args, res as CommandResult<unknown>);
		if (res.success) {
			const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : '';
			log(`✓ ${lastOperation.command} - Retry successful${time}`, 'success');
		} else {
			log(`✗ ${lastOperation.command}: Retry failed - ${res.error?.message}`, 'error');
		}
		showResultToast(res, lastOperation.command);
	};

	const handleDismissError = () => {
		setErrorState({ ...errorState, isVisible: false });
	};

	// Get active list for filtering
	const activeList = activeListId ? (lists ?? []).find((l) => l._id === activeListId) : null;

	// Filter todos based on current view and filter
	const filteredTodos = todos.filter((todo) => {
		// View-based filtering
		if (activeView === 'list' && activeList) {
			if (!(activeList.todoIds as string[]).includes(todo.id)) return false;
		}
		// Note: "today" view would filter by due date when implemented
		// For now, "inbox" and "today" show all todos

		// Status-based filtering
		if (filter === 'pending') return !todo.completed;
		if (filter === 'completed') return todo.completed;
		return true;
	});

	// Todo operations using LocalStore
	const {
		handleAddTodo,
		handleToggleTodo,
		handleDeleteTodo,
		handleEditTodo,
		handleSaveDetail,
		handleClearCompleted,
	} = useTodoOperations({
		localStore,
		log,
		confirm,
		todos,
	});

	// Batch operations using LocalStore
	const {
		selectedIds,
		toggleSelection,
		toggleSelectAll,
		handleToggleSelected,
		handleDeleteSelected,
	} = useBatchOperations({
		localStore,
		filteredTodos,
		log,
		confirm,
	});

	// Calculate counts for sidebar
	const inboxCount = todos.filter((t) => !t.completed).length;
	const todayCount = todos.filter((t) => !t.completed).length; // Same as inbox for now

	// Note operation handlers
	const handleCreateNote = async () => {
		log(`Calling note-create...`);
		const args = { title: 'New Note', content: '' };
		const res = await callTool<Note>('note-create', args);
		trackOperation('note-create', args, res as CommandResult<unknown>);
		if (res.success) {
			const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : '';
			log(`✓ note-create - ${res.reasoning || 'Note created'}${time}`, 'success');
			fetchNotes();
		} else {
			log(`✗ note-create: ${res.error?.message}`, 'error');
		}
		showResultToast(res, 'note-create');
	};

	const handleUpdateNote = async (id: string, updates: { title?: string; content?: string }) => {
		log(`Calling note-update...`);
		const args = { id, ...updates };
		const res = await callTool<Note>('note-update', args);
		trackOperation('note-update', args, res as CommandResult<unknown>);
		if (res.success) {
			const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : '';
			log(`✓ note-update - ${res.reasoning || 'Note updated'}${time}`, 'success');
			fetchNotes();
		} else {
			log(`✗ note-update: ${res.error?.message}`, 'error');
		}
		showResultToast(res, 'note-update');
	};

	const handleDeleteNote = async (id: string) => {
		log(`Calling note-delete...`);
		const args = { id };
		const res = await callTool<void>('note-delete', args);
		trackOperation('note-delete', args, res as CommandResult<unknown>);
		if (res.success) {
			const time = res.metadata?.executionTimeMs ? ` (${res.metadata.executionTimeMs}ms)` : '';
			log(`✓ note-delete - ${res.reasoning || 'Note deleted'}${time}`, 'success');
			fetchNotes();
		} else {
			log(`✗ note-delete: ${res.error?.message}`, 'error');
		}
		showResultToast(res, 'note-delete');
	};

	// Get view title
	const getViewTitle = () => {
		if (activeView === 'list' && activeList) {
			return activeList.name;
		}
		if (activeView === 'today') {
			return 'Today';
		}
		if (activeView === 'notes') {
			return 'Notes';
		}
		return 'Inbox';
	};

	// Keyboard shortcuts
	const shortcuts: KeyboardShortcut[] = useMemo(
		() => [
			{ key: 'n', description: 'Add new todo', action: () => titleInputRef.current?.focus() },
			{
				key: 'j',
				description: 'Navigate to next todo',
				action: () => setFocusedIndex((i) => Math.min(i + 1, filteredTodos.length - 1)),
			},
			{
				key: 'k',
				description: 'Navigate to previous todo',
				action: () => setFocusedIndex((i) => Math.max(i - 1, 0)),
			},
			{
				key: ' ',
				description: 'Toggle focused todo',
				action: () => {
					if (focusedIndex >= 0 && filteredTodos[focusedIndex])
						handleToggleTodo(filteredTodos[focusedIndex].id);
				},
				when: () => focusedIndex >= 0,
			},
			{
				key: 'Enter',
				description: 'Toggle focused todo',
				action: () => {
					if (focusedIndex >= 0 && filteredTodos[focusedIndex])
						handleToggleTodo(filteredTodos[focusedIndex].id);
				},
				when: () => focusedIndex >= 0,
			},
			{
				key: 'e',
				description: 'Edit focused todo',
				action: () => {
					if (focusedIndex >= 0 && filteredTodos[focusedIndex])
						handleEditTodo(filteredTodos[focusedIndex].id);
				},
				when: () => focusedIndex >= 0,
			},
			{
				key: 'Delete',
				description: 'Delete focused todo',
				action: () => {
					if (focusedIndex >= 0 && filteredTodos[focusedIndex])
						handleDeleteTodo(filteredTodos[focusedIndex].id);
				},
				when: () => focusedIndex >= 0,
			},
			{
				key: 'Backspace',
				description: 'Delete focused todo',
				action: () => {
					if (focusedIndex >= 0 && filteredTodos[focusedIndex])
						handleDeleteTodo(filteredTodos[focusedIndex].id);
				},
				when: () => focusedIndex >= 0,
			},
			{ key: 'Escape', description: 'Clear focus', action: () => setFocusedIndex(-1) },
			{ key: 'a', description: 'Select all todos', action: () => toggleSelectAll() },
			{
				key: 'c',
				description: 'Clear completed',
				action: () => {
					if (stats && stats.completed > 0) handleClearCompleted(stats.completed);
				},
				when: () => !!(stats && stats.completed > 0),
			},
			{ key: '?', description: 'Show keyboard shortcuts', action: () => setShowKeyboardHelp(true) },
		],
		[
			filteredTodos,
			focusedIndex,
			stats,
			handleToggleTodo,
			handleEditTodo,
			handleDeleteTodo,
			handleClearCompleted,
			toggleSelectAll,
		]
	);

	useKeyboard({ shortcuts });

	return (
		<div className="app-shell">
			<ToastContainer toasts={toasts} onRemove={removeToast} />
			<ConfirmModal
				isOpen={confirmState.isOpen}
				title={confirmState.title}
				message={confirmState.message}
				warning={confirmState.warning}
				onConfirm={handleConfirm}
				onCancel={handleCancel}
			/>
			<KeyboardHelp
				isOpen={showKeyboardHelp}
				onClose={() => setShowKeyboardHelp(false)}
				shortcuts={shortcuts}
				theme={theme}
				onToggleTheme={toggleTheme}
			/>
			<DevModeDrawer
				isOpen={devDrawerOpen}
				onClose={() => setDevDrawerOpen(false)}
				lastResult={lastResult}
				lastCommandName={lastCommandName}
				logEntries={logEntries}
				isConvexReady={isHydrated}
				isBackendReady={isBackendReady}
				isChatReady={isChatReady}
				pendingOperations={pendingOperations}
				showCommandLog={showCommandLog}
				onToggleCommandLog={() => setShowCommandLog(!showCommandLog)}
			/>
			<TodoDetailModal
				todo={detailTodo}
				onClose={() => setDetailTodo(null)}
				onSave={handleSaveDetail}
			/>

			{/* Mobile sidebar overlay */}
			<div
				className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`}
				onClick={() => setSidebarOpen(false)}
			/>

			<Sidebar
				activeView={activeView}
				activeListId={activeListId}
				lists={lists ?? []}
				onViewChange={handleViewChange}
				onCreateList={handleCreateList}
				todayCount={todayCount}
				inboxCount={inboxCount}
			/>

			<header className="app-header">
				<div className="header-left">
					<button
						type="button"
						className="mobile-menu-btn"
						onClick={() => setSidebarOpen(!sidebarOpen)}
					>
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
						>
							<title>Menu</title>
							<line x1="3" y1="12" x2="21" y2="12" />
							<line x1="3" y1="6" x2="21" y2="6" />
							<line x1="3" y1="18" x2="21" y2="18" />
						</svg>
					</button>
					<div className="header-title">
						<h1>{getViewTitle()}</h1>
					</div>
				</div>
				<div className="header-right">
					<button
						type="button"
						className="keyboard-help-btn"
						onClick={() => setShowKeyboardHelp(true)}
						title="Settings"
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
						>
							<title>Settings</title>
							<circle cx="12" cy="12" r="3" />
							<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
						</svg>
					</button>
					<button
						type="button"
						className="dev-mode-btn"
						onClick={() => setDevDrawerOpen(true)}
						title="Open Dev Mode"
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
						>
							<title>Edit Mode</title>
							<path d="M12 20h9" />
							<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
						</svg>
					</button>
					<button
						type="button"
						className="dev-mode-btn"
						onClick={() => setChatSidebarOpen(!chatSidebarOpen)}
						title={chatSidebarOpen ? 'Hide AI Copilot' : 'Show AI Copilot'}
					>
						<span style={{ fontSize: '14px' }}>🤖</span>
					</button>
					<button
						type="button"
						className="logout-btn"
						onClick={() => void signOut()}
						title="Sign out"
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
						>
							<title>Sign Out</title>
							<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
							<polyline points="16,17 21,12 16,7" />
							<line x1="21" y1="12" x2="9" y2="12" />
						</svg>
					</button>
					<div className="connection-status">
						<span className={`status-dot ${connected ? 'connected' : ''}`}></span>
						<span>
							{connected
								? pendingOperations > 0
									? `Syncing (${pendingOperations})`
									: 'Connected'
								: 'Disconnected'}
						</span>
					</div>
				</div>
			</header>

			<div className="app-main">
				<main className="app-content">
					{activeView === 'notes' ? (
						<NotesView
							notes={notes}
							noteFolders={noteFolders}
							activeNoteFolderId={activeNoteFolderId}
							onCreateNote={handleCreateNote}
							onUpdateNote={handleUpdateNote}
							onDeleteNote={handleDeleteNote}
							callTool={callTool}
						/>
					) : (
						<>
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

							<TodoForm onAdd={handleAddTodo} titleInputRef={titleInputRef} />

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
										<button
											type="button"
											className="clear-btn"
											onClick={() => handleClearCompleted(stats.completed)}
										>
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
												checked={
													selectedIds.size === filteredTodos.length && filteredTodos.length > 0
												}
												onChange={toggleSelectAll}
											/>
											<span>
												Select All ({selectedIds.size}/{filteredTodos.length})
											</span>
										</label>
										{selectedIds.size > 0 && (
											<div className="batch-actions">
												<button
													type="button"
													className="batch-btn toggle"
													onClick={handleToggleSelected}
												>
													Toggle Selected
												</button>
												<button
													type="button"
													className="batch-btn delete"
													onClick={handleDeleteSelected}
												>
													Delete Selected
												</button>
											</div>
										)}
									</div>
								)}

								{!isHydrated && todos.length === 0 && (
									<div className="isLoading">Loading todos...</div>
								)}
								{error && <div className="error">{error}</div>}

								<div className="todo-list">
									{filteredTodos.length === 0 && isHydrated ? (
										<p className="empty-state">No todos yet. Add one above!</p>
									) : (
										filteredTodos.map((todo, index) => (
											<TodoItem
												key={todo.id}
												todo={todo}
												onToggle={handleToggleTodo}
												onDelete={handleDeleteTodo}
												onEdit={handleEditTodo}
												onViewDetail={handleViewDetail}
												selected={selectedIds.has(todo.id)}
												onSelect={toggleSelection}
												showSelect={true}
												focused={index === focusedIndex}
											/>
										))
									)}
								</div>
							</div>

							{showCommandLog && <CommandLog entries={logEntries} />}
						</>
					)}
				</main>
			</div>

			<footer className="app-footer">
				<p>
					Press <kbd>?</kbd> for keyboard shortcuts.
				</p>
			</footer>

			{/* AI Copilot Chat Sidebar */}
			<ChatSidebar
				isOpen={chatSidebarOpen}
				onToggle={() => setChatSidebarOpen(!chatSidebarOpen)}
				onTodosChanged={() => {}} // No longer needed - local store is source of truth
				todos={todos}
				localStore={localStore}
				onConnectionStatusChange={(status) => setIsChatReady(status === 'connected')}
			/>
		</div>
	);
};

export default App;
