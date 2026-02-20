import type React from 'react';
import { useState } from 'react';
import type { Priority } from '../types';

interface TodoFormProps {
	onAdd: (title: string, priority: Priority, description?: string) => void;
}

export const TodoForm: React.FC<TodoFormProps> = ({ onAdd }) => {
	const [title, setTitle] = useState('');
	const [priority, setPriority] = useState<Priority>('medium');
	const [description, setDescription] = useState('');

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!title.trim()) return;
		onAdd(title, priority, description);
		setTitle('');
		setDescription('');
		setPriority('medium');
	};

	return (
		<form onSubmit={handleSubmit} className="todo-form">
			<input
				type="text"
				placeholder="What needs to be done?"
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				className="title-input"
			/>
			<select
				value={priority}
				onChange={(e) => setPriority(e.target.value as Priority)}
				className="priority-select"
			>
				<option value="low">Low</option>
				<option value="medium">Medium</option>
				<option value="high">High</option>
			</select>
			<button type="submit" className="add-btn">
				Add
			</button>
		</form>
	);
};
