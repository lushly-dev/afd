/**
 * HTTP Actions for external chat server to call
 * These bypass auth for system-level access (MVP approach)
 * TODO: Add token forwarding for user-scoped calls
 */
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

// Auth routes
auth.addHttpRoutes(http);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT API ROUTES (System-level access for AI chat)
// ═══════════════════════════════════════════════════════════════════════════════

// Helper to parse JSON body
async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// Helper to create JSON response
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// CORS preflight handler
http.route({
  path: "/api/todos/create",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// POST /api/todos/create
http.route({
  path: "/api/todos/create",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await parseBody(request) as { 
        title?: string; 
        priority?: "low" | "medium" | "high";
        description?: string;
        userId?: string;
      };
      
      if (!body.title) {
        return jsonResponse({ success: false, error: { message: "Title required" } }, 400);
      }
      
      // For MVP: use a system user ID or the first user
      // TODO: Add token forwarding for proper user context
      const users = await ctx.runQuery(api.todos.list);
      
      // Create the todo
      const result = await ctx.runMutation(api.todos.create, {
        title: body.title,
        priority: body.priority || "medium",
        description: body.description,
      });
      
      return jsonResponse({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonResponse({ success: false, error: { message } }, 500);
    }
  }),
});

// POST /api/todos/list
http.route({
  path: "/api/todos/list",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

http.route({
  path: "/api/todos/list",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await parseBody(request) as { 
        completed?: boolean;
        priority?: string;
        limit?: number;
      };
      
      const todos = await ctx.runQuery(api.todos.list);
      
      // Apply filters
      let filtered = todos;
      if (body.completed !== undefined) {
        filtered = filtered.filter(t => t.completed === body.completed);
      }
      if (body.priority) {
        filtered = filtered.filter(t => t.priority === body.priority);
      }
      if (body.limit) {
        filtered = filtered.slice(0, body.limit);
      }
      
      return jsonResponse({ 
        success: true, 
        data: { 
          items: filtered,
          total: filtered.length 
        } 
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonResponse({ success: false, error: { message } }, 500);
    }
  }),
});

// POST /api/todos/toggle
http.route({
  path: "/api/todos/toggle",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

http.route({
  path: "/api/todos/toggle",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await parseBody(request) as { id?: string };
      
      if (!body.id) {
        return jsonResponse({ success: false, error: { message: "ID required" } }, 400);
      }
      
      const result = await ctx.runMutation(api.todos.toggle, { 
        id: body.id as any  // Convex ID type
      });
      
      return jsonResponse({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonResponse({ success: false, error: { message } }, 500);
    }
  }),
});

// POST /api/todos/update
http.route({
  path: "/api/todos/update",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

http.route({
  path: "/api/todos/update",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await parseBody(request) as { 
        id?: string;
        title?: string;
        description?: string;
        priority?: "low" | "medium" | "high";
      };
      
      if (!body.id) {
        return jsonResponse({ success: false, error: { message: "ID required" } }, 400);
      }
      
      const { id, ...updates } = body;
      const result = await ctx.runMutation(api.todos.update, { 
        id: id as any,  // Convex ID type
        ...updates
      });
      
      return jsonResponse({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonResponse({ success: false, error: { message } }, 500);
    }
  }),
});

// POST /api/todos/delete
http.route({
  path: "/api/todos/delete",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

http.route({
  path: "/api/todos/delete",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await parseBody(request) as { id?: string };
      
      if (!body.id) {
        return jsonResponse({ success: false, error: { message: "ID required" } }, 400);
      }
      
      const result = await ctx.runMutation(api.todos.remove, { 
        id: body.id as any  // Convex ID type
      });
      
      return jsonResponse({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonResponse({ success: false, error: { message } }, 500);
    }
  }),
});

// POST /api/todos/stats
http.route({
  path: "/api/todos/stats",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

http.route({
  path: "/api/todos/stats",
  method: "POST",
  handler: httpAction(async (ctx) => {
    try {
      const stats = await ctx.runQuery(api.todos.stats);
      return jsonResponse({ success: true, data: stats });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonResponse({ success: false, error: { message } }, 500);
    }
  }),
});

// POST /api/todos/clear-completed
http.route({
  path: "/api/todos/clear-completed",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

http.route({
  path: "/api/todos/clear-completed",
  method: "POST",
  handler: httpAction(async (ctx) => {
    try {
      const result = await ctx.runMutation(api.todos.clearCompleted);
      return jsonResponse({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonResponse({ success: false, error: { message } }, 500);
    }
  }),
});

export default http;
