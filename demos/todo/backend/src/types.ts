/**
 * AFD Todo Demo - Type Definitions
 */

/** Priority level for tasks */
export type Priority = 0 | 1 | 2 | 3;

/** Task status */
export type TaskStatus = 'pending' | 'completed';

/** Task entity */
export interface Task {
	id: string;
	title: string;
	description?: string;
	status: TaskStatus;
	completedAt?: string;
	listId: string;
	parentId?: string;
	position: number;
	dueDate?: string;
	dueTime?: string;
	priority: Priority;
	tags: string[];
	createdAt: string;
	updatedAt: string;
}

/** List entity */
export interface List {
	id: string;
	name: string;
	color?: string;
	icon?: string;
	position: number;
	isArchived: boolean;
}
