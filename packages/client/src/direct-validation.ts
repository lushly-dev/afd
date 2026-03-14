/**
 * @fileoverview Input validation for DirectClient commands
 *
 * Validates command inputs against parameter definitions before execution,
 * checking required fields, types, and enum constraints.
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Command definition for validation purposes.
 * Matches the structure from @lushly-dev/afd-core.
 */
export interface CommandDefinition {
	name: string;
	description: string;
	parameters: CommandParameter[];
}

/**
 * Command parameter definition for validation.
 */
export interface CommandParameter {
	name: string;
	type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
	description: string;
	required?: boolean;
	default?: unknown;
	enum?: unknown[];
}

/**
 * Validation error details for a specific parameter.
 */
export interface ValidationIssue {
	parameter: string;
	message: string;
	expected?: string;
	received?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate input against command parameters.
 * Returns null if valid, or an array of validation issues.
 */
export function validateInput(
	input: Record<string, unknown> | undefined,
	parameters: CommandParameter[]
): ValidationIssue[] | null {
	const issues: ValidationIssue[] = [];
	const inputObj = input ?? {};

	for (const param of parameters) {
		const value = inputObj[param.name];

		// Check required parameters
		if (param.required && value === undefined) {
			issues.push({
				parameter: param.name,
				message: `Required parameter '${param.name}' is missing`,
				expected: param.type,
			});
			continue;
		}

		// Skip validation for undefined optional parameters
		if (value === undefined) {
			continue;
		}

		// Type validation
		const actualType = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
		if (actualType !== param.type) {
			issues.push({
				parameter: param.name,
				message: `Parameter '${param.name}' has wrong type`,
				expected: param.type,
				received: actualType,
			});
		}

		// Enum validation
		if (param.enum && !param.enum.includes(value)) {
			issues.push({
				parameter: param.name,
				message: `Parameter '${param.name}' must be one of: ${param.enum.join(', ')}`,
				expected: param.enum.join(' | '),
				received: String(value),
			});
		}
	}

	return issues.length > 0 ? issues : null;
}
