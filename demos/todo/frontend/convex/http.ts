/**
 * HTTP Actions for external chat server to call
 * These bypass auth for system-level access (MVP approach)
 * TODO: Add token forwarding for user-scoped calls
 */
import { httpRouter } from 'convex/server';
import { api, internal } from './_generated/api';
import { httpAction } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { auth } from './auth';

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
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		},
	});
}

// CORS preflight handler
http.route({
	path: '/api/todos/create',
	method: 'OPTIONS',
	handler: httpAction(async () => {
		return new Response(null, {
			status: 204,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			},
		});
	}),
});

// POST /api/todos/create
http.route({
	path: '/api/todos/create',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		try {
			const body = (await parseBody(request)) as {
				title?: string;
				priority?: 'low' | 'medium' | 'high';
				description?: string;
				userId?: string;
			};

			if (!body.title) {
				return jsonResponse({ success: false, error: { message: 'Title required' } }, 400);
			}

			// Use internal mutation (bypasses auth)
			const todo = await ctx.runMutation(internal.todos.systemCreate, {
				title: body.title,
				priority: body.priority,
				description: body.description,
				userId: body.userId,
			});

			return jsonResponse({ success: true, data: todo });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return jsonResponse({ success: false, error: { message } }, 500);
		}
	}),
});

// POST /api/todos/list
http.route({
	path: '/api/todos/list',
	method: 'OPTIONS',
	handler: httpAction(async () => {
		return new Response(null, {
			status: 204,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			},
		});
	}),
});

http.route({
	path: '/api/todos/list',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		try {
			const body = (await parseBody(request)) as {
				completed?: boolean;
				priority?: string;
				limit?: number;
				userId?: string;
			};

			// Use internal query (bypasses auth)
			const todos = await ctx.runQuery(internal.todos.systemList, {
				userId: body.userId,
				completed: body.completed,
				limit: body.limit,
			});

			// Apply priority filter (not in internal query for simplicity)
			let filtered = todos;
			if (body.priority) {
				filtered = filtered.filter((t: { priority: string }) => t.priority === body.priority);
			}

			return jsonResponse({
				success: true,
				data: {
					items: filtered,
					total: filtered.length,
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return jsonResponse({ success: false, error: { message } }, 500);
		}
	}),
});

// POST /api/todos/toggle
http.route({
	path: '/api/todos/toggle',
	method: 'OPTIONS',
	handler: httpAction(async () => {
		return new Response(null, {
			status: 204,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			},
		});
	}),
});

http.route({
	path: '/api/todos/toggle',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		try {
			const body = (await parseBody(request)) as { id?: string };

			if (!body.id) {
				return jsonResponse({ success: false, error: { message: 'ID required' } }, 400);
			}

			const result = await ctx.runMutation(internal.todos.systemToggle, {
				id: body.id as unknown as Id<'todos'>, // Convex ID type
			});

			return jsonResponse({ success: true, data: result });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return jsonResponse({ success: false, error: { message } }, 500);
		}
	}),
});

// POST /api/todos/update
http.route({
	path: '/api/todos/update',
	method: 'OPTIONS',
	handler: httpAction(async () => {
		return new Response(null, {
			status: 204,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			},
		});
	}),
});

http.route({
	path: '/api/todos/update',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		try {
			const body = (await parseBody(request)) as {
				id?: string;
				title?: string;
				description?: string;
				priority?: 'low' | 'medium' | 'high';
			};

			if (!body.id) {
				return jsonResponse({ success: false, error: { message: 'ID required' } }, 400);
			}

			const { id, ...updates } = body;
			const result = await ctx.runMutation(internal.todos.systemUpdate, {
				id: id as unknown as Id<'todos'>, // Convex ID type
				...updates,
			});

			return jsonResponse({ success: true, data: result });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return jsonResponse({ success: false, error: { message } }, 500);
		}
	}),
});

// POST /api/todos/delete
http.route({
	path: '/api/todos/delete',
	method: 'OPTIONS',
	handler: httpAction(async () => {
		return new Response(null, {
			status: 204,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			},
		});
	}),
});

