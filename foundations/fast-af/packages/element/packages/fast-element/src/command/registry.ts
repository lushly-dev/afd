/**
 * CommandRegistry singleton for managing command lifecycle.
 * Enables AI agents and command palettes to discover and execute commands.
 *
 * @remarks
 * - SSR-safe: Guards against document access in Node.js
 * - The `cmd-exec` document event bridge is opt-in (`enableEventBridge()`)
 * - Uses AFD's failure() helper for error results
 *
 * @example
 * ```typescript
 * import { CommandRegistry } from '@lushly-dev/fast-element/command.js';
 *
 * // Execute a command
 * const result = await CommandRegistry.execute('editor.save');
 * if (result.success) {
 *   console.log('Saved:', result.data);
 * } else {
 *   console.error('Failed:', result.error.message);
 * }
 *
 * // Get actions for command palette
 * const actions = CommandRegistry.getActions();
 *
 * // Subscribe to changes
 * const unsubscribe = CommandRegistry.onChange((added, removed) => {
 *   console.log('Commands changed:', { added, removed });
 * });
 * ```
 */

import { isDevMode } from "../dev-mode.js";
import { validateCommandArguments } from "./schema-validation.js";
import type {
    Action,
    ActionFilter,
    CommandEntry,
    CommandResult,
    InterfaceType,
} from "./types.js";
import { DEFAULT_EXPOSE_CONFIG, ErrorCodes, failure } from "./types.js";

/**
 * Interceptor for command execution.
 * Interceptors can modify, block, or wrap command execution.
 *
 * @remarks
 * Interceptors run in priority order (lower priority runs first).
 * Each interceptor must call `next()` to continue the chain.
 *
 * @example
 * ```typescript
 * CommandRegistry.addInterceptor({
 *   name: 'confirm',
 *   priority: 10,
 *   intercept: async (command, args, next) => {
 *     if (command.destructive) {
 *       const confirmed = await showConfirm('Are you sure?');
 *       if (!confirmed) return { success: false, error: { code: 'USER_CANCELLED', message: 'Cancelled' } };
 *     }
 *     return next();
 *   }
 * });
 * ```
 *
 * @public
 */
export interface Interceptor {
    /** Unique name for the interceptor (used for removal) */
    name: string;
    /** Priority order (lower runs first, default: 100) */
    priority?: number;
    /**
     * Marks the interceptor as one that asks for user confirmation of destructive
     * commands.
     *
     * @remarks
     * Externally-originated invocations (see {@link CommandRegistryAPI.invoke}) of
     * `destructive` commands fail closed with `CONFIRMATION_REQUIRED` unless an
     * interceptor with this flag, or one named `confirm`, is installed.
     */
    confirms?: boolean;
    /**
     * Intercept the command execution.
     * @param command - The command entry being executed
     * @param args - Arguments passed to the command
     * @param next - Call to continue to next interceptor or execute the command
     * @returns The command result
     */
    intercept(
        command: CommandEntry,
        args: unknown[],
        next: () => Promise<CommandResult>,
    ): Promise<CommandResult>;
}

/**
 * PostHook for observing command execution results.
 * PostHooks run after command execution completes (success or failure).
 *
 * @remarks
 * Unlike interceptors, post-hooks cannot modify the result.
 * They are useful for:
 * - Logging and analytics
 * - Building undo stacks
 * - Triggering side effects
 *
 * @example
 * ```typescript
 * CommandRegistry.addPostHook({
 *   name: 'undo',
 *   afterExecute: (command, args, result) => {
 *     if (result.success && command.undoable) {
 *       undoStack.push({ command, args, result });
 *     }
 *   }
 * });
 * ```
 *
 * @public
 */
export interface PostHook {
    /** Unique name for the post-hook (used for removal) */
    name: string;
    /**
     * Called after command execution completes.
     * @param command - The command entry that was executed
     * @param args - Arguments that were passed to the command
     * @param result - The result of command execution
     */
    afterExecute(command: CommandEntry, args: unknown[], result: CommandResult): void;
}

