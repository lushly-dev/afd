import { FASTElement, attr, css, html } from "@lushly-dev/fast-element";

import { violetActionTokenDefaults } from "../theme/violet-token-defaults";

type VioletPaginationItem =
    | { kind: "page"; key: string; page: number; current: boolean }
    | { kind: "ellipsis"; key: string };

const integerConverter = {
    fromView(value: string): number {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : 0;
    },
    toView(value: number): string {
        return String(value);
    },
};

const styles = css`
    ${violetActionTokenDefaults}

    :host {
        display: inline-flex;
        max-inline-size: 100%;
    }

    .nav {
        display: inline-flex;
        max-inline-size: 100%;
    }

    .list {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--_space-xs);
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .item {
        display: inline-flex;
        align-items: center;
    }

    .button,
    .ellipsis {
        box-sizing: border-box;
        min-inline-size: calc(var(--_target-size) - var(--_space-xs));
        min-block-size: calc(var(--_target-size) - var(--_space-xs));
        border-radius: var(--_radius-md);
        font-family: inherit;
        font-size: var(--_control-body-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-body-line);
    }

    .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 var(--_space-md);
        border: 1px solid transparent;
        background: transparent;
        color: var(--_text-secondary);
        cursor: pointer;
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-fast) var(--_easing-standard),
            color var(--_duration-fast) var(--_easing-standard);
    }

    .button:hover {
        background: var(--_action-secondary-background);
        color: var(--_text-primary);
    }

    .button:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px var(--_focus-ring);
    }

    .button[aria-current="page"] {
        background: var(--_surface-page);
        border-color: var(--_border-subtle);
        box-shadow: var(--_shadow-control);
        color: var(--_text-primary);
    }

    .button[data-kind="nav"] {
        padding-inline: var(--_space-lg);
    }

    .button[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
        box-shadow: none;
    }

    .ellipsis {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 var(--_space-sm);
        color: var(--_text-muted);
    }

    :host([disabled]) {
        opacity: 0.72;
    }

    @media (forced-colors: active) {
        .button,
        .ellipsis {
            forced-color-adjust: none;
        }

        .button {
            border-color: ButtonText;
            color: ButtonText;
            background: Canvas;
            box-shadow: none;
        }

        .button[aria-current="page"] {
            background: Highlight;
            border-color: Highlight;
            color: HighlightText;
        }

        .ellipsis {
            color: ButtonText;
        }
    }
`;

const template = html<VioletPagination>`
    <nav class="nav" part="nav" aria-label="${x => x.label}">
        <ol class="list" part="list"></ol>
    </nav>
`;

/**
 * Violet pagination navigation.
 *
 * @summary Token-driven page navigation control with accessible current-page semantics and router-agnostic change events.
 * @fires page-change - Emitted when the current page changes. The event detail contains `{ page }`.
 * @fires change - Emitted after the current page changes.
 * @csspart nav - Navigation wrapper.
 * @csspart list - Ordered list wrapper.
 * @csspart item - Generic list item wrapper.
 * @csspart button - Generic interactive button.
 * @csspart previous-button - Previous-page button.
 * @csspart next-button - Next-page button.
 * @csspart page-button - Non-current numbered page button.
 * @csspart current-button - Current page button.
 * @csspart ellipsis - Collapsed-range marker.
 */
export class VioletPagination extends FASTElement {
    #synchronizing: boolean;

    declare public label: string;
    declare public disabled: boolean;
    declare public page: number;
    declare public pageCount: number;
    declare public siblingCount: number;
    declare public boundaryCount: number;

    public constructor() {
        super();
        this.#synchronizing = false;
        this.label = "Pagination";
        this.disabled = false;
        this.page = 1;
        this.pageCount = 1;
        this.siblingCount = 1;
        this.boundaryCount = 1;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.#synchronizing = true;
        this.page = readIntegerAttribute(this, "page", this.page || 1);
        this.pageCount = readIntegerAttribute(this, "page-count", this.pageCount || 1);
        this.siblingCount = readIntegerAttribute(this, "sibling-count", this.siblingCount || 0);
        this.boundaryCount = readIntegerAttribute(this, "boundary-count", this.boundaryCount || 0);
        this.#synchronizing = false;
        this.#normalizeState();
        this.#renderItems();
    }

    public pageChanged(): void {
        if (!this.isConnected || this.#synchronizing) {
            return;
        }
        this.#normalizeState();
        this.#renderItems();
    }

    public pageCountChanged(): void {
        if (!this.isConnected || this.#synchronizing) {
            return;
        }
        this.#normalizeState();
        this.#renderItems();
    }

    public siblingCountChanged(): void {
        if (!this.isConnected || this.#synchronizing) {
            return;
        }
        this.#normalizeState();
        this.#renderItems();
    }

    public boundaryCountChanged(): void {
        if (!this.isConnected || this.#synchronizing) {
            return;
        }
        this.#normalizeState();
        this.#renderItems();
    }

    public goPrevious(): void {
        this.goToPage(this.page - 1);
    }

    public goNext(): void {
        this.goToPage(this.page + 1);
    }

    public goToPage(nextPage: number): void {
        if (this.disabled) {
            return;
        }

        const clamped = clamp(nextPage, 1, this.pageCount);
        if (clamped === this.page) {
            return;
        }

        this.page = clamped;
        this.#renderItems();
        this.$emit("page-change", { page: this.page });
        this.$emit("change");
    }

