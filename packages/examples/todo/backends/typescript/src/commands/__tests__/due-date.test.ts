/**
 * @fileoverview Unit tests for due date filtering commands
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../../store/index.js';
import { createTodo } from '../create.js';
import { updateTodo } from '../update.js';
import { listTodos } from '../list.js';
import { listToday } from '../list-today.js';
import { listUpcoming } from '../list-upcoming.js';
import { getStats } from '../stats.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
	store.clear();
});

// Helper to create date at specific offset from today
function getDateOffset(days: number): string {
	const date = new Date();
	date.setDate(date.getDate() + days);
	return date.toISOString();
}

// Helper to get start of today
function getStartOfToday(): Date {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Helper to get end of today
function getEndOfToday(): Date {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
}

// ═══════════════════════════════════════════════════════════════════════════════
// todo-create with dueDate
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo-create with dueDate', () => {
	it('creates a todo with a due date', async () => {
		const dueDate = getDateOffset(1);
		const result = await createTodo.handler(
			{ title: 'Due tomorrow', priority: 'high', dueDate },
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.dueDate).toBe(dueDate);
		expect(result.reasoning).toContain('due');
	});

	it('creates a todo without a due date', async () => {
		const result = await createTodo.handler(
			{ title: 'No due date', priority: 'medium' },
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.dueDate).toBeUndefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo-update with dueDate
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo-update with dueDate', () => {
	it('updates a todo with a due date', async () => {
		const created = await createTodo.handler({ title: 'Test', priority: 'medium' }, {});
		const dueDate = getDateOffset(3);

		const result = await updateTodo.handler(
			{ id: created.data!.id, dueDate },
			{}
		);

		expect(result.success).toBe(true);
		expect(result.data?.dueDate).toBe(dueDate);
		expect(result.reasoning).toContain('due date');
	});

	it('clears a due date by setting to null', async () => {
		const dueDate = getDateOffset(1);
		const created = await createTodo.handler(
			{ title: 'Has due date', priority: 'medium', dueDate },
			{}
		);

		const result = await updateTodo.handler(
			{ id: created.data!.id, dueDate: null },
			{}
		);

		expect(result.success).toBe(true);
		// dueDate should be cleared (either undefined or null)
		expect(result.data?.dueDate == null).toBe(true);
		expect(result.reasoning).toContain('cleared due date');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo-list with due date filters
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo-list with due date filters', () => {
	beforeEach(async () => {
		// Create todos with various due dates
		await createTodo.handler({ title: 'Overdue', priority: 'high', dueDate: getDateOffset(-2) }, {});
		await createTodo.handler({ title: 'Due today', priority: 'medium', dueDate: new Date().toISOString() }, {});
		await createTodo.handler({ title: 'Due tomorrow', priority: 'low', dueDate: getDateOffset(1) }, {});
		await createTodo.handler({ title: 'Due next week', priority: 'medium', dueDate: getDateOffset(7) }, {});
		await createTodo.handler({ title: 'No due date', priority: 'low' }, {});
	});

	it('filters by dueBefore', async () => {
		// Use start of today to get only items with due date strictly before today
		const startOfToday = new Date();
		startOfToday.setHours(0, 0, 0, 0);

		const result = await listTodos.handler({
			dueBefore: startOfToday.toISOString(),
			sortBy: 'dueDate',
			sortOrder: 'asc',
			limit: 20,
			offset: 0,
		}, {});

		expect(result.success).toBe(true);
		// Should include only overdue item (due before start of today)
		expect(result.data?.todos.length).toBe(1);
		expect(result.data?.todos[0].title).toBe('Overdue');
	});

	it('filters by dueAfter', async () => {
		const result = await listTodos.handler({
			dueAfter: getDateOffset(0),
			sortBy: 'dueDate',
			sortOrder: 'asc',
			limit: 20,
			offset: 0,
		}, {});

		expect(result.success).toBe(true);
		// Should include due today, tomorrow, and next week
		expect(result.data?.todos.length).toBeGreaterThanOrEqual(2);
	});

	it('filters by overdue status', async () => {
		const result = await listTodos.handler({
			overdue: true,
			sortBy: 'dueDate',
			sortOrder: 'asc',
			limit: 20,
			offset: 0,
		}, {});

		expect(result.success).toBe(true);
		expect(result.data?.todos.length).toBe(1);
		expect(result.data?.todos[0].title).toBe('Overdue');
	});

	it('sorts by dueDate', async () => {
		const result = await listTodos.handler({
			sortBy: 'dueDate',
			sortOrder: 'asc',
			limit: 20,
			offset: 0,
		}, {});

		expect(result.success).toBe(true);
		// First items should have earliest due dates
		const todosWithDueDates = result.data?.todos.filter((t) => t.dueDate);
		expect(todosWithDueDates?.length).toBeGreaterThan(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo-list-today
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo-list-today', () => {
	it('returns empty result when no todos due today', async () => {
		const result = await listToday.handler({
			includeOverdue: false,
			includeCompleted: false,
			sortBy: 'priority',
			sortOrder: 'desc',
			limit: 20,
			offset: 0,
		}, {});

		expect(result.success).toBe(true);
		expect(result.data?.todos).toHaveLength(0);
		expect(result.data?.todayCount).toBe(0);
		expect(result.reasoning).toContain('No tasks due today');
	});

	it('returns todos due today', async () => {
		// Create a todo due today
		const today = new Date();
		today.setHours(12, 0, 0, 0);
		await createTodo.handler({ title: 'Due today', priority: 'high', dueDate: today.toISOString() }, {});

		const result = await listToday.handler({
			includeOverdue: false,
			includeCompleted: false,
			sortBy: 'priority',
			sortOrder: 'desc',
			limit: 20,
			offset: 0,
		}, {});

		expect(result.success).toBe(true);
		expect(result.data?.todayCount).toBe(1);
		expect(result.data?.todos[0].title).toBe('Due today');
	});

	it('includes overdue todos when flag is set', async () => {
		// Create overdue todo
		await createTodo.handler({ title: 'Overdue task', priority: 'high', dueDate: getDateOffset(-2) }, {});

		const withOverdue = await listToday.handler({
			includeOverdue: true,
			includeCompleted: false,
			sortBy: 'priority',
			sortOrder: 'desc',
			limit: 20,
			offset: 0,
		}, {});

		const withoutOverdue = await listToday.handler({
			includeOverdue: false,
			includeCompleted: false,
			sortBy: 'priority',
			sortOrder: 'desc',
			limit: 20,
			offset: 0,
		}, {});

		expect(withOverdue.data?.overdueCount).toBe(1);
		expect(withoutOverdue.data?.overdueCount).toBe(0);
	});

	it('provides alternatives when no tasks today', async () => {
		// Create a future todo
		await createTodo.handler({ title: 'Future task', priority: 'medium', dueDate: getDateOffset(3) }, {});

		const result = await listToday.handler({
			includeOverdue: false,
			includeCompleted: false,
			sortBy: 'priority',
			sortOrder: 'desc',
			limit: 20,
			offset: 0,
		}, {});

		expect(result.success).toBe(true);
		expect(result.data?.total).toBe(0);
		expect(result.alternatives).toBeDefined();
		expect(result.alternatives?.length).toBeGreaterThan(0);
		expect(result.alternatives?.[0].reason).toContain('upcoming');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo-list-upcoming
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo-list-upcoming', () => {
	it('returns empty result when no upcoming todos', async () => {
		const result = await listUpcoming.handler({
			days: 7,
			includeCompleted: false,
			sortBy: 'dueDate',
			sortOrder: 'asc',
			limit: 20,
			offset: 0,
		}, {});

		expect(result.success).toBe(true);
		expect(result.data?.todos).toHaveLength(0);
		expect(result.data?.total).toBe(0);
		expect(result.reasoning).toContain('No upcoming');
	});

	it('returns todos within the specified days', async () => {
		// Create todos at various future dates
		const today = new Date();
		today.setHours(14, 0, 0, 0);
		await createTodo.handler({ title: 'Due today', priority: 'high', dueDate: today.toISOString() }, {});
		await createTodo.handler({ title: 'Due in 3 days', priority: 'medium', dueDate: getDateOffset(3) }, {});
		await createTodo.handler({ title: 'Due in 10 days', priority: 'low', dueDate: getDateOffset(10) }, {});

		const result = await listUpcoming.handler({
			days: 7,
			includeCompleted: false,
			sortBy: 'dueDate',
			sortOrder: 'asc',
			limit: 20,
			offset: 0,
		}, {});

		expect(result.success).toBe(true);
		// Should include today and 3 days, but not 10 days
		expect(result.data?.total).toBe(2);
		expect(result.data?.daysAhead).toBe(7);
	});

	it('calculates breakdown correctly', async () => {
		const today = new Date();
		today.setHours(14, 0, 0, 0);
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		tomorrow.setHours(14, 0, 0, 0);

		await createTodo.handler({ title: 'Today 1', priority: 'high', dueDate: today.toISOString() }, {});
		await createTodo.handler({ title: 'Today 2', priority: 'medium', dueDate: today.toISOString() }, {});
		await createTodo.handler({ title: 'Tomorrow', priority: 'low', dueDate: tomorrow.toISOString() }, {});

		const result = await listUpcoming.handler({
			days: 7,
			includeCompleted: false,
			sortBy: 'dueDate',
			sortOrder: 'asc',
			limit: 20,
			offset: 0,
		}, {});

		expect(result.success).toBe(true);
		expect(result.data?.breakdown.today).toBe(2);
		expect(result.data?.breakdown.tomorrow).toBe(1);
	});

	it('filters by priority', async () => {
		await createTodo.handler({ title: 'High priority', priority: 'high', dueDate: getDateOffset(1) }, {});
		await createTodo.handler({ title: 'Low priority', priority: 'low', dueDate: getDateOffset(1) }, {});

		const result = await listUpcoming.handler({
			days: 7,
			includeCompleted: false,
			priority: 'high',
			sortBy: 'dueDate',
			sortOrder: 'asc',
			limit: 20,
			offset: 0,
		}, {});

		expect(result.success).toBe(true);
		expect(result.data?.todos).toHaveLength(1);
		expect(result.data?.todos[0].title).toBe('High priority');
	});

	it('supports pagination', async () => {
		// Create multiple upcoming todos
		for (let i = 1; i <= 5; i++) {
			await createTodo.handler({
				title: `Task ${i}`,
				priority: 'medium',
				dueDate: getDateOffset(i),
			}, {});
		}

		const page1 = await listUpcoming.handler({
			days: 7,
			includeCompleted: false,
			sortBy: 'dueDate',
			sortOrder: 'asc',
			limit: 2,
			offset: 0,
		}, {});

		const page2 = await listUpcoming.handler({
			days: 7,
			includeCompleted: false,
			sortBy: 'dueDate',
			sortOrder: 'asc',
			limit: 2,
			offset: 2,
		}, {});

		expect(page1.data?.todos).toHaveLength(2);
		expect(page1.data?.hasMore).toBe(true);
		expect(page2.data?.todos).toHaveLength(2);
		expect(page2.data?.hasMore).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// todo-stats with overdue
// ═══════════════════════════════════════════════════════════════════════════════

describe('todo-stats with overdue count', () => {
	it('counts overdue todos', async () => {
		// Create overdue todo
		await createTodo.handler({ title: 'Overdue', priority: 'high', dueDate: getDateOffset(-2) }, {});
		// Create non-overdue todo
		await createTodo.handler({ title: 'Future', priority: 'medium', dueDate: getDateOffset(2) }, {});
		// Create todo without due date
		await createTodo.handler({ title: 'No date', priority: 'low' }, {});

		const result = await getStats.handler({}, {});

		expect(result.success).toBe(true);
		expect(result.data?.overdue).toBe(1);
		expect(result.data?.total).toBe(3);
	});

	it('does not count completed todos as overdue', async () => {
		// Create and complete an overdue todo
		const created = await createTodo.handler({
			title: 'Completed overdue',
			priority: 'high',
			dueDate: getDateOffset(-2),
		}, {});

		// Toggle to completed using the store directly
		store.toggle(created.data!.id);

		const result = await getStats.handler({}, {});

		expect(result.success).toBe(true);
		expect(result.data?.overdue).toBe(0);
	});
});