/**
 * Reads a `canExecute`/`when` getter, treating a throwing getter as `false` so a
 * single faulty command cannot break command listing.
 * @internal
 */
function readFlag(read: () => boolean): boolean {
    try {
        return read();
    } catch {
        return false;
    }
}

/**
 * Listener function signature for command registry changes.
 * @param added - Array of newly registered command IDs
 * @param removed - Array of unregistered command IDs
 * @public
 */
export type CommandListener = (added: string[], removed: string[]) => void;

/**
 * Telemetry handler function signature.
 * @param event - Event name (e.g., "command.registered", "command.executed")
 * @param data - Event data
 * @public
 */
export type TelemetryHandler = (event: string, data: Record<string, unknown>) => void;

/**
 * Describes who is invoking a command from outside the component's own code.
 * @public
 */
export interface InvokeOptions {
    /**
     * The interface the invocation arrives through (`agent`, `mcp`, `cli` or
     * `palette`). The command's `expose` configuration must enable it.
     */
    origin: InterfaceType;
}

/**
 * Public contract for the global command registry.
 * @public
 */
export interface CommandRegistryAPI {
    register(id: string, command: CommandEntry): void;
    unregister(id: string, expected?: CommandEntry): void;
    get(id: string): CommandEntry | undefined;
    execute(id: string, ...args: unknown[]): Promise<CommandResult>;
    invoke(id: string, args: unknown[], options: InvokeOptions): Promise<CommandResult>;
    enableEventBridge(): () => void;
    getActions(filter?: ActionFilter): Action[];
    onChange(listener: CommandListener): () => void;
    clear(): void;
    forScope(shadowRoot: ShadowRoot): CommandRegistryAPI;
    setTelemetryHandler(handler?: TelemetryHandler): void;
    addInterceptor(interceptor: Interceptor): void;
    removeInterceptor(name: string): void;
    addPostHook(hook: PostHook): void;
    removePostHook(name: string): void;
}

/**
 * Internal implementation of the CommandRegistry.
 * @internal
 */
class CommandRegistryImpl implements CommandRegistryAPI {
    private commands = new Map<string, CommandEntry>();
    private shadowed = new Map<string, CommandEntry[]>();
    private listeners = new Set<CommandListener>();
    private interceptors: Interceptor[] = [];
    private postHooks: PostHook[] = [];
    private eventBridge?: (e: Event) => void;
    private eventBridgeUsers = 0;
    private telemetryHandler?: TelemetryHandler;

    /**
     * Enables the document-level `cmd-exec` event bridge.
     *
     * @returns A function that disables the bridge again
     *
     * @remarks
     * The bridge is **opt-in**. A `cmd-exec` event
     * (`new CustomEvent("cmd-exec", { detail: { id, args } })`) is an external
     * invocation path: any script, extension or agent that can dispatch events on
     * the document can use it. Events are therefore treated as `agent` origin
     * invocations (see {@link CommandRegistryAPI.invoke}): the command must be
     * exposed to `agent`, its `parameters` schema is enforced, and destructive
     * commands fail closed unless a confirmation interceptor is installed.
     *
     * Calling this more than once is safe; the single shared listener is removed
     * only when every caller has disposed. SSR-safe: a no-op outside a browser.
     *
     * @public
     */
    enableEventBridge(): () => void {
        if (typeof document === "undefined") {
            return () => {};
        }

        if (this.eventBridge === void 0) {
            const bridge = (e: Event) => {
                const detail = (e as CustomEvent).detail;

                if (
                    !detail ||
                    typeof detail !== "object" ||
                    typeof detail.id !== "string"
                ) {
                    return;
                }

                const args = Array.isArray(detail.args) ? detail.args : [];
                void this.invoke(detail.id, args, { origin: "agent" });
            };

            this.eventBridge = bridge;
            document.addEventListener("cmd-exec", bridge);
        }

        this.eventBridgeUsers++;

        let disposed = false;
        return () => {
            if (disposed) return;
            disposed = true;

            if (--this.eventBridgeUsers === 0 && this.eventBridge !== void 0) {
                document.removeEventListener("cmd-exec", this.eventBridge);
                this.eventBridge = void 0;
            }
        };
    }