http.route({
	path: '/api/todos/delete',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		try {
			const body = (await parseBody(request)) as { id?: string };

			if (!body.id) {
				return jsonResponse({ success: false, error: { message: 'ID required' } }, 400);
			}

			const result = await ctx.runMutation(internal.todos.systemDelete, {
				id: body.id as unknown as Id<'todos'>, // Convex ID type
			});

			return jsonResponse({ success: true, data: result });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return jsonResponse({ success: false, error: { message } }, 500);
		}
	}),
});

// POST /api/todos/stats
http.route({
	path: '/api/todos/stats',
	method: 'OPTIONS',
	handler: httpAction(async () => {
		return new Response(null, {
			status: 204,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			},
		});
	}),
});

http.route({
	path: '/api/todos/stats',
	method: 'POST',
	handler: httpAction(async (ctx) => {
		try {
			// Use internal query (bypasses auth)
			const stats = await ctx.runQuery(internal.todos.systemStats, {});
			return jsonResponse({ success: true, data: stats });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return jsonResponse({ success: false, error: { message } }, 500);
		}
	}),
});

// POST /api/todos/clear-completed
http.route({
	path: '/api/todos/clear-completed',
	method: 'OPTIONS',
	handler: httpAction(async () => {
		return new Response(null, {
			status: 204,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			},
		});
	}),
});

http.route({
	path: '/api/todos/clear-completed',
	method: 'POST',
	handler: httpAction(async (ctx) => {
		try {
			const result = await ctx.runMutation(internal.todos.systemClearCompleted, {});
			return jsonResponse({ success: true, data: result });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return jsonResponse({ success: false, error: { message } }, 500);
		}
	}),
});

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT SESSIONS API (For lushx MCP server)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/sessions/create
http.route({
	path: '/api/sessions/create',
	method: 'OPTIONS',
	handler: httpAction(async () => {
		return new Response(null, {
			status: 204,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			},
		});
	}),
});

http.route({
	path: '/api/sessions/create',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		try {
			const body = (await parseBody(request)) as {
				agentId?: string;
				workflow?: string;
				issue?: string;
				pane?: number;
			};

			if (!body.agentId || !body.workflow) {
				return jsonResponse(
					{ success: false, error: { message: 'agentId and workflow required' } },
					400
				);
			}

			const result = await ctx.runMutation(api.agentSessions.create, {
				agentId: body.agentId,
				workflow: body.workflow,
				issue: body.issue,
				pane: body.pane,
			});

			return jsonResponse({ success: true, data: result });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return jsonResponse({ success: false, error: { message } }, 500);
		}
	}),
});

// POST /api/sessions/status
http.route({
	path: '/api/sessions/status',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		try {
			const body = (await parseBody(request)) as { agentId?: string };

			if (!body.agentId) {
				return jsonResponse({ success: false, error: { message: 'agentId required' } }, 400);
			}

			const result = await ctx.runQuery(api.agentSessions.getStatus, {
				agentId: body.agentId,
			});

			return jsonResponse({ success: true, data: result });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return jsonResponse({ success: false, error: { message } }, 500);
		}
	}),
});

// POST /api/sessions/list
http.route({
	path: '/api/sessions/list',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		try {
			const body = (await parseBody(request)) as {
				state?: 'running' | 'paused' | 'stopped' | 'complete';
				limit?: number;
			};

			const result = await ctx.runQuery(api.agentSessions.list, {
				state: body.state,
				limit: body.limit,
			});

			return jsonResponse({ success: true, data: result });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return jsonResponse({ success: false, error: { message } }, 500);
		}
	}),
});

// POST /api/sessions/update
http.route({
	path: '/api/sessions/update',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		try {
			const body = (await parseBody(request)) as {
				agentId?: string;
				state?: 'running' | 'paused' | 'stopped' | 'complete';
				outputLines?: number;
			};

			if (!body.agentId) {
				return jsonResponse({ success: false, error: { message: 'agentId required' } }, 400);
			}

			const result = await ctx.runMutation(api.agentSessions.updateStatus, {
				agentId: body.agentId,
				state: body.state,
				outputLines: body.outputLines,
			});

			return jsonResponse({ success: true, data: result });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return jsonResponse({ success: false, error: { message } }, 500);
		}
	}),
});

export default http;
