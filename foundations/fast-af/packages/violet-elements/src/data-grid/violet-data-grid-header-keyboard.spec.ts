import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-data-grid.define";
import type { VioletDataGrid } from "./violet-data-grid";

const resizeChord = "{Control>}{Alt>}r{/Alt}{/Control}";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function renderBetweenButtons(
  focusMode: "cell" | "row",
  dir?: string,
): Promise<VioletDataGrid> {
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
  return document.activeElement === grid
    ? (grid.shadowRoot?.activeElement ?? null)
    : document.activeElement;
}

function header(grid: VioletDataGrid, columnId: string): HTMLTableCellElement {
  const cell = grid.shadowRoot?.querySelector<HTMLTableCellElement>(
    `th[data-column-id="${columnId}"]`,
  );
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

function cell(grid: VioletDataGrid, rowId: string, columnId: string): HTMLTableCellElement {
  const target = grid.shadowRoot?.querySelector<HTMLTableCellElement>(
    `td[data-row-id="${rowId}"][data-column-id="${columnId}"]`,
  );
  if (!target) {
    throw new Error(`Expected a cell for ${rowId}/${columnId}.`);
  }
  return target;
}

function selectionCell(grid: VioletDataGrid, rowId: string): HTMLTableCellElement {
  const target = grid.shadowRoot?.querySelector<HTMLTableCellElement>(
    `td.selection-cell[data-selection-row-id="${rowId}"]`,
  );
  if (!target) {
    throw new Error(`Expected a selection cell for ${rowId}.`);
  }
  return target;
}

function selectAllCheckbox(grid: VioletDataGrid): HTMLElement {
  const target = grid.shadowRoot?.querySelector<HTMLElement>(
    "th.selection-header violet-checkbox.selection-checkbox",
  );
  if (!target) {
    throw new Error("Expected a select-all checkbox.");
  }
  return target;
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
    expect(forward).toEqual([cell(grid, "a", "name"), document.getElementById("after")]);
    expect(forward.filter(isHeaderStop)).toEqual([]);

    const backward = await tabStops(grid, true);
    expect(backward).toEqual([cell(grid, "a", "name"), document.getElementById("before")]);
    expect(backward.filter(isHeaderStop)).toEqual([]);
  });

  it("preserves cell focus across a queued row splice after same-frame refocus (#2383)", async () => {
    const grid = await renderBetweenButtons("cell");
    const after = document.getElementById("after") as HTMLButtonElement;
    const firstCell = cell(grid, "a", "name");

    // Focusing an inactive cell queues renderedRows.splice + recheckCellFocusAfterRender.
    // Leaving and returning to the cell before the frame flushes must keep focus on the cell.
    firstCell.focus();
    after.focus();
    firstCell.focus();

    await nextFrame();
    await nextFrame();

    expect(focused(grid)).toBe(cell(grid, "a", "name"));

    // Intentional departure to an outside control before the frame flushes must not be stolen back.
    cell(grid, "b", "name").focus();
    after.focus();

    await nextFrame();
    await nextFrame();

    expect(document.activeElement).toBe(after);
  });

  it("adds one roving header Tab stop in row mode, in either direction", async () => {
    const grid = await renderBetweenButtons("row");

    const forward = await tabStops(grid);
    expect(forward.map((stop) => stop.id || stop.className)).toEqual(["header-button", "after"]);
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
    await nextFrame();

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

  it.each(["cell", "row"] as const)(
    "sorts with Enter and Space on a header in %s mode",
    async (focusMode) => {
      const grid = await renderBetweenButtons(focusMode);
      const sorts: unknown[] = [];
      grid.addEventListener("sort-change", (event) => sorts.push((event as CustomEvent).detail));
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
    },
  );

  it("moves from the first row to the active column's header and back in cell mode", async () => {
    const grid = await renderBetweenButtons("cell");
    const activeCells: unknown[] = [];
    (document.getElementById("before") as HTMLButtonElement).focus();
    await userEvent.tab();
    expect(focused(grid)).toBe(cell(grid, "a", "name"));
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(grid.activeCell).toEqual({ rowId: "a", columnId: "bed" });
    expect(focused(grid)).toBe(cell(grid, "a", "bed"));
    grid.addEventListener("active-cell-change", (event) =>
      activeCells.push((event as CustomEvent).detail),
    );

    await userEvent.keyboard("{ArrowUp}");
    expect(focused(grid)).toBe(header(grid, "bed"));
    expect(grid.activeCell).toEqual({ rowId: "a", columnId: "bed" });

    await userEvent.keyboard("{ArrowRight}{ArrowDown}");
    expect(focused(grid)).toBe(cell(grid, "a", "zone"));
    expect(grid.activeCell).toEqual({ rowId: "a", columnId: "zone" });
    await nextFrame();
    expect(
      grid.shadowRoot
        ?.querySelector('[part~="active-cell"]')
        ?.matches('td[data-row-id="a"][data-column-id="zone"]'),
    ).toBe(true);
    expect(activeCells).toEqual([{ rowId: "a", columnId: "zone" }]);

    await userEvent.keyboard("{ArrowDown}{ArrowUp}");
    expect(focused(grid)).toBe(cell(grid, "a", "zone"));
    expect(grid.activeCell).toEqual({ rowId: "a", columnId: "zone" });
  });

  it("returns Shift+Tab from a header to the active cell in cell mode", async () => {
    const grid = await renderBetweenButtons("cell");
    cell(grid, "a", "name").focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(focused(grid)).toBe(headerTarget(grid, "name"));

    await userEvent.tab({ shift: true });
    expect(focused(grid)).toBe(cell(grid, "a", "name"));
    expect(grid.activeCell).toEqual({ rowId: "a", columnId: "name" });

    await userEvent.tab({ shift: true });
    expect(document.activeElement?.id).toBe("before");
  });

  it.each(["cell", "row"] as const)(
    "reaches a non-sortable column's resizer from its header with Ctrl+Alt+R in %s mode",
    async (focusMode) => {
      const grid = await renderBetweenButtons(focusMode);
      const widths: string[] = [];
      grid.addEventListener("column-width-change", (event) => {
        widths.push((event as CustomEvent<{ columnId: string }>).detail.columnId);
      });
      const resizer = grid.shadowRoot!.querySelector<HTMLButtonElement>(
        '[data-column-resizer="bed"]',
      )!;
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

describe("violet-data-grid role=grid and roving focus (#510)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function renderInteractiveGrid(options: {
    focusMode: "cell" | "row";
    selectionMode?: "none" | "single" | "multiple";
    rowCount?: number;
    virtualize?: boolean;
    height?: number;
  }): Promise<VioletDataGrid> {
    document.body.innerHTML = `<button id="before" type="button">Before</button>`;
    const grid = document.createElement("violet-data-grid") as VioletDataGrid;
    grid.setAttribute("aria-label", "Nursery inventory");
    const target = grid as unknown as Record<string, unknown>;
    target.columns = [
      {
        id: "name",
        label: "Name",
        width: "160px",
        sortable: true,
        editable: true,
        describe: (row: { name: string; active: boolean }) =>
          row.active ? "in active propagation" : undefined,
      },
      { id: "bed", label: "Bed", width: "120px", editable: true },
      { id: "active", label: "Active", width: "100px", editable: true, editor: "checkbox" },
    ];
    const count = options.rowCount ?? 5;
    target.rows = Array.from({ length: count }, (_, index) => ({
      id: `row-${index}`,
      label: `Plant ${index}`,
      data: { name: `Plant ${index}`, bed: `Bed ${index}`, active: index % 2 === 0 },
    }));
    target.focusMode = options.focusMode;
    target.selectionMode = options.selectionMode ?? "multiple";
    target.virtualize = options.virtualize ?? false;
    if (options.height) {
      grid.style.display = "block";
      grid.style.height = `${options.height}px`;
      grid.style.setProperty(
        "--violet-data-grid-virtualized-max-block-size",
        `${options.height}px`,
      );
    }
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

  it("exposes role=grid, gridcell, aria-multiselectable, aria-colindex and cell aria-selected in cell mode while keeping native table semantics in row mode", async () => {
    const cellGrid = await renderInteractiveGrid({
      focusMode: "cell",
      selectionMode: "multiple",
      rowCount: 3,
    });
    const table = cellGrid.shadowRoot!.querySelector("table")!;
    expect(table.getAttribute("role")).toBe("grid");
    expect(table.getAttribute("aria-multiselectable")).toBe("true");
    expect(table.getAttribute("aria-label")).toBe("Nursery inventory");
    expect(table.getAttribute("aria-rowcount")).toBe("4");
    expect(table.getAttribute("aria-colcount")).toBe("4");
    expect(scroller(cellGrid).hasAttribute("role")).toBe(false);
    expect(scroller(cellGrid).hasAttribute("aria-label")).toBe(false);
    expect(scroller(cellGrid).hasAttribute("aria-describedby")).toBe(false);
    expect(scroller(cellGrid).hasAttribute("aria-keyshortcuts")).toBe(false);

    expect(
      cellGrid.shadowRoot!.querySelector("th.selection-header")?.getAttribute("aria-colindex"),
    ).toBe("1");
    expect(header(cellGrid, "name").getAttribute("aria-colindex")).toBe("2");
    expect(header(cellGrid, "bed").getAttribute("aria-colindex")).toBe("3");
    expect(header(cellGrid, "active").getAttribute("aria-colindex")).toBe("4");

    expect(selectionCell(cellGrid, "row-0").getAttribute("role")).toBe("gridcell");
    expect(selectionCell(cellGrid, "row-0").getAttribute("aria-colindex")).toBe("1");
    expect(cell(cellGrid, "row-0", "name").getAttribute("role")).toBe("gridcell");
    expect(cell(cellGrid, "row-0", "name").getAttribute("aria-colindex")).toBe("2");
    expect(cell(cellGrid, "row-0", "name").getAttribute("tabindex")).toBe("0");
    expect(cell(cellGrid, "row-0", "bed").getAttribute("tabindex")).toBe("-1");
    expect(scroller(cellGrid).getAttribute("tabindex")).toBe("-1");

    // Range selection sets aria-selected on gridcells; row selection keeps aria-selected on tr.
    cell(cellGrid, "row-0", "name").focus();
    await nextFrame();
    expect(cell(cellGrid, "row-0", "name").getAttribute("aria-describedby")).toBe(
      cellGrid.activeCellDescribeId,
    );
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await nextFrame();
    expect(cell(cellGrid, "row-0", "name").getAttribute("aria-selected")).toBe("true");
    expect(cell(cellGrid, "row-0", "bed").getAttribute("aria-selected")).toBe("true");
    expect(cell(cellGrid, "row-0", "active").getAttribute("aria-selected")).toBe("false");
    expect(
      cellGrid.shadowRoot!.querySelector('tr[data-row-index="0"]')?.getAttribute("aria-selected"),
    ).toBe("false");

    const rowGrid = await renderInteractiveGrid({
      focusMode: "row",
      selectionMode: "multiple",
      rowCount: 3,
    });
    const rowTable = rowGrid.shadowRoot!.querySelector("table")!;
    expect(rowTable.hasAttribute("role")).toBe(false);
    expect(rowTable.hasAttribute("aria-multiselectable")).toBe(false);
    expect(rowTable.getAttribute("aria-label")).toBe("Nursery inventory");
    expect(cell(rowGrid, "row-0", "name").hasAttribute("role")).toBe(false);
    expect(cell(rowGrid, "row-0", "name").hasAttribute("tabindex")).toBe(false);
    expect(cell(rowGrid, "row-0", "name").getAttribute("aria-colindex")).toBe("2");
  });

  it("adds one table Tab stop in cell mode with selection and checkbox columns regardless of row count", async () => {
    const grid = await renderInteractiveGrid({
      focusMode: "cell",
      selectionMode: "multiple",
      rowCount: 8,
    });
    // Verify every checkbox cell widget has tabindex="-1" in cell mode.
    for (const checkbox of grid.shadowRoot!.querySelectorAll("violet-checkbox.cell-checkbox")) {
      expect(checkbox.getAttribute("tabindex")).toBe("-1");
    }

    const stops = await tabStops(grid);
    const tableStops = stops.filter(
      (stop) => !stop.classList.contains("fill-action") && stop.id !== "after",
    );
    expect(tableStops).toEqual([cell(grid, "row-0", "name")]);
    expect(stops.at(-1)?.id).toBe("after");
  });

  it("adds at most one header Tab stop and one body Tab stop in row mode with selection and checkbox columns", async () => {
    const grid = await renderInteractiveGrid({
      focusMode: "row",
      selectionMode: "multiple",
      rowCount: 8,
    });

    const forward = await tabStops(grid);
    expect(forward).toHaveLength(3);
    expect(forward[0]).toBe(headerTarget(grid, "name"));
    expect(forward[1]).toBe(
      selectionCell(grid, "row-0").querySelector("violet-checkbox.selection-checkbox"),
    );
    expect(forward[2]?.id).toBe("after");

    // Single-selection mode also keeps one header stop and one body stop.
    const singleGrid = await renderInteractiveGrid({
      focusMode: "row",
      selectionMode: "single",
      rowCount: 6,
    });
    const singleForward = await tabStops(singleGrid);
    expect(singleForward).toHaveLength(3);
    expect(singleForward[0]).toBe(headerTarget(singleGrid, "name"));
    expect(singleForward[1]).toBe(
      selectionCell(singleGrid, "row-0").querySelector("violet-radio.selection-radio"),
    );
    expect(singleForward[2]?.id).toBe("after");
  });

  it("reaches selection cells, checkbox cells and select-all with arrows and toggles them with Space", async () => {
    const grid = await renderInteractiveGrid({
      focusMode: "cell",
      selectionMode: "multiple",
      rowCount: 3,
    });
    const cellChanges: unknown[] = [];
    grid.addEventListener("cell-change", (event) =>
      cellChanges.push((event as CustomEvent).detail),
    );

    // Enter grid at (row-0, name), move left into row-0 selection cell and toggle with Space.
    cell(grid, "row-0", "name").focus();
    await nextFrame();
    await userEvent.keyboard("{ArrowLeft}");
    expect(focused(grid)).toBe(selectionCell(grid, "row-0"));
    // activeCell keeps a real data column rather than exposing a synthetic selection column id.
    expect(grid.activeCell).toEqual({ rowId: "row-0", columnId: "name" });
    await userEvent.keyboard(" ");
    await nextFrame();
    expect(grid.selectedRowIds).toEqual(["row-0"]);

    // Move up from row-0 selection cell to the select-all checkbox and toggle all rows with Space.
    await userEvent.keyboard("{ArrowUp}");
    expect(focused(grid)).toBe(selectAllCheckbox(grid));
    await userEvent.keyboard(" ");
    await nextFrame();
    expect(grid.selectedRowIds).toEqual(["row-0", "row-1", "row-2"]);

    // Return down to selection column, move right to the checkbox cell and toggle it with Space.
    await userEvent.keyboard("{ArrowDown}{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(focused(grid)).toBe(cell(grid, "row-0", "active"));
    expect(grid.activeCell).toEqual({ rowId: "row-0", columnId: "active" });
    await userEvent.keyboard(" ");
    await nextFrame();
    expect(cellChanges).toEqual([{ rowId: "row-0", columnId: "active", value: false }]);
  });

  it("moves focus into editors on Enter/F2 and returns focus to the td on commit, cancel and Tab-move", async () => {
    const grid = await renderInteractiveGrid({
      focusMode: "cell",
      selectionMode: "none",
      rowCount: 3,
    });
    cell(grid, "row-0", "name").focus();
    await nextFrame();

    await userEvent.keyboard("{Enter}");
    await nextFrame();
    const editor = grid.shadowRoot!.querySelector<HTMLInputElement>(".cell-editor");
    expect(editor).not.toBeNull();
    expect(focused(grid)).toBe(editor);

    await userEvent.keyboard("{Escape}");
    await nextFrame();
    expect(grid.editingCell).toBeNull();
    expect(focused(grid)).toBe(cell(grid, "row-0", "name"));

    await userEvent.keyboard("{F2}");
    await nextFrame();
    expect(grid.editingCell).toEqual({ rowId: "row-0", columnId: "name" });
    await userEvent.keyboard("{Enter}");
    await nextFrame();
    expect(grid.editingCell).toBeNull();
    expect(focused(grid)).toBe(cell(grid, "row-0", "name"));

    await userEvent.keyboard("{Enter}");
    await nextFrame();
    await userEvent.keyboard("{Tab}");
    await nextFrame();
    expect(grid.editingCell).toBeNull();
    expect(grid.activeCell).toEqual({ rowId: "row-0", columnId: "bed" });
    expect(focused(grid)).toBe(cell(grid, "row-0", "bed"));
  });

  it("falls back to .table-scroll as the single Tab stop when the active virtualized row unmounts and restores td focus on re-entry", async () => {
    const grid = await renderInteractiveGrid({
      focusMode: "cell",
      selectionMode: "none",
      rowCount: 60,
      virtualize: true,
      height: 160,
    });
    const scroll = scroller(grid);

    cell(grid, "row-0", "name").focus();
    await nextFrame();
    expect(scroll.getAttribute("tabindex")).toBe("-1");
    expect(focused(grid)).toBe(cell(grid, "row-0", "name"));

    // Scroll row-0 out of the virtual window.
    scroll.scrollTop = 1_200;
    scroll.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => {
      expect(grid.shadowRoot!.querySelector('td[data-row-id="row-0"]')).toBeNull();
      expect(scroll.getAttribute("tabindex")).toBe("0");
      // Focus is never left on a detached td.
      expect(focused(grid)).toBe(scroll);
    });

    // Tab away and back into the grid: focusing .table-scroll scrolls row-0 back and focuses its td.
    (document.getElementById("before") as HTMLButtonElement).focus();
    for (let step = 0; step < 4; step += 1) {
      await userEvent.tab();
      if (!focused(grid)?.classList.contains("fill-action")) {
        break;
      }
    }
    await vi.waitFor(() => {
      const restoredCell = cell(grid, "row-0", "name");
      expect(focused(grid)).toBe(restoredCell);
      expect(restoredCell.getAttribute("tabindex")).toBe("0");
      expect(scroll.getAttribute("tabindex")).toBe("-1");
    });
  });

  it("leaves the grid on forward Tab from a column header or select-all header in cell mode", async () => {
    const grid = await renderInteractiveGrid({
      focusMode: "cell",
      selectionMode: "multiple",
      rowCount: 3,
    });

    cell(grid, "row-0", "name").focus();
    await nextFrame();
    await userEvent.keyboard("{ArrowUp}");
    expect(focused(grid)).toBe(headerTarget(grid, "name"));

    await userEvent.tab();
    expect(document.activeElement?.id).toBe("after");

    // Also test forward Tab from select-all header in cell mode.
    cell(grid, "row-0", "name").focus();
    await nextFrame();
    await userEvent.keyboard("{ArrowLeft}{ArrowUp}");
    expect(focused(grid)).toBe(selectAllCheckbox(grid));

    await userEvent.tab();
    expect(document.activeElement?.id).toBe("after");
  });

  it("handles Option+Tab (altKey) on headers and custom cell widgets for macOS Safari full-keyboard navigation", async () => {
    const grid = await renderInteractiveGrid({
      focusMode: "cell",
      selectionMode: "multiple",
      rowCount: 2,
    });

    const activeCell = cell(grid, "row-0", "name");
    activeCell.focus();
    await nextFrame();
    await userEvent.keyboard("{ArrowUp}");
    const columnHeader = headerTarget(grid, "name");
    expect(focused(grid)).toBe(columnHeader);

    const headerBack = new KeyboardEvent("keydown", {
      key: "Tab",
      altKey: true,
      shiftKey: true,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    columnHeader.dispatchEvent(headerBack);
    expect(headerBack.defaultPrevented).toBe(true);
    expect(focused(grid)).toBe(activeCell);

    await userEvent.keyboard("{ArrowLeft}{ArrowUp}");
    const selectAll = selectAllCheckbox(grid);
    expect(focused(grid)).toBe(selectAll);
    const selectAllBack = new KeyboardEvent("keydown", {
      key: "Tab",
      altKey: true,
      shiftKey: true,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    selectAll.dispatchEvent(selectAllBack);
    expect(selectAllBack.defaultPrevented).toBe(true);
    expect(focused(grid)).toBe(selectionCell(grid, "row-0"));

    // Forward Option+Tab from a column header suspends the body roving Tab stop so focus leaves the grid.
    activeCell.focus();
    await nextFrame();
    await userEvent.keyboard("{ArrowUp}");
    expect(focused(grid)).toBe(columnHeader);
    const headerForward = new KeyboardEvent("keydown", {
      key: "Tab",
      altKey: true,
      shiftKey: false,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    columnHeader.dispatchEvent(headerForward);
    expect(headerForward.defaultPrevented).toBe(false);
    expect(activeCell.getAttribute("tabindex")).toBe("-1");
    await nextFrame();
    expect(activeCell.getAttribute("tabindex")).toBe("0");
  });

  it("does not copy or paste into a data cell while a selection cell has focus", async () => {
    const grid = await renderInteractiveGrid({
      focusMode: "cell",
      selectionMode: "multiple",
      rowCount: 3,
    });
    const pastes: unknown[] = [];
    const copies: unknown[] = [];
    grid.addEventListener("cell-paste", (event) => pastes.push((event as CustomEvent).detail));
    grid.addEventListener("cell-copy", (event) => copies.push((event as CustomEvent).detail));

    cell(grid, "row-0", "name").focus();
    await nextFrame();
    await userEvent.keyboard("{ArrowLeft}{ArrowDown}");
    expect(focused(grid)).toBe(selectionCell(grid, "row-1"));

    const pasteData = new DataTransfer();
    pasteData.setData("text/plain", "Overwritten");
    selectionCell(grid, "row-1").dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: pasteData,
      }),
    );
    const copyData = new DataTransfer();
    selectionCell(grid, "row-1").dispatchEvent(
      new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: copyData,
      }),
    );
    await nextFrame();

    expect(pastes).toEqual([]);
    expect(copies).toEqual([]);
    expect(copyData.getData("text/plain")).toBe("");
  });

  it("keeps a single Tab stop and keyboard access for custom cell widgets in cell mode", async () => {
    const { html } = await import("@lushly-dev/fast-element");
    await import("../button/violet-button.define");
    document.body.innerHTML = `<button id="before" type="button">Before</button>`;
    const grid = document.createElement("violet-data-grid") as VioletDataGrid;
    const target = grid as unknown as Record<string, unknown>;
    target.columns = [
      {
        id: "actions",
        label: "Actions",
        width: "220px",
        cellTemplate: html`
                    <button type="button" class="native-act">Open</button>
                    <input type="checkbox" aria-label="Native flag" />
                    <input type="text" aria-label="Native note" />
                `,
      },
      {
        id: "details",
        label: "Details",
        width: "160px",
        cellTemplate: html`<violet-button data-cell-widget="action">Inspect</violet-button>`,
      },
    ];
    target.rows = [
      { id: "r0", label: "Row 0", data: { actions: "", details: "" } },
      { id: "r1", label: "Row 1", data: { actions: "", details: "" } },
    ];
    target.focusMode = "cell";
    target.selectionMode = "none";
    document.body.append(grid);
    const after = document.createElement("button");
    after.id = "after";
    after.type = "button";
    after.textContent = "After";
    document.body.append(after);
    await customElements.whenDefined("violet-data-grid");
    await nextFrame();
    await nextFrame();

    const stops = await tabStops(grid);
    expect(stops).toEqual([cell(grid, "r0", "actions"), after]);

    // Enter focuses the first widget inside the cell; Tab cycles widgets within the cell; Escape returns to td.
    cell(grid, "r0", "actions").focus();
    await nextFrame();
    await userEvent.keyboard("{Enter}");
    const firstButton = cell(grid, "r0", "actions").querySelector("button.native-act");
    const checkbox = cell(grid, "r0", "actions").querySelector('input[type="checkbox"]');
    const textInput = cell(grid, "r0", "actions").querySelector('input[type="text"]');
    expect(focused(grid)).toBe(firstButton);

    await userEvent.tab();
    expect(focused(grid)).toBe(checkbox);
    await userEvent.tab();
    expect(focused(grid)).toBe(textInput);

    // Option+Tab (altKey) also cycles custom cell widgets for macOS Safari navigation.
    const widgetBack = new KeyboardEvent("keydown", {
      key: "Tab",
      altKey: true,
      shiftKey: true,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    textInput?.dispatchEvent(widgetBack);
    expect(widgetBack.defaultPrevented).toBe(true);
    expect(focused(grid)).toBe(checkbox);

    const widgetForward = new KeyboardEvent("keydown", {
      key: "Tab",
      altKey: true,
      shiftKey: false,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    checkbox?.dispatchEvent(widgetForward);
    expect(widgetForward.defaultPrevented).toBe(true);
    expect(focused(grid)).toBe(textInput);

    await userEvent.keyboard("{Escape}");
    expect(focused(grid)).toBe(cell(grid, "r0", "actions"));
  });

  it("keeps a mounted body Tab stop and scrolls on Ctrl+End in a virtualized row-mode grid", async () => {
    const grid = await renderInteractiveGrid({
      focusMode: "row",
      selectionMode: "multiple",
      rowCount: 60,
      virtualize: true,
      height: 160,
    });
    const scroll = scroller(grid);

    // Scroll row-0 out of the virtual window; the mounted body must still provide a Tab stop.
    scroll.scrollTop = 1_200;
    scroll.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => {
      expect(grid.shadowRoot!.querySelector('td[data-row-id="row-0"]')).toBeNull();
      expect(
        grid.shadowRoot!.querySelector('tbody violet-checkbox.selection-checkbox[tabindex="0"]'),
      ).not.toBeNull();
    });

    const stopsAfterScroll = await tabStops(grid);
    expect(stopsAfterScroll).toHaveLength(3);
    expect(stopsAfterScroll[0]).toBe(headerTarget(grid, "name"));
    expect(stopsAfterScroll[1]?.matches("violet-checkbox.selection-checkbox")).toBe(true);
    expect(stopsAfterScroll[2]?.id).toBe("after");

    // Ctrl+End from row-0 scrolls to the final row and focuses its mounted cell control.
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    const firstCheckbox = await vi.waitFor(() => {
      const checkbox = grid.shadowRoot?.querySelector<HTMLElement>(
        'td.selection-cell[data-selection-row-id="row-0"] violet-checkbox.selection-checkbox',
      );
      expect(checkbox).not.toBeNull();
      return checkbox!;
    });
    firstCheckbox.focus();
    await vi.waitFor(() => {
      expect(focused(grid)).toBe(firstCheckbox);
    });

    await userEvent.keyboard("{Control>}{End}{/Control}");
    await vi.waitFor(() => {
      const lastCheckbox = grid.shadowRoot!.querySelector(
        'td[data-row-id="row-59"][data-column-id="active"] violet-checkbox.cell-checkbox',
      );
      expect(lastCheckbox).not.toBeNull();
      expect(focused(grid)).toBe(lastCheckbox);
    });
  });

  it("retains pending row-mode Ctrl+End focus across a two-step virtual scroll unless focus moves elsewhere (#2960)", async () => {
    const grid = await renderInteractiveGrid({
      focusMode: "row",
      selectionMode: "multiple",
      rowCount: 60,
      virtualize: true,
      height: 160,
    });
    const scroll = scroller(grid);
    const firstCheckbox = selectionCell(grid, "row-0").querySelector<HTMLElement>(
      "violet-checkbox.selection-checkbox",
    )!;
    firstCheckbox.focus();
    await vi.waitFor(() => {
      expect(focused(grid)).toBe(firstCheckbox);
    });

    // Force a two-step scroll where row-0 unmounts (causing focus to park on .table-scroll)
    // before row-59 mounts on a later frame, holding any intermediate reconcileScroll retargets.
    const originalScrollTo = scroll.scrollTo.bind(scroll);
    let mode: "end" | "home" | "holding" | "passthrough" = "end";
    let heldTargetTop: number | null = null;
    const releasePendingScroll = (): void => {
      const finalTop = heldTargetTop;
      expect(finalTop).not.toBeNull();
      heldTargetTop = null;
      mode = "passthrough";
      originalScrollTo({ top: finalTop!, behavior: "auto" });
    };
    scroll.scrollTo = ((...args: unknown[]) => {
      const options = args[0];
      if (
        mode !== "passthrough" &&
        args.length === 1 &&
        typeof options === "object" &&
        options !== null &&
        typeof (options as ScrollToOptions).top === "number"
      ) {
        const finalTop = (options as ScrollToOptions).top!;
        heldTargetTop = finalTop;
        if (mode === "end" || mode === "home") {
          const intermediateTop = mode === "end" ? Math.floor(finalTop / 2) : 900;
          mode = "holding";
          originalScrollTo({ top: intermediateTop, behavior: "auto" });
        }
        return;
      }
      return (originalScrollTo as (...forwarded: unknown[]) => void)(...args);
    }) as typeof scroll.scrollTo;

    await userEvent.keyboard("{Control>}{End}{/Control}");
    await vi.waitFor(() => {
      expect(grid.shadowRoot!.querySelector('td[data-row-id="row-0"]')).toBeNull();
      expect(grid.shadowRoot!.querySelector('td[data-row-id="row-59"]')).toBeNull();
      expect(focused(grid)).toBe(scroll);
    });

    releasePendingScroll();
    await vi.waitFor(() => {
      const lastCheckbox = grid.shadowRoot!.querySelector(
        'td[data-row-id="row-59"][data-column-id="active"] violet-checkbox.cell-checkbox',
      );
      expect(lastCheckbox).not.toBeNull();
      expect(focused(grid)).toBe(lastCheckbox);
    });

    // Deliberate in-grid focus move while a multi-step Ctrl+Home scroll is in flight must cancel
    // pending row-mode focus via #focusGeneration (document.activeElement stays on the grid host).
    mode = "home";
    await userEvent.keyboard("{Control>}{Home}{/Control}");
    await vi.waitFor(() => {
      expect(grid.shadowRoot!.querySelector('td[data-row-id="row-59"]')).toBeNull();
      expect(grid.shadowRoot!.querySelector('td[data-row-id="row-0"]')).toBeNull();
      expect(focused(grid)).toBe(scroll);
    });

    const nameHeader = headerTarget(grid, "name");
    nameHeader.focus();
    expect(focused(grid)).toBe(nameHeader);
    releasePendingScroll();
    await vi.waitFor(() => {
      expect(grid.shadowRoot!.querySelector('td[data-row-id="row-0"]')).not.toBeNull();
    });
    await nextFrame();
    expect(focused(grid)).toBe(nameHeader);
  });
});
