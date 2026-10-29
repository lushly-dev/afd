/**
 * ConfirmDialog component for command safety confirmations.
 * Modal dialog for confirming destructive actions.
 *
 * @remarks
 * Provides an accessible modal dialog with:
 * - open/prompt attributes for state management
 * - confirm/cancel events for user response
 * - Full ARIA support (role, aria-modal, aria-labelledby, aria-describedby)
 * - Focus trap to keep keyboard navigation within dialog
 * - Escape key to cancel
 *
 * @example
 * ```html
 * <fast-af-confirm-dialog
 *   open
 *   prompt="Are you sure you want to delete this item?"
 *   @confirm=${handleConfirm}
 *   @cancel=${handleCancel}
 * ></fast-af-confirm-dialog>
 * ```
 */

import { FASTElementDefinition } from "../../components/fast-definitions.js";
import { FASTElement } from "../../components/fast-element.js";
import { attr } from "../../components/attributes.js";
import { html } from "../../templating/template.js";
import { css } from "../../styles/css.js";
import { when } from "../../templating/when.js";

/**
 * Styles for the confirm dialog component.
 * Uses CSS custom properties for theming.
 */
const styles = css`
    :host {
        display: none;
    }

    :host([open]) {
        display: block;
    }

    .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: var(--confirm-dialog-z-index, 1000);
    }

    .dialog {
        background: var(--confirm-dialog-background, #fff);
        border-radius: var(--confirm-dialog-border-radius, 8px);
        box-shadow: var(--confirm-dialog-shadow, 0 4px 24px rgba(0, 0, 0, 0.2));
        max-width: var(--confirm-dialog-max-width, 400px);
        width: 90%;
        padding: var(--confirm-dialog-padding, 24px);
    }

    .title {
        font-size: var(--confirm-dialog-title-size, 1.25rem);
        font-weight: var(--confirm-dialog-title-weight, 600);
        margin: 0 0 16px;
        color: var(--confirm-dialog-title-color, inherit);
    }

    .prompt {
        margin: 0 0 24px;
        color: var(--confirm-dialog-prompt-color, inherit);
        line-height: 1.5;
    }

    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
    }

    button {
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 0.2s, border-color 0.2s;
    }

    .cancel-button {
        background: var(--confirm-dialog-cancel-bg, transparent);
        border: 1px solid var(--confirm-dialog-cancel-border, #ccc);
        color: var(--confirm-dialog-cancel-color, inherit);
    }

    .cancel-button:hover {
        background: var(--confirm-dialog-cancel-hover-bg, #f5f5f5);
    }

    .cancel-button:focus-visible {
        outline: 2px solid var(--confirm-dialog-focus-color, #0066cc);
        outline-offset: 2px;
    }

    .confirm-button {
        background: var(--confirm-dialog-confirm-bg, #dc3545);
        border: 1px solid var(--confirm-dialog-confirm-border, #dc3545);
        color: var(--confirm-dialog-confirm-color, #fff);
    }

    .confirm-button:hover {
        background: var(--confirm-dialog-confirm-hover-bg, #c82333);
        border-color: var(--confirm-dialog-confirm-hover-border, #c82333);
    }

    .confirm-button:focus-visible {
        outline: 2px solid var(--confirm-dialog-focus-color, #0066cc);
        outline-offset: 2px;
    }

    /* Slot for custom content */
    ::slotted(*) {
        margin-bottom: 16px;
    }
`;

/**
 * Template for the confirm dialog component.
 */
const template = html<ConfirmDialog>`
    ${when(
        x => x.open,
        html<ConfirmDialog>`
            <div
                class="overlay"
                @click="${(x, c) => x.handleOverlayClick(c.event as MouseEvent)}"
            >
                <div
                    class="dialog"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="dialog-title"
                    aria-describedby="dialog-prompt"
                    @click="${(x, c) => c.event.stopPropagation()}"
                    @keydown="${(x, c) => x.handleKeydown(c.event as KeyboardEvent)}"
                >
                    <h2 id="dialog-title" class="title">
                        <slot name="title">Confirm Action</slot>
                    </h2>
                    <p id="dialog-prompt" class="prompt">${x => x.prompt}</p>
                    <slot></slot>
                    <div class="actions">
                        <button
                            type="button"
                            class="cancel-button"
                            @click="${x => x.handleCancel()}"
                        >
                            <slot name="cancel-text">Cancel</slot>
                        </button>
                        <button
                            type="button"
                            class="confirm-button"
                            @click="${x => x.handleConfirm()}"
                        >
                            <slot name="confirm-text">Confirm</slot>
                        </button>
                    </div>
                </div>
            </div>
        `,
    )}
`;

