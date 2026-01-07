/**
 * @fileoverview scenario.suggest command
 *
 * AI-powered scenario suggestions based on context.
 * Supports multiple suggestion strategies:
 * - changed-files: Suggest scenarios for modified code
 * - uncovered: Suggest scenarios for untested commands
 * - failed: Suggest scenarios based on recent failures
 * - command: Suggest scenarios for a specific command
 * - natural: Natural language query-based suggestions
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import { success, failure } from '@lushly-dev/afd-core';
import { scenarioCoverage, type ScenarioCoverageOutput } from './coverage.js';
import { scenarioList, type ScenarioSummary } from './list.js';
import type { Scenario, Step } from '../types/scenario.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Context type for suggestions.
 */
export type SuggestionContext =
  | 'changed-files'
  | 'uncovered'
  | 'failed'
  | 'command'
  | 'natural';

/**
 * Input for scenario.suggest command.
 */
export interface ScenarioSuggestInput {
  /** Context type for suggestions */
  context: SuggestionContext;

  /** Changed files (for changed-files context) */
  files?: string[];

  /** Specific command to suggest scenarios for */
  command?: string;

  /** Natural language query */
  query?: string;

  /** Directory containing scenarios */
  directory?: string;

  /** Known commands for coverage analysis */
  knownCommands?: string[];

  /** Maximum suggestions */
  limit?: number;

  /** Include scenario skeletons */
  includeSkeleton?: boolean;
}

/**
 * A single scenario suggestion.
 */
export interface ScenarioSuggestion {
  /** Suggested scenario name */
  name: string;

  /** Job this would test */
  job: string;

  /** Why this is suggested */
  reason: string;

  /** Confidence (0-1) */
  confidence: number;

  /** Priority */
  priority: 'high' | 'medium' | 'low';

  /** Tags for the scenario */
  tags?: string[];

  /** Commands that would be tested */
  commands?: string[];

  /** Skeleton scenario (if requested) */
  skeleton?: Partial<Scenario>;
}

/**
 * Output from scenario.suggest command.
 */
export interface ScenarioSuggestOutput {
  /** Suggestions */
  suggestions: ScenarioSuggestion[];

  /** Total number of suggestions found (before limit) */
  totalFound: number;

  /** Reasoning for suggestions */
  reasoning: string;

  /** Context that was used */
  context: SuggestionContext;
}

// ============================================================================
// Main Command
// ============================================================================

/**
 * Get AI-powered scenario suggestions.
 *
 * @example
 * ```typescript
 * // Suggest based on changed files
 * const result = await scenarioSuggest({
 *   context: 'changed-files',
 *   files: ['src/commands/token/add.ts'],
 * });
 *
 * // Suggest for uncovered commands
 * const result = await scenarioSuggest({
 *   context: 'uncovered',
 *   knownCommands: ['todo.create', 'todo.list', 'todo.delete'],
 * });
 * ```
 */
