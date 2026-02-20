export type Priority = 'low' | 'medium' | 'high';

export interface Todo {
	id: string;
	title: string;
	description?: string;
	completed: boolean;
	priority: Priority;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
}

export interface TodoStats {
	total: number;
	completed: number;
	pending: number;
	completionRate: number;
}

export interface Source {
	type?: string;
	title?: string;
	url?: string;
	relevance?: number;
}

export interface PlanStep {
	name?: string;
	action?: string;
	description?: string;
	status?: 'pending' | 'in-progress' | 'complete' | 'failed';
}

export interface CommandResult<T> {
	success: boolean;
	data: T;
	error?: {
		code: string;
		message: string;
		suggestion?: string;
		retryable?: boolean;
	};
	reasoning?: string;
	confidence?: number;
	warnings?: Array<{
		code: string;
		message: string;
		severity?: string;
	}>;
	metadata?: {
		executionTimeMs: number;
	};
	sources?: Source[];
	plan?: PlanStep[];
}
