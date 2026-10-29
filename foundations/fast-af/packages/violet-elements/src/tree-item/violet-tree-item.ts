import { FASTElement, attr, css, html, observable, ref } from "@lushly-dev/fast-element";

import { registerSystemChevronRightIcon } from "../icon/generated";
import "../icon/violet-icon";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";

let violetTreeItemId = 0;

registerSystemChevronRightIcon();

function isTreeItemElement(value: unknown): value is VioletTreeItem {
    return value instanceof HTMLElement && value.tagName.toLowerCase() === "violet-tree-item";
}

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        display: block;
        outline: none;

        --_tree-level: 1;
        --_tree-indent-step: var(--violet-tree-indent-step, 1rem);
        --_tree-row-radius: var(--violet-tree-row-radius, var(--_radius-md));
        --_tree-row-gap: var(--violet-tree-row-gap, var(--_space-inline-md));
        --_tree-row-padding-inline: var(--violet-tree-row-padding-inline, var(--_space-inline-md));
        --_tree-row-padding-block: var(--violet-tree-row-padding-block, var(--_space-stack-2xs));
        --_tree-row-background-selected:
            var(--violet-tree-row-background-selected, color-mix(in srgb, var(--_surface-subtle) 76%, white));
        --_tree-row-background-hover: var(--violet-tree-row-background-hover, var(--_surface-subtle));
        --_tree-row-border-selected: var(--violet-tree-row-border-selected, var(--_border-subtle));
        --_tree-toggle-size: var(--violet-tree-toggle-size, 0.875rem);
    }

    .row {
        box-sizing: border-box;
        display: grid;
        grid-template-columns: auto auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--_tree-row-gap);
        min-block-size: var(--_target-size);
        padding-block: var(--_tree-row-padding-block);
        padding-inline-end: var(--_tree-row-padding-inline);
        padding-inline-start: calc(
            var(--_tree-row-padding-inline) + (var(--_tree-level, 1) - 1) * var(--_tree-indent-step)
        );
        border-radius: var(--_tree-row-radius);
        color: var(--color-text-primary, #18181b);
        cursor: pointer;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-fast) var(--_easing-standard),
            color var(--_duration-fast) var(--_easing-standard);
    }

    .row:hover {
        background: var(--_tree-row-background-hover);
    }

    :host([selected]) .row {
        background: var(--_tree-row-background-selected);
        box-shadow: inset 0 0 0 1px var(--_tree-row-border-selected);
    }

    :host(:focus-visible) .row {
        box-shadow: inset 0 0 0 2px var(--_focus-ring);
    }

    :host([selected]:focus-visible) .row {
        box-shadow:
            inset 0 0 0 1px var(--_tree-row-border-selected),
            inset 0 0 0 3px var(--_focus-ring);
    }

    :host([disabled]) .row {
        color: var(--_text-muted);
        cursor: not-allowed;
        opacity: 0.75;
    }

    .toggle {
        inline-size: var(--_tree-toggle-size);
        block-size: var(--_tree-toggle-size);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--_radius-md);
        color: var(--_text-secondary);
        user-select: none;
    }

    :host(:not([aria-expanded])) .toggle {
        opacity: 0;
    }

    .toggle-icon {
        --violet-icon-size: 0.75rem;
        transition: transform var(--_duration-fast) var(--_easing-standard);
    }

    :host([expanded]) .toggle-icon {
        transform: rotate(90deg);
    }

    .label {
        min-inline-size: 0;
        color: inherit;
    }

    .meta {
        color: var(--_text-muted);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .group {
        display: grid;
        gap: 0;
    }

    .group[hidden] {
        display: none;
    }

    ::slotted(violet-tree-item) {
        margin-block-start: 0;
    }

    @media (forced-colors: active) {
        .row {
            forced-color-adjust: none;
            color: ButtonText;
        }

        .row:hover,
        :host([selected]) .row {
            background: Canvas;
        }

        :host([selected]) .row {
            box-shadow: inset 0 0 0 1px Highlight;
        }

        :host(:focus-visible) .row {
            box-shadow: inset 0 0 0 2px Highlight;
        }
    }
`;

const template = html<VioletTreeItem>`
    <div class="row" part="row" @click="${(x, c) => x.handleRowClick(c.event as MouseEvent)}">
        <span
            class="toggle"
            part="toggle"
            aria-hidden="true"
            data-tree-toggle="true"
        >
            <violet-icon
                class="toggle-icon"
                part="toggle-icon"
                icon="system/chevron-right"
                decorative
                data-tree-toggle="true"
            ></violet-icon>
        </span>
        <slot name="start"></slot>
        <span class="label" part="label">
            <slot ${ref("labelSlot")}></slot>
        </span>
        <span class="meta" part="meta">
            <slot name="meta"></slot>
        </span>
    </div>
    <div class="group" part="group" role="group" ?hidden="${x => !x.expanded || x.childItems.length === 0}">
        <slot name="item" ${ref("itemSlot")} @slotchange="${x => x.handleItemSlotChange()}"></slot>
    </div>
`;

/**
 * Violet tree item primitive.
 *
 * @summary Focusable tree item with optional nested child items, selection, and expansion state. Set `expandable` on an item whose children are not rendered yet (lazy branches) so it still advertises `aria-expanded` and can be expanded.
 * @fires select-request - Emitted when the item requests selection.
 * @fires toggle-request - Emitted when the item requests an expansion change.
 * @slot - Primary item label.
 * @slot start - Optional leading visual such as an icon.
 * @slot meta - Optional trailing metadata.
 * @slot item - Nested `violet-tree-item` descendants; usually assigned automatically.
 * @csspart row - Interactive row surface.
 * @csspart toggle - Expansion indicator region.
 * @csspart toggle-icon - Icon inside the expansion indicator region.
 * @csspart label - Main label wrapper.
 * @csspart meta - Trailing metadata wrapper.
 * @csspart group - Child item group container.
 */
export class VioletTreeItem extends FASTElement {
    @observable
    declare public childItems: VioletTreeItem[];

    declare public expanded: boolean;
    declare public expandable: boolean;
    declare public selected: boolean;
    declare public disabled: boolean;
    declare public value: string;

    public labelSlot!: HTMLSlotElement;
    public itemSlot!: HTMLSlotElement;

    readonly #itemId: string;
    readonly #structureObserver: MutationObserver;
    #level = 1;
    #posInSet = 1;
    #setSize = 1;

    public constructor() {
        super();
        this.#itemId = `violet-tree-item-${violetTreeItemId}`;
        violetTreeItemId += 1;
        this.childItems = [];
        this.expanded = false;
        this.expandable = false;
        this.selected = false;
        this.disabled = false;
        this.value = "";
        this.#structureObserver = new MutationObserver(() => {
            this.syncStructureFromDom();
        });
    }

    public connectedCallback(): void {
        super.connectedCallback();
        // Host attributes must not be touched during construction (custom elements spec),
        // so the initial roving-tabindex state is applied on first connect.
        if (!this.hasAttribute("tabindex")) {
            this.tabIndex = -1;
        }
        this.refreshNestingSlot();
        this.id ||= this.#itemId;
        this.#structureObserver.observe(this, { childList: true });
        queueMicrotask(() => {
            this.syncStructureFromDom();
        });
        this.#syncAccessibilityState();
    }

    public disconnectedCallback(): void {
        this.#structureObserver.disconnect();
        super.disconnectedCallback();
    }

    public expandedChanged(): void {
        this.#syncAccessibilityState();
    }

    public expandableChanged(): void {
        this.#syncAccessibilityState();
    }

    public selectedChanged(): void {
        this.#syncAccessibilityState();
    }

    public disabledChanged(): void {
        this.#syncAccessibilityState();
    }

    public childItemsChanged(): void {
        this.#syncAccessibilityState();
    }

    public get hasChildren(): boolean {
        return this.expandable || this.childItems.length > 0;
    }

    public get parentItem(): VioletTreeItem | null {
        return isTreeItemElement(this.parentElement) ? this.parentElement : null;
    }

    public get resolvedValue(): string {
        return this.value || this.textLabel;
    }

    public get textLabel(): string {
        const nodes = this.labelSlot?.assignedNodes({ flatten: true }) ?? [];
        const labelText = nodes
            .map(node => node.textContent ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

        return labelText || this.getAttribute("aria-label") || "";
    }

    public focusItem(): void {
        this.focus();
    }

    public setActiveFromTree(active: boolean): void {
        this.tabIndex = active ? 0 : -1;
    }

    public setTreePosition(level: number, posInSet: number, setSize: number): void {
        this.#level = level;
        this.#posInSet = posInSet;
        this.#setSize = setSize;
        this.style.setProperty("--_tree-level", String(level));
        this.#syncAccessibilityState();
    }

    public refreshNestingSlot(): void {
        if (isTreeItemElement(this.parentElement)) {
            this.setAttribute("slot", "item");
            return;
        }

        if (this.getAttribute("slot") === "item") {
            this.removeAttribute("slot");
        }
    }

    public handleItemSlotChange(): void {
        this.#syncChildItemsFromDom();
    }

    public syncStructureFromDom(): void {
        this.#syncChildItemsFromDom();

        for (const child of this.childItems) {
            child.syncStructureFromDom();
        }
    }

    public handleRowClick(event: MouseEvent): void {
        if (this.disabled) {
            return;
        }

        const toggleRequested = event
            .composedPath()
            .some(
                value =>
                    value instanceof HTMLElement && value.dataset.treeToggle === "true" && this.hasChildren,
            );

        if (toggleRequested) {
            this.$emit("toggle-request", { expanded: !this.expanded });
            return;
        }

        this.$emit("select-request", { value: this.resolvedValue });
    }

    #syncAccessibilityState(): void {
        // Property defaults are assigned in the constructor and fire the *Changed callbacks;
        // host attributes must not be written until the element is connected.
        if (!this.isConnected) {
            return;
        }

        this.setAttribute("role", "treeitem");
        this.setAttribute("aria-level", String(this.#level));
        this.setAttribute("aria-posinset", String(this.#posInSet));
        this.setAttribute("aria-setsize", String(this.#setSize));
        this.setAttribute("aria-selected", String(this.selected));

        if (this.disabled) {
            this.setAttribute("aria-disabled", "true");
        } else {
            this.removeAttribute("aria-disabled");
        }

        if (this.hasChildren) {
            this.setAttribute("aria-expanded", String(this.expanded));
        } else {
            this.removeAttribute("aria-expanded");
        }
    }

    #syncChildItemsFromDom(): void {
        this.childItems = Array.from(this.children).filter(isTreeItemElement);

        for (const child of this.childItems) {
            child.setAttribute("slot", "item");
        }
    }
}

attr({ mode: "boolean" })(VioletTreeItem.prototype, "expanded");
attr({ mode: "boolean" })(VioletTreeItem.prototype, "expandable");
attr({ mode: "boolean" })(VioletTreeItem.prototype, "selected");
attr({ mode: "boolean" })(VioletTreeItem.prototype, "disabled");
attr(VioletTreeItem.prototype, "value");

if (!customElements.get("violet-tree-item")) {
    await FASTElement.define(VioletTreeItem, {
        name: "violet-tree-item",
        template,
        styles,
    });
}
