/**
 * A small, dependency-free JSON Schema validator for command `parameters`.
 *
 * @remarks
 * Deliberately limited to the keywords agents and command palettes actually
 * rely on: `type`, `enum`, `const`, `required`, `properties`,
 * `additionalProperties`, `items`, `minimum`/`maximum` (plus the numeric
 * exclusive forms), `minLength`/`maxLength` and `minItems`/`maxItems`.
 * Unknown keywords (including `pattern`, `$ref`, `oneOf`, ...) are ignored, so a
 * schema that uses them is validated on a best-effort basis rather than rejected.
 *
 * @internal
 */

/**
 * A single validation problem.
 * @internal
 */
export interface SchemaIssue {
    /** JSON-pointer-like location of the problem (e.g. `$.items[0].id`). */
    path: string;
    /** Human-readable description. */
    message: string;
}

const MAX_ISSUES = 20;
const hasOwn = (target: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(target, key);

function typeOf(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
    return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
    switch (type) {
        case "string":
        case "boolean":
        case "undefined":
            return typeof value === type;
        case "number":
            return typeof value === "number" && Number.isFinite(value);
        case "integer":
            return typeof value === "number" && Number.isInteger(value);
        case "null":
            return value === null;
        case "array":
            return Array.isArray(value);
        case "object":
            return typeof value === "object" && value !== null && !Array.isArray(value);
        default:
            // Unknown type names are not enforced.
            return true;
    }
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
        return false;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    return aKeys.every(
        key =>
            hasOwn(b, key) &&
            deepEqual(
                (a as Record<string, unknown>)[key],
                (b as Record<string, unknown>)[key],
            ),
    );
}

function validateInto(
    issues: SchemaIssue[],
    value: unknown,
    schema: Record<string, unknown>,
    path: string,
): void {
    if (issues.length >= MAX_ISSUES) return;
    const report = (at: string, message: string) => {
        if (issues.length < MAX_ISSUES) issues.push({ path: at, message });
    };
    const add = (message: string) => report(path, message);

    const type = schema.type;
    if (type !== void 0) {
        const types = Array.isArray(type) ? (type as string[]) : [type as string];
        if (!types.some(t => matchesType(value, t))) {
            add(`expected ${types.join(" or ")} but received ${typeOf(value)}`);
            return;
        }
    }

    if (Array.isArray(schema.enum) && !schema.enum.some(v => deepEqual(v, value))) {
        add(`must be one of ${JSON.stringify(schema.enum)}`);
    }

    if (hasOwn(schema, "const") && !deepEqual(schema.const, value)) {
        add(`must equal ${JSON.stringify(schema.const)}`);
    }

    if (typeof value === "number") {
        const { minimum, maximum, exclusiveMinimum, exclusiveMaximum } = schema;
        if (typeof minimum === "number" && value < minimum) {
            add(`must be >= ${minimum}`);
        }
        if (typeof maximum === "number" && value > maximum) {
            add(`must be <= ${maximum}`);
        }
        if (typeof exclusiveMinimum === "number" && value <= exclusiveMinimum) {
            add(`must be > ${exclusiveMinimum}`);
        }
        if (typeof exclusiveMaximum === "number" && value >= exclusiveMaximum) {
            add(`must be < ${exclusiveMaximum}`);
        }
    }

    if (typeof value === "string") {
        if (typeof schema.minLength === "number" && value.length < schema.minLength) {
            add(`must be at least ${schema.minLength} character(s)`);
        }
        if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
            add(`must be at most ${schema.maxLength} character(s)`);
        }
    }

    if (Array.isArray(value)) {
        if (typeof schema.minItems === "number" && value.length < schema.minItems) {
            add(`must contain at least ${schema.minItems} item(s)`);
        }
        if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
            add(`must contain at most ${schema.maxItems} item(s)`);
        }
        const items = schema.items;
        if (items !== null && typeof items === "object" && !Array.isArray(items)) {
            for (let i = 0; i < value.length && issues.length < MAX_ISSUES; i++) {
                validateInto(
                    issues,
                    value[i],
                    items as Record<string, unknown>,
                    `${path}[${i}]`,
                );
            }
        }
    }

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        const properties =
            schema.properties !== null && typeof schema.properties === "object"
                ? (schema.properties as Record<string, unknown>)
                : {};

        if (Array.isArray(schema.required)) {
            for (const key of schema.required as string[]) {
                if (!hasOwn(record, key) || record[key] === void 0) {
                    report(`${path}.${key}`, "is required");
                }
            }
        }

        for (const key of Object.keys(properties)) {
            const propertySchema = properties[key];
            if (
                hasOwn(record, key) &&
                record[key] !== void 0 &&
                propertySchema !== null &&
                typeof propertySchema === "object"
            ) {
                validateInto(
                    issues,
                    record[key],
                    propertySchema as Record<string, unknown>,
                    `${path}.${key}`,
                );
            }
        }

        const additional = schema.additionalProperties;
        if (additional === false) {
            for (const key of Object.keys(record)) {
                if (!hasOwn(properties, key)) {
                    report(`${path}.${key}`, "is not an allowed property");
                }
            }
        } else if (additional !== null && typeof additional === "object") {
            for (const key of Object.keys(record)) {
                if (!hasOwn(properties, key)) {
                    validateInto(
                        issues,
                        record[key],
                        additional as Record<string, unknown>,
                        `${path}.${key}`,
                    );
                }
            }
        }
    }
}

/**
 * Validates a value against a (basic) JSON Schema.
 * @param value - The value to validate.
 * @param schema - The JSON Schema.
 * @returns The list of problems; empty when the value is valid.
 * @internal
 */
export function validateSchema(
    value: unknown,
    schema: Record<string, unknown>,
): SchemaIssue[] {
    const issues: SchemaIssue[] = [];
    validateInto(issues, value, schema, "$");
    return issues;
}

/**
 * Validates the arguments of a command invocation against the command's
 * `parameters` schema.
 *
 * @remarks
 * Command arguments are positional (`execute(...args)`), but the `parameters`
 * schema describes a single structured argument, which is how every built-in
 * command (and agent tool call) consumes input. The schema is therefore applied to
 * `args[0]`. When no argument is supplied and the schema describes an object,
 * an empty object is validated so `required` still fires.
 *
 * @internal
 */
export function validateCommandArguments(
    args: unknown[],
    schema: Record<string, unknown>,
): SchemaIssue[] {
    let value: unknown = args[0];

    if (value === void 0) {
        const describesObject =
            schema.type === "object" ||
            schema.properties !== void 0 ||
            schema.required !== void 0;

        if (!describesObject) {
            return [{ path: "$", message: "a value is required" }];
        }

        value = {};
    }

    return validateSchema(value, schema);
}