    /**
     * Registers a command entry in the registry.
     *
     * @param id - The command identifier
     * @param command - The command entry to register
     *
     * @remarks
     * - Emits a warning in DEV_MODE if overwriting an existing command
     * - Notifies listeners of the registration
     * - Emits telemetry event
     *
     * @public
     */
    register(id: string, command: CommandEntry): void {
        const current = this.commands.get(id);
        const stack = this.shadowed.get(id);

        // Re-registering an entry that is currently shadowed promotes it.
        if (stack !== void 0) {
            const index = stack.indexOf(command);
            if (index !== -1) stack.splice(index, 1);
        }

        if (current !== void 0 && current !== command) {
            if (isDevMode()) {
                console.warn(
                    `[fast-af] Command "${id}" already registered. Overwriting.`,
                );
            }

            // Keep the displaced entry so removing the newest source falls back to it.
            const shadows = stack ?? [];
            shadows.push(current);
            this.shadowed.set(id, shadows);
        }

        this.commands.set(id, command);
        this.notify([id], []);
        this.emitTelemetry("command.registered", { id, label: command.label });
    }

    /**
     * Unregisters a command from the registry.
     *
     * @param id - The command identifier to unregister
     * @param expected - When provided, only this registration is removed
     *
     * @remarks
     * - No-op if command doesn't exist
     * - The most recent registration wins, but earlier registrations of the same ID
     *   (for example from several connected elements) are remembered: removing the
     *   active `expected` entry makes the previous one active again, and the
     *   command is only unregistered when no registration remains
     * - Without `expected`, the command and all its registrations are removed
     * - Notifies listeners of the removal (or of the replacement when falling back)
     * - Emits telemetry event on removal
     *
     * @public
     */
    unregister(id: string, expected?: CommandEntry): void {
        if (expected !== void 0 && this.commands.get(id) !== expected) {
            // A stale removal of a shadowed registration.
            const stack = this.shadowed.get(id);
            const index = stack?.indexOf(expected) ?? -1;

            if (stack !== void 0 && index !== -1) {
                stack.splice(index, 1);
                if (stack.length === 0) this.shadowed.delete(id);
            }

            return;
        }

        const fallback = expected !== void 0 ? this.shadowed.get(id)?.pop() : void 0;

        if (fallback !== void 0) {
            if (this.shadowed.get(id)?.length === 0) this.shadowed.delete(id);
            this.commands.set(id, fallback);
            this.notify([id], []);
            return;
        }

        this.shadowed.delete(id);

        if (this.commands.delete(id)) {
            this.notify([], [id]);
            this.emitTelemetry("command.unregistered", { id });
        }
    }

    /**
     * Retrieves a command entry by ID.
     *
     * @param id - The command identifier
     * @returns The command entry, or undefined if not found
     *
     * @public
     */
    get(id: string): CommandEntry | undefined {
        return this.commands.get(id);
    }

    /**
     * Executes a command by ID on behalf of the application's own code.
     *
     * @param id - The command identifier
     * @param args - Arguments to pass to the command
     * @returns A Promise resolving to the CommandResult
     *
     * @remarks
     * This is the trusted, programmatic path: `expose`, `parameters` and the
     * confirmation requirement are not enforced here (use `invoke()` for
     * invocations that originate from an agent, MCP server, CLI or event).
     *
     * Never throws. Returns a failure result if:
     * - Command not found (COMMAND_NOT_FOUND)
     * - Command is disabled (COMMAND_DISABLED)
     * - A `canExecute` getter throws (EXECUTION_FAILED)
     *
     * Interceptors are run in priority order before the command handler.
     *
     * @public
     */
    execute(id: string, ...args: unknown[]): Promise<CommandResult> {
        return this.run(id, args);
    }

