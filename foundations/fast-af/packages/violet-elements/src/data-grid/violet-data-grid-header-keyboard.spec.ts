import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-data-grid";
import type { VioletDataGrid } from "./violet-data-grid";

const resizeChord = "{Control>}{Alt>}r{/Alt}{/Control}";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderBetweenButtons(focusMode: "cell" | "row", dir?: string): Promise<VioletDataGrid> {
    document.body.innerHTML = `<button id="before" type="button">Before</button>`;
    const grid = document.createElement("violet-data-grid") as VioletDataGrid;
    if (dir) {
        grid.setAttribute("dir", dir);
    }
    const target = grid as unknown as Record<string, unknown>;
    target.columns = [
        { id: "name", label: "Name", width: "160px", sortable: true },
        { id: "status", label: "Status", width: "140px", sortable: true },
        { id: "bed", label: "Bed", width: "120px" },
        { id: "zone", label: "Zone", width: "120px", sortable: true },
    ];
    target.rows = [
        { id: "a", data: { name: "Birch", status: "Seedling", bed: "North", zone: "3" } },
        { id: "b", data: { name: "Alder", status: "Mature", bed: "South", zone: "5" } },
    ];
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

function focused(grid: VioletDataGrid): Element | null {
    return document.activeElement === grid ? grid.shadowRoot?.activeElement ?? null : document.activeElement;
}

function header(grid: VioletDataGrid, columnId: string): HTMLTableCellElement {
    const cell = grid.shadowRoot?.querySelector<HTMLTableCellElement>(`th[data-column-id="${columnId}"]`);
    if (!cell) {
        throw new Error(`Expected a header cell for ${columnId}.`);
    }
    return cell;
}

/** The element that takes focus for a column header: its sort button, or the header cell. */
function headerTarget(grid: VioletDataGrid, columnId: string): HTMLElement {
    const cell = header(grid, columnId);
    return cell.querySelector<HTMLElement>(".header-button") ?? cell;
}

function scroller(grid: VioletDataGrid): HTMLElement {
    return grid.shadowRoot!.querySelector<HTMLElement>(".table-scroll")!;
}

function isHeaderStop(element: Element): boolean {
    return element.classList.contains("header-button") || element.localName === "th";
}

async function tabStops(grid: VioletDataGrid, shift = false): Promise<Element[]> {
    (document.getElementById(shift ? "after" : "before") as HTMLButtonElement).focus();
    const end = shift ? "before" : "after";
    const stops: Element[] = [];
    for (let index = 0; index < 16 && document.activeElement?.id !== end; index += 1) {
        await userEvent.tab({ shift });
        const element = focused(grid);
        if (element) {
            stops.push(element);
        }
    }
    return stops;
}

describe("violet-data-grid column headers in the keyboard model (real key presses)", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("adds no header Tab stops in cell mode, in either direction", async () => {
        const grid = await renderBetweenButtons("cell");

        const forward = await tabStops(grid);
        expect(forward.at(-1)?.id).toBe("after");
        expect(forward.filter(isHeaderStop)).toEqual([]);

        const backward = await tabStops(grid, true);
        expect(backward[0]).toBe(scroller(grid));
        expect(backward.at(-1)?.id).toBe("before");
        expect(backward.filter(isHeaderStop)).toEqual([]);
    });

    it("adds one roving header Tab stop in row mode, in either direction", async () => {
        const grid = await renderBetweenButtons("row");

        const forward = await tabStops(grid);
        expect(forward.map(stop => stop.id || stop.className)).toEqual(["header-button", "after"]);
        expect(forward[0]).toBe(headerTarget(grid, "name"));

        const backward = await tabStops(grid, true);
        expect(backward).toEqual([headerTarget(grid, "name"), document.getElementById("before")]);
    });

    it("moves between headers with the arrow keys, Home and End, and keeps the last one as the Tab stop", async () => {
        const grid = await renderBetweenButtons("row");
        (document.getElementById("before") as HTMLButtonElement).focus();
        await userEvent.tab();

        await userEvent.keyboard("{ArrowRight}{ArrowRight}");
        expect(focused(grid)).toBe(header(grid, "bed"));
        expect(header(grid, "bed").getAttribute("aria-keyshortcuts")).toBe("Control+Alt+R");

        await userEvent.keyboard("{End}");
        expect(focused(grid)).toBe(headerTarget(grid, "zone"));
        await userEvent.keyboard("{ArrowRight}");
        expect(focused(grid)).toBe(headerTarget(grid, "zone"));
        await userEvent.keyboard("{Home}");
        expect(focused(grid)).toBe(headerTarget(grid, "name"));
        await userEvent.keyboard("{ArrowLeft}");
        expect(focused(grid)).toBe(headerTarget(grid, "name"));
        await userEvent.keyboard("{ArrowRight}{ArrowRight}");
        expect(focused(grid)).toBe(header(grid, "bed"));

        await userEvent.tab();
        expect(document.activeElement?.id).toBe("after");
        await userEvent.tab({ shift: true });
        expect(focused(grid)).toBe(header(grid, "bed"));
        for (const columnId of ["name", "status", "zone"]) {
            expect(headerTarget(grid, columnId).getAttribute("tabindex")).toBe("-1");
        }
        expect(header(grid, "bed").getAttribute("tabindex")).toBe("0");
    });

    it("swaps ArrowLeft and ArrowRight between headers in RTL", async () => {
        const grid = await renderBetweenButtons("row", "rtl");
        headerTarget(grid, "name").focus();

        await userEvent.keyboard("{ArrowLeft}");
        expect(focused(grid)).toBe(headerTarget(grid, "status"));
        await userEvent.keyboard("{ArrowRight}");
        expect(focused(grid)).toBe(headerTarget(grid, "name"));
    });

    it.each(["cell", "row"] as const)("sorts with Enter and Space on a header in %s mode", async focusMode => {
        const grid = await renderBetweenButtons(focusMode);
        const sorts: unknown[] = [];
        grid.addEventListener("sort-change", event => sorts.push((event as CustomEvent).detail));
        headerTarget(grid, "name").focus();
        await userEvent.keyboard("{ArrowRight}");

        await userEvent.keyboard("{Enter}");
        await nextFrame();
        expect(header(grid, "status").getAttribute("aria-sort")).toBe("ascending");
        expect(focused(grid)).toBe(headerTarget(grid, "status"));

        await userEvent.keyboard(" ");
        await nextFrame();
        expect(header(grid, "status").getAttribute("aria-sort")).toBe("descending");
        expect(header(grid, "name").getAttribute("aria-sort")).toBe("none");
        expect(sorts).toEqual([
            { columnId: "status", direction: "ascending" },
            { columnId: "status", direction: "descending" },
        ]);
        expect(focused(grid)).toBe(headerTarget(grid, "status"));
    });

    it("moves from the first row to the active column's header and back in cell mode", async () => {
        const grid = await renderBetweenButtons("cell");
        const activeCells: unknown[] = [];
        (document.getElementById("before") as HTMLButtonElement).focus();
        await userEvent.tab();
        expect(focused(grid)).toBe(scroller(grid));
        await userEvent.keyboard("{ArrowRight}{ArrowRight}");
        expect(grid.activeCell).toEqual({ rowId: "a", columnId: "bed" });
        grid.addEventListener("active-cell-change", event => activeCells.push((event as CustomEvent).detail));

        await userEvent.keyboard("{ArrowUp}");
        expect(focused(grid)).toBe(header(grid, "bed"));
        expect(grid.activeCell).toEqual({ rowId: "a", columnId: "bed" });

        await userEvent.keyboard("{ArrowRight}{ArrowDown}");
        expect(focused(grid)).toBe(scroller(grid));
        expect(grid.activeCell).toEqual({ rowId: "a", columnId: "zone" });
        await nextFrame();
        expect(
            grid.shadowRoot?.querySelector('[part~="active-cell"]')?.matches('td[data-row-id="a"][data-column-id="zone"]'),
        ).toBe(true);
        expect(activeCells).toEqual([{ rowId: "a", columnId: "zone" }]);

        await userEvent.keyboard("{ArrowDown}{ArrowUp}");
        expect(focused(grid)).toBe(scroller(grid));
        expect(grid.activeCell).toEqual({ rowId: "a", columnId: "zone" });
    });

    it("returns Shift+Tab from a header to the active cell in cell mode", async () => {
        const grid = await renderBetweenButtons("cell");
        scroller(grid).focus();
        await userEvent.keyboard("{ArrowUp}");
        expect(focused(grid)).toBe(headerTarget(grid, "name"));

        await userEvent.tab({ shift: true });
        expect(focused(grid)).toBe(scroller(grid));
        expect(grid.activeCell).toEqual({ rowId: "a", columnId: "name" });

        await userEvent.tab({ shift: true });
        expect(document.activeElement?.id).toBe("before");
    });

    it.each(["cell", "row"] as const)(
        "reaches a non-sortable column's resizer from its header with Ctrl+Alt+R in %s mode",
        async focusMode => {
            const grid = await renderBetweenButtons(focusMode);
            const widths: string[] = [];
            grid.addEventListener("column-width-change", event => {
                widths.push((event as CustomEvent<{ columnId: string }>).detail.columnId);
            });
            const resizer = grid.shadowRoot!.querySelector<HTMLButtonElement>('[data-column-resizer="bed"]')!;
            headerTarget(grid, "name").focus();
            await userEvent.keyboard("{ArrowRight}{ArrowRight}");
            expect(focused(grid)).toBe(header(grid, "bed"));

            await userEvent.keyboard(resizeChord);
            expect(focused(grid)).toBe(resizer);

            await userEvent.keyboard("{ArrowRight}");
            expect(widths).toEqual(["bed"]);
            await userEvent.keyboard("{Escape}");
            expect(focused(grid)).toBe(header(grid, "bed"));
        },
    );
});
