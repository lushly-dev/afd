/**
 * Type definitions for the `command` decorator system.
 * Enables AI agents to interact with FASTElement components through structured commands.
 *
 * @remarks
 * This module contains types only - no runtime code.
 * Re-exports AFD core types for ecosystem alignment.
 * FAST-AF is an "agent runtime for Web Components".
 */

// ============================================
// AFD Core Type Stubs
// ============================================
// TODO: Replace with re-exports from @lushly-dev/afd-core when available
// These stubs match the AFD core API and will be removed in Wave 2+

/**
 * Metadata attached to command results for tracing and analytics.
 * @public
 */
export interface ResultMetadata {
    /** Execution duration in milliseconds */
    duration?: number;
    /** Trace ID for distributed tracing */
    traceId?: string;
    /** Additional custom metadata */
    [key: string]: unknown;
}

/**
 * Structured error information for failed commands.
 * @public
 */
export interface CommandError {
    /** Machine-readable error code */
    code: string;
    /** Human-readable error message */
    message: string;
    /** Suggestion for how to resolve the error */
    suggestion?: string;
    /** Whether the operation can be retried */
    retryable?: boolean;
    /** Additional error details */
    details?: Record<string, unknown>;
}

/**
 * Result type for command execution.
 * Discriminated union based on success field.
 * @public
 */
export type CommandResult<T = unknown> =
    | { success: true; data: T; metadata?: ResultMetadata }
    | { success: false; error: CommandError; metadata?: ResultMetadata };

/**
 * Standard error codes for command failures.
 * @public
 */
