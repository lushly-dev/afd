import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import "../breadcrumb-item/violet-breadcrumb-item";
import type { VioletBreadcrumbItem } from "../breadcrumb-item/violet-breadcrumb-item";
import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
    }

    .nav {
        display: block;
    }

    .list {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0;
        margin: 0;
        padding: 0;
        list-style: none;
    }
`;

const template = html<VioletBreadcrumb>`
    <nav class="nav" part="nav" aria-label="${x => x.label || "Breadcrumb"}">
        <div class="list" part="list" role="list">
            <slot @slotchange="${x => x.handleSlotChange()}"></slot>
        </div>
    </nav>
`;

/**
 * Violet breadcrumb container.
 *
 * @summary Labeled breadcrumb navigation surface that renders slotted `violet-breadcrumb-item` elements.
 * @slot - `violet-breadcrumb-item` elements.
 * @csspart nav - Breadcrumb navigation wrapper.
 * @csspart list - Ordered list wrapper.
 */
export class VioletBreadcrumb extends FASTElement {
    @observable
    declare public items: VioletBreadcrumbItem[];

    declare public label: string;

    public constructor() {
        super();
        this.items = [];
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.#syncAccessibility();
        this.handleSlotChange();
    }

    public handleSlotChange(): void {
        this.items = this.#ownedItems();
        this.#normalizeCurrentItem();
    }

    public labelChanged(): void {
        this.#syncAccessibility();
    }

    #ownedItems(): VioletBreadcrumbItem[] {
        return Array.from(this.querySelectorAll("violet-breadcrumb-item")).filter(
            item => item.closest("violet-breadcrumb") === this,
        ) as VioletBreadcrumbItem[];
    }

    #normalizeCurrentItem(): void {
        const explicitCurrentItems = this.items.filter(item => item.current);
        const currentItem =
            explicitCurrentItems[explicitCurrentItems.length - 1] ?? this.items[this.items.length - 1] ?? null;

        this.items.forEach(item => {
            item.current = item === currentItem;
        });
    }

    #syncAccessibility(): void {
        this.ariaLabel = this.label || "Breadcrumb";
    }
}

attr(VioletBreadcrumb.prototype, "label");

if (!customElements.get("violet-breadcrumb")) {
    await FASTElement.define(VioletBreadcrumb, {
        name: "violet-breadcrumb",
        template,
        styles,
    });
}
