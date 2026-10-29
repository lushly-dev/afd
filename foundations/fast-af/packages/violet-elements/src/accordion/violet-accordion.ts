import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import "../accordion-item/violet-accordion-item";
import type { VioletAccordionItem } from "../accordion-item/violet-accordion-item";
import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
    }

    .root {
        display: block;
    }
`;

const template = html<VioletAccordion>`
    <div class="root" part="root" @keydown="${(x, c) => x.handleKeydown(c.event as KeyboardEvent)}">
        <slot @slotchange="${x => x.handleSlotChange()}"></slot>
    </div>
`;

/**
 * Violet accordion container.
 *
 * @summary Grouped disclosure control that coordinates one or more `violet-accordion-item` children.
 * @fires change - Emitted when an item's expanded state changes.
 * @slot - `violet-accordion-item` elements.
 * @csspart root - Root wrapper around the slotted items.
 */
export class VioletAccordion extends FASTElement {
    @observable
    declare public slottedItems: HTMLElement[];

    declare public expandMode: string;

    public constructor() {
        super();
        this.slottedItems = [];
        this.expandMode = "multi";
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.addEventListener("toggle-request", this.handleToggleRequest as EventListener);
        this.syncItems();
    }

    public disconnectedCallback(): void {
        super.disconnectedCallback();
        this.removeEventListener("toggle-request", this.handleToggleRequest as EventListener);
    }

    public handleSlotChange(): void {
        const slot = this.shadowRoot?.querySelector("slot") as HTMLSlotElement | null;
        this.slottedItems = (slot?.assignedElements({ flatten: true }) as HTMLElement[]) ?? [];
        this.syncItems();
    }

    public handleToggleRequest(event: CustomEvent<{ expanded: boolean }>): void {
        const item = event.target as VioletAccordionItem | null;
        if (!(item instanceof HTMLElement) || !this.items.includes(item as VioletAccordionItem)) {
            return;
        }

        const nextExpanded = event.detail?.expanded ?? !item.hasAttribute("expanded");

        if (this.expandMode === "single" && nextExpanded) {
            for (const sibling of this.items) {
                if (sibling !== item) {
                    sibling.expanded = false;
                }
            }
        }

        (item as VioletAccordionItem).expanded = nextExpanded;
        this.$emit("change", {
            item,
            expanded: nextExpanded,
        });
    }

    public handleKeydown(event: KeyboardEvent): boolean {
        const currentItem = event.composedPath().find(
            value => value instanceof HTMLElement && value.tagName.toLowerCase() === "violet-accordion-item",
        ) as VioletAccordionItem | undefined;

        if (!currentItem) {
            return true;
        }

        const enabledItems = this.items.filter(item => !item.disabled);
        const currentIndex = enabledItems.indexOf(currentItem);
        if (currentIndex < 0) {
            return true;
        }

        switch (event.key) {
            case "ArrowDown":
            case "ArrowRight": {
                event.preventDefault();
                enabledItems[(currentIndex + 1) % enabledItems.length]?.focusTrigger();
                return false;
            }
            case "ArrowUp":
            case "ArrowLeft": {
                event.preventDefault();
                enabledItems[(currentIndex - 1 + enabledItems.length) % enabledItems.length]?.focusTrigger();
                return false;
            }
            case "Home": {
                event.preventDefault();
                enabledItems[0]?.focusTrigger();
                return false;
            }
            case "End": {
                event.preventDefault();
                enabledItems.at(-1)?.focusTrigger();
                return false;
            }
        }

        return true;
    }

    private get items(): VioletAccordionItem[] {
        return Array.from(this.querySelectorAll("violet-accordion-item")).filter(
            item => item.closest("violet-accordion") === this,
        ) as VioletAccordionItem[];
    }

    private syncItems(): void {
        const items = this.items;
        if (this.expandMode === "single") {
            const expandedItems = items.filter(item => item.expanded);
            expandedItems.slice(1).forEach(item => {
                item.expanded = false;
            });
        }
    }
}

attr({ attribute: "expand-mode" })(VioletAccordion.prototype, "expandMode");

if (!customElements.get("violet-accordion")) {
    await FASTElement.define(VioletAccordion, {
        name: "violet-accordion",
        template,
        styles,
    });
}
