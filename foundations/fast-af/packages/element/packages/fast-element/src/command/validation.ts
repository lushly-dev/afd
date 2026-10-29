/**
 * Validation commands for FAST elements.
 * Provides linting and accessibility auditing capabilities.
 *
 * @remarks
 * Task 10: Implements fast.lint.check for code validation against FAST best practices.
 * Task 11: Implements fast.a11y.audit for accessibility auditing.
 */

import { CommandRegistry } from "./registry.js";
import { failure } from "./types.js";
import { createWeakReference } from "./weak-ref.js";

/**
 * Severity level for lint issues.
 * @public
 */
export type LintSeverity = "error" | "warning" | "info";

/**
 * A single lint issue found in code.
 * @public
 */
export interface LintIssue {
    /** Rule ID that triggered the issue */
    rule: string;
    /** Issue severity */
    severity: LintSeverity;
    /** Human-readable message describing the issue */
    message: string;
    /** Line number where the issue occurs (1-indexed) */
    line: number;
    /** Column number where the issue occurs (1-indexed) */
    column: number;
    /** Suggested fix for the issue */
    fix?: string;
    /** Confidence level for the suggested fix (0-1) */
    fixConfidence?: number;
}

/**
 * Issue counts by severity level.
 * @public
 */
export interface LintCounts {
    error: number;
    warning: number;
    info: number;
}

/**
 * A plan step for fixing a lint issue.
 * @public
 */
export interface LintPlanStep {
    /** Step number (1-indexed) */
    step: number;
    /** Action to take to fix the issue */
    action: string;
    /** Confidence level for this fix (0-1) */
    confidence: number;
}

/**
 * Result of a lint check operation.
 * @public
 */
export interface LintResult {
    /** Array of lint issues found */
    issues: LintIssue[];
    /** Issue counts by severity */
    counts: LintCounts;
}

/**
 * WCAG conformance level.
 * @public
 */
export type WcagLevel = "A" | "AA" | "AAA";

/**
 * Impact severity for accessibility violations.
 * @public
 */
export type A11yImpact = "minor" | "moderate" | "serious" | "critical";

/**
 * A single accessibility violation found during audit.
 * @public
 */
export interface A11yViolation {
    /** WCAG rule ID that was violated (e.g., "color-contrast", "aria-label") */
    rule: string;
    /** Impact severity of the violation */
    impact: A11yImpact;
    /** CSS selector identifying the violating element */
    selector: string;
    /** WCAG level this rule applies to */
    wcagLevel: WcagLevel;
    /** Human-readable description of the violation */
    message: string;
    /** WCAG success criterion reference (e.g., "1.4.3") */
    wcagCriterion?: string;
}

/**
 * Result of an accessibility audit operation.
 * @public
 */
export interface A11yAuditResult {
    /** Array of accessibility violations found */
    violations: A11yViolation[];
    /** WCAG level used for the audit */
    level: WcagLevel;
    /** Target element selector that was audited */
    target: string;
}

/**
 * Default lint rules applied when no rules are specified.
 * @internal
 */
const DEFAULT_LINT_RULES = [
    "fast/no-inline-styles",
    "fast/prefer-design-tokens",
    "fast/proper-element-naming",
    "fast/require-slot-names",
    "fast/attribute-reflection",
];

/**
 * Built-in linter for FAST best practices.
 * @internal
 */
