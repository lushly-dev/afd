/**
 * AFD Todo Demo - Command Registry
 * 
 * Registers all todo-related commands with the AFD server.
 */
import { z } from 'zod';
import { CommandRegistry } from '@lushly-dev/afd-core';
import { TaskStore } from './stores/task-store.js';
import { ListStore } from './stores/list-store.js';

// Schemas
const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(['pending', 'completed']),
  completedAt: z.string().optional(),
  listId: z.string(),
  parentId: z.string().optional(),
  position: z.number(),
  dueDate: z.string().optional(),
  dueTime: z.string().optional(),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ListSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
  icon: z.string().optional(),
  position: z.number(),
  isArchived: z.boolean(),
});

export type Task = z.infer<typeof TaskSchema>;
export type List = z.infer<typeof ListSchema>;

export function registerCommands(registry: CommandRegistry, taskStore: TaskStore, listStore: ListStore) {
  // ====== Task Commands ======
  
  registry.register({
    name: 'task-create',
    description: 'Create a new task',
    inputSchema: z.object({
      title: z.string().min(1).describe('Task title'),
      description: z.string().optional().describe('Task description'),
      listId: z.string().optional().describe('List to add task to (defaults to Inbox)'),
      dueDate: z.string().optional().describe('Due date (ISO format)'),
      dueTime: z.string().optional().describe('Due time (HH:mm format)'),
      priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional().describe('Priority: 0=none, 1=low, 2=medium, 3=high'),
      tags: z.array(z.string()).optional().describe('Tags for the task'),
    }),
    outputSchema: TaskSchema,
    handler: async (input) => {
      const task = taskStore.create(input);
      return {
        data: task,
        metadata: {
          confidence: 1.0,
          reasoning: `Created task "${task.title}"`,
        },
      };
    },
  });

  registry.register({
    name: 'task-list',
    description: 'List tasks with optional filters',
    inputSchema: z.object({
      listId: z.string().optional().describe('Filter by list'),
      status: z.enum(['pending', 'completed', 'all']).optional().describe('Filter by status'),
      dueDate: z.string().optional().describe('Filter by due date'),
      limit: z.number().optional().describe('Max results'),
    }),
    outputSchema: z.array(TaskSchema),
    handler: async (input) => {
      const tasks = taskStore.list(input);
      return {
        data: tasks,
        metadata: {
          confidence: 1.0,
          reasoning: `Found ${tasks.length} tasks`,
        },
      };
    },
  });

  registry.register({
    name: 'task-update',
    description: 'Update an existing task',
    inputSchema: z.object({
      id: z.string().describe('Task ID'),
      title: z.string().optional(),
      description: z.string().optional(),
      listId: z.string().optional(),
      dueDate: z.string().optional(),
      dueTime: z.string().optional(),
      priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
      tags: z.array(z.string()).optional(),
    }),
    outputSchema: TaskSchema,
    handler: async (input) => {
      const task = taskStore.update(input.id, input);
      return {
        data: task,
        metadata: {
          confidence: 1.0,
          reasoning: `Updated task "${task.title}"`,
        },
      };
    },
  });

  registry.register({
    name: 'task-complete',
    description: 'Mark a task as completed',
    inputSchema: z.object({
      id: z.string().describe('Task ID'),
    }),
    outputSchema: TaskSchema,
    handler: async (input) => {
      const task = taskStore.complete(input.id);
      return {
        data: task,
        metadata: {
          confidence: 1.0,
          reasoning: `Completed task "${task.title}"`,
        },
      };
    },
  });

  registry.register({
    name: 'task-uncomplete',
    description: 'Reopen a completed task',
    inputSchema: z.object({
      id: z.string().describe('Task ID'),
    }),
    outputSchema: TaskSchema,
    handler: async (input) => {
      const task = taskStore.uncomplete(input.id);
      return {
        data: task,
        metadata: {
          confidence: 1.0,
          reasoning: `Reopened task "${task.title}"`,
        },
      };
    },
  });

  registry.register({
    name: 'task-delete',
    description: 'Delete a task',
    inputSchema: z.object({
      id: z.string().describe('Task ID'),
    }),
    outputSchema: z.object({ deleted: z.boolean() }),
    handler: async (input) => {
      taskStore.delete(input.id);
      return {
        data: { deleted: true },
        metadata: {
          confidence: 1.0,
          reasoning: `Deleted task ${input.id}`,
        },
      };
    },
  });

  // ====== List Commands ======

  registry.register({
    name: 'list-create',
    description: 'Create a new list/project',
    inputSchema: z.object({
      name: z.string().min(1).describe('List name'),
      color: z.string().optional().describe('Color (hex)'),
      icon: z.string().optional().describe('Icon emoji'),
    }),
    outputSchema: ListSchema,
    handler: async (input) => {
      const list = listStore.create(input);
      return {
        data: list,
        metadata: {
          confidence: 1.0,
          reasoning: `Created list "${list.name}"`,
        },
      };
    },
  });

  registry.register({
    name: 'list-list',
    description: 'Get all lists',
    inputSchema: z.object({
      includeArchived: z.boolean().optional().describe('Include archived lists'),
    }),
    outputSchema: z.array(ListSchema),
    handler: async (input) => {
      const lists = listStore.list(input);
      return {
        data: lists,
        metadata: {
          confidence: 1.0,
          reasoning: `Found ${lists.length} lists`,
        },
      };
    },
  });

  registry.register({
    name: 'list-update',
    description: 'Update a list',
    inputSchema: z.object({
      id: z.string().describe('List ID'),
      name: z.string().optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
      isArchived: z.boolean().optional(),
    }),
    outputSchema: ListSchema,
    handler: async (input) => {
      const list = listStore.update(input.id, input);
      return {
        data: list,
        metadata: {
          confidence: 1.0,
          reasoning: `Updated list "${list.name}"`,
        },
      };
    },
  });

  registry.register({
    name: 'list-delete',
    description: 'Delete a list and optionally its tasks',
    inputSchema: z.object({
      id: z.string().describe('List ID'),
      deleteTasks: z.boolean().optional().describe('Also delete tasks in this list'),
    }),
    outputSchema: z.object({ deleted: z.boolean(), tasksDeleted: z.number() }),
    handler: async (input) => {
      let tasksDeleted = 0;
      if (input.deleteTasks) {
        tasksDeleted = taskStore.deleteByListId(input.id);
      } else {
        // Move tasks to Inbox
        taskStore.moveToInbox(input.id);
      }
      listStore.delete(input.id);
      return {
        data: { deleted: true, tasksDeleted },
        metadata: {
          confidence: 1.0,
          reasoning: `Deleted list ${input.id}${tasksDeleted > 0 ? ` and ${tasksDeleted} tasks` : ''}`,
        },
      };
    },
  });
}
