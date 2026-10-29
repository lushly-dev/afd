/**
 * UndoBehavior - Manages an undo stack for undoable commands.
 *
 * @remarks
 * Uses the CommandRegistry PostHook API to observe command execution and
 * capture undo functions. Provides keyboard shortcut support (Ctrl+Z).
 *
 * Commands are undoable if the source element has a matching `${methodName}Undo()`
 * method that returns a function to reverse the operation. `methodName` is the name
 * of the `@command`-decorated method (not the last segment of the command ID).
 *
 * @example
 * ```typescript
 * import { UndoBehavior } from '@lushly-dev/fast-element/command.js';
 *
 * class MyApp extends FASTElement {
 *   private undoBehavior = new UndoBehavior({ limit: 20 });
 *
 *   connectedCallback() {
 *     super.connectedCallback();
 *     this.$fastController.addBehavior(this.undoBehavior);
 *   }
 *
 *   // Command with undo support
 *   @command("editor.delete")
 *   delete() { ... }
 *
 *   // Undo function - returns the reverse operation
 *   deleteUndo() {
 *     return () => { ... restore deleted content ... };
 *   }
 * }
 * ```
 *
 * @public
 */

import type { CommandHostController } from "../behavior.js";
import { CommandRegistry } from "../registry.js";
import type { CommandEntry, CommandResult } from "../types.js";

/**
 * Entry in the undo stack.
 * @public
 */
export interface UndoEntry {
    /** The command ID that was executed */
    commandId: string;
    /** The command label for display */
    label: string;
    /** Arguments that were passed to the command */
    args: unknown[];
    /** The undo function to reverse the operation */
    undoFn: () => void | Promise<void>;
    /** Timestamp when the command was executed */
    timestamp: number;
}

/**
 * Options for configuring UndoBehavior.
 * @public
 */
export interface UndoBehaviorOptions {
    /** Maximum number of undo entries to keep (default: 10) */
    limit?: number;
    /** Whether to register Ctrl+Z keyboard shortcut (default: true) */
    enableKeyboardShortcut?: boolean;
}

/**
 * Whether a keyboard event originates from an element whose own undo history the
 * browser manages (inputs, textareas, selects, contenteditable).
 * @internal
 */
function isEditableTarget(event: Event): boolean {
    // composedPath()[0] sees through shadow roots, where event.target is retargeted
    const target = (event.composedPath?.()[0] ?? event.target) as Element | null;

    if (!target || typeof (target as Element).tagName !== "string") {
        return false;
    }

    const tag = target.tagName;

    return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (target as HTMLElement).isContentEditable === true
    );
}

/**
 * Behavior that manages an undo stack for undoable commands.
 *
 * @remarks
 * - Installs a shared PostHook with the CommandRegistry while at least one instance
 *   is connected (reference counted: added by the first instance, removed when the
 *   last one disconnects)
 * - When several instances are connected, the most recently connected one records
 *   undo entries and handles the keyboard shortcut
 * - Captures undo functions from `${methodName}Undo()` convention
 * - Maintains a limited stack of undo entries
 * - Provides `undo()` method and Ctrl/Cmd+Z keyboard shortcut; the shortcut is left
 *   to the browser when the event target is an editable element
 * - Cleans up on disconnect
 *
 * @public
 */
export class UndoBehavior {
    /** Undo stack (most recent at the end) */
    private stack: UndoEntry[] = [];

    /** Maximum stack size */
    private readonly limit: number;

    /** Whether keyboard shortcut is enabled */
    private readonly enableKeyboardShortcut: boolean;

    /** Bound keyboard handler for cleanup */
    private boundKeydownHandler: ((e: KeyboardEvent) => void) | null = null;

    /** Name of the post-hook for registration/removal */
    private static readonly POST_HOOK_NAME = "undo";

    /** Connected instances, oldest first. The last one is the active handler. */
    private static readonly instances: UndoBehavior[] = [];

    /** Whether this instance is currently connected */
    private connected = false;

    /**
     * Creates a new UndoBehavior instance.
     *
     * @param options - Configuration options
     */
    constructor(options: UndoBehaviorOptions = {}) {
        this.limit = options.limit ?? 10;
        this.enableKeyboardShortcut = options.enableKeyboardShortcut ?? true;
    }

    /**
     * Called when the host element connects to the DOM.
     * Registers the undo post-hook with CommandRegistry.
     *
     * @param controller - The host controller managing this behavior
     */
    connectedCallback(controller: CommandHostController): void {
        if (this.connected) {
            return;
        }

        this.connected = true;
        const instances = UndoBehavior.instances;
        instances.push(this);

        // Register the shared post-hook to capture undo functions
        if (instances.length === 1) {
            CommandRegistry.addPostHook({
                name: UndoBehavior.POST_HOOK_NAME,
                afterExecute: (command, args, result) => {
                    const active = UndoBehavior.instances;
                    active[active.length - 1]?.handleCommandExecuted(
                        command,
                        args,
                        result,
                    );
                },
            });
        }

        // Register keyboard shortcut
        if (this.enableKeyboardShortcut && typeof document !== "undefined") {
            const handler = this.handleKeydown.bind(this);
            this.boundKeydownHandler = handler;
            document.addEventListener("keydown", handler);
        }
    }