const linter = {
    /**
     * Check code against FAST best practices.
     * @param code - The code to lint
     * @param rules - Optional array of rule IDs to apply
     * @returns Array of lint issues found
     */
    async check(code: string, rules?: string[]): Promise<LintIssue[]> {
        const activeRules = rules ?? DEFAULT_LINT_RULES;
        const issues: LintIssue[] = [];
        const lines = code.split("\n");

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;

            // Rule: fast/no-inline-styles
            if (activeRules.includes("fast/no-inline-styles")) {
                const styleMatch = line.match(/style\s*=\s*["']/);
                if (styleMatch) {
                    issues.push({
                        rule: "fast/no-inline-styles",
                        severity: "warning",
                        message:
                            "Avoid inline styles. Use CSS classes or design tokens instead.",
                        line: lineNum,
                        column: styleMatch.index! + 1,
                        fix: "Extract inline styles to a CSS class or use design tokens",
                        fixConfidence: 0.7,
                    });
                }
            }

            // Rule: fast/prefer-design-tokens
            if (activeRules.includes("fast/prefer-design-tokens")) {
                const hexMatch = line.match(/#[0-9a-fA-F]{3,8}\b/);
                if (hexMatch) {
                    issues.push({
                        rule: "fast/prefer-design-tokens",
                        severity: "info",
                        message: `Prefer design tokens over hardcoded color values: ${hexMatch[0]}`,
                        line: lineNum,
                        column: hexMatch.index! + 1,
                        fix: "Replace with a design token (e.g., --accent-foreground-rest)",
                        fixConfidence: 0.6,
                    });
                }
            }

            // Rule: fast/proper-element-naming
            if (activeRules.includes("fast/proper-element-naming")) {
                const tagMatch = line.match(/<([a-z]+)(?:\s|>)/);
                if (
                    tagMatch &&
                    !tagMatch[1].includes("-") &&
                    ![
                        "div",
                        "span",
                        "p",
                        "a",
                        "ul",
                        "li",
                        "h1",
                        "h2",
                        "h3",
                        "h4",
                        "h5",
                        "h6",
                        "template",
                        "slot",
                        "style",
                        "script",
                    ].includes(tagMatch[1])
                ) {
                    // This is a native element, which is fine - skip
                }
                // Check for custom elements without proper prefix
                const customElementMatch = line.match(
                    /customElements\.define\s*\(\s*["']([^"']+)["']/,
                );
                if (
                    customElementMatch &&
                    !customElementMatch[1].startsWith("fast-") &&
                    !customElementMatch[1].startsWith("fluent-")
                ) {
                    issues.push({
                        rule: "fast/proper-element-naming",
                        severity: "warning",
                        message: `Custom element "${customElementMatch[1]}" should use a namespace prefix (e.g., fast-, fluent-, app-)`,
                        line: lineNum,
                        column: customElementMatch.index! + 1,
                        fix: `Rename to include a namespace prefix: "app-${customElementMatch[1]}" or similar`,
                        fixConfidence: 0.8,
                    });
                }
            }

            // Rule: fast/require-slot-names
            if (activeRules.includes("fast/require-slot-names")) {
                const slotMatch = line.match(/<slot\s*>/);
                if (slotMatch) {
                    issues.push({
                        rule: "fast/require-slot-names",
                        severity: "info",
                        message: "Consider using named slots for better API clarity",
                        line: lineNum,
                        column: slotMatch.index! + 1,
                        fix: 'Add a name attribute to the slot: <slot name="content">',
                        fixConfidence: 0.5,
                    });
                }
            }

            // Rule: fast/attribute-reflection
            if (activeRules.includes("fast/attribute-reflection")) {
                const attrMatch = line.match(
                    /@attr\s*(?:\([^)]*\))?\s*\n?\s*(?:public\s+)?(\w+)/,
                );
                if (attrMatch) {
                    // Check if there's a corresponding attribute definition without reflection option
                    const noReflectMatch =
                        line.match(/@attr\s*\(\s*\)\s*/) || line.match(/@attr\s*(?!\()/);
                    if (noReflectMatch) {
                        issues.push({
                            rule: "fast/attribute-reflection",
                            severity: "info",
                            message:
                                "Consider explicit reflection mode for @attr decorator",
                            line: lineNum,
                            column: noReflectMatch.index! + 1,
                            fix: "Specify reflection: @attr({ mode: 'reflect' }) or @attr({ mode: 'boolean' })",
                            fixConfidence: 0.6,
                        });
                    }
                }
            }
        }

        return issues;
    },
};

/**
 * WCAG rules by conformance level.
 * Rules are cumulative: AA includes A, AAA includes AA.
 * @internal
 */
const WCAG_RULES: Record<WcagLevel, string[]> = {
    A: [
        "aria-required-attr",
        "aria-valid-attr",
        "button-name",
        "image-alt",
        "input-label",
        "link-name",
        "list-structure",
        "tabindex",
    ],
    AA: [
        "color-contrast",
        "focus-visible",
        "heading-order",
        "landmark-unique",
        "meta-viewport",
        "target-size",
    ],
    AAA: [
        "color-contrast-enhanced",
        "focus-visible-enhanced",
        "link-purpose",
        "reading-level",
    ],
};

/**
 * Get all applicable rules for a WCAG level (cumulative).
 * @internal
 */
function getRulesForLevel(level: WcagLevel): string[] {
    const rules = [...WCAG_RULES.A];
    if (level === "AA" || level === "AAA") {
        rules.push(...WCAG_RULES.AA);
    }
    if (level === "AAA") {
        rules.push(...WCAG_RULES.AAA);
    }
    return rules;
}

/**
 * Built-in accessibility auditor.
 * Performs runtime DOM analysis for WCAG violations.
 * @internal
 */
const a11yAuditor = {
    /**
     * Audit an element for accessibility violations.
     * @param target - CSS selector for the target element
     * @param level - WCAG conformance level to check against
     * @returns Array of accessibility violations found
     */
    async audit(target: string, level: WcagLevel): Promise<A11yViolation[]> {
        // Guard for non-browser environments
        if (typeof document === "undefined") {
            return [];
        }

        const violations: A11yViolation[] = [];
        const element = document.querySelector(target);

        if (!element) {
            return violations;
        }

        const applicableRules = getRulesForLevel(level);

        // Check: Images without alt text (WCAG 1.1.1 - Level A)
        if (applicableRules.includes("image-alt")) {
            const images = element.querySelectorAll("img:not([alt])");
            images.forEach((img, index) => {
                violations.push({
                    rule: "image-alt",
                    impact: "critical",
                    selector: `${target} img:nth-of-type(${index + 1})`,
                    wcagLevel: "A",
                    message: "Images must have alternate text",
                    wcagCriterion: "1.1.1",
                });
            });
        }

        // Check: Buttons without accessible name (WCAG 4.1.2 - Level A)
        if (applicableRules.includes("button-name")) {
            const buttons = element.querySelectorAll("button");
            buttons.forEach((btn, index) => {
                const hasText = btn.textContent?.trim();
                const hasAriaLabel = btn.getAttribute("aria-label");
                const hasAriaLabelledBy = btn.getAttribute("aria-labelledby");
                if (!hasText && !hasAriaLabel && !hasAriaLabelledBy) {
                    violations.push({
                        rule: "button-name",
                        impact: "critical",
                        selector: `${target} button:nth-of-type(${index + 1})`,
                        wcagLevel: "A",
                        message: "Buttons must have discernible text",
                        wcagCriterion: "4.1.2",
                    });
                }
            });
        }

        // Check: Links without accessible name (WCAG 2.4.4 - Level A)
        if (applicableRules.includes("link-name")) {
            const links = element.querySelectorAll("a[href]");
            links.forEach((link, index) => {
                const hasText = link.textContent?.trim();
                const hasAriaLabel = link.getAttribute("aria-label");
                const hasAriaLabelledBy = link.getAttribute("aria-labelledby");
                if (!hasText && !hasAriaLabel && !hasAriaLabelledBy) {
                    violations.push({
                        rule: "link-name",
                        impact: "serious",
                        selector: `${target} a:nth-of-type(${index + 1})`,
                        wcagLevel: "A",
                        message: "Links must have discernible text",
                        wcagCriterion: "2.4.4",
                    });
                }
            });
        }

        // Check: Form inputs without labels (WCAG 1.3.1 - Level A)
        if (applicableRules.includes("input-label")) {
            const inputs = element.querySelectorAll("input, select, textarea");
            inputs.forEach((input, index) => {
                const id = input.getAttribute("id");
                const hasLabel = id && element.querySelector(`label[for="${id}"]`);
                const hasAriaLabel = input.getAttribute("aria-label");
                const hasAriaLabelledBy = input.getAttribute("aria-labelledby");
                const isHidden = input.getAttribute("type") === "hidden";
                if (!isHidden && !hasLabel && !hasAriaLabel && !hasAriaLabelledBy) {
                    violations.push({
                        rule: "input-label",
                        impact: "critical",
                        selector: `${target} input:nth-of-type(${index + 1})`,
                        wcagLevel: "A",
                        message: "Form elements must have labels",
                        wcagCriterion: "1.3.1",
                    });
                }
            });
        }

        // Check: Invalid tabindex values (WCAG 2.4.3 - Level A)
        if (applicableRules.includes("tabindex")) {
            const tabindexElements = element.querySelectorAll("[tabindex]");
            tabindexElements.forEach((el, index) => {
                const tabindex = parseInt(el.getAttribute("tabindex") || "0", 10);
                if (tabindex > 0) {
                    violations.push({
                        rule: "tabindex",
                        impact: "moderate",
                        selector: `${target} [tabindex]:nth-of-type(${index + 1})`,
                        wcagLevel: "A",
                        message: "Avoid positive tabindex values; use 0 or -1",
                        wcagCriterion: "2.4.3",
                    });
                }
            });
        }

        // Check: Invalid ARIA attributes (WCAG 4.1.2 - Level A)
        if (applicableRules.includes("aria-valid-attr")) {
            const ariaElements = element.querySelectorAll(
                "[aria-hidden='true'][tabindex]:not([tabindex='-1'])",
            );
            ariaElements.forEach((el, index) => {
                violations.push({
                    rule: "aria-valid-attr",
                    impact: "serious",
                    selector: `${target} [aria-hidden='true'][tabindex]:nth-of-type(${index + 1})`,
                    wcagLevel: "A",
                    message: "Elements with aria-hidden='true' should not be focusable",
                    wcagCriterion: "4.1.2",
                });
            });
        }

        // Check: Required ARIA attributes (WCAG 4.1.2 - Level A)
        if (applicableRules.includes("aria-required-attr")) {
            // Check role="checkbox" requires aria-checked
            const checkboxes = element.querySelectorAll(
                "[role='checkbox']:not([aria-checked])",
            );
            checkboxes.forEach((el, index) => {
                violations.push({
                    rule: "aria-required-attr",
                    impact: "critical",
                    selector: `${target} [role='checkbox']:nth-of-type(${index + 1})`,
                    wcagLevel: "A",
                    message: "Elements with role='checkbox' must have aria-checked",
                    wcagCriterion: "4.1.2",
                });
            });
        }

        // Check: Heading order (WCAG 1.3.1 - Level AA)
        if (applicableRules.includes("heading-order")) {
            const headings = element.querySelectorAll("h1, h2, h3, h4, h5, h6");
            let lastLevel = 0;
            headings.forEach((heading, index) => {
                const level = parseInt(heading.tagName[1], 10);
                if (lastLevel > 0 && level > lastLevel + 1) {
                    violations.push({
                        rule: "heading-order",
                        impact: "moderate",
                        selector: `${target} ${heading.tagName.toLowerCase()}:nth-of-type(${index + 1})`,
                        wcagLevel: "AA",
                        message: `Heading levels should only increase by one. Found h${level} after h${lastLevel}`,
                        wcagCriterion: "1.3.1",
                    });
                }
                lastLevel = level;
            });
        }

        return violations;
    },
};

/**
 * Register fast.lint.* and fast.a11y.* commands with the CommandRegistry.
 * Called during fast-element initialization.
 *
 * @remarks
 * These commands provide code validation and accessibility auditing:
 * - fast.lint.check: Validates code against FAST best practices
 * - fast.a11y.audit: Runs WCAG accessibility audit on DOM elements
 *
 * @public
 */
export function registerValidationCommands(): void {
    // fast.lint.check
    CommandRegistry.register("fast.lint.check", {
        id: "fast.lint.check",
        label: "Validate code against FAST best practices",
        description:
            "Analyzes code for FAST best practice violations including inline styles, " +
            "design token usage, element naming, slot names, and attribute reflection.",
        category: "FAST",
        execute: async (args: { code: string; rules?: string[] }) => {
            const { code, rules } = args ?? {};

            if (!code) {
                return failure({
                    code: "VALIDATION_ERROR",
                    message: "Code is required for linting",
                    suggestion: "Provide a code string to analyze",
                    retryable: false,
                });
            }

            try {
                const issues = await linter.check(code, rules);

                // Calculate counts by severity
                const counts: LintCounts = {
                    error: issues.filter(i => i.severity === "error").length,
                    warning: issues.filter(i => i.severity === "warning").length,
                    info: issues.filter(i => i.severity === "info").length,
                };

                const hasErrors = counts.error > 0;

                // Build plan array with fix suggestions
                const plan: LintPlanStep[] = issues
                    .filter(i => i.fix)
                    .map((issue, idx) => ({
                        step: idx + 1,
                        action: issue.fix!,
                        confidence: issue.fixConfidence ?? 0.8,
                    }));

                if (hasErrors) {
                    return failure({
                        code: "LINT_ERRORS",
                        message: `Found ${counts.error} error(s)`,
                        suggestion: "Fix the reported errors and re-run",
                        retryable: false,
                        details: { issues, counts, plan },
                    });
                }

                return {
                    success: true as const,
                    data: { issues, counts },
                    confidence: 0.95,
                    plan,
                };
            } catch (error) {
                return failure({
                    code: "VALIDATION_ERROR",
                    message: error instanceof Error ? error.message : "Linting failed",
                    suggestion: "Check that the code is valid and try again",
                    retryable: true,
                });
            }
        },
        canExecute: true,
        when: true,
        expose: { palette: true, agent: true, mcp: true, cli: true },
        source:
            typeof document !== "undefined"
                ? createWeakReference(document.body)
                : createWeakReference({} as HTMLElement),
    });

    // fast.a11y.audit
    CommandRegistry.register("fast.a11y.audit", {
        id: "fast.a11y.audit",
        label: "Run accessibility audit",
        description:
            "Audits DOM elements for WCAG accessibility violations. " +
            "Checks for missing alt text, unlabeled form controls, heading order, " +
            "ARIA issues, and more based on the specified conformance level.",
        category: "FAST",
        execute: async (args: { element?: string; level?: WcagLevel }) => {
            const target = args?.element ?? "body";
            const level = args?.level ?? "AA";

            // Validate WCAG level
            if (!["A", "AA", "AAA"].includes(level)) {
                return failure({
                    code: "INVALID_LEVEL",
                    message: `Invalid WCAG level: ${level}. Must be A, AA, or AAA`,
                    suggestion: "Use level 'A', 'AA', or 'AAA'",
                    retryable: false,
                });
            }

            try {
                const violations = await a11yAuditor.audit(target, level);

                if (violations.length > 0) {
                    return failure({
                        code: "A11Y_VIOLATIONS",
                        message: `Found ${violations.length} accessibility violation(s)`,
                        suggestion: "Fix the reported violations and re-audit",
                        retryable: false,
                        details: { violations, level, target },
                    });
                }

                return {
                    success: true as const,
                    data: { violations, level, target },
                    confidence: 0.9,
                };
            } catch (error) {
                return failure({
                    code: "AUDIT_ERROR",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Accessibility audit failed",
                    suggestion: "Check that the target selector is valid",
                    retryable: true,
                });
            }
        },
        canExecute: true,
        when: true,
        expose: { palette: true, agent: true, mcp: true, cli: true },
        source:
            typeof document !== "undefined"
                ? createWeakReference(document.body)
                : createWeakReference({} as HTMLElement),
    });
}