export async function scenarioSuggest(
  input: ScenarioSuggestInput
): Promise<CommandResult<ScenarioSuggestOutput>> {
  const {
    context,
    files = [],
    command,
    query,
    directory = process.cwd(),
    knownCommands = [],
    limit = 5,
    includeSkeleton = false,
  } = input;

  try {
    let suggestions: ScenarioSuggestion[] = [];

    switch (context) {
      case 'changed-files':
        suggestions = await suggestFromChangedFiles(files, directory);
        break;

      case 'uncovered':
        suggestions = await suggestFromUncovered(directory, knownCommands);
        break;

      case 'failed':
        suggestions = await suggestFromFailed(directory);
        break;

      case 'command':
        if (!command) {
          return failure({
            code: 'MISSING_COMMAND',
            message: 'Command is required for command context',
            suggestion: 'Provide --command flag with the command name',
          });
        }
        suggestions = await suggestForCommand(command, directory);
        break;

      case 'natural':
        if (!query) {
          return failure({
            code: 'MISSING_QUERY',
            message: 'Query is required for natural context',
            suggestion: 'Provide --query flag with your question',
          });
        }
        suggestions = await suggestFromQuery(query, directory, knownCommands);
        break;

      default:
        return failure({
          code: 'INVALID_CONTEXT',
          message: `Unknown context: ${context}`,
          suggestion: 'Use one of: changed-files, uncovered, failed, command, natural',
        });
    }

    // Sort by priority and confidence
    suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.confidence - a.confidence;
    });

    const totalFound = suggestions.length;
    const limited = suggestions.slice(0, limit);

    // Generate skeletons if requested
    if (includeSkeleton) {
      for (const suggestion of limited) {
        suggestion.skeleton = generateSkeleton(suggestion);
      }
    }

    return success(
      {
        suggestions: limited,
        totalFound,
        reasoning: generateReasoning(context, limited, totalFound),
        context,
      },
      {
        reasoning: `Found ${totalFound} suggestions, returning top ${limited.length}`,
      }
    );
  } catch (error) {
    return failure({
      code: 'SUGGEST_ERROR',
      message: error instanceof Error ? error.message : 'Failed to generate suggestions',
    });
  }
}

// ============================================================================
// Suggestion Strategies
// ============================================================================

/**
 * Suggest scenarios based on changed files.
 */
async function suggestFromChangedFiles(
  files: string[],
  directory: string
): Promise<ScenarioSuggestion[]> {
  const suggestions: ScenarioSuggestion[] = [];

  if (files.length === 0) {
    return suggestions;
  }

  // Get existing scenarios to check coverage
  const listResult = await scenarioList({ directory });
  const existingScenarios = listResult.success ? listResult.data?.scenarios ?? [] : [];

  for (const file of files) {
    const commands = mapFileToCommands(file);

    for (const cmd of commands) {
      // Check if command is covered by existing scenarios
      // ScenarioSummary doesn't have commands, so check by name pattern
      const covered = existingScenarios.some(
        (s) => s.name.includes(cmd.replace('.', '-'))
      );

      if (!covered) {
        suggestions.push({
          name: `test-${cmd.replace(/\./g, '-')}`,
          job: inferJobFromCommand(cmd),
          reason: `File "${file}" changed, command "${cmd}" may need test coverage`,
          confidence: 0.85,
          priority: 'high',
          commands: [cmd],
          tags: ['regression', 'changed'],
        });
      } else {
        // Suggest edge case scenarios
        suggestions.push({
          name: `${cmd.replace(/\./g, '-')}-edge-cases`,
          job: inferJobFromCommand(cmd),
          reason: `File "${file}" changed, consider adding edge case tests for "${cmd}"`,
          confidence: 0.6,
          priority: 'medium',
          commands: [cmd],
          tags: ['edge-case', 'changed'],
        });
      }
    }
  }

  return suggestions;
}

/**
 * Suggest scenarios based on coverage gaps.
 */