    /**
     * Invokes a command on behalf of an external caller (agent, MCP, CLI, palette
     * or the `cmd-exec` event bridge).
     *
     * @param id - The command identifier
     * @param args - Arguments to pass to the command
     * @param options - Describes the invocation origin
     * @returns A Promise resolving to the CommandResult; never rejects
     *
     * @remarks
     * Applies the safety properties that `execute()` leaves to the caller:
     * - `expose`: the command must be exposed to `options.origin`
     *   (COMMAND_NOT_EXPOSED); same secure defaults as `getActions()`
     * - `parameters`: when the command declares a JSON Schema it is applied to
     *   `args[0]` (INVALID_PARAMETERS); see the `parameters` option docs
     * - `destructive`: fails closed (CONFIRMATION_REQUIRED) unless a confirmation
     *   interceptor (named `confirm`, or flagged `confirms: true`) is installed
     *
     * @public
     */
    invoke(id: string, args: unknown[], options: InvokeOptions): Promise<CommandResult> {
        return this.run(id, Array.isArray(args) ? args : [], options);
    }

    /**
     * Shared execution path for `execute()` and `invoke()`.
     * @internal
     */
    private run(
        id: string,
        args: unknown[],
        options?: InvokeOptions,
    ): Promise<CommandResult> {
        const cmd = this.commands.get(id);

        if (!cmd) {
            return Promise.resolve(
                failure({
                    code: ErrorCodes.COMMAND_NOT_FOUND,
                    message: `Command not found: ${id}`,
                    suggestion: "Check command ID or ensure component is connected",
                    retryable: false,
                }),
            );
        }

        const origin = options?.origin;

        if (origin !== void 0) {
            const expose = { ...DEFAULT_EXPOSE_CONFIG, ...cmd.expose };

            if (expose[origin] !== true) {
                return Promise.resolve(
                    this.reject(
                        id,
                        origin,
                        failure({
                            code: ErrorCodes.COMMAND_NOT_EXPOSED,
                            message: `Command not exposed to ${String(origin)}: ${id}`,
                            suggestion:
                                "Enable the interface in the command's expose configuration",
                            retryable: false,
                        }),
                    ),
                );
            }
        }

        let canExecute: boolean;

        try {
            canExecute = cmd.canExecute;
        } catch (error) {
            return Promise.resolve(
                failure({
                    code: ErrorCodes.EXECUTION_FAILED,
                    message: `Command availability check failed: ${id}`,
                    suggestion: "Inspect the command's canExecute implementation",
                    retryable: false,
                    details: {
                        cause:
                            error instanceof Error
                                ? { message: error.message, name: error.name }
                                : { value: String(error) },
                    },
                }),
            );
        }

        if (!canExecute) {
            return Promise.resolve(
                failure({
                    code: ErrorCodes.COMMAND_DISABLED,
                    message: `Command disabled: ${id}`,
                    suggestion: "Wait for the command to become available",
                    retryable: true,
                }),
            );
        }

        if (origin !== void 0) {
            if (cmd.parameters) {
                const issues = validateCommandArguments(args, cmd.parameters);

                if (issues.length > 0) {
                    return Promise.resolve(
                        this.reject(
                            id,
                            origin,
                            failure({
                                code: ErrorCodes.INVALID_PARAMETERS,
                                message: `Invalid parameters for ${id}: ${issues
                                    .map(i => `${i.path} ${i.message}`)
                                    .join("; ")}`,
                                suggestion:
                                    "Provide arguments matching the command's parameters schema",
                                retryable: false,
                                details: { issues },
                            }),
                        ),
                    );
                }
            }

            if (
                cmd.destructive &&
                !this.interceptors.some(i => i.confirms === true || i.name === "confirm")
            ) {
                return Promise.resolve(
                    this.reject(
                        id,
                        origin,
                        failure({
                            code: ErrorCodes.CONFIRMATION_REQUIRED,
                            message: `Command requires confirmation: ${id}`,
                            suggestion:
                                "Install a confirmation interceptor (for example ConfirmBehavior) before invoking destructive commands externally",
                            retryable: false,
                        }),
                    ),
                );
            }
        }

        const start = globalThis.performance?.now() ?? Date.now();

        // Build the handler that executes the command
        const executeHandler = (): Promise<CommandResult> => {
            return Promise.resolve(cmd.execute(...args));
        };

        // Build the interceptor chain and execute
        const chain = this.buildInterceptorChain(cmd, args, executeHandler);

        return Promise.resolve()
            .then(chain)
            .then(result => this.normalizeResult(id, result))
            .catch(error =>
                failure({
                    code: ErrorCodes.EXECUTION_FAILED,
                    message: `Command execution failed: ${id}`,
                    suggestion:
                        "Inspect the command implementation and retry after resolving the error",
                    retryable: false,
                    details: {
                        cause:
                            error instanceof Error
                                ? { message: error.message, name: error.name }
                                : { value: String(error) },
                    },
                }),
            )
            .then(result => {
                this.emitTelemetry("command.executed", {
                    id,
                    duration: (globalThis.performance?.now() ?? Date.now()) - start,
                    success: result.success,
                });

                // Run post-hooks after execution
                this.runPostHooks(cmd, args, result);

                return result;
            });
    }

