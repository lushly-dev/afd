import type React from 'react';
import type { Todo } from '../types';

interface TodoItemProps {
	todo: Todo;
	onToggle: (id: string) => void;
	onDelete: (id: string) => void;
	onEdit: (id: string) => void;
	selected?: boolean;
	onSelect?: (id: string) => void;
	showSelect?: boolean;
}

const formatDate = (isoString: string) => {
	const date = new Date(isoString);
	const now = new Date();
	const diff = now.getTime() - date.getTime();

	if (diff < 60000) return 'just now';
	if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
	if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
	if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

	return date.toLocaleDateString();
};

export const TodoItem: React.FC<TodoItemProps> = ({
	todo,
	onToggle,
	onDelete,
	onEdit,
	selected = false,
	onSelect,
	showSelect = false,
}) => {
	return (
		<div className={`todo-item ${todo.completed ? 'completed' : ''}`}>
			{showSelect && (
				<input
					type="checkbox"
					className="todo-select"
					checked={selected}
					onChange={() => onSelect?.(todo.id)}
				/>
			)}
			<div
				className={`todo-checkbox ${todo.completed ? 'checked' : ''}`}
				onClick={() => onToggle(todo.id)}
			/>
			<div className="todo-content">
				<div className="todo-title">{todo.title}</div>
				<div className="todo-meta">
					<span className={`priority-badge priority-${todo.priority}`}>{todo.priority}</span>
					<span>·</span>
					<span>{formatDate(todo.createdAt)}</span>
				</div>
			</div>
			<div className="todo-actions">
				<button type="button" onClick={() => onEdit(todo.id)}>
					Edit
				</button>
				<button type="button" onClick={() => onDelete(todo.id)}>
					Delete
				</button>
			</div>
		</div>
	);
};
