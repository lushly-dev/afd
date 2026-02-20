import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useState } from 'react';
import type { CommandResult, Note, NoteFolder } from '../types';
import './NotesView.css';

interface NotesViewProps {
	notes: Note[];
	noteFolders: NoteFolder[];
	activeNoteFolderId: string | null;
	onCreateNote: () => void;
	onUpdateNote: (id: string, updates: { title?: string; content?: string }) => Promise<void>;
	onDeleteNote: (id: string) => Promise<void>;
	callTool: <T>(command: string, args: Record<string, unknown>) => Promise<CommandResult<T>>;
}

export const NotesView: React.FC<NotesViewProps> = ({
	notes,
	noteFolders,
	activeNoteFolderId,
	onCreateNote,
	onUpdateNote,
	onDeleteNote,
}) => {
	const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
	const [titleValue, setTitleValue] = useState('');
	const [isDirty, setIsDirty] = useState(false);
	const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');

	// Filter notes by folder
	const filteredNotes = activeNoteFolderId
		? notes.filter((n) => n.folderId === activeNoteFolderId)
		: notes;

	// Get selected note
	const selectedNote = notes.find((n) => n.id === selectedNoteId) || null;

	// TipTap editor
	const editor = useEditor({
		extensions: [StarterKit],
		content: selectedNote?.content || '',
		onUpdate: () => {
			setIsDirty(true);
			setSaveStatus('unsaved');
		},
	});

	// Update editor content when selected note changes
	useEffect(() => {
		if (editor && selectedNote) {
			const currentContent = editor.getHTML();
			if (currentContent !== selectedNote.content) {
				editor.commands.setContent(selectedNote.content || '');
				setTitleValue(selectedNote.title);
				setIsDirty(false);
				setSaveStatus('saved');
			}
		} else if (editor && !selectedNote) {
			editor.commands.setContent('');
			setTitleValue('');
		}
	}, [editor, selectedNote?.id, selectedNote]);

	// Autosave with debounce
	useEffect(() => {
		if (!isDirty || !selectedNoteId || !editor) return;

		const timeout = setTimeout(async () => {
			setSaveStatus('saving');
			await onUpdateNote(selectedNoteId, {
				content: editor.getHTML(),
				title: titleValue,
			});
			setIsDirty(false);
			setSaveStatus('saved');
		}, 1500);

		return () => clearTimeout(timeout);
	}, [isDirty, selectedNoteId, titleValue, editor, onUpdateNote]);

	// Handle note selection
	const handleSelectNote = (noteId: string) => {
		// Save current note if dirty before switching
		if (isDirty && selectedNoteId && editor) {
			onUpdateNote(selectedNoteId, {
				content: editor.getHTML(),
				title: titleValue,
			});
		}
		setSelectedNoteId(noteId);
		setIsDirty(false);
	};

	// Handle title change
	const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setTitleValue(e.target.value);
		setIsDirty(true);
		setSaveStatus('unsaved');
	};

	// Handle delete
	const handleDeleteNote = async () => {
		if (!selectedNoteId) return;
		if (!confirm('Delete this note?')) return;
		await onDeleteNote(selectedNoteId);
		setSelectedNoteId(null);
	};

	// Format date
	const formatDate = (dateStr: string) => {
		const date = new Date(dateStr);
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	};

	// Get preview text
	const getPreview = (content: string) => {
		const text = content.replace(/<[^>]*>/g, '').trim();
		return text.length > 60 ? `${text.slice(0, 60)}...` : text;
	};

	return (
		<div className="notes-view">
			{/* Notes List */}
			<div className="notes-list">
				<div className="notes-list-header">
					<h2>
						{activeNoteFolderId
							? noteFolders.find((f) => f.id === activeNoteFolderId)?.name || 'Notes'
							: 'All Notes'}
					</h2>
					<button type="button" className="notes-add-btn" onClick={onCreateNote} title="New note">
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
						>
							<title>Add Note</title>
							<line x1="12" y1="5" x2="12" y2="19" />
							<line x1="5" y1="12" x2="19" y2="12" />
						</svg>
					</button>
				</div>

				<div className="notes-items">
					{filteredNotes.length === 0 ? (
						<div className="notes-empty">
							<p>No notes yet</p>
							<button type="button" onClick={onCreateNote}>Create your first note</button>
						</div>
					) : (
						filteredNotes.map((note) => (
							<button
								type="button"
								key={note.id}
								className={`notes-item ${selectedNoteId === note.id ? 'active' : ''}`}
								onClick={() => handleSelectNote(note.id)}
							>
								<div className="notes-item-title">{note.title || 'Untitled'}</div>
								<div className="notes-item-meta">
									<span className="notes-item-date">{formatDate(note.updatedAt)}</span>
									<span className="notes-item-preview">{getPreview(note.content)}</span>
								</div>
							</button>
						))
					)}
				</div>
			</div>

			{/* Editor */}
			<div className="notes-editor">
				{selectedNote ? (
					<>
						<div className="notes-editor-toolbar">
							<input
								type="text"
								className="notes-title-input"
								value={titleValue}
								onChange={handleTitleChange}
								placeholder="Note title..."
							/>
							<div className="notes-toolbar-actions">
								<span className="notes-save-status">
									{saveStatus === 'saving' && 'Saving...'}
									{saveStatus === 'saved' && '✓ Saved'}
								</span>
								<button
									type="button"
									className="notes-toolbar-btn notes-toolbar-btn-danger"
									onClick={handleDeleteNote}
									title="Delete note"
								>
									<svg
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
									>
										<title>Delete Note</title>
										<polyline points="3 6 5 6 21 6" />
										<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
									</svg>
								</button>
							</div>
						</div>
						<div className="notes-editor-content">
							<EditorContent editor={editor} />
						</div>
					</>
				) : (
					<div className="notes-editor-empty">
						<div className="notes-editor-empty-icon">
							<svg
								width="48"
								height="48"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
							>
								<title>No note selected</title>
								<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
								<polyline points="14 2 14 8 20 8" />
							</svg>
						</div>
						<p>Select a note or create a new one</p>
						<button type="button" onClick={onCreateNote}>New Note</button>
					</div>
				)}
			</div>
		</div>
	);
};
