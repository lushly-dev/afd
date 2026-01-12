import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Re-export the Id type for use in components
export type TodoId = Id<"todos">;

// Hook for reactive todos list with automatic updates
export function useConvexTodos() {
  const convexTodos = useQuery(api.todos.list);
  const convexStats = useQuery(api.todos.stats);

  const createMutation = useMutation(api.todos.create);
  const updateMutation = useMutation(api.todos.update);
  const toggleMutation = useMutation(api.todos.toggle);
  const removeMutation = useMutation(api.todos.remove);
  const batchToggleMutation = useMutation(api.todos.batchToggle);
  const batchDeleteMutation = useMutation(api.todos.batchDelete);
  const clearCompletedMutation = useMutation(api.todos.clearCompleted);

  // Map Convex data to match app expectations (convert _id to id, convert dates to strings)
  const todos = convexTodos?.map((todo) => ({
    ...todo,
    id: todo._id,
    priority: todo.priority, // Keep as string
    createdAt: new Date(todo.createdAt).toISOString(),
    updatedAt: new Date(todo.updatedAt).toISOString(),
  })) ?? [];

  const stats = convexStats ? {
    ...convexStats,
    completionRate: convexStats.total > 0 ? convexStats.completed / convexStats.total : 0,
  } : { total: 0, completed: 0, pending: 0, completionRate: 0, byPriority: { high: 0, medium: 0, low: 0 } };

  return {
    // Reactive data (automatically updates on changes)
    todos,
    stats,
    isLoading: convexTodos === undefined,
    
    // Mutations
    create: async (title: string, options?: { description?: string; priority?: "low" | "medium" | "high" }) => {
      return await createMutation({
        title,
        description: options?.description,
        priority: options?.priority,
      });
    },
    
    update: async (id: string, updates: { title?: string; description?: string; priority?: "low" | "medium" | "high" }) => {
      return await updateMutation({ id: id as TodoId, ...updates });
    },

    toggle: async (id: string) => {
      return await toggleMutation({ id: id as TodoId });
    },

    remove: async (id: string) => {
      return await removeMutation({ id: id as TodoId });
    },
    
    // Batch operations
    batchToggle: async (ids: string[], completed: boolean) => {
      return await batchToggleMutation({ ids: ids as TodoId[], completed });
    },

    batchDelete: async (ids: string[]) => {
      return await batchDeleteMutation({ ids: ids as TodoId[] });
    },
    
    clearCompleted: async () => {
      return await clearCompletedMutation({});
    },
  };
}
