import { FASTElement, attr, css, html } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_cursor-width: var(--violet-cursor-width, 0.125em);
        --_cursor-height: var(--violet-cursor-height, 1em);
        --_cursor-gap: var(--violet-cursor-gap, 0.125em);
    }

    .text {
        display: grid;
        align-content: start;
        gap: var(--_space-stack-xs);
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0;
        line-height: inherit;
    }

    .content-slot {
        display: block;
    }

    .content-slot::slotted(*) {
        margin: 0;
    }

    .cursor {
        display: inline-block;
        inline-size: var(--_cursor-width);
        block-size: var(--_cursor-height);
        background: currentColor;
        vertical-align: text-bottom;
        margin-inline-start: var(--_cursor-gap);
        animation: blink 0.8s step-end infinite;
    }

    .cursor[hidden] {
        display: none;
    }

    @keyframes blink {
        50% { opacity: 0; }
    }

    @media (prefers-reduced-motion: reduce) {
        .cursor {
            animation: none;
        }
    }
`;

const template = html<VioletMessageText>`
    <div class="text" part="text">
        <slot class="content-slot"></slot><span class="cursor" part="cursor" ?hidden="${x => x.state !== "streaming"}" aria-hidden="true"></span>
    </div>
`;

/**
 * Violet message text part.
 *
 * @summary Renders a text part from a UIMessage with optional streaming
 *          cursor indicator. Maps to TanStack AI TextPart / AI SDK TextUIPart.
 * @slot - Text content (plain text or pre-sanitized HTML).
 * @csspart text - The text container.
 * @csspart cursor - The blinking cursor shown during streaming.
 */
export class VioletMessageText extends FASTElement {
    declare public state: string;

    public constructor() {
        super();
        this.state = "done";
    }
}

export type VioletMessageTextState = "streaming" | "done";

attr(VioletMessageText.prototype, "state");

if (!customElements.get("violet-message-text")) {
    await FASTElement.define(VioletMessageText, {
        name: "violet-message-text",
        template,
        styles,
    });
}