    /**
     * Called when the host element disconnects from the DOM.
     * Removes the post-hook (when this was the last instance) and cleans up state.
     *
     * @param controller - The host controller managing this behavior
     */
    disconnectedCallback(controller: CommandHostController): void {
        if (!this.connected) {
            return;
        }

        this.connected = false;

        const instances = UndoBehavior.instances;
        const index = instances.indexOf(this);

        if (index !== -1) {
            instances.splice(index, 1);
        }

        // Remove post-hook once no instance needs it
        if (instances.length === 0) {
            CommandRegistry.removePostHook(UndoBehavior.POST_HOOK_NAME);
        }

        // Remove keyboard handler
        const handler = this.boundKeydownHandler;
        if (typeof document !== "undefined" && handler !== null) {
            document.removeEventListener("keydown", handler);
            this.boundKeydownHandler = null;
        }

        // Clear state
        this.stack = [];
    }

    /**
     * Gets the current undo stack.
     *
     * @remarks
     * Returns a copy of the stack to prevent external mutation.
     *
     * @returns Array of undo entries (most recent last)
     */
    getStack(): readonly UndoEntry[] {
        return [...this.stack];
    }

    /**
     * Gets the number of entries in the undo stack.
     *
     * @returns The stack size
     */
    get stackSize(): number {
        return this.stack.length;
    }

    /**
     * Whether there are any operations to undo.
     *
     * @returns True if the stack is not empty
     */
    get canUndo(): boolean {
        return this.stack.length > 0;
    }

    /**
     * Gets the most recent undo entry without removing it.
     *
     * @returns The most recent entry, or undefined if stack is empty
     */
    peek(): UndoEntry | undefined {
        return this.stack[this.stack.length - 1];
    }

    /**
     * Undoes the most recent operation.
     *
     * @remarks
     * Pops the most recent entry from the stack and executes its undo function.
     * If the undo function is async, this returns a Promise.
     *
     * @returns Promise that resolves when the undo is complete
     */
    async undo(): Promise<boolean> {
        const entry = this.stack.pop();
        if (!entry) {
            return false;
        }

        try {
            await entry.undoFn();
            return true;
        } catch (error) {
            // Re-push on failure so user can retry
            this.stack.push(entry);
            throw error;
        }
    }

    /**
     * Clears the entire undo stack.
     */
    clear(): void {
        this.stack = [];
    }

    /**
     * Handles a command execution and potentially adds to the undo stack.
     *
     * @internal
     */
    private handleCommandExecuted(
        command: CommandEntry,
        args: unknown[],
        result: CommandResult,
    ): void {
        // Only capture successful commands
        if (!result.success) {
            return;
        }

        // Get the source element
        const source = command.source.deref();
        if (!source) {
            return;
        }

        // Prefer the decorated method's name; fall back to the last segment of the
        // command ID (e.g., "editor.save" -> "save") for hand-registered entries.
        const methodName = command.methodName ?? this.extractMethodName(command.id);
        if (!methodName) {
            return;
        }

        // Look for ${methodName}Undo() convention
        const undoMethodName = `${methodName}Undo`;
        const undoMethod = (source as unknown as Record<string, unknown>)[undoMethodName];

        if (typeof undoMethod !== "function") {
            return;
        }

        // Call the undo method to get the undo function
        // The undo method should return a function that reverses the operation
        const undoFn = (undoMethod as () => () => void | Promise<void>).call(source);

        if (typeof undoFn !== "function") {
            return;
        }

        // Add to stack
        this.stack.push({
            commandId: command.id,
            label: command.label,
            args,
            undoFn,
            timestamp: Date.now(),
        });

        // Trim to limit
        while (this.stack.length > this.limit) {
            this.stack.shift();
        }
    }

    /**
     * Extracts the method name from a command ID.
     *
     * @param commandId - The command ID (e.g., "editor.save")
     * @returns The method name (e.g., "save")
     *
     * @internal
     */
    private extractMethodName(commandId: string): string | null {
        // Command IDs are in format "namespace.method" or "@scope/namespace.method"
        const lastDotIndex = commandId.lastIndexOf(".");
        if (lastDotIndex === -1) {
            return null;
        }
        return commandId.slice(lastDotIndex + 1);
    }

    /**
     * Handles keyboard events for Ctrl+Z shortcut.
     *
     * @internal
     */
    private handleKeydown(event: KeyboardEvent): void {
        // Check for Ctrl+Z (Windows/Linux) or Cmd+Z (Mac)
        const isUndo =
            (event.ctrlKey || event.metaKey) && event.key === "z" && !event.shiftKey;

        if (
            isUndo &&
            this.canUndo &&
            UndoBehavior.instances[UndoBehavior.instances.length - 1] === this &&
            !event.defaultPrevented &&
            !isEditableTarget(event)
        ) {
            event.preventDefault();
            this.undo().catch(error => {
                console.error("[fast-af] Undo failed:", error);
            });
        }
    }
}