    #normalizeState(): void {
        this.pageCount = Math.max(1, this.pageCount || 1);
        this.siblingCount = Math.max(0, this.siblingCount || 0);
        this.boundaryCount = Math.max(0, this.boundaryCount || 0);
        this.page = clamp(this.page || 1, 1, this.pageCount);
    }

    #renderItems(): void {
        const list = this.listElement;
        if (!list) {
            return;
        }

        const fragment = document.createDocumentFragment();
        fragment.append(this.#createNavItem("Previous", "previous-button", "Previous page", this.page <= 1, () => {
            this.goPrevious();
        }));

        for (const item of this.#buildPaginationItems()) {
            if (item.kind === "ellipsis") {
                fragment.append(this.#createEllipsisItem());
                continue;
            }

            fragment.append(this.#createPageItem(item.page, item.current));
        }

        fragment.append(this.#createNavItem("Next", "next-button", "Next page", this.page >= this.pageCount, () => {
            this.goNext();
        }));

        list.replaceChildren(fragment);
    }

    #buildPaginationItems(): VioletPaginationItem[] {
        const sequence = buildPageSequence(this.page, this.pageCount, this.siblingCount, this.boundaryCount);
        return sequence.map((token, index) =>
            token === "ellipsis"
                ? { kind: "ellipsis", key: `ellipsis-${index}` }
                : { kind: "page", key: `page-${token}`, page: token, current: token === this.page },
        );
    }

    #createNavItem(
        text: string,
        part: string,
        ariaLabel: string,
        disabled: boolean,
        onClick: () => void,
    ): HTMLLIElement {
        const item = document.createElement("li");
        item.className = "item";
        item.setAttribute("part", part === "previous-button" ? "item previous" : "item next");

        const button = document.createElement("button");
        button.className = "button";
        button.type = "button";
        button.dataset.kind = "nav";
        button.setAttribute("part", `button ${part}`);
        button.setAttribute("aria-label", ariaLabel);
        button.disabled = this.disabled || disabled;
        button.textContent = text;
        button.addEventListener("click", onClick);

        item.append(button);
        return item;
    }

    #createPageItem(page: number, current: boolean): HTMLLIElement {
        const item = document.createElement("li");
        item.className = "item";
        item.setAttribute("part", "item page-item");

        const button = document.createElement("button");
        button.className = "button";
        button.type = "button";
        button.setAttribute("part", current ? "button current-button" : "button page-button");
        button.setAttribute("aria-label", current ? `Page ${page}, current page` : `Go to page ${page}`);
        button.setAttribute("aria-current", current ? "page" : "false");
        button.disabled = this.disabled || current;
        button.textContent = String(page);
        button.addEventListener("click", () => this.goToPage(page));

        item.append(button);
        return item;
    }

    #createEllipsisItem(): HTMLLIElement {
        const item = document.createElement("li");
        item.className = "item";
        item.setAttribute("part", "item ellipsis-item");

        const ellipsis = document.createElement("span");
        ellipsis.className = "ellipsis";
        ellipsis.setAttribute("part", "ellipsis");
        ellipsis.setAttribute("aria-hidden", "true");
        ellipsis.textContent = "...";

        item.append(ellipsis);
        return item;
    }

    private get listElement(): HTMLOListElement | null {
        return this.shadowRoot?.querySelector(".list") ?? null;
    }
}

attr(VioletPagination.prototype, "label");
attr({ mode: "boolean" })(VioletPagination.prototype, "disabled");
attr({ attribute: "page", converter: integerConverter })(VioletPagination.prototype, "page");
attr({ attribute: "page-count", converter: integerConverter })(VioletPagination.prototype, "pageCount");
attr({ attribute: "sibling-count", converter: integerConverter })(VioletPagination.prototype, "siblingCount");
attr({ attribute: "boundary-count", converter: integerConverter })(VioletPagination.prototype, "boundaryCount");

if (!customElements.get("violet-pagination")) {
    await FASTElement.define(VioletPagination, {
        name: "violet-pagination",
        template,
        styles,
    });
}

function buildPageSequence(
    page: number,
    pageCount: number,
    siblingCount: number,
    boundaryCount: number,
): Array<number | "ellipsis"> {
    const startPages = range(1, Math.min(boundaryCount, pageCount));
    const endPages = range(Math.max(pageCount - boundaryCount + 1, boundaryCount + 1), pageCount);
    const siblingsStart = Math.max(
        Math.min(page - siblingCount, pageCount - boundaryCount - siblingCount * 2 - 1),
        boundaryCount + 2,
    );
    const siblingsEnd = Math.min(
        Math.max(page + siblingCount, boundaryCount + siblingCount * 2 + 2),
        endPages.length > 0 ? endPages[0] - 2 : pageCount - 1,
    );

    const items: Array<number | "ellipsis"> = [];
    items.push(...startPages);

    if (siblingsStart > boundaryCount + 2) {
        items.push("ellipsis");
    } else if (pageCount > boundaryCount + 1) {
        items.push(boundaryCount + 1);
    }

    items.push(...range(siblingsStart, siblingsEnd));

    if (siblingsEnd < pageCount - boundaryCount - 1) {
        items.push("ellipsis");
    } else if (pageCount - boundaryCount > boundaryCount) {
        items.push(pageCount - boundaryCount);
    }

    items.push(...endPages);

    return Array.from(new Set(items));
}

function range(start: number, end: number): number[] {
    if (end < start) {
        return [];
    }

    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}

function readIntegerAttribute(element: HTMLElement, attribute: string, fallback: number): number {
    const raw = element.getAttribute(attribute);
    if (!raw) {
        return fallback;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}