async function suggestFromUncovered(
  directory: string,
  knownCommands: string[]
): Promise<ScenarioSuggestion[]> {
  const suggestions: ScenarioSuggestion[] = [];

  if (knownCommands.length === 0) {
    // Can't analyze coverage without known commands
    suggestions.push({
      name: 'coverage-audit',
      job: 'Test coverage audit',
      reason: 'No known commands provided - consider documenting your command list',
      confidence: 0.5,
      priority: 'low',
      tags: ['setup'],
    });
    return suggestions;
  }

  // Get coverage data
  const coverageResult = await scenarioCoverage({
    directory,
    knownCommands,
  });

  if (!coverageResult.success || !coverageResult.data) {
    return suggestions;
  }

  const coverage = coverageResult.data;

  // Untested commands (high priority) - using commandCoverage array
  const untestedCommands = coverage.commandCoverage
    .filter((c) => c.scenarioCount === 0)
    .map((c) => c.command);

  for (const cmd of untestedCommands) {
    suggestions.push({
      name: `test-${cmd.replace(/\./g, '-')}`,
      job: inferJobFromCommand(cmd),
      reason: `Command "${cmd}" has 0% test coverage`,
      confidence: 0.95,
      priority: 'high',
      commands: [cmd],
      tags: ['coverage', 'untested'],
    });
  }

  // Low coverage commands (medium priority)
  const lowCoverageCommands = coverage.commandCoverage
    .filter((c) => c.scenarioCount > 0 && c.scenarioCount < 3)
    .map((c) => c.command);

  for (const cmd of lowCoverageCommands) {
    suggestions.push({
      name: `${cmd.replace(/\./g, '-')}-additional`,
      job: inferJobFromCommand(cmd),
      reason: `Command "${cmd}" has limited coverage - consider additional scenarios`,
      confidence: 0.7,
      priority: 'medium',
      commands: [cmd],
      tags: ['coverage', 'improve'],
    });
  }

  return suggestions;
}

/**
 * Suggest scenarios based on failed tests.
 */
async function suggestFromFailed(directory: string): Promise<ScenarioSuggestion[]> {
  const suggestions: ScenarioSuggestion[] = [];

  // Get existing scenarios to find ones marked as failed/flaky
  const listResult = await scenarioList({ directory });
  if (!listResult.success || !listResult.data) {
    return suggestions;
  }

  const scenarios = listResult.data.scenarios;

  // Look for scenarios with error-related tags or names
  // ScenarioSummary has tags and lastRunStatus, not status or commands
  const problematic = scenarios.filter(
    (s) =>
      s.tags?.some((t) => ['flaky', 'failing', 'needs-fix'].includes(t.toLowerCase())) ||
      s.lastRunStatus === 'failed'
  );

  for (const scenario of problematic) {
    suggestions.push({
      name: `regression-${scenario.name}`,
      job: 'Regression test for failed scenario',
      reason: `Scenario "${scenario.name}" has issues - consider creating focused regression test`,
      confidence: 0.85,
      priority: 'high',
      tags: ['regression', 'failing'],
    });

    // Parse the scenario name to infer commands
    // e.g., "test-todo-create" -> "todo.create"
    const inferredCmd = scenario.name
      .replace(/^test-/, '')
      .replace(/-/g, '.');

    if (inferredCmd && inferredCmd.includes('.')) {
      suggestions.push({
        name: `${inferredCmd.replace(/\./g, '-')}-isolation`,
        job: `Isolated test for ${inferredCmd}`,
        reason: `Command "${inferredCmd}" may be involved in failed scenario - test in isolation`,
        confidence: 0.6,
        priority: 'medium',
        commands: [inferredCmd],
        tags: ['isolation', 'debug'],
      });
    }
  }

  // If no failed scenarios found, suggest general testing
  if (suggestions.length === 0) {
    suggestions.push({
      name: 'smoke-tests',
      job: 'Basic smoke tests',
      reason: 'No failed scenarios found - consider adding smoke tests for quick verification',
      confidence: 0.5,
      priority: 'low',
      tags: ['smoke'],
    });
  }

  return suggestions;
}

/**
 * Suggest scenarios for a specific command.
 */
