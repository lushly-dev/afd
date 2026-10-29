import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-data-grid";
import type {
    VioletDataGrid,
    VioletDataGridChangeDetail,
    VioletDataGridColumn,
    VioletDataGridFillDetail,
    VioletDataGridRow,
} from "./violet-data-grid";

interface Plant {
    name: string;
    bed: string;
    notes: string;
}

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

const columns: VioletDataGridColumn<Plant>[] = [
    { id: "name", label: "Name", width: "140px", editable: true },
    { id: "bed", label: "Bed", width: "120px", editable: true },
    { id: "notes", label: "Notes", width: "120px" },
];

const plants: VioletDataGridRow<Plant>[] = [
    { id: "a", data: { name: "Alder", bed: "North", notes: "" } },
    { id: "b", data: { name: "Birch", bed: "South", notes: "" } },
    { id: "c", data: { name: "Cedar", bed: "East", notes: "" } },
    { id: "d", data: { name: "Dogwood", bed: "West", notes: "" } },
];

function applyChanges(rows: VioletDataGridRow<Plant>[], changes: VioletDataGridChangeDetail[]): VioletDataGridRow<Plant>[] {
    return rows.map(row => {
        const rowChanges = changes.filter(change => change.rowId === row.id);
        if (!rowChanges.length) {
            return row;
        }
        const data = { ...row.data };
        for (const change of rowChanges) {
            (data as Record<string, unknown>)[change.columnId] = change.value;
        }
        return { ...row, data };
    });
}

/** Renders a cell-mode grid and a consumer "Fill down" button that calls `fillSelection`. */
async function renderGrid(): Promise<{ grid: VioletDataGrid; fills: VioletDataGridFillDetail[]; fillDown: HTMLButtonElement }> {
    document.body.innerHTML = `<button id="fill-down" type="button">Fill down</button>`;
    const grid = document.createElement("violet-data-grid") as VioletDataGrid;
    grid.setAttribute("aria-label", "Plants");
    grid.focusMode = "cell";
    grid.virtualize = false;
    (grid as unknown as { columns: VioletDataGridColumn<Plant>[] }).columns = columns;
    (grid as unknown as { rows: VioletDataGridRow<Plant>[] }).rows = plants;
    document.body.append(grid);

    const fills: VioletDataGridFillDetail[] = [];
    grid.addEventListener("cell-fill", event => {
        const detail = (event as CustomEvent<VioletDataGridFillDetail>).detail;
        fills.push(detail);
        const typed = grid as unknown as { rows: VioletDataGridRow<Plant>[] };
        typed.rows = applyChanges(typed.rows, detail.changes);
    });

    const fillDown = document.getElementById("fill-down") as HTMLButtonElement;
    fillDown.addEventListener("click", () => grid.fillSelection("down"));

    await customElements.whenDefined("violet-data-grid");
    await nextFrame();
    await nextFrame();
    return { grid, fills, fillDown };
}

function cell(grid: VioletDataGrid, rowId: string, columnId: string): HTMLTableCellElement {
    const element = grid.shadowRoot?.querySelector<HTMLTableCellElement>(
        `td[data-row-id="${rowId}"][data-column-id="${columnId}"]`,
    );
    if (!element) {
        throw new Error(`Expected cell ${rowId}/${columnId}.`);
    }
    return element;
}

function rowData(grid: VioletDataGrid): Plant[] {
    return (grid as unknown as { rows: VioletDataGridRow<Plant>[] }).rows.map(row => row.data);
}

describe("violet-data-grid fillSelection", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("fills the next row from the active cell with two single clicks and no drag", async () => {
        const { grid, fills, fillDown } = await renderGrid();

        await userEvent.click(cell(grid, "a", "name"));
        await userEvent.click(fillDown);
        await nextFrame();

        expect(fills).toEqual([
            {
                source: { anchor: { rowId: "a", columnId: "name" }, focus: { rowId: "a", columnId: "name" } },
                target: { anchor: { rowId: "a", columnId: "name" }, focus: { rowId: "b", columnId: "name" } },
                changes: [{ rowId: "b", columnId: "name", value: "Alder" }],
            },
        ]);
        expect(rowData(grid).map(plant => plant.name)).toEqual(["Alder", "Alder", "Cedar", "Dogwood"]);
        expect(grid.cellSelection).toEqual({
            anchor: { rowId: "a", columnId: "name" },
            focus: { rowId: "b", columnId: "name" },
        });
    });

    it("emits the same detail as dragging the fill handle over the same range", async () => {
        const dragged = await renderGrid();
        await userEvent.click(cell(dragged.grid, "a", "name"));
        await nextFrame();
        const handle = dragged.grid.shadowRoot?.querySelector<HTMLElement>('[data-fill-handle="true"]');
        expect(handle).toBeTruthy();
        await userEvent.dragAndDrop(handle!, cell(dragged.grid, "c", "name"));
        await nextFrame();
        expect(dragged.fills).toHaveLength(1);
        const dragDetail = dragged.fills[0];

        const filled = await renderGrid();
        await userEvent.click(cell(filled.grid, "a", "name"));
        const returned = filled.grid.fillSelection("down", 2);

        expect(dragDetail?.changes).toHaveLength(2);
        expect(filled.fills).toEqual([dragDetail]);
        expect(returned).toEqual(dragDetail);
        expect(rowData(filled.grid)).toEqual(rowData(dragged.grid));
    });

    it("tiles a multi-cell selection and stops before read-only cells, like a drag", async () => {
        const { grid, fills } = await renderGrid();

        await userEvent.click(cell(grid, "a", "name"));
        await userEvent.click(cell(grid, "b", "name"), { modifiers: ["Shift"] });
        expect(grid.fillSelection("down", 2)?.changes).toEqual([
            { rowId: "c", columnId: "name", value: "Alder" },
            { rowId: "d", columnId: "name", value: "Birch" },
        ]);
        // Let the filled rows render, so the click's generated locator is unique when it resolves.
        await nextFrame();

        await userEvent.click(cell(grid, "a", "name"));
        const right = grid.fillSelection("right", 5);
        expect(right?.target).toEqual({
            anchor: { rowId: "a", columnId: "name" },
            focus: { rowId: "a", columnId: "bed" },
        });
        expect(right?.changes).toEqual([{ rowId: "a", columnId: "bed", value: "Alder" }]);
        expect(fills).toHaveLength(2);
    });

    it("fills nothing without an editable target, an active cell or cell focus mode", async () => {
        const { grid, fills } = await renderGrid();

        expect(grid.fillSelection("down")).toBeNull();

        await userEvent.click(cell(grid, "d", "name"));
        expect(grid.fillSelection("down")).toBeNull();
        expect(grid.fillSelection("down", 0)).toBeNull();

        await userEvent.click(cell(grid, "a", "bed"));
        expect(grid.fillSelection("right")).toBeNull();

        grid.focusMode = "row";
        await nextFrame();
        expect(grid.fillSelection("up")).toBeNull();
        expect(fills).toEqual([]);
    });
});
