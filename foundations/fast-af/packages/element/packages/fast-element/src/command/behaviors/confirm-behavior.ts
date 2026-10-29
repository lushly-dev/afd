/**
 * ConfirmBehavior - Intercepts destructive commands and prompts for confirmation.
 *
 * @remarks
 * Uses the CommandRegistry interceptor API to intercept commands marked with
 * `destructive: true`. Exposes pending confirmation state for UI rendering.
 *
 * @example
 * ```typescript
 * import { ConfirmBehavior } from '@lushly-dev/fast-element/command.js';
 *
 * class MyApp extends FASTElement {
 *   private confirmBehavior = new ConfirmBehavior();
 *
 *   connectedCallback() {
 *     super.connectedCallback();
 *     this.$fastController.addBehavior(this.confirmBehavior);
 *   }
 *
 *   // In template (pendingConfirmation is observable, so the template updates):
 *   // <fast-af-confirm-dialog
 *   //   :open="${x => x.confirmBehavior.pendingConfirmation !== null}"
 *   //   :prompt="${x => x.confirmBehavior.pendingConfirmation?.prompt}"
 *   //   @confirm="${x => x.confirmBehavior.executeConfirmed()}"
 *   //   @cancel="${x => x.confirmBehavior.cancelPending()}">
 *   // </fast-af-confirm-dialog>
 * }
 * ```
 *
 * @public
 */

import { Observable } from "../../observation/observable.js";
import type { CommandHostController } from "../behavior.js";
import { CommandRegistry } from "../registry.js";
import type { CommandResult } from "../types.js";
import { failure } from "../types.js";

/**
 * Error code for user-cancelled operations.
 * @public
 */
export const USER_CANCELLED = "USER_CANCELLED";

/**
 * Pending confirmation state.
 * @public
 */
export interface PendingConfirmation {
    /** The command ID being confirmed */
    commandId: string;
    /** The command label for display */
    label: string;
    /** The confirmation prompt to show */
    prompt: string;
    /** Internal resolver - do not use directly */
    resolve: (confirmed: boolean) => void;
}

/**
 * Behavior that intercepts destructive commands and prompts for user confirmation.
 *
 * @remarks
 * - Installs a shared `confirm` interceptor with the CommandRegistry while at
 *   least one instance is connected (reference counted: the interceptor is added
 *   by the first instance and removed when the last one disconnects)
 * - Intercepts commands where `destructive: true`
 * - When several instances are connected, the most recently connected one handles
 *   confirmations; if it disconnects, the previous one takes over
 * - Concurrent confirmations are queued: `pendingConfirmation` is the oldest
 *   unsettled one, and each `executeConfirmed()`/`cancelPending()` settles it and
 *   exposes the next
 * - `pendingConfirmation` is observable, so templates binding to it update
 * - Cancels any pending confirmation on disconnect
 *
 * @public
 */
export class ConfirmBehavior {
    /** Pending confirmations, oldest first */
    private queue: PendingConfirmation[] = [];

    /** Whether this instance is currently connected */
    private connected = false;

    /** Name of the interceptor for registration/removal */
    private static readonly INTERCEPTOR_NAME = "confirm";

    /** Connected instances, oldest first. The last one is the active handler. */
    private static readonly instances: ConfirmBehavior[] = [];

    /**
     * Called when the host element connects to the DOM.
     * Registers this instance and, for the first one, the shared interceptor.
     *
     * @param controller - The host controller managing this behavior
     */
    connectedCallback(controller: CommandHostController): void {
        if (this.connected) {
            return;
        }

        this.connected = true;
        const instances = ConfirmBehavior.instances;
        instances.push(this);

        if (instances.length === 1) {
            CommandRegistry.addInterceptor({
                name: ConfirmBehavior.INTERCEPTOR_NAME,
                confirms: true,
                priority: 10, // Run early to block before other interceptors
                intercept: async (command, args, next): Promise<CommandResult> => {
                    // Only intercept destructive commands
                    if (!command.destructive) {
                        return next();
                    }

                    const active = ConfirmBehavior.instances;
                    const handler = active[active.length - 1];

                    // Show confirmation and wait for user response; with nobody left
                    // to ask, fail closed.
                    const confirmed =
                        handler !== void 0 &&
                        (await handler.showConfirmation(
                            command.id,
                            command.label,
                            command.confirmPrompt ?? "Are you sure you want to proceed?",
                        ));

                    if (!confirmed) {
                        return failure({
                            code: USER_CANCELLED,
                            message: "User cancelled the operation",
                            retryable: false,
                        });
                    }

                    return next();
                },
            });
        }
    }

    /**
     * Called when the host element disconnects from the DOM.
     * Cancels pending confirmations, and removes the shared interceptor when this
     * was the last connected instance.
     *
     * @param controller - The host controller managing this behavior
     */
    disconnectedCallback(controller: CommandHostController): void {
        if (!this.connected) {
            return;
        }

        this.connected = false;

        // Cancel any pending confirmation
        this.settleAll(false);

        const instances = ConfirmBehavior.instances;
        const index = instances.indexOf(this);

        if (index !== -1) {
            instances.splice(index, 1);
        }

        // Remove interceptor to prevent memory leaks once nobody can confirm
        if (instances.length === 0) {
            CommandRegistry.removeInterceptor(ConfirmBehavior.INTERCEPTOR_NAME);
        }
    }

    /**
     * Gets the oldest pending confirmation, if any.
     *
     * @remarks
     * Observable: use this in templates to show a confirmation dialog and to get the
     * prompt text. When several confirmations are queued, the next one becomes
     * current after the present one is settled.
     *
     * @returns The pending confirmation or null
     */
    get pendingConfirmation(): PendingConfirmation | null {
        Observable.track(this, "pendingConfirmation");
        return this.queue[0] ?? null;
    }

    /**
     * Gets the number of unsettled confirmations, including the current one.
     * Observable.
     */
    get pendingCount(): number {
        Observable.track(this, "pendingConfirmation");
        return this.queue.length;
    }

    /**
     * Confirms the current pending operation and allows it to proceed.
     *
     * @remarks
     * Call this when the user clicks "Confirm" in your confirmation UI.
     * The intercepted command will then execute normally.
     */
    executeConfirmed(): void {
        this.settleCurrent(true);
    }

    /**
     * Cancels the current pending operation.
     *
     * @remarks
     * Call this when the user clicks "Cancel" in your confirmation UI.
     * The intercepted command will return a USER_CANCELLED error.
     */
    cancelPending(): void {
        this.settleCurrent(false);
    }

    private settleCurrent(confirmed: boolean): void {
        const current = this.queue.shift();

        if (current !== void 0) {
            Observable.notify(this, "pendingConfirmation");
            current.resolve(confirmed);
        }
    }

    private settleAll(confirmed: boolean): void {
        const settled = this.queue;

        if (settled.length > 0) {
            this.queue = [];
            Observable.notify(this, "pendingConfirmation");

            for (const pending of settled) {
                pending.resolve(confirmed);
            }
        }
    }

    /**
     * Queues a confirmation prompt and waits for user response.
     *
     * @param commandId - The command ID being confirmed
     * @param label - The command label for display
     * @param prompt - The confirmation prompt text
     * @returns Promise that resolves to true if confirmed, false if cancelled
     *
     * @internal
     */
    private showConfirmation(
        commandId: string,
        label: string,
        prompt: string,
    ): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            this.queue.push({
                commandId,
                label,
                prompt,
                resolve,
            });

            Observable.notify(this, "pendingConfirmation");
        });
    }
}
