import { FASTElement, attr, css, html } from "@lushly-dev/fast-element";

import { isSafeLinkHref } from "../foundations/violet-safe-url";
import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: inline-flex;
        align-items: center;
        gap: 0;
        color: var(--_text-secondary);
        font-size: var(--_caption-size);
        line-height: var(--_caption-line);
    }

    .link,
    .label,
    .current {
        display: inline-flex;
        align-items: center;
        min-inline-size: 0;
        color: inherit;
        font: inherit;
        text-decoration: none;
    }

    .link {
        border-radius: var(--_radius-sm);
        transition:
            color var(--_duration-fast) var(--_easing-standard),
            background-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-fast) var(--_easing-standard);
    }

    .link:hover {
        color: var(--_text-primary);
        background: var(--_surface-hover);
    }

    .link:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px var(--_focus-ring);
    }

    .current {
        color: var(--_text-primary);
        font-weight: 500;
    }

    .separator {
        color: var(--_text-muted);
        margin-inline: var(--_space-stack-2xs);
    }

    :host([current]) .separator {
        display: none;
    }
`;

const template = html<VioletBreadcrumbItem>`
    ${x =>
        x.current
            ? html<VioletBreadcrumbItem>`
                  <span class="current" part="current" aria-current="page">
                      <slot></slot>
                  </span>
              `
            : isSafeLinkHref(x.href)
              ? html<VioletBreadcrumbItem>`
                    <a class="link" part="link" href="${x => x.href}">
                        <slot></slot>
                    </a>
                `
            : html<VioletBreadcrumbItem>`
                  <span class="label" part="label">
                      <slot></slot>
                  </span>
              `}
    <span class="separator" part="separator" aria-hidden="true">
        <slot name="separator">/</slot>
    </span>
`;

/**
 * Violet breadcrumb item.
 *
 * @summary Link-or-current breadcrumb item for use inside `violet-breadcrumb`.
 * @slot - Item label content.
 * @slot separator - Optional custom separator glyph.
 * @csspart link - Linked breadcrumb label.
 * @csspart label - Non-linked breadcrumb label.
 * @csspart current - Current page label.
 * @csspart separator - Separator glyph wrapper.
 */
export class VioletBreadcrumbItem extends FASTElement {
    readonly #internals: ElementInternals;

    declare public href: string;
    declare public current: boolean;

    public constructor() {
        super();
        this.#internals = this.attachInternals();
        this.href = "";
        this.current = false;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.#syncAccessibility();
    }

    public currentChanged(): void {
        this.#syncAccessibility();
    }

    #syncAccessibility(): void {
        this.#internals.role = "listitem";
        this.#internals.ariaCurrent = this.current ? "page" : null;
        if (this.$fastController.isConnected) {
            this.setAttribute("role", "listitem");

            if (this.current) {
                this.setAttribute("aria-current", "page");
            } else {
                this.removeAttribute("aria-current");
            }
        }
    }
}

attr(VioletBreadcrumbItem.prototype, "href");
attr({ mode: "boolean" })(VioletBreadcrumbItem.prototype, "current");

if (!customElements.get("violet-breadcrumb-item")) {
    await FASTElement.define(VioletBreadcrumbItem, {
        name: "violet-breadcrumb-item",
        template,
        styles,
    });
}