/**
 * A modal dialog component for confirming destructive actions.
 *
 * Events: `confirm` is dispatched when the user confirms; `cancel` is dispatched
 * when the user cancels, presses Escape, or clicks the overlay.
 *
 * Slots: the default slot supplies additional content; `title`, `cancel-text`, and
 * `confirm-text` replace their corresponding labels.
 *
 * CSS parts: `overlay`, `dialog`, `title`, `prompt`, `actions`, `cancel-button`, and
 * `confirm-button`.
 *
 * @internal
 */
export class ConfirmDialog extends FASTElement {
    /**
     * Whether the dialog is open/visible.
     * @public
     */
    @attr({ mode: "boolean" })
    open = false;

    /**
     * The prompt message to display in the dialog.
     * @public
     */
    @attr
    prompt = "";

    /**
     * Reference to the previously focused element for restoring focus on close.
     * @internal
     */
    private previouslyFocused: HTMLElement | null = null;

    /**
     * List of focusable elements within the dialog for focus trapping.
     * @internal
     */
    private focusableElements: HTMLElement[] = [];

    /**
     * Called when the open attribute changes.
     * Manages focus trap and body scroll lock.
     * @param oldValue - Previous value
     * @param newValue - New value
     */
    openChanged(oldValue: boolean, newValue: boolean): void {
        if (newValue) {
            this.previouslyFocused = document.activeElement as HTMLElement;
            // Defer focus to allow template to render
            requestAnimationFrame(() => {
                this.trapFocus();
            });
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
            this.previouslyFocused?.focus();
        }
    }

    /**
     * Sets up focus trap within the dialog.
     * @internal
     */
    private trapFocus(): void {
        const dialog = this.shadowRoot?.querySelector(".dialog");
        if (!dialog) return;

        // Get all focusable elements
        this.focusableElements = Array.from(
            dialog.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
        );

        // Focus the first button (cancel by default for safety)
        const cancelButton = dialog.querySelector<HTMLElement>(".cancel-button");
        cancelButton?.focus();
    }

    /**
     * Handles keydown events for focus trap and escape key.
     * @param event - The keyboard event
     * @internal
     */
    handleKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            this.handleCancel();
            return;
        }

        if (event.key === "Tab") {
            this.handleTabKey(event);
        }
    }

    /**
     * Handles tab key for focus trapping.
     * @param event - The keyboard event
     * @internal
     */
    private handleTabKey(event: KeyboardEvent): void {
        const focusable = this.focusableElements;
        if (focusable.length === 0) return;

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];
        const activeElement = this.shadowRoot?.activeElement;

        if (event.shiftKey) {
            // Shift+Tab: wrap to last element if on first
            if (activeElement === firstElement) {
                event.preventDefault();
                lastElement.focus();
            }
        } else {
            // Tab: wrap to first element if on last
            if (activeElement === lastElement) {
                event.preventDefault();
                firstElement.focus();
            }
        }
    }

    /**
     * Handles overlay click to cancel.
     * @param event - The mouse event
     * @internal
     */
    handleOverlayClick(event: MouseEvent): void {
        // Only close if clicking the overlay itself, not the dialog
        if ((event.target as HTMLElement).classList.contains("overlay")) {
            this.handleCancel();
        }
    }

    /**
     * Handles confirm button click.
     * Emits 'confirm' event and closes the dialog.
     * @public
     */
    handleConfirm(): void {
        this.$emit("confirm");
        this.open = false;
    }

    /**
     * Handles cancel button click.
     * Emits 'cancel' event and closes the dialog.
     * @public
     */
    handleCancel(): void {
        this.$emit("cancel");
        this.open = false;
    }
}

/**
 * The namespaced tag used by the opt-in confirmation dialog.
 * @public
 */
export const confirmDialogTagName = "fast-af-confirm-dialog" as const;

let definitionPromise: Promise<FASTElementDefinition> | undefined;

/**
 * Defines the confirmation dialog in the provided registry.
 *
 * @remarks
 * Registration is explicit so importing the command API remains side-effect free.
 * Repeated calls for the same registry are safe.
 *
 * @param registry - Registry in which to define the dialog.
 * @public
 */
export async function defineConfirmDialog(
    registry: CustomElementRegistry = customElements,
): Promise<void> {
    if (registry.get(confirmDialogTagName) !== undefined) {
        return;
    }

    definitionPromise ??= FASTElementDefinition.compose(ConfirmDialog, {
        name: confirmDialogTagName,
        template,
        styles,
    });

    const definition = await definitionPromise;
    definition.define(registry);
    await registry.whenDefined(confirmDialogTagName);
}