    /**
     * Gets all available commands as Action objects for command palette integration.
     *
     * @param filter - Optional filter to restrict which commands are returned
     * @returns Array of Action objects for visible, available commands
     *
     * @remarks
     * - Filters out commands declared `hidden: true`
     * - Filters out commands where `when` is false
     * - Sets `disabled` based on `canExecute`
     * - Compatible with ninja-keys and similar libraries
     * - When filter.interface is specified, only returns commands exposed to that interface
     * - Secure defaults: MCP and CLI are opt-in (false by default)
     *
     * @example
     * ```typescript
     * // Get all visible commands (for command palette)
     * const allActions = CommandRegistry.getActions();
     *
     * // Get only commands exposed to MCP
     * const mcpActions = CommandRegistry.getActions({ interface: 'mcp' });
     *
     * // Get only commands exposed to CLI
     * const cliActions = CommandRegistry.getActions({ interface: 'cli' });
     * ```
     *
     * @public
     */
    getActions(filter?: ActionFilter): Action[] {
        return Array.from(this.commands.values())
            .filter(cmd => {
                // Hidden commands stay registered/executable but never surface as actions
                if (cmd.hidden) return false;

                // Always filter by visibility
                if (!readFlag(() => cmd.when)) return false;

                // If interface filter is specified, check expose config
                if (filter?.interface) {
                    const expose = { ...DEFAULT_EXPOSE_CONFIG, ...cmd.expose };
                    return expose[filter.interface] === true;
                }

                return true;
            })
            .map(cmd => ({
                id: cmd.id,
                title: cmd.label,
                icon: cmd.icon,
                section: cmd.category,
                hotkey: cmd.keybinding,
                disabled: !readFlag(() => cmd.canExecute),
                handler: () => {
                    this.execute(cmd.id);
                },
            }));
    }

