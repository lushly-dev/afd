import { FASTElement, attr, css, html } from "@lushly-dev/fast-element";

import { isSafeLinkHref } from "../foundations/violet-safe-url";
import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import { registerSystemDocumentIcon } from "../icon/generated/icons/system-document";
import "../icon/violet-icon";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: inline-flex;
        --_citation-font-size: var(--violet-citation-font-size, var(--_caption-size, 12px));
        --_citation-line-height: var(--violet-citation-line-height, var(--_caption-line, 16px));
        --_citation-badge-size: var(--violet-citation-badge-size, var(--_caption-line, 16px));
        --_citation-max-width: var(--violet-citation-max-width, 200px);
        --_hc-border: var(--violet-hc-border, 1px solid ButtonText);
    }

    .root {
        display: inline-flex;
        align-items: center;
        gap: var(--_space-xs, 4px);
        font-size: var(--_citation-font-size);
        line-height: var(--_citation-line-height);
    }

    .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-inline-size: var(--_citation-badge-size);
        block-size: var(--_citation-badge-size);
        padding-inline: var(--_space-xs, 4px);
        border-radius: var(--_radius-sm);
        background: var(--_surface-subtle, rgba(28, 26, 13, 0.04));
        font-size: calc(var(--_citation-font-size) * 0.85);
        font-weight: 600;
        color: var(--_text-secondary, #414651);
    }

    .badge[hidden] {
        display: none;
    }

    .link {
        color: var(--_text-link, #2563eb);
        text-decoration: none;
        max-inline-size: var(--_citation-max-width);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .link:hover {
        text-decoration: underline;
    }

    .link:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px var(--_focus-ring);
        border-radius: var(--_radius-sm);
    }

    .title {
        color: var(--_text-primary, #1c1a0d);
        max-inline-size: var(--_citation-max-width);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .doc-icon {
        display: inline-flex;
        color: var(--_text-secondary, #414651);
        --violet-icon-size: var(--_citation-line-height);
    }

    @media (forced-colors: active) {
        .link {
            color: LinkText;
        }

        .badge {
            forced-color-adjust: none;
            border: var(--_hc-border);
            background: Canvas;
        }
    }
`;

const template = html<VioletSourceCitation>`
    <span class="root" part="root">
        <span class="badge" part="badge" ?hidden="${x => !x.index}" aria-hidden="true">${x => x.index}</span>
        ${x => {
            if (x.type === "url" && x.href) {
                // Only http(s)/mailto/relative hrefs become links; anything else
                // (e.g. javascript:) is rendered as plain text.
                if (!isSafeLinkHref(x.href)) {
                    return html<VioletSourceCitation>`
                        <span class="title" part="title">${x => x.sourceTitle || x.href}</span>
                    `;
                }
                return html<VioletSourceCitation>`
                    <a class="link" part="link" href="${x => x.href}" target="_blank" rel="noopener noreferrer">
                        ${x => x.sourceTitle || x.href}
                    </a>
                `;
            }
            return html<VioletSourceCitation>`
                <span class="doc-icon" part="icon"><violet-icon icon="system/document" decorative></violet-icon></span>
                <span class="title" part="title">${x => x.sourceTitle || "Document"}</span>
            `;
        }}
        <slot></slot>
    </span>
`;

/**
 * Violet source citation.
 *
 * @summary Inline or footnote-style source reference. Maps to AI SDK
 *          SourceUrlUIPart and SourceDocumentUIPart.
 * @slot - Custom citation content (overrides default rendering).
 * @csspart root - The citation container.
 * @csspart badge - The numbered badge.
 * @csspart link - The clickable link (url type).
 * @csspart icon - The document icon (document type).
 * @csspart title - The document title (document type).
 */
export class VioletSourceCitation extends FASTElement {
    declare public type: string;
    declare public href: string;
    declare public sourceTitle: string;
    declare public sourceId: string;
    declare public mediaType: string;
    declare public index: string;

    public constructor() {
        super();
        this.type = "url";
        this.href = "";
        this.sourceTitle = "";
        this.sourceId = "";
        this.mediaType = "";
        this.index = "";
    }

    public connectedCallback(): void {
        super.connectedCallback();
        registerSystemDocumentIcon();
    }
}

export type VioletSourceCitationType = "url" | "document";

attr(VioletSourceCitation.prototype, "type");
attr(VioletSourceCitation.prototype, "href");
attr({ attribute: "source-title" })(VioletSourceCitation.prototype, "sourceTitle");
attr({ attribute: "source-id" })(VioletSourceCitation.prototype, "sourceId");
attr({ attribute: "media-type" })(VioletSourceCitation.prototype, "mediaType");
attr(VioletSourceCitation.prototype, "index");

if (!customElements.get("violet-source-citation")) {
    await FASTElement.define(VioletSourceCitation, {
        name: "violet-source-citation",
        template,
        styles,
    });
}
