/**
 * @lushly-dev/afd-testing - YAML Scenario Parser
 *
 * Parses .scenario.yaml files into typed Scenario objects.
 * Uses the 'yaml' package for parsing with strict validation.
 */

import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type {
  Scenario,
  Step,
  Expectation,
  FixtureConfig,
  Verification,
} from "../types/scenario.js";
import { isScenario } from "../types/scenario.js";

// ============================================================================
// Parser Result Types
// ============================================================================

export interface ParseSuccess {
  success: true;
  scenario: Scenario;
}

export interface ParseError {
  success: false;
  error: string;
  path?: string;
  line?: number;
}

export type ParseResult = ParseSuccess | ParseError;

// ============================================================================
// YAML Schema Validation
// ============================================================================

/**
 * Validate and transform raw YAML into a Scenario object
 */
function validateScenarioYaml(raw: unknown, filePath: string): ParseResult {
  if (typeof raw !== "object" || raw === null) {
    return {
      success: false,
      error: "Scenario file must contain a YAML object",
      path: filePath,
    };
  }

  const obj = raw as Record<string, unknown>;

  // Validate required 'name' field
  if (typeof obj.name !== "string" || obj.name.trim() === "") {
    return {
      success: false,
      error: "Scenario must have a non-empty 'name' field",
      path: filePath,
    };
  }

  // Validate required 'description' field
  if (typeof obj.description !== "string" || obj.description.trim() === "") {
    return {
      success: false,
      error: "Scenario must have a non-empty 'description' field",
      path: filePath,
    };
  }

  // Validate required 'job' field (kebab-case identifier)
  if (typeof obj.job !== "string" || obj.job.trim() === "") {
    return {
      success: false,
      error: "Scenario must have a non-empty 'job' field (kebab-case identifier)",
      path: filePath,
    };
  }

  // Validate 'steps' array
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    return {
      success: false,
      error: "Scenario must have at least one step",
      path: filePath,
    };
  }

  // Parse tags (optional, defaults to empty array)
  const tags = Array.isArray(obj.tags)
    ? obj.tags.filter((t): t is string => typeof t === "string")
    : [];

  // Parse steps
  const stepsResult = parseSteps(obj.steps, filePath);
  if (!stepsResult.success) {
    return stepsResult;
  }

  // Parse optional fixture
  const fixtureResult = parseFixture(obj.fixture);
  if (!fixtureResult.success) {
    return { ...fixtureResult, path: filePath };
  }

  // Parse optional verification (called 'verify' in schema)
  const verifyResult = parseVerification(obj.verify);
  if (!verifyResult.success) {
    return { ...verifyResult, path: filePath };
  }

  // Build the scenario object
  const scenario: Scenario = {
    name: obj.name,
    description: obj.description,
    job: obj.job,
    tags,
    version: typeof obj.version === "string" ? obj.version : undefined,
    fixture: fixtureResult.fixture,
    isolation:
      obj.isolation === "fresh" || obj.isolation === "chained" ? obj.isolation : undefined,
    dependsOn: Array.isArray(obj.dependsOn)
      ? obj.dependsOn.filter((d): d is string => typeof d === "string")
      : undefined,
    timeout: typeof obj.timeout === "number" ? obj.timeout : undefined,
    steps: stepsResult.steps,
    verify: verifyResult.verification,
  };

  // Final type guard check
  if (!isScenario(scenario)) {
    return {
      success: false,
      error: "Parsed scenario failed validation",
      path: filePath,
    };
  }

  return { success: true, scenario };
}

/**
 * Parse steps array from YAML
 */
function parseSteps(
  raw: unknown[],
  filePath: string
): { success: true; steps: Step[] } | ParseError {
  const steps: Step[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item !== "object" || item === null) {
      return {
        success: false,
        error: `Step ${i + 1} must be an object`,
        path: filePath,
      };
    }

    const step = item as Record<string, unknown>;

    // Command (required)
    if (typeof step.command !== "string" || step.command.trim() === "") {
      return {
        success: false,
        error: `Step ${i + 1} must have a non-empty 'command' field`,
        path: filePath,
      };
    }

    // Parse expect (required per Step interface)
    const expectResult = parseExpectation(step.expect, i + 1, filePath);
    if (!expectResult) {
      return {
        success: false,
        error: `Step ${i + 1} must have an 'expect' block`,
        path: filePath,
      };
    }
    if (!expectResult.success) {
      return expectResult;
    }

    // Parse input (optional)
    const input =
      typeof step.input === "object" && step.input !== null
        ? (step.input as Record<string, unknown>)
        : undefined;

    steps.push({
      command: step.command,
      input,
      description: typeof step.description === "string" ? step.description : undefined,
      expect: expectResult.expectation,
      continueOnFailure: step.continueOnFailure === true,
    });
  }

  return { success: true, steps };
}

