/**
 * @fileoverview Input validation utilities
 */

import { z, type ZodType, type ZodError, type ZodIssue } from 'zod';

export interface ValidationError {
  path: string;
  message: string;
  code: string;
  expected?: string;
  received?: string;
}

export type ValidationResult<T> =
  | { success: true; data: T; errors: never[] }
  | { success: false; data: undefined; errors: ValidationError[] };

export interface SchemaInfo {
  expectedFields: string[];
  unexpectedFields: string[];
  missingFields: string[];
}

export interface EnhancedValidationResult<T> {
  success: boolean;
  data: T | undefined;
  errors: ValidationError[];
  expectedFields?: string[];
  unexpectedFields?: string[];
  missingFields?: string[];
}

export function validateInput<T>(schema: ZodType<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { success: true, data: result.data, errors: [] as never[] };
  return { success: false, data: undefined, errors: formatZodErrors(result.error) };
}

export function validateInputEnhanced<T>(schema: ZodType<T>, input: unknown): EnhancedValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { success: true, data: result.data, errors: [] };
  const schemaInfo = extractSchemaInfo(schema, input);
  const errors = formatZodErrors(result.error);
  return {
    success: false, data: undefined, errors,
    expectedFields: schemaInfo.expectedFields.length > 0 ? schemaInfo.expectedFields : undefined,
    unexpectedFields: schemaInfo.unexpectedFields.length > 0 ? schemaInfo.unexpectedFields : undefined,
    missingFields: schemaInfo.missingFields.length > 0 ? schemaInfo.missingFields : undefined,
  };
}

export function validateOrThrow<T>(schema: ZodType<T>, input: unknown): T {
  const result = validateInput(schema, input);
  if (!result.success) throw new ValidationException(result.errors);
  return result.data;
}

export function isValid<T>(schema: ZodType<T>, input: unknown): input is T {
  return schema.safeParse(input).success;
}

function formatZodErrors(error: ZodError): ValidationError[] {
  return error.issues.map(formatZodIssue);
}

function formatZodIssue(issue: ZodIssue): ValidationError {
  const path = issue.path.join(".");
  const error: ValidationError = { path: path || "(root)", message: issue.message, code: issue.code };
  if (issue.code === "invalid_type") { error.expected = issue.expected; error.received = issue.received; }
  return error;
}

export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return "No validation errors";
  if (errors.length === 1) {
    const err = errors[0]!;
    return err.path === "(root)" ? err.message : `${err.path}: ${err.message}`;
  }
  return errors.map((err) => err.path === "(root)" ? `- ${err.message}` : `- ${err.path}: ${err.message}`).join("\n");
}

export function formatEnhancedValidationError(
  errors: ValidationError[],
  schemaInfo?: { expectedFields?: string[]; unexpectedFields?: string[]; missingFields?: string[]; }
): string {
  const parts: string[] = [];
  if (errors.length > 0) parts.push(formatValidationErrors(errors));
  if (schemaInfo) {
    if (schemaInfo.unexpectedFields?.length) parts.push(`Unknown field(s): ${schemaInfo.unexpectedFields.join(", ")}`);
    if (schemaInfo.missingFields?.length) parts.push(`Missing required field(s): ${schemaInfo.missingFields.join(", ")}`);
    if (schemaInfo.expectedFields?.length) parts.push(`Expected fields: ${schemaInfo.expectedFields.join(", ")}`);
  }
  return parts.join(". ");
}

function extractSchemaInfo<T>(schema: ZodType<T>, input: unknown): SchemaInfo {
  const expectedFields: string[] = [];
  const unexpectedFields: string[] = [];
  const missingFields: string[] = [];
  const shape = getSchemaShape(schema);
  if (shape) {
    for (const key of Object.keys(shape)) expectedFields.push(key);
    if (input && typeof input === "object" && !Array.isArray(input)) {
      for (const key of Object.keys(input)) { if (!expectedFields.includes(key)) unexpectedFields.push(key); }
      for (const key of expectedFields) { if (!(key in input) && shape[key] && isRequiredField(shape[key] as ZodType)) missingFields.push(key); }
    }
  }
  return { expectedFields, unexpectedFields, missingFields };
}

function getSchemaShape<T>(schema: ZodType<T>): Record<string, ZodType> | null {
  if (schema instanceof z.ZodObject) return schema.shape as Record<string, ZodType>;
  if (schema instanceof z.ZodEffects) return getSchemaShape(schema._def.schema);
  if (schema instanceof z.ZodOptional) return getSchemaShape(schema._def.innerType);
  if (schema instanceof z.ZodNullable) return getSchemaShape(schema._def.innerType);
  if (schema instanceof z.ZodDefault) return getSchemaShape(schema._def.innerType);
  return null;
}

function isRequiredField(schema: ZodType): boolean {
  if (schema instanceof z.ZodOptional) return false;
  if (schema instanceof z.ZodDefault) return false;
  if (schema instanceof z.ZodEffects) return isRequiredField(schema._def.schema);
  return true;
}

export class ValidationException extends Error {
  readonly errors: ValidationError[];
  readonly code = "VALIDATION_ERROR";
  constructor(errors: ValidationError[]) {
    super(formatValidationErrors(errors));
    this.name = "ValidationException";
    this.errors = errors;
  }
  toCommandError() {
    return { code: this.code, message: "Input validation failed", suggestion: this.message, details: { errors: this.errors } };
  }
}

export const patterns = {
  uuid: z.string().uuid(), email: z.string().email(), url: z.string().url(),
  nonEmpty: z.string().min(1), positiveInt: z.number().int().positive(),
  nonNegativeInt: z.number().int().nonnegative(), isoDate: z.string().datetime(),
  pagination: z.object({ limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().nonnegative().default(0) }),
};

export function optional<T extends ZodType>(schema: T) { return schema.optional(); }
export function withDefault<T extends ZodType>(schema: T, defaultValue: z.infer<T>) { return schema.default(defaultValue); }
