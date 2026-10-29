import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-data-grid";
import type { VioletDataGrid } from "./violet-data-grid";
import { isColumnResizeShortcut, keyboardResizedColumnWidth } from "./violet-data-grid-resize";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderGrid(attributes: Record<string, string> = {}, dir?: string): Promise<VioletDataGrid> {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    if (dir) {
        host.setAttribute("dir", dir);
    }

    const grid = document.createElement("violet-data-grid") as VioletDataGrid;
    for (const [name, value] of Object.entries(attributes)) {
        grid.setAttribute(name, value);
    }
    const target = grid as unknown as Record<string, unknown>;
    target.columns = [
        { id: "name", label: "Name", width: "200px" },
        { id: "status", label: "Status", width: "160px" },
    ];
    target.rows = [{ id: "a", name: "Alder", status: "Seedling" }];
    target.focusMode = "cell";
    target.virtualize = false;
    host.append(grid);
    document.body.append(host);
    await customElements.whenDefined("violet-data-grid");
    await nextFrame();
    await nextFrame();
    return grid;
}

function resizerFor(grid: VioletDataGrid, columnId: string): HTMLButtonElement {
    const resizer = grid.shadowRoot?.querySelector<HTMLButtonElement>(`[data-column-resizer="${columnId}"]`);
    if (!resizer) {
        throw new Error(`Expected a resizer for ${columnId}.`);
    }
    return resizer;
}

function press(resizer: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true, ...init });
    resizer.dispatchEvent(event);
    return event;
}

describe("keyboardResizedColumnWidth", () => {
    const base = { shiftKey: false, currentWidth: 200, minimumWidth: 72, rtl: false };

    it("grows with ArrowRight and shrinks with ArrowLeft in 8px steps", () => {
        expect(keyboardResizedColumnWidth({ ...base, key: "ArrowRight" })).toBe(208);
        expect(keyboardResizedColumnWidth({ ...base, key: "ArrowLeft" })).toBe(192);
    });

    it("uses 32px steps with Shift", () => {
        expect(keyboardResizedColumnWidth({ ...base, key: "ArrowRight", shiftKey: true })).toBe(232);
        expect(keyboardResizedColumnWidth({ ...base, key: "ArrowLeft", shiftKey: true })).toBe(168);
    });

    it("swaps directions in RTL", () => {
        expect(keyboardResizedColumnWidth({ ...base, key: "ArrowLeft", rtl: true })).toBe(208);
        expect(keyboardResizedColumnWidth({ ...base, key: "ArrowRight", rtl: true })).toBe(192);
    });

    it("never goes below the minimum width and ignores other keys", () => {
        expect(keyboardResizedColumnWidth({ ...base, key: "ArrowLeft", currentWidth: 75, shiftKey: true })).toBe(72);
        expect(keyboardResizedColumnWidth({ ...base, key: "ArrowUp" })).toBeNull();
        expect(keyboardResizedColumnWidth({ ...base, key: "Enter" })).toBeNull();
    });
});