async function suggestForCommand(
  command: string,
  directory: string
): Promise<ScenarioSuggestion[]> {
  const suggestions: ScenarioSuggestion[] = [];

  // Get existing scenarios
  const listResult = await scenarioList({ directory });
  const existingScenarios = listResult.success ? listResult.data?.scenarios ?? [] : [];

  // Check existing coverage - ScenarioSummary doesn't have commands field
  const existing = existingScenarios.filter(
    (s) => s.name.includes(command.replace('.', '-'))
  );

  const baseName = command.replace(/\./g, '-');

  if (existing.length === 0) {
    // No existing scenarios - suggest CRUD-style tests
    suggestions.push({
      name: `${baseName}-basic`,
      job: `Test ${command} basic functionality`,
      reason: `Command "${command}" has no test scenarios`,
      confidence: 0.95,
      priority: 'high',
      commands: [command],
      tags: ['basic', 'crud'],
    });
  }

  // Always suggest edge cases and error handling
  suggestions.push({
    name: `${baseName}-validation`,
    job: `Test ${command} input validation`,
    reason: `Test validation and error handling for "${command}"`,
    confidence: 0.8,
    priority: existing.length === 0 ? 'high' : 'medium',
    commands: [command],
    tags: ['validation', 'error-handling'],
  });

  suggestions.push({
    name: `${baseName}-edge-cases`,
    job: `Test ${command} edge cases`,
    reason: `Test boundary conditions and edge cases for "${command}"`,
    confidence: 0.7,
    priority: 'medium',
    commands: [command],
    tags: ['edge-case'],
  });

  // If it's a mutation command, suggest idempotency tests
  if (command.includes('.create') || command.includes('.update') || command.includes('.delete')) {
    suggestions.push({
      name: `${baseName}-idempotency`,
      job: `Test ${command} idempotency`,
      reason: `Mutation commands should be tested for idempotent behavior`,
      confidence: 0.65,
      priority: 'low',
      commands: [command],
      tags: ['idempotency', 'mutation'],
    });
  }

  return suggestions;
}

/**
 * Suggest scenarios from a natural language query.
 */
