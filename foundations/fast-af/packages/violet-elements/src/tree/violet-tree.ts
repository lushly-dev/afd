import { FASTElement, attr, css, html, observable, when } from "@lushly-dev/fast-element";

import "../tree-item/violet-tree-item";
import { VioletTreeItem } from "../tree-item/violet-tree-item";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import { logicalArrowKey } from "../foundations/violet-direction";

let violetTreeId = 0;

function isTreeItemElement(value: unknown): value is VioletTreeItem {
    return value instanceof HTMLElement && value.tagName.toLowerCase() === "violet-tree-item";
}

function getTreeChildItems(item: VioletTreeItem): VioletTreeItem[] {
    return Array.isArray(item.childItems) ? item.childItems : [];
}

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        display: grid;

        --_tree-surface-padding: var(--violet-tree-surface-padding, var(--_space-stack-xs));
        --_tree-surface-radius: var(--violet-tree-surface-radius, calc(var(--_radius-md) * 2));
        --_tree-surface-background: var(--violet-tree-surface-background, var(--_surface-card));
        --_tree-surface-border: var(--violet-tree-surface-border, var(--_border-subtle));
    }

    .field {
        display: grid;
        gap: 0;
        min-inline-size: 0;
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-2xs);
    }

    .surface {
        min-inline-size: 0;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
    }

    :host([appearance="framed"]) .surface {
        padding: var(--_tree-surface-padding);
        border: 1px solid var(--_tree-surface-border);
        border-radius: var(--_tree-surface-radius);
        background: var(--_tree-surface-background);
        box-shadow: var(--_shadow-control);
    }

    .tree {
        display: grid;
        gap: 0;
        outline: none;
    }

    .supporting,
    .error {
        margin: 0;
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting {
        color: var(--_text-muted);
        margin-block-start: var(--_space-stack-2xs);
    }

    .error {
        color: var(--color-state-danger-foreground, #b42318);
        margin-block-start: var(--_space-stack-2xs);
    }

    @media (forced-colors: active) {
        .surface {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: ButtonText;
            box-shadow: none;
        }
    }
`;

const template = html<VioletTree>`
    <div class="field" part="field">
        ${when(
            x => Boolean(x.label),
            html<VioletTree>`
                <div class="label" part="label" id="${x => x.labelId}">${x => x.label}</div>
            `,
        )}
        <div class="surface" part="surface">
            <div
                class="tree"
                part="tree"
                role="tree"
                aria-label="${x => (x.label ? null : x.ariaLabel)}"
                aria-labelledby="${x => (x.label ? x.labelId : null)}"
                aria-describedby="${x => x.describedBy}"
            >
                <slot @slotchange="${x => x.handleSlotChange()}"></slot>
            </div>
        </div>
        ${when(
            x => Boolean(x.supportingText),
            html<VioletTree>`
                <p class="supporting" part="supporting-text" id="${x => x.supportingTextId}">
                    ${x => x.supportingText}
                </p>
            `,
        )}
        ${when(
            x => Boolean(x.errorText),
            html<VioletTree>`
                <p class="error" part="error-text" id="${x => x.errorTextId}">
                    ${x => x.errorText}
                </p>
            `,
        )}
    </div>
`;

/**
 * Violet tree primitive.
 *
 * @summary Single-selection treeview with nested `violet-tree-item` children, roving focus, and APG-style keyboard support.
 * @fires change - Emitted when the selected item changes.
 * @fires expanded-change - Emitted when the user expands or collapses an item; detail is `{ value, itemId, expanded }`.
 * @slot - Root `violet-tree-item` elements.
 * @csspart field - Outer field wrapper.
 * @csspart label - Optional label element.
 * @csspart surface - Bordered tree surface.
 * @csspart tree - Internal treeview container.
 * @csspart supporting-text - Supporting text element.
 * @csspart error-text - Error text element.
 */
export class VioletTree extends FASTElement {
    @observable
    declare public rootItems: VioletTreeItem[];

    declare public label: string;
    declare public supportingText: string;
    declare public errorText: string;
    declare public value: string;
    declare public ariaLabel: string;
    declare public appearance: "plain" | "framed";

    readonly #id: number;
    #activeItem: VioletTreeItem | null = null;
    #searchBuffer = "";
    #searchTimer = 0;
    #syncingValue = false;

    public constructor() {
        super();
        this.#id = violetTreeId;
        violetTreeId += 1;
        this.rootItems = [];
        this.label = "";
        this.supportingText = "";
        this.errorText = "";
        this.value = "";
        this.ariaLabel = "Tree";
        this.appearance = "plain";
    }

    public get labelId(): string {
        return `violet-tree-label-${this.#id}`;
    }

    public get supportingTextId(): string {
        return `violet-tree-supporting-${this.#id}`;
    }

    public get errorTextId(): string {
        return `violet-tree-error-${this.#id}`;
    }

    public get describedBy(): string | null {
        const ids = [this.supportingText ? this.supportingTextId : "", this.errorText ? this.errorTextId : ""].filter(
            Boolean,
        );

        return ids.length ? ids.join(" ") : null;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.addEventListener("select-request", this.handleSelectRequest as EventListener);
        this.addEventListener("toggle-request", this.handleToggleRequest as EventListener);
        this.addEventListener("keydown", this.handleKeydown as EventListener);
        this.addEventListener("focusin", this.handleFocusIn as EventListener);
        queueMicrotask(() => {
            this.handleSlotChange();
        });
    }

    public disconnectedCallback(): void {
        this.removeEventListener("select-request", this.handleSelectRequest as EventListener);
        this.removeEventListener("toggle-request", this.handleToggleRequest as EventListener);
        this.removeEventListener("keydown", this.handleKeydown as EventListener);
        this.removeEventListener("focusin", this.handleFocusIn as EventListener);
        window.clearTimeout(this.#searchTimer);
        super.disconnectedCallback();
    }

    public valueChanged(): void {
        if (this.#syncingValue) {
            return;
        }

        const match = this.#allItems().find(item => item.resolvedValue === this.value) ?? null;
        this.#applySelection(match, false);
        this.#syncTreeState();
    }

    public handleSlotChange(): void {
        this.rootItems = this.#ownedRootItems();

        for (const item of this.rootItems) {
            item.syncStructureFromDom();
        }

        const allItems = this.#allItems();
        const selectedItem = this.value
            ? allItems.find(item => item.resolvedValue === this.value) ?? null
            : allItems.find(item => item.selected) ?? null;

        if (selectedItem) {
            this.#applySelection(selectedItem, false);
        } else if (allItems.length > 0) {
            this.#applySelection(null, false);
        }

        this.#syncTreeState();
    }

    public handleSelectRequest(event: CustomEvent<{ value: string }>): void {
        const item = this.#itemFromEvent(event);
        if (!item || item.disabled) {
            return;
        }

        this.#setActiveItem(item, true);
        this.#applySelection(item, true);
        this.#syncTreeState();
    }

    public handleToggleRequest(event: CustomEvent<{ expanded: boolean }>): void {
        const item = this.#itemFromEvent(event);
        if (!item || item.disabled || !item.hasChildren) {
            return;
        }

        this.#setExpanded(item, event.detail?.expanded ?? !item.expanded);
        this.#setActiveItem(item, true);
        this.#syncTreeState();
    }

    public handleFocusIn(event: FocusEvent): void {
        const item = this.#itemFromEvent(event);
        if (!item || item.disabled) {
            return;
        }

        this.#setActiveItem(item, false);
    }

    public handleKeydown(event: KeyboardEvent): void {
        const item = this.#itemFromEvent(event) ?? this.#activeItem ?? this.#visibleItems()[0] ?? null;
        if (!item) {
            return;
        }

        const visibleItems = this.#visibleItems();
        const currentIndex = visibleItems.indexOf(item);

        switch (logicalArrowKey(event.key, this)) {
            case "ArrowDown": {
                const next = visibleItems[currentIndex + 1];
                if (!next) {
                    return;
                }

                event.preventDefault();
                this.#setActiveItem(next, true);
                break;
            }

            case "ArrowUp": {
                const previous = visibleItems[currentIndex - 1];
                if (!previous) {
                    return;
                }

                event.preventDefault();
                this.#setActiveItem(previous, true);
                break;
            }

            case "ArrowRight": {
                event.preventDefault();
                if (item.hasChildren && !item.expanded) {
                    this.#setExpanded(item, true);
                    this.#syncTreeState();
                    return;
                }

                if (item.hasChildren && item.expanded) {
                    const firstChild = item.childItems[0];
                    if (firstChild) {
                        this.#setActiveItem(firstChild, true);
                    }
                }
                break;
            }

            case "ArrowLeft": {
                event.preventDefault();
                if (item.hasChildren && item.expanded) {
                    this.#setExpanded(item, false);
                    this.#syncTreeState();
                    return;
                }

                const parent = item.parentItem;
                if (parent) {
                    this.#setActiveItem(parent, true);
                }
                break;
            }

            case "Home": {
                event.preventDefault();
                const first = visibleItems[0];
                if (first) {
                    this.#setActiveItem(first, true);
                }
                break;
            }

            case "End": {
                event.preventDefault();
                const last = visibleItems.at(-1);
                if (last) {
                    this.#setActiveItem(last, true);
                }
                break;
            }

            case "Enter":
            case " ": {
                event.preventDefault();
                this.#applySelection(item, true);
                this.#syncTreeState();
                break;
            }

            default: {
                if (event.altKey || event.ctrlKey || event.metaKey || event.key.length !== 1) {
                    return;
                }

                this.#handleTypeahead(event.key, item);
                break;
            }
        }
    }

    #setExpanded(item: VioletTreeItem, expanded: boolean): void {
        if (item.expanded === expanded) {
            return;
        }

        item.expanded = expanded;
        this.$emit("expanded-change", {
            value: item.resolvedValue,
            itemId: item.id,
            expanded,
        });
    }

    #ownedRootItems(): VioletTreeItem[] {
        const slot = this.shadowRoot?.querySelector("slot");
        return (slot?.assignedElements() ?? []).filter(isTreeItemElement);
    }

    #allItems(): VioletTreeItem[] {
        const all: VioletTreeItem[] = [];

        const visit = (items: VioletTreeItem[]) => {
            for (const item of items) {
                all.push(item);
                const childItems = getTreeChildItems(item);
                if (childItems.length > 0) {
                    visit(childItems);
                }
            }
        };

        visit(this.rootItems);
        return all;
    }

    #visibleItems(): VioletTreeItem[] {
        const visible: VioletTreeItem[] = [];

        const visit = (items: VioletTreeItem[]) => {
            for (const item of items) {
                visible.push(item);
                const childItems = getTreeChildItems(item);
                if (item.expanded && childItems.length > 0) {
                    visit(childItems);
                }
            }
        };

        visit(this.rootItems);
        return visible;
    }

    #syncTreeState(): void {
        const walk = (items: VioletTreeItem[], level: number) => {
            items.forEach((item, index) => {
                item.setTreePosition(level, index + 1, items.length);
                const childItems = getTreeChildItems(item);
                if (childItems.length > 0) {
                    walk(childItems, level + 1);
                }
            });
        };

        walk(this.rootItems, 1);

        const visibleItems = this.#visibleItems();
        const selectedItem = this.#allItems().find(item => item.selected) ?? null;

        if (!this.#activeItem || !visibleItems.includes(this.#activeItem)) {
            this.#activeItem = selectedItem && visibleItems.includes(selectedItem) ? selectedItem : visibleItems[0] ?? null;
        }

        const allItems = this.#allItems();
        for (const item of allItems) {
            item.setActiveFromTree(item === this.#activeItem);
        }
    }

    #setActiveItem(item: VioletTreeItem, focus: boolean): void {
        this.#activeItem = item;
        for (const candidate of this.#allItems()) {
            candidate.setActiveFromTree(candidate === item);
        }

        if (focus) {
            item.focusItem();
        }
    }

    #applySelection(item: VioletTreeItem | null, emit: boolean): void {
        const allItems = this.#allItems();
        const selectedItem = item && !item.disabled ? item : null;

        for (const candidate of allItems) {
            candidate.selected = candidate === selectedItem;
        }

        this.#syncingValue = true;
        this.value = selectedItem?.resolvedValue ?? "";
        this.#syncingValue = false;

        if (emit && selectedItem) {
            this.$emit("change", {
                value: selectedItem.resolvedValue,
                itemId: selectedItem.id,
            });
        }
    }

    #itemFromEvent(event: Event): VioletTreeItem | null {
        const item = event.composedPath().find(isTreeItemElement);
        return item ?? null;
    }

    #handleTypeahead(fragment: string, currentItem: VioletTreeItem): void {
        const visibleItems = this.#visibleItems();
        if (visibleItems.length === 0) {
            return;
        }

        this.#searchBuffer += fragment.toLowerCase();
        window.clearTimeout(this.#searchTimer);
        this.#searchTimer = window.setTimeout(() => {
            this.#searchBuffer = "";
        }, 400);

        const startIndex = Math.max(visibleItems.indexOf(currentItem), 0);

        for (let offset = 1; offset <= visibleItems.length; offset += 1) {
            const candidate = visibleItems[(startIndex + offset) % visibleItems.length];
            if (candidate.textLabel.toLowerCase().startsWith(this.#searchBuffer)) {
                this.#setActiveItem(candidate, true);
                return;
            }
        }
    }
}

attr(VioletTree.prototype, "label");
attr({ attribute: "supporting-text" })(VioletTree.prototype, "supportingText");
attr({ attribute: "error-text" })(VioletTree.prototype, "errorText");
attr(VioletTree.prototype, "value");
attr({ attribute: "aria-label", mode: "fromView" })(VioletTree.prototype, "ariaLabel");
attr(VioletTree.prototype, "appearance");

if (!customElements.get("violet-tree")) {
    await FASTElement.define(VioletTree, {
        name: "violet-tree",
        template,
        styles,
    });
}
