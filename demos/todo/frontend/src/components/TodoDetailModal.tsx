import type React from 'react';
import { useEffect, useState } from 'react';
import type { Todo } from '../types';
import { MarkdownEditor } from './MarkdownEditor';
import './TodoDetailModal.css';

interface TodoDetailModalProps {
	todo: Todo | null;
	onClose: () => void;
	onSave: (
		id: string,
		updates: { title?: string; description?: string; priority?: Todo['priority'] }
	) => void;
}

export const TodoDetailModal: React.FC<TodoDetailModalProps> = ({ todo, onClose, onSave }) => {
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [priority, setPriority] = useState<Todo['priority']>('medium');
	const [hasChanges, setHasChanges] = useState(false);

	useEffect(() => {
		if (todo) {
			setTitle(todo.title);
			setDescription(todo.description || '');
			setPriority(todo.priority);
			setHasChanges(false);
		}
	}, [todo]);

	if (!todo) return null;

	const handleTitleChange = (newTitle: string) => {
		setTitle(newTitle);
		setHasChanges(true);
	};

	const handleDescriptionChange = (newDescription: string) => {
		setDescription(newDescription);
		setHasChanges(true);
	};

	const handlePriorityChange = (newPriority: Todo['priority']) => {
		setPriority(newPriority);
		setHasChanges(true);
	};

	const handleSave = () => {
		const updates: { title?: string; description?: string; priority?: Todo['priority'] } = {};
		if (title !== todo.title) updates.title = title;
		if (description !== (todo.description || '')) updates.description = description;
		if (priority !== todo.priority) updates.priority = priority;

		if (Object.keys(updates).length > 0) {
			onSave(todo.id, updates);
		}
		onClose();
	};

	const handleClose = () => {
		if (hasChanges) {
			if (confirm('You have unsaved changes. Are you sure you want to close?')) {
				onClose();
			}
		} else {
			onClose();
		}
	};

	return (
		<div className="modal-overlay" onClick={handleClose}>
			<div className="detail-modal" onClick={(e) => e.stopPropagation()}>
				<div className="detail-header">
					<input
						type="text"
						className="detail-title-input"
						value={title}
						onChange={(e) => handleTitleChange(e.target.value)}
						placeholder="Todo title"
					/>
					<button className="close-btn" onClick={handleClose}>
						&times;
					</button>
				</div>

				<div className="detail-meta">
					<div className="meta-item">
						<label>Priority:</label>
						<select
							value={priority}
							onChange={(e) => handlePriorityChange(e.target.value as Todo['priority'])}
							className="priority-select"
						>
							<option value="low">Low</option>
							<option value="medium">Medium</option>
							<option value="high">High</option>
						</select>
					</div>
					<div className="meta-item">
						<label>Status:</label>
						<span className={`status-badge ${todo.completed ? 'completed' : 'pending'}`}>
							{todo.completed ? 'Completed' : 'Pending'}
						</span>
					</div>
					<div className="meta-item">
						<label>Created:</label>
						<span>{new Date(todo.createdAt).toLocaleDateString()}</span>
					</div>
				</div>

				<div className="detail-body">
					<label className="description-label">Notes</label>
					<MarkdownEditor
						value={description}
						onChange={handleDescriptionChange}
						placeholder="Add notes, links, or any details about this task..."
					/>
				</div>

				<div className="detail-footer">
					<button className="btn-secondary" onClick={handleClose}>
						Cancel
					</button>
					<button className="btn-primary" onClick={handleSave} disabled={!hasChanges}>
						Save Changes
					</button>
				</div>
			</div>
		</div>
	);
};