    /**
     * Subscribes to command registry changes.
     *
     * @param listener - Callback invoked when commands are added or removed
     * @returns Unsubscribe function
     *
     * @example
     * ```typescript
     * const unsubscribe = CommandRegistry.onChange((added, removed) => {
     *   console.log('Added:', added, 'Removed:', removed);
     * });
     *
     * // Later, to stop listening:
     * unsubscribe();
     * ```
     *
     * @public
     */
    onChange(listener: CommandListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Clears all registered commands.
     *
     * @remarks
     * For testing purposes only.
     * Notifies listeners of all removed commands.
     *
     * @public
     */
    clear(): void {
        const ids = Array.from(this.commands.keys());
        this.commands.clear();
        this.shadowed.clear();
        if (ids.length > 0) {
            this.notify([], ids);
        }
    }

    /**
     * Gets a scoped registry for micro-frontend isolation.
     *
     * @param _shadowRoot - The shadow root to scope to (unused in Phase 1)
     * @returns The global registry (scoped registries are Phase 2)
     *
     * @remarks
     * Phase 2 stub: Returns global registry with warning in DEV_MODE.
     * Future implementation will support isolated command registries
     * per shadow root for micro-frontend architectures.
     *
     * @public
     */
    forScope(_shadowRoot: ShadowRoot): CommandRegistryAPI {
        if (isDevMode()) {
            console.warn(
                "[fast-af] Scoped registries are Phase 2. Returning global registry.",
            );
        }
        return this;
    }

    /**
     * Sets a telemetry handler for command events.
     *
     * @param handler - Function to handle telemetry events
     *
     * @remarks
     * Events emitted:
     * - "command.registered" - \{ id, label \}
     * - "command.unregistered" - \{ id \}
     * - "command.executed" - \{ id, duration, success \}
     * - "command.rejected" - \{ id, origin, code \} (external invocation refused)
     *
     * @example
     * ```typescript
     * CommandRegistry.setTelemetryHandler((event, data) => {
     *   analytics.track(event, data);
     * });
     * ```
     *
     * @public
     */
    setTelemetryHandler(handler?: TelemetryHandler): void {
        this.telemetryHandler = handler;
    }

    /**
     * Adds an interceptor to the command execution chain.
     *
     * @param interceptor - The interceptor to add
     *
     * @remarks
     * - Interceptors run in priority order (lower priority runs first)
     * - Default priority is 100
     * - Multiple interceptors can have the same priority
     * - Interceptors with the same name will not be duplicated
     *
     * @example
     * ```typescript
     * CommandRegistry.addInterceptor({
     *   name: 'logging',
     *   priority: 1,
     *   intercept: async (cmd, args, next) => {
     *     console.log('Executing:', cmd.id);
     *     const result = await next();
     *     console.log('Result:', result);
     *     return result;
     *   }
     * });
     * ```
     *
     * @public
     */
    addInterceptor(interceptor: Interceptor): void {
        // Avoid duplicates by name
        if (this.interceptors.some(i => i.name === interceptor.name)) {
            if (isDevMode()) {
                console.warn(
                    `[fast-af] Interceptor "${interceptor.name}" already registered. Skipping.`,
                );
            }
            return;
        }

        this.interceptors.push(interceptor);
        this.interceptors.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
        this.emitTelemetry("interceptor.added", {
            name: interceptor.name,
            priority: interceptor.priority ?? 100,
        });
    }

    /**
     * Removes an interceptor by name.
     *
     * @param name - The name of the interceptor to remove
     *
     * @remarks
     * - No-op if interceptor doesn't exist
     * - Emits telemetry event on removal
     *
     * @example
     * ```typescript
     * CommandRegistry.removeInterceptor('confirm');
     * ```
     *
     * @public
     */
    removeInterceptor(name: string): void {
        const before = this.interceptors.length;
        this.interceptors = this.interceptors.filter(i => i.name !== name);
        if (this.interceptors.length < before) {
            this.emitTelemetry("interceptor.removed", { name });
        }
    }

    /**
     * Adds a post-hook to observe command execution results.
     *
     * @param hook - The post-hook to add
     *
     * @remarks
     * - Post-hooks run after command execution completes
     * - They cannot modify the result
     * - Post-hooks with the same name will not be duplicated
     *
     * @example
     * ```typescript
     * CommandRegistry.addPostHook({
     *   name: 'undo',
     *   afterExecute: (cmd, args, result) => {
     *     if (result.success) {
     *       undoStack.push({ cmd, args, result });
     *     }
     *   }
     * });
     * ```
     *
     * @public
     */
    addPostHook(hook: PostHook): void {
        // Avoid duplicates by name
        if (this.postHooks.some(h => h.name === hook.name)) {
            if (isDevMode()) {
                console.warn(
                    `[fast-af] PostHook "${hook.name}" already registered. Skipping.`,
                );
            }
            return;
        }

        this.postHooks.push(hook);
        this.emitTelemetry("posthook.added", { name: hook.name });
    }

    /**
     * Removes a post-hook by name.
     *
     * @param name - The name of the post-hook to remove
     *
     * @remarks
     * - No-op if post-hook doesn't exist
     * - Emits telemetry event on removal
     *
     * @example
     * ```typescript
     * CommandRegistry.removePostHook('undo');
     * ```
     *
     * @public
     */
    removePostHook(name: string): void {
        const before = this.postHooks.length;
        this.postHooks = this.postHooks.filter(h => h.name !== name);
        if (this.postHooks.length < before) {
            this.emitTelemetry("posthook.removed", { name });
        }
    }

    /**
     * Notifies all listeners of command changes.
     * @internal
     */
    private notify(added: string[], removed: string[]): void {
        this.listeners.forEach(listener => {
            try {
                listener(added, removed);
            } catch (error) {
                if (isDevMode()) {
                    console.error("[fast-af] Command listener threw an error:", error);
                }
            }
        });
    }

    /**
     * Emits a telemetry event if handler is set.
     * @internal
     */
    private emitTelemetry(event: string, data: Record<string, unknown>): void {
        try {
            this.telemetryHandler?.(event, data);
        } catch (error) {
            if (isDevMode()) {
                console.error("[fast-af] Telemetry handler threw an error:", error);
            }
        }
    }

    /**
     * Emits telemetry for an externally-originated invocation that was refused
     * before reaching the command, and passes the failure through.
     * @internal
     */
    private reject(
        id: string,
        origin: InterfaceType,
        result: CommandResult<never>,
    ): CommandResult<never> {
        this.emitTelemetry("command.rejected", {
            id,
            origin,
            code: result.success ? void 0 : result.error.code,
        });

        return result;
    }

    private normalizeResult(id: string, result: unknown): CommandResult {
        if (
            result &&
            typeof result === "object" &&
            (result as { success?: unknown }).success === true &&
            "data" in result
        ) {
            return result as CommandResult;
        }

        if (
            result &&
            typeof result === "object" &&
            (result as { success?: unknown }).success === false &&
            "error" in result
        ) {
            return result as CommandResult;
        }

        return failure({
            code: ErrorCodes.INTERNAL_ERROR,
            message: `Command returned an invalid result: ${id}`,
            suggestion: "Return success(data) or failure(error) from the command",
            retryable: false,
        });
    }

    /**
     * Builds the interceptor chain for command execution.
     * @internal
     */
    private buildInterceptorChain(
        command: CommandEntry,
        args: unknown[],
        handler: () => Promise<CommandResult>,
    ): () => Promise<CommandResult> {
        // Build chain from back to front
        let chain = handler;

        for (let i = this.interceptors.length - 1; i >= 0; i--) {
            const interceptor = this.interceptors[i];
            const next = chain;
            chain = () => interceptor.intercept(command, args, next);
        }

        return chain;
    }

    /**
     * Runs all post-hooks after command execution.
     * @internal
     */
    private runPostHooks(
        command: CommandEntry,
        args: unknown[],
        result: CommandResult,
    ): void {
        for (const hook of this.postHooks) {
            try {
                hook.afterExecute(command, args, result);
            } catch (error) {
                if (isDevMode()) {
                    console.error(
                        `[fast-af] PostHook "${hook.name}" threw an error:`,
                        error,
                    );
                }
            }
        }
    }
}

/**
 * Global CommandRegistry singleton.
 *
 * @remarks
 * The CommandRegistry is the central hub for command management.
 * Commands are registered automatically when FASTElement components
 * with \@command decorators connect to the DOM.
 *
 * Key features:
 * - SSR-safe with lazy initialization
 * - Reactive: subscribe to changes via onChange()
 * - Command palette integration via getActions()
 * - Telemetry hooks for analytics
 *
 * @example
 * ```typescript
 * import { CommandRegistry, success, failure } from '\@lushly-dev/fast-element/command.js';
 *
 * // Manual command registration (usually done automatically)
 * CommandRegistry.register('custom.action', \{
 *   id: 'custom.action',
 *   label: 'Custom Action',
 *   execute: () => success(\{ done: true \}),
 *   canExecute: true,
 *   when: true,
 *   source: new WeakRef(document.body),
 * \});
 *
 * // Execute command
 * const result = await CommandRegistry.execute('custom.action');
 *
 * // Command palette integration
 * const actions = CommandRegistry.getActions();
 * ninjaKeys.data = actions;
 * ```
 *
 * @public
 */
export const CommandRegistry: CommandRegistryAPI = new CommandRegistryImpl();
