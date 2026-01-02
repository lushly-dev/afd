/**
 * @afd/testing - Step Evaluator
 *
 * Compares actual command results against expected values defined in scenarios.
 * Supports various matchers: equals, contains, exists, length, gte, lte, etc.
 */

import type { CommandResult } from "@afd/core";
import type { Expectation, AssertionMatcher } from "../types/scenario.js";
import { isAssertionMatcher } from "../types/scenario.js";
import type { AssertionResult, StepError } from "../types/report.js";

// ============================================================================
// Evaluation Result Types
// ============================================================================

export interface EvaluationResult {
  /** Whether all assertions passed */
  passed: boolean;

  /** Individual assertion results */
  assertions: AssertionResult[];

  /** Overall error if evaluation failed for unexpected reasons */
  error?: StepError;
}

// ============================================================================
// Main Evaluation Function
// ============================================================================

/**
 * Evaluate a command result against an expectation.
 *
 * @param actual - The actual CommandResult from executing a command
 * @param expected - The Expectation from the scenario
 * @returns EvaluationResult with pass/fail status and detailed assertions
 */
export function evaluateResult(
  actual: CommandResult<unknown>,
  expected: Expectation
): EvaluationResult {
  const assertions: AssertionResult[] = [];
  let allPassed = true;

  // Check success status
  const successAssertion = evaluateAssertion(
    "success",
    actual.success,
    expected.success,
    "equals"
  );
  assertions.push(successAssertion);
  if (!successAssertion.passed) {
    allPassed = false;
  }

  // If expecting success, check data assertions
  if (expected.success && expected.data) {
    const dataAssertions = evaluateDataAssertions(actual.data, expected.data, "data");
    for (const assertion of dataAssertions) {
      assertions.push(assertion);
      if (!assertion.passed) {
        allPassed = false;
      }
    }
  }

  // If expecting failure, check error assertions
  if (!expected.success && expected.error) {
    if (expected.error.code) {
      const codeAssertion = evaluateAssertion(
        "error.code",
        (actual.error as Record<string, unknown> | undefined)?.code,
        expected.error.code,
        "equals"
      );
      assertions.push(codeAssertion);
      if (!codeAssertion.passed) {
        allPassed = false;
      }
    }

    if (expected.error.message) {
      const messageAssertion = evaluateAssertion(
        "error.message",
        (actual.error as Record<string, unknown> | undefined)?.message,
        expected.error.message,
        "contains"
      );
      assertions.push(messageAssertion);
      if (!messageAssertion.passed) {
        allPassed = false;
      }
    }
  }

  // Check reasoning assertion (if specified)
  if (expected.reasoning) {
    const reasoningAssertion = evaluateAssertion(
      "reasoning",
      (actual as unknown as Record<string, unknown>).reasoning,
      expected.reasoning,
      "contains"
    );
    assertions.push(reasoningAssertion);
    if (!reasoningAssertion.passed) {
      allPassed = false;
    }
  }

  // Check confidence threshold (if specified)
  if (expected.confidence !== undefined) {
    const confidenceAssertion = evaluateAssertion(
      "confidence",
      (actual as unknown as Record<string, unknown>).confidence,
      expected.confidence,
      "gte"
    );
    assertions.push(confidenceAssertion);
    if (!confidenceAssertion.passed) {
      allPassed = false;
    }
  }

  return { passed: allPassed, assertions };
}

// ============================================================================
// Data Assertion Evaluation
// ============================================================================

/**
 * Recursively evaluate data assertions using dot-notation paths.
 */
function evaluateDataAssertions(
  actual: unknown,
  expected: Record<string, unknown>,
  basePath: string
): AssertionResult[] {
  const results: AssertionResult[] = [];

  for (const [key, expectedValue] of Object.entries(expected)) {
    const path = `${basePath}.${key}`;
    const actualValue = getValueAtPath(actual, key);

    if (isAssertionMatcher(expectedValue)) {
      // Handle matcher objects like { contains: "foo" }
      const matcherResults = evaluateMatcherAssertions(path, actualValue, expectedValue);
      results.push(...matcherResults);
    } else if (typeof expectedValue === "object" && expectedValue !== null && !Array.isArray(expectedValue)) {
      // Nested object - recurse
      const nestedResults = evaluateDataAssertions(actualValue, expectedValue as Record<string, unknown>, path);
      results.push(...nestedResults);
    } else {
      // Simple equality check
      results.push(evaluateAssertion(path, actualValue, expectedValue, "equals"));
    }
  }

  return results;
}

/**
 * Evaluate all matchers in an AssertionMatcher object.
 */
