/**
 * @fileoverview Tests for MCP integration (Phase 3)
 */

import { failure, success } from '@lushly-dev/afd-core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	// MCP Server
	createMcpTestingServer,
	createToolRegistry,
	enhanceWithAgentHints,
	executeTool,
	// Hints
	generateAgentHints,
	generateCoverageHints,
	generateTestReportHints,
	// Tools
	generateTools,
	getTool,
	type JsonRpcRequest,
	type McpTestingServer,
	type McpTool,
	// Suggest
	scenarioSuggest,
} from '../index.js';

// ============================================================================
// MCP Server Tests
// ============================================================================

describe('MCP Server', () => {
	let server: McpTestingServer;

	beforeEach(() => {
		server = createMcpTestingServer({
			name: 'test-server',
			version: '1.0.0',
		});
	});

	it('should create a server with name and version', () => {
		expect(server.name).toBe('test-server');
		expect(server.version).toBe('1.0.0');
	});

	it('should handle initialize request', async () => {
		const request: JsonRpcRequest = {
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
		};

		const response = await server.handleRequest(request);

		expect(response.jsonrpc).toBe('2.0');
		expect(response.id).toBe(1);
		expect(response.error).toBeUndefined();
		expect(response.result).toMatchObject({
			protocolVersion: '2024-11-05',
			serverInfo: {
				name: 'test-server',
				version: '1.0.0',
			},
			capabilities: {
				tools: { listChanged: false },
			},
		});
	});

	it('should handle ping request', async () => {
		const request: JsonRpcRequest = {
			jsonrpc: '2.0',
			id: 2,
			method: 'ping',
		};

		const response = await server.handleRequest(request);

		expect(response.error).toBeUndefined();
		expect(response.result).toEqual({});
	});

	it('should handle tools/list request', async () => {
		const request: JsonRpcRequest = {
			jsonrpc: '2.0',
			id: 3,
			method: 'tools/list',
		};

		const response = await server.handleRequest(request);

		expect(response.error).toBeUndefined();
		const result = response.result as { tools: McpTool[] };
		expect(result.tools).toBeInstanceOf(Array);
		expect(result.tools.length).toBeGreaterThan(0);

		// Check tool structure
		const firstTool = result.tools[0];
		expect(firstTool).toHaveProperty('name');
		expect(firstTool).toHaveProperty('description');
		expect(firstTool).toHaveProperty('inputSchema');
	});

	it('should handle unknown method with error', async () => {
		const request: JsonRpcRequest = {
			jsonrpc: '2.0',
			id: 4,
			method: 'unknown/method',
		};

		const response = await server.handleRequest(request);

		expect(response.error).toBeDefined();
		expect(response.error?.code).toBe(-32601); // METHOD_NOT_FOUND
		expect(response.error?.message).toContain('Unknown method');
	});

	it('should return tools via getTools()', () => {
		const tools = server.getTools();

		expect(tools).toBeInstanceOf(Array);
		expect(tools.length).toBe(5); // list, evaluate, coverage, create, suggest
		expect(tools.map((t) => t.name)).toContain('scenario.list');
		expect(tools.map((t) => t.name)).toContain('scenario.suggest');
	});
});

// ============================================================================
// MCP Tools Tests
// ============================================================================

describe('MCP Tools', () => {
	describe('generateTools', () => {
		it('should generate all scenario tools', () => {
			const tools = generateTools();

			expect(tools).toHaveLength(5);
			expect(tools.map((t) => t.name)).toEqual([
				'scenario.list',
				'scenario.evaluate',
				'scenario.coverage',
				'scenario.create',
				'scenario.suggest',
			]);
		});

		it('should have valid JSON Schema for each tool', () => {
			const tools = generateTools();

			for (const tool of tools) {
				expect(tool.inputSchema.type).toBe('object');
				expect(tool.inputSchema.properties).toBeDefined();
				expect(tool.description).toBeTruthy();
			}
		});
	});

	describe('getTool', () => {
		it('should return tool by name', () => {
			const tool = getTool('scenario.list');

			expect(tool).toBeDefined();
			expect(tool?.name).toBe('scenario.list');
		});

		it('should return undefined for unknown tool', () => {
			const tool = getTool('unknown.tool');

			expect(tool).toBeUndefined();
		});
	});

	describe('createToolRegistry', () => {
		it('should create registry with all tools', () => {
			const registry = createToolRegistry();

			expect(registry.size).toBe(5);
			expect(registry.has('scenario.list')).toBe(true);
			expect(registry.has('scenario.suggest')).toBe(true);
		});
	});

	describe('executeTool', () => {
		it('should return error for unknown tool', async () => {
			const registry = createToolRegistry();
			const result = await executeTool(registry, 'unknown.tool', {});

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('UNKNOWN_TOOL');
			expect(result._agentHints).toBeDefined();
		});
	});
});