describe("violet-data-grid column resizer keyboard support", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("resizes the column with the arrow keys and emits column-width-change", async () => {
        const grid = await renderGrid();
        const details: Array<{ columnId: string; width: string }> = [];
        grid.addEventListener("column-width-change", event => {
            details.push((event as CustomEvent<{ columnId: string; width: string }>).detail);
        });

        const resizer = resizerFor(grid, "name");
        const startWidth = resizer.closest("th")?.getBoundingClientRect().width ?? 0;

        const grow = press(resizer, "ArrowRight");
        await nextFrame();
        expect(grow.defaultPrevented).toBe(true);
        expect(details.at(-1)?.columnId).toBe("name");
        expect(details.at(-1)?.width).toBe(`${Math.round(startWidth) + 8}px`);

        press(resizer, "ArrowRight", { shiftKey: true });
        await nextFrame();
        expect(details.at(-1)?.width).toBe(`${Math.round(startWidth) + 40}px`);

        press(resizer, "ArrowLeft");
        await nextFrame();
        expect(details.at(-1)?.width).toBe(`${Math.round(startWidth) + 32}px`);
        expect(details).toHaveLength(3);
    });

    it("stops shrinking at the minimum column width", async () => {
        const grid = await renderGrid();
        const resizer = resizerFor(grid, "status");

        for (let index = 0; index < 20; index += 1) {
            press(resizer, "ArrowLeft", { shiftKey: true });
            await nextFrame();
        }

        const width = Number.parseFloat(grid.columnWidths?.status ?? "0");
        expect(width).toBeGreaterThanOrEqual(72);
        expect(width).toBeLessThan(200);
    });

    it("autosizes on Enter like a double click", async () => {
        const grid = await renderGrid();
        const widths: string[] = [];
        grid.addEventListener("column-width-change", event => {
            widths.push((event as CustomEvent<{ width: string }>).detail.width);
        });

        const enter = press(resizerFor(grid, "name"), "Enter");
        await nextFrame();

        expect(enter.defaultPrevented).toBe(true);
        expect(widths).toHaveLength(1);
        expect(widths[0]).toMatch(/^\d+px$/);
    });

    it("grows with ArrowLeft inside an RTL tree", async () => {
        const grid = await renderGrid({}, "rtl");
        const details: string[] = [];
        grid.addEventListener("column-width-change", event => {
            details.push((event as CustomEvent<{ width: string }>).detail.width);
        });

        const resizer = resizerFor(grid, "name");
        const startWidth = Math.round(resizer.closest("th")?.getBoundingClientRect().width ?? 0);

        press(resizer, "ArrowLeft");
        await nextFrame();

        expect(details.at(-1)).toBe(`${startWidth + 8}px`);
    });

    it("ignores arrows combined with Ctrl, Alt or Meta", async () => {
        const grid = await renderGrid();
        let events = 0;
        grid.addEventListener("column-width-change", () => {
            events += 1;
        });

        const resizer = resizerFor(grid, "name");
        press(resizer, "ArrowRight", { ctrlKey: true });
        press(resizer, "ArrowRight", { altKey: true });
        press(resizer, "ArrowRight", { metaKey: true });

        expect(events).toBe(0);
    });

    it("names the cell-mode scroll container from the grid's aria-label", async () => {
        const grid = await renderGrid({ "aria-label": "Plant inventory" });
        const scroller = grid.shadowRoot?.querySelector(".table-scroll");

        expect(scroller?.getAttribute("aria-label")).toBe("Plant inventory");
        expect(scroller?.getAttribute("role")).toBe("group");
    });

    it("leaves the scroll container unnamed when the grid has no aria-label", async () => {
        const grid = await renderGrid();
        const scroller = grid.shadowRoot?.querySelector(".table-scroll");

        expect(scroller?.hasAttribute("aria-label")).toBe(false);
        expect(scroller?.hasAttribute("role")).toBe(false);
    });
});

describe("isColumnResizeShortcut", () => {
    const chord = { ctrlKey: true, altKey: true, metaKey: false, shiftKey: false, code: "KeyR" };

    it("matches Ctrl+Alt+R by physical key", () => {
        expect(isColumnResizeShortcut(chord)).toBe(true);
    });

    it("rejects other chords", () => {
        expect(isColumnResizeShortcut({ ...chord, ctrlKey: false })).toBe(false);
        expect(isColumnResizeShortcut({ ...chord, altKey: false })).toBe(false);
        expect(isColumnResizeShortcut({ ...chord, metaKey: true })).toBe(false);
        expect(isColumnResizeShortcut({ ...chord, shiftKey: true })).toBe(false);
        expect(isColumnResizeShortcut({ ...chord, code: "KeyT" })).toBe(false);
    });
});