export const ErrorCodes = {
    /** Command ID not found in registry */
    COMMAND_NOT_FOUND: "COMMAND_NOT_FOUND",
    /** Command is currently disabled */
    COMMAND_DISABLED: "COMMAND_DISABLED",
    /** Command is not exposed to the interface that invoked it */
    COMMAND_NOT_EXPOSED: "COMMAND_NOT_EXPOSED",
    /** Invalid parameters provided */
    INVALID_PARAMETERS: "INVALID_PARAMETERS",
    /** Destructive command requires confirmation but no confirmation handler is installed */
    CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
    /** Command execution failed */
    EXECUTION_FAILED: "EXECUTION_FAILED",
    /** Operation timed out */
    TIMEOUT: "TIMEOUT",
    /** Generic internal error */
    INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

/**
 * Create a successful command result.
 * @param data - The result data
 * @param metadata - Optional metadata
 * @public
 */
export function success<T>(data: T, metadata?: ResultMetadata): CommandResult<T> {
    return { success: true, data, metadata };
}

/**
 * Create a failed command result.
 * @param error - The error information
 * @param metadata - Optional metadata
 * @public
 */
export function failure(
    error: CommandError,
    metadata?: ResultMetadata,
): CommandResult<never> {
    return { success: false, error, metadata };
}

/**
 * Type guard for successful results.
 * @param result - The result to check
 * @public
 */
export function isSuccess<T>(
    result: CommandResult<T>,
): result is { success: true; data: T; metadata?: ResultMetadata } {
    return result.success === true;
}

/**
 * Type guard for failed results.
 * @param result - The result to check
 * @public
 */
export function isFailure<T>(
    result: CommandResult<T>,
): result is { success: false; error: CommandError; metadata?: ResultMetadata } {
    return result.success === false;
}

/**
 * Create a CommandError object.
 * @param code - Error code
 * @param message - Error message
 * @param options - Additional error options
 * @public
 */
export function createError(
    code: string,
    message: string,
    options?: Omit<CommandError, "code" | "message">,
): CommandError {
    return { code, message, ...options };
}

// ============================================
// Command System Types
// ============================================

/**
 * Namespace-prefixed command ID.
 * TypeScript template literal enforces at compile time.
 *
 * @remarks
 * Commands must include a namespace prefix to avoid collisions.
 * Format: "namespace.action" or "\@scope/namespace.action"
 *
 * @example
 * ```typescript
 * // Valid IDs:
 * const id1: CommandId = "editor.save";
 * const id2: CommandId = "app.settings.toggle";
 * const id3: CommandId = "@myorg/editor.format";
 *
 * // Invalid (compile error):
 * const bad: CommandId = "save"; // Missing namespace
 * ```
 *
 * @public
 */
export type CommandId = `${string}.${string}` | `@${string}/${string}.${string}`;

/**
 * JSONSchema type for parameter validation.
 * Flexible until formal JSON Schema type is added.
 *
 * @public
 */
export type JSONSchema = Record<string, unknown>;

/**
 * Decorator metadata stored via createMetadataLocator.
 * Represents the compile-time configuration of a command.
 *
 * @public
 */
export interface CommandMetadata {
    /** Namespace-prefixed command identifier */
    id: CommandId;
    /** Name of the decorated method on the component class */
    methodName: string;
    /** Human-readable label for UI display */
    label?: string;
    /** Icon identifier (e.g., "save", "fluent:save-24-regular") */
    icon?: string;
    /** Extended description for command palettes and documentation */
    description?: string;
    /** Grouping category for organization in UI */
    category?: string;
    /** Keyboard shortcut (e.g., "Ctrl+S", "Cmd+Shift+P") */
    keybinding?: string;
    /** JSON Schema for runtime parameter validation */
    parameters?: JSONSchema;
    /** Context expression for conditional visibility (e.g., "editorFocus") */
    when?: string;
    /** If true, command is registered but hidden from UI */
    hidden?: boolean;
    /** If true, command requires user confirmation before execution */
    destructive?: boolean;
    /** Custom confirmation prompt (default: "Are you sure?") */
    confirmPrompt?: string;
    /** Interface exposure configuration */
    expose?: ExposeConfig;
}

/**
 * Options passed to the `command` decorator.
 * All fields except id are optional.
 *
 * @public
 */
export interface CommandOptions {
    /** Human-readable label for UI display */
    label?: string;
    /** Icon identifier (e.g., "save", "fluent:save-24-regular") */
    icon?: string;
    /** Extended description for command palettes and documentation */
    description?: string;
    /** Grouping category for organization in UI */
    category?: string;
    /** Keyboard shortcut (e.g., "Ctrl+S", "Cmd+Shift+P") */
    keybinding?: string;
    /** JSON Schema for runtime parameter validation */
    parameters?: JSONSchema;
    /** Context expression for conditional visibility (e.g., "editorFocus") */
    when?: string;
    /** If true, command is registered but hidden from UI */
    hidden?: boolean;
    /** If true, command requires user confirmation before execution */
    destructive?: boolean;
    /** Custom confirmation prompt (default: "Are you sure?") */
    confirmPrompt?: string;
    /** Interface exposure configuration */
    expose?: ExposeConfig;
}

/**
 * Runtime command entry in the CommandRegistry.
 * Uses AFD's CommandResult for full ecosystem alignment.
 *
 * @remarks
 * Created at connect-time by CommandBehavior from CommandMetadata.
 * The source WeakRef allows garbage collection of disconnected elements.
 *
 * @public
 */
export interface CommandEntry {
    /** Namespace-prefixed command identifier */
    id: CommandId;
    /**
     * Name of the method on the source element that implements the command.
     * Set by CommandBehavior; used for conventions such as `${methodName}Undo()`.
     */
    methodName?: string;
    /** Human-readable label for UI display */
    label: string;
    /** Icon identifier (e.g., "save", "fluent:save-24-regular") */
    icon?: string;
    /** Extended description for command palettes and documentation */
    description?: string;
    /** Grouping category for organization in UI */
    category?: string;
    /** Keyboard shortcut (e.g., "Ctrl+S", "Cmd+Shift+P") */
    keybinding?: string;
    /** JSON Schema for runtime parameter validation */
    parameters?: JSONSchema;
    /** If true, command stays registered and executable but is omitted from `getActions()` */
    hidden?: boolean;
    /** If true, command requires user confirmation before execution */
    destructive?: boolean;
    /** Custom confirmation prompt (default: "Are you sure?") */
    confirmPrompt?: string;
    /** Interface exposure configuration */
    expose?: ExposeConfig;
    /**
     * Execute the command with optional arguments.
     * Returns AFD CommandResult for consistent error handling.
     */
    execute: (...args: unknown[]) => CommandResult | Promise<CommandResult>;
    /**
     * Whether the command can currently be executed.
     * Reactive via Observable.track() on the source element.
     */
    readonly canExecute: boolean;
    /**
     * Whether the command should be visible in UI.
     * Reactive via Observable.track() on the source element.
     */
    readonly when: boolean;
    /**
     * WeakRef to the source element.
     * Allows garbage collection of disconnected elements.
     */
    source: { deref(): HTMLElement | undefined };
}

/**
 * Action format for command palette integration.
 * Compatible with ninja-keys and similar libraries.
 *
 * @public
 */
export interface Action {
    /** Unique action identifier */
    id: string;
    /** Display title for the action */
    title: string;
    /** Icon identifier */
    icon?: string;
    /** Section/category for grouping */
    section?: string;
    /** Keyboard shortcut string */
    hotkey?: string;
    /** Whether the action is currently disabled */
    disabled?: boolean;
    /** Handler function to execute the action */
    handler: () => void;
}

// ============================================
// Command Exposure Types
// ============================================

/**
 * Interface types for command exposure filtering.
 * @public
 */
export type InterfaceType = "palette" | "agent" | "mcp" | "cli";

/**
 * Configuration for which interfaces a command is exposed to.
 * Secure defaults: palette and agent are opt-out, mcp and cli are opt-in.
 *
 * @remarks
 * - palette: Command palette UI (ninja-keys, etc.)
 * - agent: AI agents interacting with the component
 * - mcp: Model Context Protocol servers
 * - cli: Command-line interface tools
 *
 * @public
 */
export interface ExposeConfig {
    /** Expose to command palette UI (default: true) */
    palette?: boolean;
    /** Expose to AI agents (default: true) */
    agent?: boolean;
    /** Expose to MCP servers (default: false - opt-in for security) */
    mcp?: boolean;
    /** Expose to CLI tools (default: false - opt-in for security) */
    cli?: boolean;
}

/**
 * Default expose configuration.
 * Secure defaults: palette and agent are enabled, mcp and cli require opt-in.
 * @public
 */
export const DEFAULT_EXPOSE_CONFIG: Required<ExposeConfig> = {
    palette: true,
    agent: true,
    mcp: false,
    cli: false,
};

/**
 * Filter options for getActions().
 * @public
 */
export interface ActionFilter {
    /** Filter by interface type */
    interface?: InterfaceType;
}