// ============================================================================
// Agent Hints Tests
// ============================================================================

describe('Agent Hints', () => {
	describe('generateAgentHints', () => {
		it('should generate hints for successful result', () => {
			const result = success({ data: 'test' });
			const hints = generateAgentHints('test.command', result);

			expect(hints.shouldRetry).toBe(false);
			expect(hints.relatedCommands).toBeInstanceOf(Array);
			expect(hints.nextSteps).toBeInstanceOf(Array);
			expect(hints.interpretationConfidence).toBeGreaterThan(0);
		});

		it('should generate hints for failed result', () => {
			const result = failure({
				code: 'TEST_ERROR',
				message: 'Test error',
				suggestion: 'Try again later',
			});
			const hints = generateAgentHints('test.command', result);

			expect(hints.errorCodes).toContain('TEST_ERROR');
			expect(hints.shouldRetry).toBe(true); // "try again" in suggestion
		});

		it('should suggest retry for transient errors', () => {
			const result = failure({
				code: 'TIMEOUT',
				message: 'Request timed out',
			});
			const hints = generateAgentHints('test.command', result);

			expect(hints.shouldRetry).toBe(true);
		});

		it('should include related commands for scenario commands', () => {
			const result = success({ scenarios: [] });
			const hints = generateAgentHints('scenario.list', result);

			expect(hints.relatedCommands).toContain('scenario.evaluate');
		});
	});

	describe('generateTestReportHints', () => {
		it('should generate hints for passing report', () => {
			const report = {
				title: 'Test',
				durationMs: 100,
				scenarios: [
					{
						scenarioPath: 'test.yaml',
						jobName: 'Test',
						outcome: 'pass' as const,
						durationMs: 100,
						stepResults: [],
						passedSteps: 1,
						failedSteps: 0,
						skippedSteps: 0,
						startedAt: new Date(),
						completedAt: new Date(),
					},
				],
				summary: {
					totalScenarios: 1,
					passedScenarios: 1,
					failedScenarios: 0,
					errorScenarios: 0,
					totalSteps: 1,
					passedSteps: 1,
					failedSteps: 0,
					skippedSteps: 0,
					passRate: 1.0,
				},
				generatedAt: new Date(),
			};

			const hints = generateTestReportHints(report);

			expect(hints.shouldRetry).toBe(false);
			expect(hints.nextSteps).toContain('All tests passing - safe to proceed');
		});

		it('should suggest review for failing report', () => {
			const report = {
				title: 'Test',
				durationMs: 100,
				scenarios: [
					{
						scenarioPath: 'test.yaml',
						jobName: 'Test',
						outcome: 'fail' as const,
						durationMs: 100,
						stepResults: [],
						passedSteps: 0,
						failedSteps: 1,
						skippedSteps: 0,
						startedAt: new Date(),
						completedAt: new Date(),
					},
				],
				summary: {
					totalScenarios: 1,
					passedScenarios: 0,
					failedScenarios: 1,
					errorScenarios: 0,
					totalSteps: 1,
					passedSteps: 0,
					failedSteps: 1,
					skippedSteps: 0,
					passRate: 0.0,
				},
				generatedAt: new Date(),
			};

			const hints = generateTestReportHints(report);

			expect(hints.shouldRetry).toBe(true);
			expect(hints.nextSteps.some((s) => s.includes('Review'))).toBe(true);
		});
	});

	describe('generateCoverageHints', () => {
		it('should suggest creating tests for untested commands', () => {
			const hints = generateCoverageHints(['todo.list'], ['todo.create', 'todo.delete'], 33);

			expect(hints.untestedCommands).toContain('todo.create');
			expect(hints.untestedCommands).toContain('todo.delete');
			expect(hints.nextSteps.some((s) => s.includes('no test coverage'))).toBe(true);
		});

		it('should prioritize mutation commands', () => {
			const hints = generateCoverageHints([], ['todo.create', 'todo.delete', 'todo.list'], 0);

			expect(hints.nextSteps.some((s) => s.includes('Priority'))).toBe(true);
		});
	});

	describe('enhanceWithAgentHints', () => {
		it('should add _agentHints to result', () => {
			const result = success({ value: 1 });
			const enhanced = enhanceWithAgentHints('test', result);

			expect(enhanced._agentHints).toBeDefined();
			expect(enhanced.success).toBe(true);
			expect(enhanced.data).toEqual({ value: 1 });
		});
	});
});