describe("violet-data-grid column resizers in the tab order (real key presses)", () => {
    const resizeChord = "{Control>}{Alt>}r{/Alt}{/Control}";

    afterEach(() => {
        document.body.innerHTML = "";
    });

    async function renderBetweenButtons(focusMode: "cell" | "row"): Promise<VioletDataGrid> {
        document.body.innerHTML = `<button id="before" type="button">Before</button>`;
        const grid = document.createElement("violet-data-grid") as VioletDataGrid;
        const target = grid as unknown as Record<string, unknown>;
        target.columns = [
            { id: "name", label: "Name", width: "160px", sortable: true },
            { id: "status", label: "Status", width: "140px" },
            { id: "bed", label: "Bed", width: "120px" },
        ];
        target.rows = [{ id: "a", data: { name: "Alder", status: "Seedling", bed: "North" } }];
        target.focusMode = focusMode;
        target.virtualize = false;
        document.body.append(grid);
        const after = document.createElement("button");
        after.id = "after";
        after.type = "button";
        after.textContent = "After";
        document.body.append(after);
        await customElements.whenDefined("violet-data-grid");
        await nextFrame();
        await nextFrame();
        return grid;
    }

    function focusedInGrid(grid: VioletDataGrid): Element | null {
        return grid.shadowRoot?.activeElement ?? null;
    }

    async function tabThrough(grid: VioletDataGrid): Promise<Element[]> {
        (document.getElementById("before") as HTMLButtonElement).focus();
        const stops: Element[] = [];
        for (let index = 0; index < 12 && document.activeElement?.id !== "after"; index += 1) {
            await userEvent.tab();
            const focused = document.activeElement === grid ? focusedInGrid(grid) : document.activeElement;
            if (focused) {
                stops.push(focused);
            }
        }
        return stops;
    }

    it.each(["cell", "row"] as const)("never stops on a resizer when tabbing through a %s-mode grid", async focusMode => {
        const grid = await renderBetweenButtons(focusMode);

        const stops = await tabThrough(grid);

        expect(stops.at(-1)?.id).toBe("after");
        expect(stops.some(stop => stop.classList.contains("column-resizer"))).toBe(false);
        // Row mode keeps one header in the tab order; in cell mode the grid itself is the only stop.
        expect(stops.some(stop => stop.classList.contains("header-button"))).toBe(focusMode === "row");
        for (const resizer of grid.shadowRoot?.querySelectorAll(".column-resizer") ?? []) {
            expect(resizer.getAttribute("tabindex")).toBe("-1");
        }
    });

    it("reaches a column's resizer from its header button with Ctrl+Alt+R, resizes it and returns on Escape", async () => {
        const grid = await renderBetweenButtons("row");
        const widths: Array<{ columnId: string; width: string }> = [];
        grid.addEventListener("column-width-change", event => {
            widths.push((event as CustomEvent<{ columnId: string; width: string }>).detail);
        });
        const headerButton = grid.shadowRoot!.querySelector<HTMLButtonElement>(
            'th[data-column-id="name"] .header-button',
        )!;
        const startWidth = Math.round(resizerFor(grid, "name").closest("th")!.getBoundingClientRect().width);
        expect(headerButton.getAttribute("aria-keyshortcuts")).toBe("Control+Alt+R");

        headerButton.focus();
        await userEvent.keyboard(resizeChord);
        expect(focusedInGrid(grid)).toBe(resizerFor(grid, "name"));

        await userEvent.keyboard("{ArrowRight}");
        await nextFrame();
        expect(widths.map(({ columnId, width }) => ({ columnId, width }))).toEqual([
            { columnId: "name", width: `${startWidth + 8}px` },
        ]);

        await userEvent.keyboard("{Escape}");
        expect(focusedInGrid(grid)).toBe(headerButton);
    });

    it("reaches the active cell's column resizer with Ctrl+Alt+R in cell mode", async () => {
        const grid = await renderBetweenButtons("cell");
        const widths: string[] = [];
        grid.addEventListener("column-width-change", event => {
            widths.push((event as CustomEvent<{ columnId: string }>).detail.columnId);
        });
        const scroller = grid.shadowRoot!.querySelector<HTMLElement>(".table-scroll")!;
        expect(scroller.getAttribute("aria-keyshortcuts")).toBe("Control+Alt+R");

        scroller.focus();
        await userEvent.keyboard("{ArrowRight}");
        expect(grid.activeCell).toEqual({ rowId: "a", columnId: "status" });

        await userEvent.keyboard(resizeChord);
        expect(focusedInGrid(grid)).toBe(resizerFor(grid, "status"));

        await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
        await userEvent.keyboard("{Escape}");
        expect(widths).toEqual(["status"]);
        expect(focusedInGrid(grid)).toBe(scroller);
        expect(grid.activeCell).toEqual({ rowId: "a", columnId: "status" });
    });

    it("continues Tab from the header button that opened the resizer", async () => {
        const grid = await renderBetweenButtons("row");
        grid.shadowRoot!.querySelector<HTMLButtonElement>('th[data-column-id="name"] .header-button')!.focus();
        await userEvent.keyboard(resizeChord);
        expect(focusedInGrid(grid)).toBe(resizerFor(grid, "name"));

        await userEvent.tab();

        expect(document.activeElement?.id).toBe("after");
    });

    it("lets Tab leave a resizer focused by pointer", async () => {
        const grid = await renderBetweenButtons("row");
        resizerFor(grid, "bed").focus();

        await userEvent.tab();

        expect(focusedInGrid(grid)?.classList.contains("column-resizer") ?? false).toBe(false);
    });
});

describe("column resizer native key handling", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("does not cancel Tab or modified keys on the resizer", async () => {
        const grid = await renderGrid();
        const resizer = resizerFor(grid, "name");

        expect(press(resizer, "Tab").defaultPrevented).toBe(false);
        expect(press(resizer, "ArrowRight", { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(press(resizer, "ArrowRight").defaultPrevented).toBe(true);
    });
});