async function suggestFromQuery(
  query: string,
  directory: string,
  knownCommands: string[]
): Promise<ScenarioSuggestion[]> {
  const suggestions: ScenarioSuggestion[] = [];
  const queryLower = query.toLowerCase();

  // Pattern matching for common queries
  if (queryLower.includes('error') || queryLower.includes('fail')) {
    suggestions.push({
      name: 'error-handling-suite',
      job: 'Comprehensive error handling tests',
      reason: `Query mentions errors - suggesting error handling scenarios`,
      confidence: 0.8,
      priority: 'high',
      tags: ['error-handling'],
    });
  }

  if (queryLower.includes('crud') || queryLower.includes('create') || queryLower.includes('delete')) {
    suggestions.push({
      name: 'crud-operations',
      job: 'Test CRUD operations',
      reason: 'Query mentions CRUD - suggesting create/read/update/delete scenarios',
      confidence: 0.8,
      priority: 'high',
      tags: ['crud'],
    });
  }

  if (queryLower.includes('performance') || queryLower.includes('speed') || queryLower.includes('slow')) {
    suggestions.push({
      name: 'performance-benchmarks',
      job: 'Performance testing',
      reason: 'Query mentions performance - suggesting benchmark scenarios',
      confidence: 0.75,
      priority: 'medium',
      tags: ['performance', 'benchmark'],
    });
  }

  if (queryLower.includes('security') || queryLower.includes('auth')) {
    suggestions.push({
      name: 'security-tests',
      job: 'Security validation',
      reason: 'Query mentions security - suggesting security-focused scenarios',
      confidence: 0.75,
      priority: 'high',
      tags: ['security'],
    });
  }

  if (queryLower.includes('integration') || queryLower.includes('workflow')) {
    suggestions.push({
      name: 'integration-workflow',
      job: 'End-to-end integration workflow',
      reason: 'Query mentions integration - suggesting workflow scenarios',
      confidence: 0.7,
      priority: 'medium',
      tags: ['integration', 'workflow'],
    });
  }

  // If we have known commands, try to match query keywords
  for (const cmd of knownCommands) {
    const cmdWords = cmd.split('.').join(' ');
    const firstWord = queryLower.split(' ')[0] ?? '';
    if (queryLower.includes(cmdWords) || (firstWord && cmdWords.includes(firstWord))) {
      suggestions.push({
        name: `${cmd.replace(/\./g, '-')}-from-query`,
        job: `Test ${cmd}`,
        reason: `Query matched command "${cmd}"`,
        confidence: 0.7,
        priority: 'medium',
        commands: [cmd],
        tags: ['query-match'],
      });
    }
  }

  // Default suggestion if nothing matched
  if (suggestions.length === 0) {
    suggestions.push({
      name: 'general-test-suite',
      job: 'General testing',
      reason: `No specific patterns matched - consider reviewing your test strategy`,
      confidence: 0.4,
      priority: 'low',
      tags: ['general'],
    });
  }

  return suggestions;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map a file path to potential commands.
 */
function mapFileToCommands(file: string): string[] {
  const commands: string[] = [];
  const normalizedPath = file.replace(/\\/g, '/');

  // Pattern: src/commands/category/action.ts -> category.action
  const commandMatch = normalizedPath.match(/commands\/(\w+)\/(\w+)\.ts$/);
  if (commandMatch) {
    commands.push(`${commandMatch[1]}.${commandMatch[2]}`);
  }

  // Pattern: src/commands/category.ts -> category.*
  const categoryMatch = normalizedPath.match(/commands\/(\w+)\.ts$/);
  if (categoryMatch && categoryMatch[1] && !categoryMatch[1].includes('index')) {
    commands.push(`${categoryMatch[1]}.*`);
  }

  // Pattern: commands in handler files
  if (normalizedPath.includes('handler')) {
    const handlerMatch = normalizedPath.match(/(\w+)-handler\.ts$/);
    if (handlerMatch) {
      commands.push(`${handlerMatch[1]}.*`);
    }
  }

  return commands;
}

/**
 * Infer a job description from a command name.
 */
function inferJobFromCommand(command: string): string {
  const [category, action] = command.split('.');

  if (action) {
    return `${capitalize(action)} ${category}`;
  }

  return `Manage ${category}`;
}

/**
 * Generate a skeleton scenario.
 */
function generateSkeleton(suggestion: ScenarioSuggestion): Partial<Scenario> {
  const steps: Step[] = [];

  if (suggestion.commands && suggestion.commands.length > 0) {
    for (const cmd of suggestion.commands) {
      steps.push({
        description: `Execute ${cmd}`,
        command: cmd,
        input: {},
        expect: {
          success: true,
        },
      });
    }
  } else {
    steps.push({
      description: 'Execute command',
      command: 'your.command',
      input: {},
      expect: {
        success: true,
      },
    });
  }

  return {
    name: suggestion.name,
    job: suggestion.job,
    tags: suggestion.tags,
    steps,
  };
}

/**
 * Generate reasoning text for suggestions.
 */
function generateReasoning(
  context: SuggestionContext,
  suggestions: ScenarioSuggestion[],
  totalFound: number
): string {
  if (suggestions.length === 0) {
    return `No suggestions found for context "${context}"`;
  }

  const highPriority = suggestions.filter((s) => s.priority === 'high').length;
  const mediumPriority = suggestions.filter((s) => s.priority === 'medium').length;

  const parts: string[] = [];

  switch (context) {
    case 'changed-files':
      parts.push(`Analyzed changed files for test coverage gaps.`);
      break;
    case 'uncovered':
      parts.push(`Analyzed test coverage to find untested areas.`);
      break;
    case 'failed':
      parts.push(`Analyzed failed scenarios for regression opportunities.`);
      break;
    case 'command':
      parts.push(`Generated test suggestions for the specified command.`);
      break;
    case 'natural':
      parts.push(`Interpreted query to find relevant test scenarios.`);
      break;
  }

  parts.push(`Found ${totalFound} potential scenarios.`);

  if (highPriority > 0) {
    parts.push(`${highPriority} high priority.`);
  }
  if (mediumPriority > 0) {
    parts.push(`${mediumPriority} medium priority.`);
  }

  return parts.join(' ');
}

/**
 * Capitalize first letter of a string.
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