// ============================================================================
// scenario.suggest Tests
// ============================================================================

describe('scenario.suggest', () => {
	describe('context: command', () => {
		it('should suggest scenarios for a specific command', async () => {
			const result = await scenarioSuggest({
				context: 'command',
				command: 'todo.create',
			});

			expect(result.success).toBe(true);
			expect(result.data?.suggestions.length).toBeGreaterThan(0);
			expect(result.data?.context).toBe('command');

			// Should suggest basic and validation tests
			const names = result.data?.suggestions.map((s) => s.name) ?? [];
			expect(names.some((n) => n.includes('todo-create'))).toBe(true);
		});

		it('should fail without command parameter', async () => {
			const result = await scenarioSuggest({
				context: 'command',
			});

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('MISSING_COMMAND');
		});
	});

	describe('context: natural', () => {
		it('should suggest based on query keywords', async () => {
			const result = await scenarioSuggest({
				context: 'natural',
				query: 'What tests do I need for error handling?',
			});

			expect(result.success).toBe(true);
			expect(result.data?.suggestions.some((s) => s.tags?.includes('error-handling'))).toBe(true);
		});

		it('should suggest CRUD tests for CRUD query', async () => {
			const result = await scenarioSuggest({
				context: 'natural',
				query: 'I need crud tests',
			});

			expect(result.success).toBe(true);
			expect(result.data?.suggestions.some((s) => s.tags?.includes('crud'))).toBe(true);
		});

		it('should fail without query parameter', async () => {
			const result = await scenarioSuggest({
				context: 'natural',
			});

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('MISSING_QUERY');
		});
	});

	describe('context: uncovered', () => {
		it('should suggest audit when no known commands provided', async () => {
			const result = await scenarioSuggest({
				context: 'uncovered',
				knownCommands: [],
			});

			expect(result.success).toBe(true);
			expect(result.data?.suggestions.some((s) => s.name.includes('coverage-audit'))).toBe(true);
		});
	});

	describe('context: changed-files', () => {
		it('should suggest tests for changed command files', async () => {
			const result = await scenarioSuggest({
				context: 'changed-files',
				files: ['src/commands/todo/create.ts'],
			});

			expect(result.success).toBe(true);
			expect(result.data?.suggestions.length).toBeGreaterThan(0);
			expect(result.data?.suggestions.some((s) => s.commands?.includes('todo.create'))).toBe(true);
		});

		it('should return empty suggestions for no changed files', async () => {
			const result = await scenarioSuggest({
				context: 'changed-files',
				files: [],
			});

			expect(result.success).toBe(true);
			expect(result.data?.suggestions).toEqual([]);
		});
	});

	describe('skeleton generation', () => {
		it('should include skeleton when requested', async () => {
			const result = await scenarioSuggest({
				context: 'command',
				command: 'todo.create',
				includeSkeleton: true,
			});

			expect(result.success).toBe(true);
			const withSkeleton = result.data?.suggestions.find((s) => s.skeleton);
			expect(withSkeleton?.skeleton).toBeDefined();
			expect(withSkeleton?.skeleton?.steps).toBeDefined();
		});
	});

	describe('limit and sorting', () => {
		it('should respect limit parameter', async () => {
			const result = await scenarioSuggest({
				context: 'command',
				command: 'todo.create',
				limit: 2,
			});

			expect(result.success).toBe(true);
			expect(result.data?.suggestions.length).toBeLessThanOrEqual(2);
		});

		it('should sort by priority and confidence', async () => {
			const result = await scenarioSuggest({
				context: 'command',
				command: 'todo.create',
			});

			expect(result.success).toBe(true);
			const suggestions = result.data?.suggestions ?? [];

			// High priority should come before medium/low
			const priorities = suggestions.map((s) => s.priority);
			const highIndex = priorities.indexOf('high');
			const lowIndex = priorities.indexOf('low');

			if (highIndex !== -1 && lowIndex !== -1) {
				expect(highIndex).toBeLessThan(lowIndex);
			}
		});
	});
});