/**
 * Parse expectation from a step
 */
function parseExpectation(
  raw: unknown,
  stepNum: number,
  filePath: string
): { success: true; expectation: Expectation } | ParseError | null {
  if (raw === undefined || raw === null) {
    return null;
  }

  if (typeof raw !== "object") {
    return {
      success: false,
      error: `Step ${stepNum} 'expect' must be an object`,
      path: filePath,
    };
  }

  const obj = raw as Record<string, unknown>;

  // Check for 'success' field (required)
  if (typeof obj.success !== "boolean") {
    return {
      success: false,
      error: `Step ${stepNum} 'expect' must have a boolean 'success' field`,
      path: filePath,
    };
  }

  // Parse error block (for failure tests)
  let error: Expectation["error"] | undefined;
  if (typeof obj.error === "object" && obj.error !== null) {
    const errObj = obj.error as Record<string, unknown>;
    error = {
      code: typeof errObj.code === "string" ? errObj.code : undefined,
      message: typeof errObj.message === "string" ? errObj.message : undefined,
    };
  }

  const expectation: Expectation = {
    success: obj.success,
    data:
      typeof obj.data === "object" && obj.data !== null
        ? (obj.data as Record<string, unknown>)
        : undefined,
    error,
    reasoning: typeof obj.reasoning === "string" ? obj.reasoning : undefined,
    confidence: typeof obj.confidence === "number" ? obj.confidence : undefined,
  };

  return { success: true, expectation };
}

/**
 * Parse fixture configuration
 * FixtureConfig has: file (required), base?, overrides?
 */
function parseFixture(
  raw: unknown
): { success: true; fixture?: FixtureConfig } | ParseError {
  if (raw === undefined || raw === null) {
    return { success: true, fixture: undefined };
  }

  if (typeof raw !== "object") {
    return {
      success: false,
      error: "Fixture must be an object",
    };
  }

  const obj = raw as Record<string, unknown>;

  // 'file' is required in FixtureConfig
  if (typeof obj.file !== "string" || obj.file.trim() === "") {
    return {
      success: false,
      error: "Fixture must have a 'file' field (path to fixture JSON)",
    };
  }

  const fixture: FixtureConfig = {
    file: obj.file,
    base: typeof obj.base === "string" ? obj.base : undefined,
    overrides:
      typeof obj.overrides === "object" && obj.overrides !== null
        ? (obj.overrides as Record<string, unknown>)
        : undefined,
  };

  return { success: true, fixture };
}

/**
 * Parse verification configuration
 * Verification has: snapshot?, assertions?, custom?
 */
function parseVerification(
  raw: unknown
): { success: true; verification?: Verification } | ParseError {
  if (raw === undefined || raw === null) {
    return { success: true, verification: undefined };
  }

  if (typeof raw !== "object") {
    return {
      success: false,
      error: "Verification must be an object",
    };
  }

  const obj = raw as Record<string, unknown>;

  const verification: Verification = {
    snapshot: typeof obj.snapshot === "string" ? obj.snapshot : undefined,
    assertions: Array.isArray(obj.assertions)
      ? obj.assertions.filter((a): a is string => typeof a === "string")
      : undefined,
    custom: typeof obj.custom === "string" ? obj.custom : undefined,
  };

  return { success: true, verification };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a scenario from a YAML string
 */
export function parseScenarioString(yaml: string, filePath = "<string>"): ParseResult {
  try {
    const raw = parseYaml(yaml);
    return validateScenarioYaml(raw, filePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `YAML parse error: ${message}`,
      path: filePath,
    };
  }
}

/**
 * Parse a scenario from a file path
 */
export async function parseScenarioFile(filePath: string): Promise<ParseResult> {
  try {
    const content = await readFile(filePath, "utf-8");
    return parseScenarioString(content, filePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to read file: ${message}`,
      path: filePath,
    };
  }
}

/**
 * Parse multiple scenario files
 */
export async function parseScenarioFiles(filePaths: string[]): Promise<ParseResult[]> {
  return Promise.all(filePaths.map(parseScenarioFile));
}
