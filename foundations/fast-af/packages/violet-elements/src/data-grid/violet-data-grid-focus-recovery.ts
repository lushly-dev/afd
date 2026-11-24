import type { VioletFocusedSelectionControl } from "./violet-data-grid-types";

export function selectionControlRowIdFromElement(element: Element | null): string | undefined {
    return (
        element
            ?.closest("tr[data-row-index]")
            ?.querySelector<HTMLElement>("td[data-row-id]")
            ?.getAttribute("data-row-id") ?? undefined
    );
}

export function findFocusedSelectionControl(
    shadowRoot: ShadowRoot | null,
    focusGeneration: number,
): VioletFocusedSelectionControl | null {
    const element = shadowRoot?.activeElement;
    if (!(element instanceof HTMLElement)) {
        return null;
    }
    const selector = element.matches("violet-radio.selection-radio")
        ? "violet-radio.selection-radio"
        : element.matches("violet-checkbox.selection-checkbox")
          ? "violet-checkbox.selection-checkbox"
          : null;
    const rowId = selector ? selectionControlRowIdFromElement(element) : undefined;
    return selector && rowId ? { element, focusGeneration, rowId, selector } : null;
}

export function scrollCellIntoScrollContainer(
    cell: HTMLElement | null,
    scrollContainer: HTMLDivElement | null,
    virtualize: boolean,
): void {
    if (!cell || !scrollContainer) {
        return;
    }
    const cellRect = cell.getBoundingClientRect();
    const scrollRect = scrollContainer.getBoundingClientRect();
    if (cellRect.left < scrollRect.left) {
        scrollContainer.scrollLeft += cellRect.left - scrollRect.left;
    } else if (cellRect.right > scrollRect.right) {
        scrollContainer.scrollLeft += cellRect.right - scrollRect.right;
    }
    if (!virtualize) {
        if (cellRect.top < scrollRect.top) {
            scrollContainer.scrollTop += cellRect.top - scrollRect.top;
        } else if (cellRect.bottom > scrollRect.bottom) {
            scrollContainer.scrollTop += cellRect.bottom - scrollRect.bottom;
        }
    }
}

export function isDocumentFocusAvailableForGrid(
    grid: HTMLElement,
    ownerDocument: Document,
): boolean {
    const documentActive = ownerDocument.activeElement;
    return !documentActive || documentActive === grid || documentActive === ownerDocument.body;
}

export function isGridCellElementNode(
    element: Element | null | undefined,
): element is HTMLTableCellElement {
    return (
        element instanceof HTMLTableCellElement &&
        (element.classList.contains("selection-cell") ||
            Boolean(element.dataset.rowId && element.dataset.columnId))
    );
}

export function suspendRovingCellTabStops(
    shadowRoot: ShadowRoot | null,
    restore: () => HTMLTableCellElement | null,
): void {
    const rovingCells = Array.from(
        shadowRoot?.querySelectorAll<HTMLTableCellElement>('tbody td[tabindex="0"]') ?? [],
    );
    if (rovingCells.length === 0) {
        return;
    }
    for (const cell of rovingCells) {
        cell.setAttribute("tabindex", "-1");
    }
    setTimeout(() => {
        const target = restore();
        if (target) {
            target.setAttribute("tabindex", "0");
        }
    }, 0);
}

export interface PendingCellFocusRecovery {
    hadGridCellFocus: boolean;
    focusGeneration: number;
}

export function mergePendingCellFocusRecovery(
    previous: PendingCellFocusRecovery | null,
    hadGridCellFocus: boolean,
    focusGeneration: number,
): PendingCellFocusRecovery {
    return {
        hadGridCellFocus: hadGridCellFocus || Boolean(previous?.hadGridCellFocus),
        focusGeneration: previous ? Math.min(focusGeneration, previous.focusGeneration) : focusGeneration,
    };
}

/**
 * Recovers grid cell focus after FAST's RepeatBehavior splices tbody (which silently drops focus
 * to `document.body` in Firefox, #2383), including same-frame leave-and-return transitions, while
 * never stealing intentional focus that moved elsewhere.
 */
export function recoverGridCellFocusAfterRender(options: {
    grid: HTMLElement;
    ownerDocument: Document;
    shadowRoot: ShadowRoot | null;
    pending: PendingCellFocusRecovery;
    focusGeneration: number;
    gridCellFocusGeneration: number;
    activeCell: HTMLTableCellElement | null;
    parkFocusOnScrollContainer: () => void;
}): void {
    const {
        grid,
        ownerDocument,
        shadowRoot,
        pending,
        focusGeneration,
        gridCellFocusGeneration,
        activeCell,
        parkFocusOnScrollContainer,
    } = options;
    const focusBelongsToGridCell =
        (pending.hadGridCellFocus && focusGeneration === pending.focusGeneration) ||
        (gridCellFocusGeneration > pending.focusGeneration && focusGeneration === gridCellFocusGeneration);
    if (!focusBelongsToGridCell) {
        return;
    }

    const shadowActive = shadowRoot?.activeElement;
    if (
        shadowActive?.isConnected &&
        (!isGridCellElementNode(shadowActive) || (activeCell && shadowActive === activeCell))
    ) {
        return;
    }

    if (!isDocumentFocusAvailableForGrid(grid, ownerDocument)) {
        return;
    }

    if (activeCell) {
        activeCell.focus({ preventScroll: true });
    } else {
        parkFocusOnScrollContainer();
    }
}
