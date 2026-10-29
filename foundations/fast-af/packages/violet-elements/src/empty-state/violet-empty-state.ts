import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import "../text/violet-text";
import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

export type VioletEmptyStateAppearance = "plain" | "subtle" | "outline";
export type VioletEmptyStateOrientation = "vertical" | "horizontal";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_empty-padding: var(--_space-lg);
        --_empty-gap: var(--_space-md);
        --_empty-background: transparent;
        --_empty-border: transparent;
        --_empty-shadow: none;
        --_empty-align: center;
    }

    :host([appearance="subtle"]) {
        --_empty-background: color-mix(in srgb, var(--_surface-subtle) 60%, var(--_surface-card));
        --_empty-border: transparent;
    }

    :host([appearance="outline"]) {
        --_empty-background: transparent;
        --_empty-border: var(--_border-subtle);
    }

    :host([orientation="horizontal"]) {
        --_empty-align: start;
    }

    .root {
        box-sizing: border-box;
        display: grid;
        gap: var(--_empty-gap);
        justify-items: var(--_empty-align);
        padding: var(--_empty-padding);
        border: 1px solid var(--_empty-border);
        border-radius: var(--_radius-lg);
        background: var(--_empty-background);
        box-shadow: var(--_empty-shadow);
        text-align: var(--_empty-align);
    }

    :host([orientation="horizontal"]) .root {
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        text-align: start;
    }

    .media {
        display: grid;
        justify-items: inherit;
        min-inline-size: 0;
    }

    .media[hidden] {
        display: none;
    }

    .body {
        display: grid;
        gap: var(--_space-stack-sm);
        min-inline-size: 0;
    }

    .heading,
    .message {
        justify-self: inherit;
    }

    .heading[hidden],
    .message[hidden],
    .actions[hidden] {
        display: none;
    }

    .body-slot::slotted(*) {
        margin: 0;
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--_space-sm);
        justify-content: inherit;
    }

    @media (forced-colors: active) {
        .root {
            forced-color-adjust: none;
            background: Canvas;
            border-color: ButtonText;
            box-shadow: none;
        }
    }
`;

const template = html<VioletEmptyState>`
    <div class="root" part="root">
        <div class="media" part="media" ?hidden="${x => !x.hasMedia}">
            <slot name="media" @slotchange="${x => x.handleMediaSlotChange()}"></slot>
        </div>
        <div class="body" part="body">
            <violet-text class="heading" part="heading" as="h3" variant="title-sm" ?hidden="${x => !x.heading}">
                ${x => x.heading}
            </violet-text>
            <violet-text class="message" part="message" as="p" variant="body" tone="secondary" ?hidden="${x => !x.message}">
                ${x => x.message}
            </violet-text>
            <slot class="body-slot" @slotchange="${x => x.handleDefaultSlotChange()}"></slot>
            <div class="actions" part="actions" ?hidden="${x => !x.hasActions}">
                <slot name="actions" @slotchange="${x => x.handleActionsSlotChange()}"></slot>
            </div>
        </div>
    </div>
`;

/**
 * Composable empty-state surface for no-results, no-content, and first-run views.
 *
 * @summary Lightweight message surface with optional media and actions, built to compose with Violet text, image, and button primitives.
 * @slot - Optional extra descriptive content under the main message.
 * @slot media - Optional media or illustration shown before the copy.
 * @slot actions - Optional actions shown below the copy.
 * @csspart root - Outer empty-state surface.
 * @csspart media - Media wrapper.
 * @csspart body - Main copy wrapper.
 * @csspart heading - Rendered heading text.
 * @csspart message - Rendered message text.
 * @csspart actions - Actions row wrapper.
 */
export class VioletEmptyState extends FASTElement {
    @observable
    declare public hasMedia: boolean;

    @observable
    declare public hasActions: boolean;

    declare public heading: string;
    declare public message: string;
    declare public appearance: VioletEmptyStateAppearance;
    declare public orientation: VioletEmptyStateOrientation;

    public constructor() {
        super();
        this.hasMedia = false;
        this.hasActions = false;
        this.heading = "";
        this.message = "";
        this.appearance = "plain";
        this.orientation = "vertical";
    }

    public handleMediaSlotChange(): void {
        this.hasMedia = this.#slotHasContent('slot[name="media"]');
    }

    public handleActionsSlotChange(): void {
        this.hasActions = this.#slotHasContent('slot[name="actions"]');
    }

    public handleDefaultSlotChange(): void {
        // Keep FAST slot assignment reactive for story/docs updates even though the default slot does not toggle a wrapper.
    }

    #slotHasContent(selector: string): boolean {
        const slot = this.shadowRoot?.querySelector(selector) as HTMLSlotElement | null;
        return (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });
    }
}

attr(VioletEmptyState.prototype, "heading");
attr(VioletEmptyState.prototype, "message");
attr(VioletEmptyState.prototype, "appearance");
attr(VioletEmptyState.prototype, "orientation");

if (!customElements.get("violet-empty-state")) {
    await FASTElement.define(VioletEmptyState, {
        name: "violet-empty-state",
        template,
        styles,
    });
}