function evaluateMatcherAssertions(
  path: string,
  actual: unknown,
  matcher: AssertionMatcher
): AssertionResult[] {
  const results: AssertionResult[] = [];

  if (matcher.contains !== undefined) {
    results.push(evaluateAssertion(path, actual, matcher.contains, "contains"));
  }

  if (matcher.matches !== undefined) {
    results.push(evaluateAssertion(path, actual, matcher.matches, "matches"));
  }

  if (matcher.exists !== undefined) {
    results.push(evaluateAssertion(path, actual, matcher.exists, "exists"));
  }

  if (matcher.notExists !== undefined) {
    results.push(evaluateAssertion(path, actual, matcher.notExists, "notExists"));
  }

  if (matcher.length !== undefined) {
    results.push(evaluateAssertion(path, actual, matcher.length, "length"));
  }

  if (matcher.includes !== undefined) {
    results.push(evaluateAssertion(path, actual, matcher.includes, "includes"));
  }

  if (matcher.gte !== undefined) {
    results.push(evaluateAssertion(path, actual, matcher.gte, "gte"));
  }

  if (matcher.lte !== undefined) {
    results.push(evaluateAssertion(path, actual, matcher.lte, "lte"));
  }

  if (matcher.between !== undefined) {
    results.push(evaluateAssertion(path, actual, matcher.between, "between"));
  }

  return results;
}

// ============================================================================
// Single Assertion Evaluation
// ============================================================================

type MatcherType =
  | "equals"
  | "contains"
  | "matches"
  | "exists"
  | "notExists"
  | "length"
  | "includes"
  | "gte"
  | "lte"
  | "between";

/**
 * Evaluate a single assertion.
 */
function evaluateAssertion(
  path: string,
  actual: unknown,
  expected: unknown,
  matcher: MatcherType
): AssertionResult {
  const passed = runMatcher(actual, expected, matcher);

  return {
    path,
    matcher,
    passed,
    expected,
    actual,
    description: describeAssertion(path, actual, expected, matcher, passed),
  };
}

/**
 * Run a matcher against actual and expected values.
 */
function runMatcher(actual: unknown, expected: unknown, matcher: MatcherType): boolean {
  switch (matcher) {
    case "equals":
      return deepEqual(actual, expected);

    case "contains":
      if (typeof actual === "string" && typeof expected === "string") {
        return actual.includes(expected);
      }
      return false;

    case "matches":
      if (typeof actual === "string" && typeof expected === "string") {
        try {
          return new RegExp(expected).test(actual);
        } catch {
          return false;
        }
      }
      return false;

    case "exists":
      return expected === true
        ? actual !== null && actual !== undefined
        : actual === null || actual === undefined;

    case "notExists":
      return expected === true
        ? actual === null || actual === undefined
        : actual !== null && actual !== undefined;

    case "length":
      if (Array.isArray(actual)) {
        return actual.length === expected;
      }
      if (typeof actual === "string") {
        return actual.length === expected;
      }
      return false;

    case "includes":
      if (Array.isArray(actual)) {
        return actual.some((item) => deepEqual(item, expected));
      }
      return false;

    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;

    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;

    case "between":
      if (typeof actual === "number" && Array.isArray(expected) && expected.length === 2) {
        const [min, max] = expected as [number, number];
        return actual >= min && actual <= max;
      }
      return false;

    default:
      return false;
  }
}

/**
 * Generate a human-readable description for an assertion.
 */
function describeAssertion(
  path: string,
  actual: unknown,
  expected: unknown,
  matcher: MatcherType,
  passed: boolean
): string {
  const status = passed ? "✓" : "✗";
  const actualStr = formatValue(actual);
  const expectedStr = formatValue(expected);

  switch (matcher) {
    case "equals":
      return `${status} ${path} equals ${expectedStr} (got ${actualStr})`;
    case "contains":
      return `${status} ${path} contains "${expected}" (got ${actualStr})`;
    case "matches":
      return `${status} ${path} matches /${expected}/ (got ${actualStr})`;
    case "exists":
      return `${status} ${path} ${expected ? "exists" : "does not exist"} (got ${actualStr})`;
    case "notExists":
      return `${status} ${path} ${expected ? "does not exist" : "exists"} (got ${actualStr})`;
    case "length":
      return `${status} ${path}.length equals ${expected} (got ${Array.isArray(actual) ? actual.length : typeof actual})`;
    case "includes":
      return `${status} ${path} includes ${expectedStr} (got ${actualStr})`;
    case "gte":
      return `${status} ${path} >= ${expected} (got ${actualStr})`;
    case "lte":
      return `${status} ${path} <= ${expected} (got ${actualStr})`;
    case "between":
      const [min, max] = expected as [number, number];
      return `${status} ${path} between ${min} and ${max} (got ${actualStr})`;
    default:
      return `${status} ${path}: ${matcher}`;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get a value at a dot-notation path.
 */
function getValueAtPath(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) {
    return undefined;
  }

  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Deep equality check.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);
  if (keysA.length !== keysB.length) return false;

  return keysA.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key]
    )
  );
}

/**
 * Format a value for display in assertion descriptions.
 */
function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return `"${value.length > 50 ? value.slice(0, 50) + "..." : value}"`;
  if (typeof value === "object") {
    try {
      const str = JSON.stringify(value);
      return str.length > 100 ? str.slice(0, 100) + "..." : str;
    } catch {
      return "[object]";
    }
  }
  return String(value);
}
