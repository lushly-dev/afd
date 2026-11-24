import { FASTElement, attr, css, html, observable, type PartialFASTElementDefinition } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_msg-border-width: var(--_card-border-width, 1px);
        --_msg-body-size: var(--violet-message-body-size, var(--_body-size));
        --_msg-body-line: var(--violet-message-body-line, var(--_body-line));
        --_msg-system-size: var(--violet-message-system-size, var(--_caption-size));
        --_msg-meta-size: var(--violet-message-meta-size, var(--_meta-size));
    }

    .root {
        display: flex;
        gap: var(--_space-sm);
        align-items: flex-start;
    }

    :host([message-role="user"]) .root {
        flex-direction: row-reverse;
    }

    .avatar {
        flex-shrink: 0;
    }

    .avatar[hidden] {
        display: none;
    }

    .surface {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: var(--_space-sm);
        max-inline-size: 85%;
        min-inline-size: 0;
        padding: var(--_space-sm) var(--_space-md);
        border-radius: var(--_radius-lg);
        font-size: var(--_msg-body-size);
        line-height: var(--_msg-body-line);
    }

    /* The agent's turn is the page itself: no box around its parts. */
    :host([message-role="assistant"]) .surface {
        flex: 1 1 auto;
        max-inline-size: 100%;
        padding: 0;
        border: var(--_msg-border-width) solid transparent;
    }

    :host([message-role="user"]) .surface {
        background: var(--_surface-subtle);
        border: var(--_msg-border-width) solid transparent;
    }

    :host([message-role="system"]) .surface {
        background: transparent;
        border: var(--_msg-border-width) solid transparent;
        max-inline-size: 100%;
        text-align: center;
        font-size: var(--_msg-system-size);
        color: var(--_text-muted);
    }

    /* A toned message is a filled box, whoever sent it. */
    :host([tone="error"]) .surface {
        padding: var(--_space-sm) var(--_space-md);
        border-color: var(--_danger-border);
        background: var(--violet-color-state-danger-background, #f7e4df);
    }

    :host([tone="success"]) .surface {
        padding: var(--_space-sm) var(--_space-md);
        border-color: var(--_success-border);
        background: var(--violet-color-state-success-background, #dfeae3);
    }

    :host([tone="muted"]) .surface {
        opacity: 0.7;
    }

    .meta {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        font-size: var(--_msg-meta-size);
        color: var(--_text-secondary);
    }

    .meta[hidden] {
        display: none;
    }

    .body {
        display: flex;
        flex-direction: column;
        gap: var(--_space-md);
        min-inline-size: 0;
    }

    @media (forced-colors: active) {
        .surface {
            forced-color-adjust: none;
            border: var(--_msg-border-width) solid ButtonText;
            background: Canvas;
        }
    }
`;

const template = html<VioletMessage>`
    <article
        class="root"
        part="root"
        aria-label="${x => `${x.messageRole} message`}"
        aria-busy="${x => (x.streaming ? "true" : null)}"
    >
        <div class="avatar" part="avatar" ?hidden="${x => !x.hasAvatar}">
            <slot name="avatar" @slotchange="${x => x.handleAvatarSlotChange()}"></slot>
        </div>
        <div class="surface" part="surface">
            <div class="meta" part="meta" ?hidden="${x => !x.hasMeta}">
                <slot name="meta" @slotchange="${x => x.handleMetaSlotChange()}"></slot>
            </div>
            <div class="body" part="body">
                <slot></slot>
            </div>
        </div>
    </article>
`;

/**
 * Violet message surface.
 *
 * @summary Message chrome with role-based styling (user/assistant/system),
 *          tone variants, avatar and meta slots. Does not render content
 *          directly — message parts are slotted into the body.
 * @slot avatar - Optional avatar/icon for the message author.
 * @slot meta - Optional metadata row (timestamp, model name, etc.).
 * @slot - Message parts (text, tool cards, media, etc.).
 * @csspart root - The outer article element.
 * @csspart avatar - The avatar wrapper.
 * @csspart surface - The message card surface.
 * @csspart meta - The metadata row.
 * @csspart body - The body content area.
 */
export class VioletMessage extends FASTElement {
    @observable
    declare public hasAvatar: boolean;

    @observable
    declare public hasMeta: boolean;

    declare public messageRole: string;
    declare public tone: string;
    declare public streaming: boolean;

    public constructor() {
        super();
        this.hasAvatar = false;
        this.hasMeta = false;
        this.messageRole = "assistant";
        this.tone = "default";
        this.streaming = false;
    }

    public handleAvatarSlotChange(): void {
        const slot = this.shadowRoot?.querySelector('slot[name="avatar"]') as HTMLSlotElement | null;
        this.hasAvatar = (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });
    }

    public handleMetaSlotChange(): void {
        const slot = this.shadowRoot?.querySelector('slot[name="meta"]') as HTMLSlotElement | null;
        this.hasMeta = (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });
    }
}

export type VioletMessageRole = "user" | "assistant" | "system";
export type VioletMessageTone = "default" | "muted" | "error" | "success";

attr({ attribute: "message-role" })(VioletMessage.prototype, "messageRole");
attr(VioletMessage.prototype, "tone");
attr({ mode: "boolean" })(VioletMessage.prototype, "streaming");

/** The FAST definition of `<violet-message>`; `defineVioletMessage` in `./violet-message.define` registers it. */
export const violetMessageDefinition = {
    name: "violet-message",
    template,
    styles,
} satisfies PartialFASTElementDefinition;
