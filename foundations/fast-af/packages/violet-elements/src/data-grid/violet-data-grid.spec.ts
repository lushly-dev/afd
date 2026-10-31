import { html, Updates } from "@lushly-dev/fast-element";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-data-grid";
import "../button/violet-button";
import "./violet-data-grid-pill-select";
import type {
  VioletDataGrid,
    VioletDataGridCellLocation,
    VioletDataGridCellTemplateContext,
    VioletDataGridChangeDetail,
    VioletDataGridColumn,
    VioletDataGridEditorOption,
    VioletDataGridFilterState,
    VioletDataGridRow,
    VioletDataGridSort,
} from "./violet-data-grid";
import { sampleAutosizeRows } from "./violet-data-grid-clipboard";

type TestRow = {
    tracked: boolean;
    commonName: string;
    status: string;
    dtm: string;
};

type PillSelectElement = HTMLElement & {
    value?: string;
};

const statusEditorOptions: VioletDataGridEditorOption[] = [
    { label: "Seedling", value: "Seedling", tone: "blue" },
    { label: "In bed", value: "In bed", tone: "teal" },
    { label: "Established", value: "Established", tone: "olive" },
    { label: "Harvesting", value: "Harvesting", tone: "green" },
];

const statusPillEditorTemplate = html<VioletDataGridCellTemplateContext<TestRow>>`
    <violet-data-grid-pill-select
        class="cell-editor"
        data-cell-editor="custom"
        data-commit-on-change="true"
        data-row-id="${(x) => x.rowId}"
        data-column-id="${(x) => x.columnId}"
        control-label="${(x) => `Edit ${x.columnLabel} for ${x.rowLabel}`}"
        error-announcement="external"
        ?invalid="${(x) => Boolean(x.editingError)}"
        error-text="${(x) => x.editingError || null}"
        :value="${(x) => x.editValue ?? x.text}"
        :options="${(x) => x.editorOptions ?? []}"
    ></violet-data-grid-pill-select>
`;

const nativeWidgetCellTemplate = html<VioletDataGridCellTemplateContext<TestRow>>`
    <button type="button"><span><svg aria-hidden="true"><circle cx="4" cy="4" r="3"></circle></svg>Open</span></button>
    <input type="checkbox" aria-label="Native tracked control" />
    <input type="text" aria-label="Native note" />
`;

const shadowWidgetCellTemplate = html<VioletDataGridCellTemplateContext<TestRow>>`
    <violet-button data-cell-widget="action">Open details</violet-button>
`;

const widgetColumns: VioletDataGridColumn<TestRow>[] = [
    {
        id: "tracked",
        label: "Track",
        width: "5rem",
        align: "center",
        editable: true,
        editor: "checkbox",
    value: (row) => row.tracked,
    },
    {
        id: "commonName",
        label: "Plant",
        sortable: true,
        editable: true,
        editor: "text",
    value: (row) => row.commonName,
    },
    {
        id: "status",
        label: "Status",
        editable: true,
        editor: "custom",
    value: (row) => row.status,
        editorTemplate: statusPillEditorTemplate,
        editorOptions: statusEditorOptions,
    },
    {
        id: "dtm",
        label: "DTM",
        editable: true,
        editor: "number",
    value: (row) => row.dtm,
    },
];

const widgetRows: VioletDataGridRow<TestRow>[] = [
    {
        id: "black-currant",
        label: "Black currant",
        data: {
            tracked: true,
            commonName: "Black currant",
            status: "Established",
            dtm: "365",
        },
    },
    {
        id: "romanesco",
        label: "Romanesco cauliflower",
        data: {
            tracked: false,
            commonName: "Romanesco",
            status: "In bed",
            dtm: "80",
        },
    },
];

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}

async function nextFrames(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await nextFrame();
  }
}

async function renderVirtualGrid<RowData>(options: {
  rows: VioletDataGridRow<RowData>[];
  columns: VioletDataGridColumn<RowData>[];
  height?: number;
  focusMode?: "row" | "cell";
  sort?: VioletDataGridSort | null;
}): Promise<VioletDataGrid> {
  document.body.innerHTML = "";
  const grid = document.createElement("violet-data-grid") as VioletDataGrid;
  grid.style.display = "block";
  grid.style.blockSize = `${options.height ?? 640}px`;
  grid.style.setProperty("--violet-data-grid-virtualized-max-block-size", "none");
  grid.columns = options.columns as VioletDataGridColumn[];
  grid.sort = options.sort ?? null;
  grid.sortMode = "local";
  grid.selectionMode = "none";
  grid.focusMode = options.focusMode ?? "row";
  grid.density = "natural";
  grid.estimatedRowHeight = 32;
  grid.overscanCount = 5;
  grid.stickyHeader = true;
  grid.virtualize = true;
  grid.rows = options.rows as VioletDataGridRow[];
  document.body.append(grid);

  await customElements.whenDefined("violet-data-grid");
  await nextFrames(3);
  return grid;
}

async function renderGrid(
    overrides: Partial<{
        rows: VioletDataGridRow<TestRow>[];
        columns: VioletDataGridColumn<TestRow>[];
        sort: VioletDataGridSort | null;
        sortMode: "local" | "external";
        selectionMode: "none" | "single" | "multiple";
  }> = {},
): Promise<VioletDataGrid> {
    document.body.innerHTML = "";

    const grid = document.createElement("violet-data-grid") as VioletDataGrid;
    (grid as any).columns = overrides.columns ?? widgetColumns;
    (grid as any).rows = overrides.rows ?? widgetRows;
    (grid as any).focusMode = "cell";
    (grid as any).selectionMode = overrides.selectionMode ?? "none";
    (grid as any).showFilter = false;
    (grid as any).showToolbarAction = false;
    (grid as any).stickyHeader = true;
    (grid as any).virtualize = false;
    (grid as any).sortMode = overrides.sortMode ?? "local";
    (grid as any).sort = overrides.sort ?? null;
    (grid as any).estimatedRowHeight = 44;
    (grid as any).overscanCount = 5;
    (grid as any).filterState = {};

    document.body.append(grid);

    await customElements.whenDefined("violet-data-grid");
    await customElements.whenDefined("violet-data-grid-pill-select");
    await customElements.whenDefined("violet-radio");
    await nextFrame();

    return grid;
}

async function openRenderedEditor(
  grid: VioletDataGrid,
  rowId: string,
  columnId: string,
): Promise<HTMLInputElement> {
  const cell = grid.shadowRoot?.querySelector(
    `td[data-row-id="${rowId}"][data-column-id="${columnId}"]`,
  ) as HTMLTableCellElement | null;
  if (!cell) throw new Error(`Expected rendered cell ${rowId}/${columnId}.`);
  grid.activeCell = { rowId, columnId };
  await nextFrame();
  const rect = cell.getBoundingClientRect();
  cell.dispatchEvent(
    new MouseEvent("dblclick", {
      bubbles: true,
      composed: true,
      detail: 2,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }),
  );
  await nextFrames(2);
  const editor = grid.shadowRoot?.querySelector(
    `.cell-editor[data-row-id="${rowId}"][data-column-id="${columnId}"]`,
  ) as HTMLInputElement | null;
  if (!editor) throw new Error(`Expected rendered editor ${rowId}/${columnId}.`);
  return editor;
}

describe("violet-data-grid", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    // Regression: the sticky-header rules set `z-index: var(--_layer-raised)`,
    // but the data grid never declared that token. An undefined custom property
    // makes the declaration invalid at computed-value time, so it was dropped
    // and the header fell back to `z-index: auto` — it scrolled behind the rows.
    it("gives the sticky header a stacking context above the rows", async () => {
        const grid = await renderGrid();
        const shadowRoot = grid.shadowRoot;
        if (!shadowRoot) throw new Error("Expected a shadow root.");

        const header =
            shadowRoot.querySelector(".table-head-table") ??
            shadowRoot.querySelector(".table-full-table thead th");
        if (!header) throw new Error("Expected a sticky header element.");

        const headerStyle = getComputedStyle(header as HTMLElement);
        expect(headerStyle.position).toBe("sticky");
        expect(headerStyle.zIndex).not.toBe("auto");
        expect(Number(headerStyle.zIndex)).toBeGreaterThan(0);
    });

    it("keeps column resize targets large and clear of sortable header buttons", async () => {
        const grid = await renderGrid();
        const shadowRoot = grid.shadowRoot;
        if (!shadowRoot) throw new Error("Expected a shadow root.");

        const handles = Array.from(
            shadowRoot.querySelectorAll<HTMLButtonElement>(".column-resizer"),
        );
        expect(handles.length).toBeGreaterThan(0);

        for (const handle of handles) {
            const bounds = handle.getBoundingClientRect();
            const header = handle.closest("th");
            const sortButton = header?.querySelector<HTMLButtonElement>(".header-button");
            const nextSortButton = header?.nextElementSibling?.querySelector<HTMLButtonElement>(
                ".header-button",
            );

            expect(bounds.width).toBeGreaterThanOrEqual(24);
            expect(bounds.height).toBeGreaterThanOrEqual(24);
            expect(handle.getAttribute("aria-label")).toMatch(/^Resize .+ column$/);

            if (sortButton) {
                expect(bounds.left).toBeGreaterThanOrEqual(
                    sortButton.getBoundingClientRect().right,
                );
            }

            if (nextSortButton) {
                expect(bounds.right).toBeLessThanOrEqual(
                    nextSortButton.getBoundingClientRect().left,
                );
            }
        }
    });

    it("enters custom edit mode on double click for widget-backed cells", async () => {
        const grid = await renderGrid();
        const shadowRoot = grid.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;
        const statusCell = shadowRoot?.querySelector(
      'td[data-row-id="black-currant"][data-column-id="status"]',
        ) as HTMLTableCellElement | null;

        expect(scrollContainer).toBeTruthy();
        expect(statusCell).toBeTruthy();

        scrollContainer?.focus();
        grid.activeCell = {
            rowId: "black-currant",
            columnId: "status",
        };
        await nextFrame();

        expect(grid.activeCell?.rowId).toBe("black-currant");
        expect(grid.activeCell?.columnId).toBe("status");

        const doubleClickEvent = new MouseEvent("dblclick", {
            bubbles: true,
            composed: true,
            detail: 2,
        });
        Object.defineProperty(doubleClickEvent, "target", {
            configurable: true,
            value: statusCell,
        });
        (grid as any).locationFromMouseEvent = () => ({
            rowId: "black-currant",
            columnId: "status",
        });

        grid.handleGridDoubleClick(doubleClickEvent);
        await nextFrame();

        expect(grid.editingCell?.rowId).toBe("black-currant");
        expect(grid.editingCell?.columnId).toBe("status");

        const editor = shadowRoot?.querySelector(
      '.cell-editor[data-cell-editor="custom"]',
        ) as PillSelectElement | null;

        expect(editor).toBeTruthy();
        expect(editor?.value).toBe("Established");
    });

    it("toggles a checkbox-backed cell from a widget click event", async () => {
    const rows = widgetRows.map((row) =>
      row.id === "romanesco"
        ? {
            ...row,
            data: { ...row.data, tracked: "false" as unknown as boolean },
          }
        : row,
    );
    const grid = await renderGrid({ rows });
        const shadowRoot = grid.shadowRoot;
        const checkbox = shadowRoot?.querySelector(
      'td[data-row-id="romanesco"][data-column-id="tracked"] violet-checkbox[data-cell-widget="checkbox"]',
        ) as HTMLElement | null;

        expect(checkbox).toBeTruthy();

        const checkboxBox = checkbox?.shadowRoot?.querySelector(".box") as HTMLElement | null;

        expect(checkboxBox).toBeTruthy();
    expect((checkbox as HTMLElement & { checked: boolean }).checked).toBe(false);
    expect(checkbox?.getAttribute("aria-label")).toBe("Track for Romanesco cauliflower");
    expect(checkbox?.shadowRoot?.querySelector("input")?.getAttribute("aria-label")).toBe(
      "Track for Romanesco cauliflower",
    );

        let emittedChange: VioletDataGridChangeDetail | undefined;
        const handleCellChange = (event: Event) => {
            emittedChange = (event as CustomEvent<VioletDataGridChangeDetail>).detail;
        };
        grid.addEventListener("cell-change", handleCellChange);

        try {
      grid.activeCell = { rowId: "romanesco", columnId: "commonName" };
      await nextFrame();
      checkboxBox?.click();
      await nextFrame();

            expect(grid.activeCell).toEqual({
                rowId: "romanesco",
        columnId: "commonName",
            });
            expect(emittedChange).toEqual({
                rowId: "romanesco",
                columnId: "tracked",
                value: true,
            });
        } finally {
            grid.removeEventListener("cell-change", handleCellChange);
        }
    });

    it("names single-selection radios with selection-label and exposes a selection-header-cell part", async () => {
        const grid = await renderGrid();
        (grid as any).selectionMode = "single";
        await nextFrame();

        const radios = () =>
            grid.shadowRoot?.querySelectorAll("violet-radio.selection-radio") as NodeListOf<HTMLElement>;
        expect(radios()[0]?.getAttribute("aria-label")).toBe("Select row Black currant");

        grid.setAttribute("selection-label", "Open");
        await nextFrame();
        expect(radios()[0]?.getAttribute("aria-label")).toBe("Open Black currant");

        grid.removeAttribute("selection-label");
        await nextFrame();
        expect(radios()[0]?.getAttribute("aria-label")).toBe("Select row Black currant");

        const headerCell = grid.shadowRoot?.querySelector("th.selection-header");
        expect(headerCell?.getAttribute("part")?.split(" ")).toEqual(["header-cell", "selection-header-cell"]);
    });

    it("keeps the generic row label for multiple selection even with selection-label", async () => {
        const grid = await renderGrid();
        (grid as any).selectionMode = "multiple";
        grid.setAttribute("selection-label", "Open");
        await nextFrame();

        const rowCheckbox = grid.shadowRoot?.querySelector("tbody violet-checkbox.selection-checkbox");
        expect(rowCheckbox?.getAttribute("aria-label")).toBe("Select row Black currant");
    });

    it("uses violet-radio controls for single row selection", async () => {
        const grid = await renderGrid();
        (grid as any).selectionMode = "single";
        await nextFrame();

        const shadowRoot = grid.shadowRoot;
    const rowRadios = shadowRoot?.querySelectorAll("violet-radio.selection-radio") as
      | NodeListOf<HTMLElement & { checked?: boolean }>
      | undefined;

        expect(rowRadios?.length).toBe(widgetRows.length);

        const firstRadio = rowRadios?.[0];
        const secondRadio = rowRadios?.[1];
        const firstControl = firstRadio?.shadowRoot?.querySelector(".root") as HTMLElement | null;
        const secondControl = secondRadio?.shadowRoot?.querySelector(".root") as HTMLElement | null;

        expect(firstRadio?.getAttribute("aria-label")).toBe("Select row Black currant");
        expect(firstControl).toBeTruthy();
        expect(secondControl).toBeTruthy();

        firstControl?.click();
        await nextFrame();

        expect(grid.selectedRowIds).toEqual(["black-currant"]);
        expect(firstRadio?.checked).toBe(true);
        expect(secondRadio?.checked).toBe(false);

        secondControl?.click();
        await nextFrame();

        expect(grid.selectedRowIds).toEqual(["romanesco"]);
        expect(firstRadio?.checked).toBe(false);
        expect(secondRadio?.checked).toBe(true);
    });

  it.each([
    ["single", "violet-radio.selection-radio"],
    ["multiple", "violet-checkbox.selection-checkbox"],
  ] as const)(
    "retains focused %s row selection controls across same-identity row refreshes",
    async (selectionMode, selector) => {
      const grid = await renderVirtualGrid({
        rows: widgetRows,
        columns: widgetColumns,
        focusMode: "cell",
      });
      grid.selectionMode = selectionMode;
      grid.selectedRowIds = ["romanesco"];
      await nextFrames(2);
      const control = grid.shadowRoot?.querySelector<HTMLElement>(
        `tr:has(td[data-row-id="romanesco"]) ${selector}`,
      );
      if (!control) throw new Error("Expected the Romanesco selection control.");

      control.focus();
      expect(grid.shadowRoot?.activeElement).toBe(control);
      grid.rows = widgetRows.map((row) => ({ ...row, data: { ...row.data } })).reverse();
      grid.selectedRowIds = ["romanesco"];
      await nextFrames(3);

      const refreshedControl = grid.shadowRoot?.querySelector<HTMLElement>(
        `tr:has(td[data-row-id="romanesco"]) ${selector}`,
      );
      expect(refreshedControl).not.toBe(control);
      expect(grid.shadowRoot?.activeElement).toBe(refreshedControl);
    },
  );

  it("restores same-row selection focus within the row render batch", async () => {
    const grid = await renderVirtualGrid({
      rows: widgetRows,
      columns: widgetColumns,
      focusMode: "cell",
    });
    grid.selectionMode = "single";
    grid.selectedRowIds = ["romanesco"];
    await nextFrames(2);
    const radio = grid.shadowRoot?.querySelector<HTMLElement>(
      'tr:has(td[data-row-id="romanesco"]) violet-radio.selection-radio',
    );
    if (!radio) throw new Error("Expected the Romanesco selection radio.");

    radio.focus();
    grid.rows = widgetRows.map((row) => ({ ...row, data: { ...row.data } })).reverse();
    await Updates.next();

    const refreshedRadio = grid.shadowRoot?.querySelector<HTMLElement>(
      'tr:has(td[data-row-id="romanesco"]) violet-radio.selection-radio',
    );
    expect(refreshedRadio).not.toBe(radio);
    expect(grid.shadowRoot?.activeElement).toBe(refreshedRadio);
  });

  it("does not restore a row selection control after the user moves focus", async () => {
    const grid = await renderVirtualGrid({
      rows: widgetRows,
      columns: widgetColumns,
      focusMode: "cell",
    });
    grid.selectionMode = "single";
    grid.selectedRowIds = ["romanesco"];
    await nextFrames(2);
    const radio = grid.shadowRoot?.querySelector<HTMLElement>(
      'tr:has(td[data-row-id="romanesco"]) violet-radio.selection-radio',
    );
    const outside = document.createElement("button");
    document.body.append(outside);
    if (!radio) throw new Error("Expected the Romanesco selection radio.");

    radio.focus();
    grid.rows = widgetRows.map((row) => ({ ...row, data: { ...row.data } })).reverse();
    grid.selectedRowIds = ["romanesco"];
    outside.focus();
    await nextFrames(3);

    expect(document.activeElement).toBe(outside);
  });

  it("does not steal focus moved outside the grid without a focusin", async () => {
    const grid = await renderVirtualGrid({
      rows: widgetRows,
      columns: widgetColumns,
      focusMode: "cell",
    });
    grid.selectionMode = "single";
    grid.selectedRowIds = ["romanesco"];
    await nextFrames(2);
    const radio = grid.shadowRoot?.querySelector<HTMLElement>(
      'tr:has(td[data-row-id="romanesco"]) violet-radio.selection-radio',
    );
    const outside = document.createElement("button");
    document.body.append(outside);
    if (!radio) throw new Error("Expected the Romanesco selection radio.");

    radio.focus();
    grid.rows = widgetRows.map((row) => ({ ...row, data: { ...row.data } })).reverse();
    grid.selectedRowIds = ["romanesco"];
    // A page without system focus moves focus without dispatching focusin.
    const swallowFocusin = (event: Event): void => event.stopImmediatePropagation();
    window.addEventListener("focusin", swallowFocusin, true);
    try {
      outside.focus();
      await nextFrames(3);
    } finally {
      window.removeEventListener("focusin", swallowFocusin, true);
    }

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("does not restore a row selection control after pointer intent without a focus move", async () => {
    const grid = await renderVirtualGrid({
      rows: widgetRows,
      columns: widgetColumns,
      focusMode: "cell",
    });
    grid.selectionMode = "single";
    grid.selectedRowIds = ["romanesco"];
    await nextFrames(2);
    const radio = grid.shadowRoot?.querySelector<HTMLElement>(
      'tr:has(td[data-row-id="romanesco"]) violet-radio.selection-radio',
    );
    const pointerTarget = document.createElement("span");
    document.body.append(pointerTarget);
    if (!radio) throw new Error("Expected the Romanesco selection radio.");

    radio.focus();
    grid.rows = widgetRows.map((row) => ({ ...row, data: { ...row.data } })).reverse();
    pointerTarget.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    await nextFrames(3);

    const refreshedRadio = grid.shadowRoot?.querySelector<HTMLElement>(
      'tr:has(td[data-row-id="romanesco"]) violet-radio.selection-radio',
    );
    expect(grid.shadowRoot?.activeElement).not.toBe(refreshedRadio);
  });

  it("does not steal deliberate focus moved through the grid host", async () => {
    const grid = await renderVirtualGrid({
      rows: widgetRows,
      columns: widgetColumns,
      focusMode: "cell",
    });
    grid.selectionMode = "single";
    await nextFrames(2);
    const radio = grid.shadowRoot?.querySelector<HTMLElement>(
      'tr:has(td[data-row-id="black-currant"]) violet-radio.selection-radio',
    );
    if (!radio) throw new Error("Expected the Black currant selection radio.");

    radio.focus();
    grid.rows = widgetRows.map((row) => ({ ...row, data: { ...row.data } })).reverse();
    radio.blur();
    grid.tabIndex = -1;
    grid.focus();
    const deliberatelyFocused = grid.shadowRoot?.activeElement;
    expect(document.activeElement).toBe(grid);
    expect(deliberatelyFocused).toBe(grid.shadowRoot?.querySelector(".table-scroll"));
    await nextFrames(3);

    expect(document.activeElement).toBe(grid);
    expect(grid.shadowRoot?.activeElement).toBe(deliberatelyFocused);
  });

  it("restores same-row selection focus when the grid is nested in shadow DOM", async () => {
    const grid = await renderVirtualGrid({
      rows: widgetRows,
      columns: widgetColumns,
      focusMode: "cell",
    });
    grid.selectionMode = "single";
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    document.body.append(host);
    root.append(grid);
    await nextFrames(3);
    const radio = grid.shadowRoot?.querySelector<HTMLElement>(
      'tr:has(td[data-row-id="romanesco"]) violet-radio.selection-radio',
    );
    if (!radio) throw new Error("Expected the nested Romanesco selection radio.");

    radio.focus();
    expect(document.activeElement).toBe(host);
    grid.rows = widgetRows.map((row) => ({ ...row, data: { ...row.data } })).reverse();
    await nextFrames(3);

    const refreshedRadio = grid.shadowRoot?.querySelector<HTMLElement>(
      'tr:has(td[data-row-id="romanesco"]) violet-radio.selection-radio',
    );
    expect(document.activeElement).toBe(host);
    expect(grid.shadowRoot?.activeElement).toBe(refreshedRadio);
  });

  it("does not move focus to another selection control when the focused row is removed", async () => {
    const grid = await renderVirtualGrid({
      rows: widgetRows,
      columns: widgetColumns,
      focusMode: "cell",
    });
    grid.selectionMode = "single";
    grid.selectedRowIds = ["romanesco"];
    await nextFrames(2);
    const radio = grid.shadowRoot?.querySelector<HTMLElement>(
      'tr:has(td[data-row-id="romanesco"]) violet-radio.selection-radio',
    );
    if (!radio) throw new Error("Expected the Romanesco selection radio.");

    radio.focus();
    grid.rows = widgetRows.filter((row) => row.id !== "romanesco");
    await nextFrames(3);

    expect(grid.shadowRoot?.activeElement).not.toBe(
      grid.shadowRoot?.querySelector("violet-radio.selection-radio"),
    );
  });

  it("reactively updates the select-all header for row and external selection changes", async () => {
    const grid = await renderGrid({ selectionMode: "multiple" });

    const headerCheckbox = grid.shadowRoot?.querySelector<
      HTMLElement & { checked: boolean; indeterminate: boolean }
    >("th.selection-header violet-checkbox");
    const firstRowCheckbox = grid.shadowRoot?.querySelector<HTMLElement>(
      "tbody tr violet-checkbox.selection-checkbox",
    );
    const firstRowControl = firstRowCheckbox?.shadowRoot?.querySelector<HTMLElement>(".box");
    const firstRowInput = firstRowCheckbox?.shadowRoot?.querySelector<HTMLInputElement>(".input");

    expect(headerCheckbox?.checked).toBe(false);
    expect(headerCheckbox?.indeterminate).toBe(false);
    expect(firstRowCheckbox?.getAttribute("aria-label")).toBe("Select row Black currant");
    expect(firstRowInput?.getAttribute("aria-label")).toBe("Select row Black currant");

    firstRowControl?.click();
    await nextFrame();
    expect(grid.selectedRowIds).toEqual(["black-currant"]);
    expect(headerCheckbox?.checked).toBe(false);
    expect(headerCheckbox?.indeterminate).toBe(true);

    firstRowControl?.click();
    await nextFrame();
    expect(grid.selectedRowIds).toEqual([]);
    expect(headerCheckbox?.checked).toBe(false);
    expect(headerCheckbox?.indeterminate).toBe(false);

    grid.selectedRowIds = widgetRows.map((row) => row.id);
    await nextFrame();
    expect(headerCheckbox?.checked).toBe(true);
    expect(headerCheckbox?.indeterminate).toBe(false);
  });

  it("omits row selection semantics when row selection is disabled", async () => {
    const grid = await renderGrid({ selectionMode: "none" });
    expect(
      grid.shadowRoot
        ?.querySelector<HTMLTableRowElement>("tbody tr")
        ?.hasAttribute("aria-selected"),
    ).toBe(false);
  });

    it("reorders rows locally when sort mode is local", async () => {
    const rows = [widgetRows[1]!, widgetRows[0]!];
        const grid = await renderGrid({
            rows,
            sort: {
                columnId: "commonName",
                direction: "ascending",
            },
            sortMode: "local",
        });

    expect(grid.presentedRows.map((row) => row.id)).toEqual(["black-currant", "romanesco"]);
    });

  it("sorts through source accessors for nested data and reuses their keys", async () => {
    type NestedRow = { profile: { commonName: string } };
    let accessorReads = 0;
    const columns: VioletDataGridColumn<NestedRow>[] = [
      {
        id: "commonName",
        label: "Plant",
        sortable: true,
        value: (row) => {
          accessorReads += 1;
          return row.profile.commonName;
        },
      },
    ];
    const rows: VioletDataGridRow<NestedRow>[] = [
      { id: "tomatillo", data: { profile: { commonName: "Tomatillo" } } },
      { id: "basil", data: { profile: { commonName: "Basil" } } },
      { id: "nigella", data: { profile: { commonName: "Nigella" } } },
    ];
    const grid = await renderVirtualGrid({
      columns,
      rows,
      height: 320,
      sort: { columnId: "commonName", direction: "ascending" },
    });

    expect(grid.presentedRows.map((row) => row.id)).toEqual(["basil", "nigella", "tomatillo"]);
    const readsAfterFirstSort = accessorReads;

    grid.sort = { columnId: "commonName", direction: "descending" };
    await nextFrame();
    expect(grid.presentedRows.map((row) => row.id)).toEqual(["tomatillo", "nigella", "basil"]);
    expect(accessorReads).toBe(readsAfterFirstSort);

    grid.sort = { columnId: "commonName", direction: "ascending" };
    await nextFrame();
    expect(grid.presentedRows.map((row) => row.id)).toEqual(["basil", "nigella", "tomatillo"]);
    expect(accessorReads).toBe(readsAfterFirstSort);
  });

  it("refreshes cells and sort keys when mutable rows or columns are explicitly reassigned", async () => {
    type MutableRow = { primary: string; secondary: string };
    const column: VioletDataGridColumn<MutableRow> = {
      id: "value",
      label: "Value",
      sortable: true,
      value: (row) => row.primary,
    };
    const columns = [column];
    const rows: VioletDataGridRow<MutableRow>[] = [
      { id: "one", data: { primary: "Zebra", secondary: "Zinnia" } },
      { id: "two", data: { primary: "Birch", secondary: "Aster" } },
        ];
    const grid = await renderVirtualGrid({
      columns,
      rows,
      height: 320,
      sort: { columnId: "value", direction: "ascending" },
    });

    expect(grid.presentedRows.map((row) => row.id)).toEqual(["two", "one"]);

    rows[0]!.data.primary = "Alder";
    grid.rows = [...rows];
    await nextFrame();
    expect(grid.presentedRows.map((row) => row.id)).toEqual(["one", "two"]);
    expect(grid.presentedRows[0]?.cells[0]?.text).toBe("Alder");

    column.value = (row) => row.secondary;
    grid.columns = [...columns] as VioletDataGridColumn[];
    await nextFrame();
    expect(grid.presentedRows.map((row) => row.id)).toEqual(["two", "one"]);
    expect(grid.presentedRows[0]?.cells[0]?.text).toBe("Aster");
  });

  it("preserves row order and still emits sort intent when sort mode is external", async () => {
    const rows = [widgetRows[1]!, widgetRows[0]!];
        const grid = await renderGrid({
            rows,
            sortMode: "external",
        });

        let emittedSort: VioletDataGridSort | null | undefined;
        const handleSortChange = (event: Event) => {
            emittedSort = (event as CustomEvent<VioletDataGridSort | null>).detail;
        };

        grid.addEventListener("sort-change", handleSortChange);

        try {
            grid.handleSortRequest("commonName");
            await nextFrame();

            expect(grid.sort).toEqual({
                columnId: "commonName",
                direction: "ascending",
            });
            expect(emittedSort).toEqual({
                columnId: "commonName",
                direction: "ascending",
            });
      expect(grid.presentedRows.map((row) => row.id)).toEqual(["romanesco", "black-currant"]);
        } finally {
            grid.removeEventListener("sort-change", handleSortChange);
        }
    });

    it("clears range-driven state on sort but preserves the active cell and row selection", async () => {
        const grid = await renderGrid();
        const privateGrid = grid as any;

        grid.activeCell = {
            rowId: "black-currant",
            columnId: "status",
        };
        grid.cellSelection = {
            anchor: {
                rowId: "black-currant",
                columnId: "status",
            },
            focus: {
                rowId: "romanesco",
                columnId: "dtm",
            },
        };
        grid.selectedRowIds = ["black-currant"];
        privateGrid.editingCell = {
            rowId: "black-currant",
            columnId: "status",
        };
        privateGrid.fillPreview = {
            anchor: {
                rowId: "black-currant",
                columnId: "status",
            },
            focus: {
                rowId: "romanesco",
                columnId: "dtm",
            },
        };
        await nextFrame();

        grid.sort = {
            columnId: "commonName",
            direction: "ascending",
        };
        await nextFrame();

        expect(grid.activeCell).toEqual({
            rowId: "black-currant",
            columnId: "status",
        });
        expect(grid.selectedRowIds).toEqual(["black-currant"]);
        expect(grid.cellSelection).toBeNull();
        expect(privateGrid.editingCell).toBeNull();
        expect(privateGrid.fillPreview).toBeNull();
    });

    it("keeps row selection by id across sorts and prunes (and announces) ids that leave rows", async () => {
        const grid = await renderGrid({ selectionMode: "multiple" });
        const selectionEvents: string[][] = [];
        grid.addEventListener("selection-change", (event) => {
            selectionEvents.push((event as CustomEvent<{ selectedRowIds: string[] }>).detail.selectedRowIds);
        });

        grid.selectedRowIds = ["black-currant", "romanesco"];
        await nextFrame();
        grid.sort = { columnId: "commonName", direction: "descending" };
        await nextFrame();

        expect(grid.selectedRowIds).toEqual(["black-currant", "romanesco"]);
        expect(selectionEvents).toEqual([]);

        grid.rows = grid.rows.filter((row) => row.id !== "romanesco");
        await nextFrame();

        expect(grid.selectedRowIds).toEqual(["black-currant"]);
        expect(selectionEvents).toEqual([["black-currant"]]);
    });

    it("clears range-driven state on filter input but preserves the active cell and row selection, and emits filter intent", async () => {
        const grid = await renderGrid();
        const privateGrid = grid as any;

        grid.activeCell = {
            rowId: "black-currant",
            columnId: "status",
        };
        grid.cellSelection = {
            anchor: {
                rowId: "black-currant",
                columnId: "status",
            },
            focus: {
                rowId: "romanesco",
                columnId: "dtm",
            },
        };
        grid.selectedRowIds = ["black-currant"];
        privateGrid.editingCell = {
            rowId: "black-currant",
            columnId: "status",
        };
        privateGrid.fillPreview = {
            anchor: {
                rowId: "black-currant",
                columnId: "status",
            },
            focus: {
                rowId: "romanesco",
                columnId: "dtm",
            },
        };

        let emittedFilterState: VioletDataGridFilterState | undefined;
        const handleFilterChange = (event: Event) => {
            emittedFilterState = (event as CustomEvent<VioletDataGridFilterState>).detail;
        };
        grid.addEventListener("filter-change", handleFilterChange);

        try {
            const filterInput = { value: "currant" };
            const inputEvent = new Event("input");
            Object.defineProperty(inputEvent, "currentTarget", {
                configurable: true,
                value: filterInput,
            });

            grid.handleFilterInput(inputEvent);
            await nextFrame();

            expect(grid.activeCell).toEqual({
                rowId: "black-currant",
                columnId: "status",
            });
            expect(grid.filterState).toEqual({ query: "currant" });
            expect(emittedFilterState).toEqual({ query: "currant" });
            expect(grid.selectedRowIds).toEqual(["black-currant"]);
            expect(grid.cellSelection).toBeNull();
            expect(privateGrid.editingCell).toBeNull();
            expect(privateGrid.fillPreview).toBeNull();
        } finally {
            grid.removeEventListener("filter-change", handleFilterChange);
        }
    });

    it("skips locked cells when mapping pasted text across a selected range", async () => {
        const columns: VioletDataGridColumn<TestRow>[] = [
            {
                id: "commonName",
                label: "Plant",
                editable: true,
                editor: "text",
        value: (row) => row.commonName,
            },
            {
                id: "status",
                label: "Status",
        value: (row) => row.status,
            },
            {
                id: "dtm",
                label: "DTM",
                editable: true,
                editor: "number",
        value: (row) => row.dtm,
            },
        ];
        const grid = await renderGrid({ columns });
        const privateGrid = grid as any;

        grid.activeCell = {
            rowId: "black-currant",
            columnId: "commonName",
        };
        grid.cellSelection = {
            anchor: {
                rowId: "black-currant",
                columnId: "commonName",
            },
            focus: {
                rowId: "romanesco",
                columnId: "dtm",
            },
        };
        await nextFrame();

    const detail = privateGrid.pasteDetailForText(
      "Gooseberry\tLocked\t120\nRomanesco\tLocked too\t81",
    );

        expect(detail).not.toBeNull();
        expect(detail?.origin).toEqual({
            rowId: "black-currant",
            columnId: "commonName",
        });
        expect(detail?.changes).toEqual([
            {
                rowId: "black-currant",
                columnId: "commonName",
                value: "Gooseberry",
            },
            {
                rowId: "black-currant",
                columnId: "dtm",
                value: 120,
            },
            {
                rowId: "romanesco",
                columnId: "commonName",
                value: "Romanesco",
            },
            {
                rowId: "romanesco",
                columnId: "dtm",
                value: 81,
            },
        ]);
    });

    it("emits a boolean cell-change when a checkbox-backed cell toggles", async () => {
        const grid = await renderGrid();
        const privateGrid = grid as any;

        let emittedChange: VioletDataGridChangeDetail | undefined;
        const handleCellChange = (event: Event) => {
            emittedChange = (event as CustomEvent<VioletDataGridChangeDetail>).detail;
        };
        grid.addEventListener("cell-change", handleCellChange);

        try {
            privateGrid.commitCheckboxCellToggle(
                {
                    rowId: "romanesco",
                    columnId: "tracked",
                },
        true,
            );

            expect(emittedChange).toEqual({
                rowId: "romanesco",
                columnId: "tracked",
                value: true,
            });
        } finally {
            grid.removeEventListener("cell-change", handleCellChange);
        }
    });

    it("serializes the active cell for copy when no range is selected", async () => {
        const grid = await renderGrid();
        const privateGrid = grid as any;

        grid.activeCell = {
            rowId: "black-currant",
            columnId: "status",
        };
        await nextFrame();

        expect(privateGrid.copyDetailForCurrentSelection()).toEqual({
            cells: [
                {
                    rowId: "black-currant",
                    columnId: "status",
                },
            ],
            text: "Established",
        });
    });

    it("serializes a rectangular selection as TSV for copy", async () => {
        const grid = await renderGrid();
        const privateGrid = grid as any;

        grid.activeCell = {
            rowId: "black-currant",
            columnId: "commonName",
        };
        grid.cellSelection = {
            anchor: {
                rowId: "black-currant",
                columnId: "commonName",
            },
            focus: {
                rowId: "romanesco",
                columnId: "status",
            },
        };
        await nextFrame();

        expect(privateGrid.copyDetailForCurrentSelection()).toEqual({
            cells: [
                { rowId: "black-currant", columnId: "commonName" },
                { rowId: "black-currant", columnId: "status" },
                { rowId: "romanesco", columnId: "commonName" },
                { rowId: "romanesco", columnId: "status" },
            ],
            text: "Black currant\tEstablished\nRomanesco\tIn bed",
        });
    });

    it("emits cell-copy and writes clipboard text for the current selection", async () => {
        const grid = await renderGrid();
        const writeText = vi.fn().mockResolvedValue(undefined);
        const originalClipboard = globalThis.navigator.clipboard;
        const clipboard = { writeText } as unknown as Clipboard;
        Object.defineProperty(globalThis.navigator, "clipboard", {
            configurable: true,
            value: clipboard,
        });

        grid.activeCell = {
            rowId: "black-currant",
            columnId: "commonName",
        };

        let emittedCopy: { cells: VioletDataGridCellLocation[]; text: string } | undefined;
        const handleCellCopy = (event: Event) => {
      emittedCopy = (event as CustomEvent<{ cells: VioletDataGridCellLocation[]; text: string }>)
        .detail;
        };
        grid.addEventListener("cell-copy", handleCellCopy);

        try {
            await grid.handleCopyRequest();

            expect(emittedCopy).toEqual({
                cells: [
                    {
                        rowId: "black-currant",
                        columnId: "commonName",
                    },
                ],
                text: "Black currant",
            });
            expect(writeText).toHaveBeenCalledWith("Black currant");
        } finally {
            grid.removeEventListener("cell-copy", handleCellCopy);
            Object.defineProperty(globalThis.navigator, "clipboard", {
                configurable: true,
                value: originalClipboard,
            });
        }
    });

    it("writes TSV through clipboardData on the native copy event", async () => {
        const grid = await renderGrid();
        const scroll = grid.shadowRoot?.querySelector(".table-scroll") as HTMLDivElement;
        const cellCopies: string[] = [];
        grid.addEventListener("cell-copy", (event) => {
            cellCopies.push((event as CustomEvent<{ text: string }>).detail.text);
        });
        grid.activeCell = { rowId: "black-currant", columnId: "commonName" };
        grid.cellSelection = {
            anchor: { rowId: "black-currant", columnId: "commonName" },
            focus: { rowId: "romanesco", columnId: "status" },
        };

        const clipboardData = new DataTransfer();
        const event = new ClipboardEvent("copy", {
            bubbles: true,
            cancelable: true,
            composed: true,
            clipboardData,
        });
        scroll.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(clipboardData.getData("text/plain")).toBe("Black currant\tEstablished\nRomanesco\tIn bed");
        expect(cellCopies).toEqual(["Black currant\tEstablished\nRomanesco\tIn bed"]);
    });

    it("surfaces clipboard failures as cell-copy-error instead of swallowing them", async () => {
        const grid = await renderGrid();
        const originalClipboard = globalThis.navigator.clipboard;
        const failure = new Error("denied");
        Object.defineProperty(globalThis.navigator, "clipboard", {
            configurable: true,
            value: { writeText: vi.fn().mockRejectedValue(failure) },
        });
        const errors: { text: string; error: unknown }[] = [];
        grid.addEventListener("cell-copy-error", (event) => {
            errors.push((event as CustomEvent<{ text: string; error: unknown }>).detail);
        });
        grid.activeCell = { rowId: "black-currant", columnId: "commonName" };

        try {
            await grid.handleCopyRequest();
            expect(errors).toHaveLength(1);
            expect(errors[0]?.text).toBe("Black currant");
            expect(errors[0]?.error).toBe(failure);

            Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: undefined });
            await grid.handleCopyRequest();
            expect(errors).toHaveLength(2);
            expect(errors[1]?.error).toBeInstanceOf(Error);
        } finally {
            Object.defineProperty(globalThis.navigator, "clipboard", {
                configurable: true,
                value: originalClipboard,
            });
        }
    });

    it("lets Ctrl+C reach the native copy event and only falls back to the async clipboard when none fires", async () => {
        const grid = await renderGrid();
        const scroll = grid.shadowRoot?.querySelector(".table-scroll") as HTMLDivElement;
        const writeText = vi.fn().mockResolvedValue(undefined);
        const originalClipboard = globalThis.navigator.clipboard;
        Object.defineProperty(globalThis.navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        });
        grid.activeCell = { rowId: "black-currant", columnId: "commonName" };

        try {
            const keydown = () => {
                const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "c", ctrlKey: true });
                scroll.dispatchEvent(event);
                return event;
            };

            const first = keydown();
            expect(first.defaultPrevented).toBe(false);
            scroll.dispatchEvent(
                new ClipboardEvent("copy", { bubbles: true, cancelable: true, composed: true, clipboardData: new DataTransfer() }),
            );
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(writeText).not.toHaveBeenCalled();

            keydown();
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(writeText).toHaveBeenCalledWith("Black currant");
        } finally {
            Object.defineProperty(globalThis.navigator, "clipboard", {
                configurable: true,
                value: originalClipboard,
            });
        }
    });

    it("commits text and number edits with normalized values", async () => {
        const grid = await renderGrid();
        const privateGrid = grid as any;

        const changes: VioletDataGridChangeDetail[] = [];
        const handleCellChange = (event: Event) => {
            changes.push((event as CustomEvent<VioletDataGridChangeDetail>).detail);
        };
        grid.addEventListener("cell-change", handleCellChange);

        try {
            privateGrid.editingCell = {
                rowId: "black-currant",
                columnId: "commonName",
            };
            privateGrid.editingValue = "Gooseberry";
            privateGrid.commitEditingCell();

            privateGrid.editingCell = {
                rowId: "romanesco",
                columnId: "dtm",
            };
            privateGrid.editingValue = "";
            privateGrid.commitEditingCell();

            expect(changes).toEqual([
                {
                    rowId: "black-currant",
                    columnId: "commonName",
                    value: "Gooseberry",
                },
                {
                    rowId: "romanesco",
                    columnId: "dtm",
                    value: null,
                },
            ]);
        } finally {
            grid.removeEventListener("cell-change", handleCellChange);
        }
    });

  it("commits a mounted editor once when blur has no related target", async () => {
    const grid = await renderGrid();
    const privateGrid = grid as any;
    const changes: VioletDataGridChangeDetail[] = [];
    grid.addEventListener("cell-change", (event) => {
      changes.push((event as CustomEvent<VioletDataGridChangeDetail>).detail);
    });

    grid.activeCell = { rowId: "black-currant", columnId: "commonName" };
    privateGrid.startEditingCell(grid.activeCell);
    await nextFrames(2);

    const editor = grid.shadowRoot?.querySelector<HTMLInputElement>(".cell-editor");
    if (!editor) throw new Error("Expected a mounted text editor.");
    editor.value = "Gooseberry";
    privateGrid.editingValue = "Gooseberry";
    editor.blur();
    await nextFrames(2);

    expect(changes).toEqual([
      { rowId: "black-currant", columnId: "commonName", value: "Gooseberry" },
    ]);
    expect(grid.editingCell).toBeNull();
    expect(grid.shadowRoot?.activeElement).not.toBe(editor);

    await nextFrames(2);
    expect(changes).toHaveLength(1);
  });

    it("cancels editing without emitting cell-change and emits edit-cancel instead", async () => {
        const grid = await renderGrid();
        const privateGrid = grid as any;

        const changeHandler = vi.fn();
        let cancelledCell: VioletDataGridCellLocation | undefined;
        const handleEditCancel = (event: Event) => {
            cancelledCell = (event as CustomEvent<VioletDataGridCellLocation>).detail;
        };

        grid.addEventListener("cell-change", changeHandler);
        grid.addEventListener("edit-cancel", handleEditCancel);

        try {
            privateGrid.editingCell = {
                rowId: "black-currant",
                columnId: "commonName",
            };
            privateGrid.editingValue = "Should not commit";

            grid.cancelActiveEdit();

            expect(changeHandler).not.toHaveBeenCalled();
            expect(cancelledCell).toEqual({
                rowId: "black-currant",
                columnId: "commonName",
            });
            expect(privateGrid.editingCell).toBeNull();
            expect(privateGrid.editingValue).toBe("");
        } finally {
            grid.removeEventListener("cell-change", changeHandler);
            grid.removeEventListener("edit-cancel", handleEditCancel);
        }
    });

    it("falls back to the first available cell when the active row disappears", async () => {
        const grid = await renderGrid();

        grid.activeCell = {
            rowId: "black-currant",
            columnId: "status",
        };
        await nextFrame();

        grid.rows = [widgetRows[1]!];
        await nextFrame();

        expect(grid.activeCell).toEqual({
            rowId: "romanesco",
            columnId: "tracked",
        });
    });

    it("moves the active cell with Tab when not editing", async () => {
        const grid = await renderGrid();
    const scrollContainer = grid.shadowRoot?.querySelector(
      ".table-scroll",
    ) as HTMLDivElement | null;

        grid.activeCell = {
            rowId: "black-currant",
            columnId: "commonName",
        };
        await nextFrame();

        const keyEvent = new KeyboardEvent("keydown", {
            bubbles: true,
            key: "Tab",
        });
        Object.defineProperty(keyEvent, "target", {
            configurable: true,
            value: scrollContainer,
        });

        grid.handleGridKeydown(keyEvent);

        expect(grid.activeCell).toEqual({
            rowId: "black-currant",
            columnId: "status",
        });
    });

    it("commits the current edit and moves focus with Tab from an editor", async () => {
        const grid = await renderGrid();
        const privateGrid = grid as any;

        grid.activeCell = {
            rowId: "black-currant",
            columnId: "commonName",
        };
        privateGrid.editingCell = {
            rowId: "black-currant",
            columnId: "commonName",
        };
        privateGrid.editingValue = "Gooseberry";

        let emittedChange: VioletDataGridChangeDetail | undefined;
        const handleCellChange = (event: Event) => {
            emittedChange = (event as CustomEvent<VioletDataGridChangeDetail>).detail;
        };
        grid.addEventListener("cell-change", handleCellChange);

        try {
            const editor = document.createElement("input");
            editor.className = "cell-editor";
            const keyEvent = new KeyboardEvent("keydown", {
                bubbles: true,
                key: "Tab",
            });
            Object.defineProperty(keyEvent, "target", {
                configurable: true,
                value: editor,
            });

            grid.handleGridKeydown(keyEvent);

            expect(emittedChange).toEqual({
                rowId: "black-currant",
                columnId: "commonName",
                value: "Gooseberry",
            });
            expect(privateGrid.editingCell).toBeNull();
            expect(grid.activeCell).toEqual({
                rowId: "black-currant",
                columnId: "status",
            });
        } finally {
            grid.removeEventListener("cell-change", handleCellChange);
        }
    });

    it("derives the fill source range from the active cell or the selected range", async () => {
        const grid = await renderGrid();
        const privateGrid = grid as any;

        grid.activeCell = {
            rowId: "black-currant",
            columnId: "commonName",
        };

        expect(privateGrid.currentFillSourceRange()).toEqual({
            anchor: {
                rowId: "black-currant",
                columnId: "commonName",
            },
            focus: {
                rowId: "black-currant",
                columnId: "commonName",
            },
        });

        grid.cellSelection = {
            anchor: {
                rowId: "black-currant",
                columnId: "commonName",
            },
            focus: {
                rowId: "romanesco",
                columnId: "status",
            },
        };

        expect(privateGrid.currentFillSourceRange()).toEqual({
            anchor: {
                rowId: "black-currant",
                columnId: "commonName",
            },
            focus: {
                rowId: "romanesco",
                columnId: "status",
            },
        });
    });

    it("clamps fill expansion at the first locked column boundary", async () => {
        const columns: VioletDataGridColumn<TestRow>[] = [
            {
                id: "commonName",
                label: "Plant",
                editable: true,
                editor: "text",
        value: (row) => row.commonName,
            },
            {
                id: "status",
                label: "Status",
        value: (row) => row.status,
            },
            {
                id: "dtm",
                label: "DTM",
                editable: true,
                editor: "number",
        value: (row) => row.dtm,
            },
        ];
        const grid = await renderGrid({ columns });
        const privateGrid = grid as any;

        const sourceBounds = {
            rowStart: 0,
            rowEnd: 0,
            columnStart: 0,
            columnEnd: 0,
        };
        const expandedBounds = {
            rowStart: 0,
            rowEnd: 0,
            columnStart: 0,
            columnEnd: 2,
        };

        expect(privateGrid.clampFillBoundsToEditableTargets(expandedBounds, sourceBounds)).toEqual({
            rowStart: 0,
            rowEnd: 0,
            columnStart: 0,
            columnEnd: 0,
        });
    });

    it("normalizes pasted text line endings and trims a trailing newline", async () => {
        const grid = await renderGrid();
        const privateGrid = grid as any;

        expect(privateGrid.normalizePastedText("Black currant\r\nEstablished\r")).toBe(
      "Black currant\nEstablished",
        );
        expect(privateGrid.normalizePastedText("Black currant\r\nEstablished\r\n")).toBe(
      "Black currant\nEstablished",
        );
    });

    it("uses the top-left selected cell as the paste origin", async () => {
        const grid = await renderGrid();
        const privateGrid = grid as any;

        grid.activeCell = {
            rowId: "romanesco",
            columnId: "status",
        };
        grid.cellSelection = {
            anchor: {
                rowId: "romanesco",
                columnId: "status",
            },
            focus: {
                rowId: "black-currant",
                columnId: "commonName",
            },
        };

        expect(privateGrid.pasteOriginLocation()).toEqual({
            rowId: "black-currant",
            columnId: "commonName",
        });
    });

    it("applies a single pasted value across the whole selected range while skipping locked cells", async () => {
        const columns: VioletDataGridColumn<TestRow>[] = [
            {
                id: "commonName",
                label: "Plant",
                editable: true,
                editor: "text",
        value: (row) => row.commonName,
            },
            {
                id: "status",
                label: "Status",
        value: (row) => row.status,
            },
            {
                id: "dtm",
                label: "DTM",
                editable: true,
                editor: "number",
        value: (row) => row.dtm,
            },
        ];
        const grid = await renderGrid({ columns });
        const privateGrid = grid as any;

        grid.activeCell = {
            rowId: "black-currant",
            columnId: "commonName",
        };
        grid.cellSelection = {
            anchor: {
                rowId: "black-currant",
                columnId: "commonName",
            },
            focus: {
                rowId: "romanesco",
                columnId: "dtm",
            },
        };

        expect(privateGrid.pasteDetailForText("42")?.changes).toEqual([
            {
                rowId: "black-currant",
                columnId: "commonName",
                value: "42",
            },
            {
                rowId: "black-currant",
                columnId: "dtm",
                value: 42,
            },
            {
                rowId: "romanesco",
                columnId: "commonName",
                value: "42",
            },
            {
                rowId: "romanesco",
                columnId: "dtm",
                value: 42,
            },
        ]);
    });

    it("samples autosize rows with a bounded set and still includes the last row", async () => {
        const rows: VioletDataGridRow<TestRow>[] = Array.from({ length: 205 }, (_, index) => ({
            id: `row-${index + 1}`,
            data: {
                tracked: index % 2 === 0,
                commonName: `Plant ${index + 1}`,
                status: index === 204 ? "Last row sentinel" : "Seedling",
                dtm: String(index + 1),
            },
        }));
        const grid = await renderGrid({ rows });
        const sample = sampleAutosizeRows(grid.presentedRows);

        expect(sample.length).toBeLessThanOrEqual(151);
        expect(sample[0]?.id).toBe("row-1");
        expect(sample[99]?.id).toBe("row-100");
    expect(sample.some((row) => row.id === "row-205")).toBe(true);
    });

    it("falls back to the first available cell when the active column disappears", async () => {
        const grid = await renderGrid();

        grid.activeCell = {
            rowId: "black-currant",
            columnId: "status",
        };
        await nextFrame();

    (grid as any).columns = widgetColumns.filter((column) => column.id !== "status");
        await nextFrame();

        expect(grid.activeCell).toEqual({
            rowId: "black-currant",
            columnId: "tracked",
        });
    });

  it("tracks the effective density row height until a caller supplies an override", () => {
    const grid = document.createElement("violet-data-grid") as VioletDataGrid;

    expect(grid.estimatedRowHeight).toBe(32);
    grid.density = "compact";
    expect(grid.estimatedRowHeight).toBe(24);
    grid.density = "comfortable";
    expect(grid.estimatedRowHeight).toBe(44);

    grid.estimatedRowHeight = 36;
    grid.density = "natural";
    expect(grid.estimatedRowHeight).toBe(36);
  });

  it("uses one semantic virtual table with logical row metadata and aligned deterministic columns", async () => {
    const rows: VioletDataGridRow<{ values: string[] }>[] = Array.from(
      { length: 1_000 },
      (_, rowIndex) => ({
        id: `row-${rowIndex}`,
        data: {
          values: [
            `Plant ${rowIndex}`,
            rowIndex === 900
              ? "A deliberately very long offscreen note that must not resize the column"
              : "note",
            String(rowIndex),
          ],
        },
      }),
    );
    const columns: VioletDataGridColumn<{ values: string[] }>[] = [
      { id: "plant", label: "Plant", value: (row) => row.values[0] },
      { id: "notes", label: "Notes", value: (row) => row.values[1] },
      { id: "count", label: "Count", width: "7rem", value: (row) => row.values[2] },
    ];
    const grid = await renderVirtualGrid({ rows, columns, height: 720 });
    const shadowRoot = grid.shadowRoot;
    const scroll = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;
    const table = shadowRoot?.querySelector("table") as HTMLTableElement | null;

    expect(shadowRoot?.querySelectorAll("table").length).toBe(1);
    expect(table?.getAttribute("aria-rowcount")).toBe("1001");
    expect(table?.getAttribute("aria-colcount")).toBe("3");
    expect(getComputedStyle(table as HTMLTableElement).borderCollapse).toBe("separate");
    expect(getComputedStyle(table as HTMLTableElement).borderSpacing).toBe("0px");
    expect(getComputedStyle(shadowRoot?.querySelector("thead th") as HTMLElement).position).toBe(
      "sticky",
    );
    expect(scroll?.clientHeight).toBeGreaterThanOrEqual(700);
    expect(grid.virtualTotalSize).toBe(32_000);

    const assertWindow = () => {
      const mountedRows = [
        ...(shadowRoot?.querySelectorAll("tbody tr[data-row-index]") ?? []),
      ] as HTMLTableRowElement[];
      const spacerRows = [
        ...(shadowRoot?.querySelectorAll(".virtual-spacer-row") ?? []),
      ] as HTMLTableRowElement[];
      expect(mountedRows.length).toBeGreaterThan(0);
      expect(spacerRows).toHaveLength(2);
      expect(spacerRows.every((row) => row.parentElement?.tagName === "TBODY")).toBe(true);
      expect(mountedRows.length).toBeLessThanOrEqual(
        Math.ceil((scroll?.clientHeight ?? 0) / 32) + 2 * grid.overscanCount + 2,
      );

      const lastItem = grid.renderedRows.at(-1)?.item;
      expect(lastItem?.end ?? 0).toBeGreaterThanOrEqual(
        (scroll?.scrollTop ?? 0) + (scroll?.clientHeight ?? 0) - 32,
      );

      const firstRow = mountedRows[0];
      const firstDataCell = firstRow?.querySelector(
        "td[data-column-id]",
      ) as HTMLTableCellElement | null;
      expect(getComputedStyle(firstDataCell as HTMLTableCellElement).borderBlockEndStyle).toBe(
        "solid",
      );
      expect(getComputedStyle(firstDataCell as HTMLTableCellElement).borderBlockEndWidth).toBe(
        "1px",
      );
      const firstItem = grid.renderedRows[0]?.item;
      expect(firstRow?.getAttribute("aria-rowindex")).toBe(String((firstItem?.index ?? -1) + 2));
      const scrollRect = scroll?.getBoundingClientRect();
      expect(
        mountedRows.some((row) => {
          const rowRect = row.getBoundingClientRect();
          return rowRect.bottom > (scrollRect?.top ?? 0) && rowRect.top < (scrollRect?.bottom ?? 0);
        }),
      ).toBe(true);

      const headers = [
        ...(shadowRoot?.querySelectorAll("thead th[data-column-id]") ?? []),
      ] as HTMLElement[];
      const cells = [...(firstRow?.querySelectorAll("td[data-column-id]") ?? [])] as HTMLElement[];
      expect(cells.length).toBe(headers.length);
      headers.forEach((header, index) => {
        const cell = cells[index];
        expect(cell?.getAttribute("headers")).toBe(header.id);
        expect(
          Math.abs(
            header.getBoundingClientRect().width - (cell?.getBoundingClientRect().width ?? 0),
          ),
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(header.getBoundingClientRect().left - (cell?.getBoundingClientRect().left ?? 0)),
        ).toBeLessThanOrEqual(1);
      });
    };

    assertWindow();
    if (!scroll) throw new Error("Expected a virtual scroll container.");
    scroll.scrollTop = 900 * 32;
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrames(3);
    assertWindow();

    grid.style.blockSize = "1200px";
    await nextFrames(3);
    expect(scroll.clientHeight).toBeGreaterThanOrEqual(1_180);
    assertWindow();

    scroll.scrollTop = scroll.scrollHeight;
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrames(4);

    expect(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop).toBeLessThanOrEqual(1);
    const lastRow = shadowRoot?.querySelector<HTMLTableRowElement>(
      'tbody tr[data-row-index="999"]',
    );
    const scrollRect = scroll.getBoundingClientRect();
    const scrollportBottom = scrollRect.top + scroll.clientTop + scroll.clientHeight;
    expect(lastRow).toBeTruthy();
    expect(grid.renderedRows.at(-1)?.item.index).toBe(rows.length - 1);
    expect(grid.renderedRows.at(-1)?.item.end).toBe(grid.virtualTotalSize);
    expect(lastRow?.getBoundingClientRect().bottom ?? 0).toBeGreaterThanOrEqual(
      scrollportBottom - 2,
    );
    expect(lastRow?.getBoundingClientRect().bottom ?? 0).toBeLessThanOrEqual(scrollportBottom + 2);

    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrames(4);
    expect(scroll.scrollTop).toBeLessThanOrEqual(1);
    expect(grid.renderedRows[0]?.item.index).toBe(0);

    const middleScrollTop = (scroll.scrollHeight - scroll.clientHeight) / 2;
    scroll.scrollTop = middleScrollTop;
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrames(4);
    expect(Math.abs(scroll.scrollTop - middleScrollTop)).toBeLessThanOrEqual(1);
    expect(grid.renderedRows[0]?.item.index ?? 0).toBeGreaterThan(0);
    expect(grid.renderedRows.at(-1)?.item.index ?? 999).toBeLessThan(999);

    let requestedScrollTop: number | null = null;
    const moveAwayFromTail = () => {
      const endGap = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
      if (requestedScrollTop === null && endGap < 3) {
        requestedScrollTop = scroll.scrollTop - 100;
        scroll.scrollTop = requestedScrollTop;
      }
    };
    scroll.addEventListener("scroll", moveAwayFromTail);
    scroll.scrollTop = scroll.scrollHeight;
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrames(4);
    scroll.removeEventListener("scroll", moveAwayFromTail);

    expect(requestedScrollTop).not.toBeNull();
    expect(Math.abs(scroll.scrollTop - (requestedScrollTop ?? 0))).toBeLessThanOrEqual(1);
    expect(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop).toBeGreaterThanOrEqual(90);
    expect(grid.renderedRows.at(-1)?.item.index).toBe(999);
  });

  it("measures rendered rows when theme targets or cell controls exceed the estimate", async () => {
    const tallCell = html<VioletDataGridCellTemplateContext<{ value: string }>>`
            <span style="display:block;min-block-size:68px">${(x) => x.text}</span>
        `;
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      data: { value: `Value ${index}` },
    }));
    const columns: VioletDataGridColumn<{ value: string }>[] = [
      {
        id: "value",
        label: "Value",
        value: (row) => row.value,
        cellTemplate: tallCell,
      },
    ];
    const grid = await renderVirtualGrid({ rows, columns, height: 320 });
    grid.style.setProperty("--size-target-natural", "52px");

    await nextFrames(4);

    const firstRow = grid.shadowRoot?.querySelector<HTMLTableRowElement>(
      'tbody tr[data-index="0"]',
    );
    const firstVirtualRow = grid.renderedRows.find((row) => row.item.index === 0);
    expect(firstRow?.getBoundingClientRect().height ?? 0).toBeGreaterThanOrEqual(68);
    expect(firstVirtualRow?.item.size ?? 0).toBeGreaterThanOrEqual(68);
    expect(grid.estimatedRowHeight).toBe(32);

    const scroll = grid.shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;
    if (!scroll) throw new Error("Expected a virtual scroll container.");
    const lastItem = grid.renderedRows.at(-1)?.item;
    expect(lastItem?.end ?? 0).toBeGreaterThanOrEqual(scroll.clientHeight - 32);
  });

  it("preserves overlapping row views and formats only entering rows during steady scrolling", async () => {
    type ScrollingRow = { values: string[] };
    let serializations = 0;
    const rows: VioletDataGridRow<ScrollingRow>[] = Array.from(
      { length: 1_000 },
      (_, rowIndex) => ({
        id: `row-${rowIndex}`,
        data: { values: [`Plant ${rowIndex}`, `Status ${rowIndex}`, `Note ${rowIndex}`] },
      }),
    );
    const columns: VioletDataGridColumn<ScrollingRow>[] = Array.from(
      { length: 3 },
      (_, columnIndex) => ({
        id: `column-${columnIndex}`,
        label: `Column ${columnIndex}`,
        value: (row) => row.values[columnIndex],
        serialize: (value) => {
          serializations += 1;
          return String(value ?? "");
        },
      }),
    );
    const grid = await renderVirtualGrid({ rows, columns, height: 320 });
    grid.selectionMode = "single";
    const scroll = grid.shadowRoot?.querySelector<HTMLDivElement>(".table-scroll");
    if (!scroll) throw new Error("Expected a virtual scroll container.");

    scroll.scrollTop = 640;
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrames(4);
    const beforeNodes = new Map(
      [
        ...(grid.shadowRoot?.querySelectorAll<HTMLTableRowElement>("tbody tr[data-index]") ?? []),
      ].map((row) => [row.dataset.index, row]),
    );
    const beforeSerializations = serializations;

    scroll.scrollTop += 32;
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrames(4);
    const afterNodes = [
      ...(grid.shadowRoot?.querySelectorAll<HTMLTableRowElement>("tbody tr[data-index]") ?? []),
    ];
    const overlappingNodes = afterNodes.filter((row) => beforeNodes.has(row.dataset.index));

    expect(overlappingNodes.length).toBeGreaterThan(0);
    expect(overlappingNodes.every((row) => beforeNodes.get(row.dataset.index) === row)).toBe(true);
    expect(serializations - beforeSerializations).toBeGreaterThan(0);
    expect(serializations - beforeSerializations).toBeLessThanOrEqual(columns.length * 2);

    const selectedRenderedRow = grid.renderedRows[Math.floor(grid.renderedRows.length / 2)]!;
    grid.selectedRowIds = [selectedRenderedRow.row.id];
    await nextFrames(2);
    const selectedRow = grid.shadowRoot?.querySelector<HTMLTableRowElement>(
      `tbody tr[data-row-index="${selectedRenderedRow.item.index}"]`,
    );
    expect(selectedRow?.getAttribute("aria-selected")).toBe("true");
    expect(
      selectedRow?.querySelector<HTMLElement & { checked: boolean }>("violet-radio")?.checked,
    ).toBe(true);
  });

  it("bounds 10k by 61 presentation work and reuses sort keys across direction changes", async () => {
    type LargeRow = { values: string[] };
    const rows: VioletDataGridRow<LargeRow>[] = Array.from({ length: 10_000 }, (_, rowIndex) => ({
      id: `row-${rowIndex}`,
      data: {
        values: Array.from({ length: 61 }, (_, columnIndex) =>
          columnIndex === 0 ? `Plant ${10_000 - rowIndex}` : `r${rowIndex}-c${columnIndex}`,
        ),
      },
    }));
    let sortValueReads = 0;
    let serializations = 0;
    const columns: VioletDataGridColumn<LargeRow>[] = Array.from(
      { length: 61 },
      (_, columnIndex) => ({
        id: `column-${columnIndex}`,
        label: `Column ${columnIndex}`,
        sortable: columnIndex === 0,
        value: (row) => {
          if (columnIndex === 0) sortValueReads += 1;
          return row.values[columnIndex];
        },
        serialize: (value) => {
          serializations += 1;
          return String(value ?? "");
        },
      }),
    );
    const grid = await renderVirtualGrid({
      rows,
      columns,
      height: 640,
      sort: { columnId: "column-0", direction: "ascending" },
    });

    const mountedCount = grid.renderedRows.length;
    expect(mountedCount).toBeGreaterThan(0);
    expect(mountedCount).toBeLessThanOrEqual(Math.ceil(640 / 32) + 12);
    expect(sortValueReads).toBeLessThanOrEqual(rows.length + mountedCount);
    expect(serializations).toBeLessThanOrEqual(mountedCount * columns.length);

    const beforeSelectionReads = sortValueReads;
    const beforeSelectionSerializations = serializations;
    grid.selectedRowIds = [grid.presentedRows[0]!.id];
    await nextFrames();
    expect(sortValueReads).toBe(beforeSelectionReads);
    expect(serializations).toBe(beforeSelectionSerializations);

    const beforeReverseReads = sortValueReads;
    const reverseStarted = performance.now();
    grid.sort = { columnId: "column-0", direction: "descending" };
    await nextFrames(2);
    const reverseElapsed = performance.now() - reverseStarted;
    expect(sortValueReads - beforeReverseReads).toBeLessThanOrEqual(grid.renderedRows.length);
    expect(reverseElapsed).toBeLessThan(500);
  });

  it("keeps public offscreen presented rows interaction-aware without eager decoration", async () => {
    type InteractionRow = { values: string[] };
    let serializations = 0;
    const rows: VioletDataGridRow<InteractionRow>[] = Array.from(
      { length: 100 },
      (_, rowIndex) => ({
        id: `row-${rowIndex}`,
        data: { values: [`Plant ${rowIndex}`, `Status ${rowIndex}`] },
      }),
    );
    const columns: VioletDataGridColumn<InteractionRow>[] = Array.from(
      { length: 2 },
      (_, columnIndex) => ({
        id: `column-${columnIndex}`,
        label: `Column ${columnIndex}`,
        editable: true,
        editor: "text",
        value: (row) => row.values[columnIndex],
        serialize: (value) => {
          serializations += 1;
          return String(value ?? "");
        },
      }),
    );
    const grid = await renderVirtualGrid({ rows, columns, height: 160, focusMode: "cell" });
    grid.activeCell = { rowId: "row-0", columnId: "column-0" };
    grid.cellSelection = {
      anchor: { rowId: "row-0", columnId: "column-0" },
      focus: { rowId: "row-90", columnId: "column-0" },
    };
    grid.editingValue = "Edited value";
    grid.editingCell = { rowId: "row-0", columnId: "column-0" };
    grid.fillPreview = {
      anchor: { rowId: "row-0", columnId: "column-0" },
      focus: { rowId: "row-92", columnId: "column-0" },
    };
    await nextFrames(2);

    const beforePublicRead = serializations;
    const editingCell = grid.presentedRows[0]?.cells[0];
    const selectedOffscreenCell = grid.presentedRows[90]?.cells[0];
    const fillCell = grid.presentedRows[92]?.cells[0];

    expect(editingCell).toMatchObject({
      active: true,
      selected: true,
      editing: true,
      editValue: "Edited value",
    });
    expect(editingCell?.rangeEdge).not.toBe("");
    expect(selectedOffscreenCell?.selected).toBe(true);
    expect(fillCell?.fillPreview).toBe(true);
    expect(serializations - beforePublicRead).toBeGreaterThanOrEqual(columns.length * 2);
    expect(serializations - beforePublicRead).toBeLessThanOrEqual(columns.length * 3);
    expect(grid.renderedRows.every((rendered) => rendered.row.id !== "row-90")).toBe(true);
    expect(grid.renderedRows.every((rendered) => rendered.row.id !== "row-92")).toBe(true);
  });

  it("commits an editor recycled by virtual scrolling exactly once and restores grid focus", async () => {
    const rows: VioletDataGridRow<{ value: string }>[] = Array.from(
      { length: 100 },
      (_, index) => ({
        id: `row-${index}`,
        data: { value: `Value ${index}` },
      }),
    );
    const columns: VioletDataGridColumn<{ value: string }>[] = [
      {
        id: "value",
        label: "Value",
        editable: true,
        editor: "text",
        value: (row) => row.value,
      },
    ];
    const grid = await renderVirtualGrid({ rows, columns, height: 160, focusMode: "cell" });
    const privateGrid = grid as any;
    const scroll = grid.shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;
    const changes: VioletDataGridChangeDetail[] = [];
    grid.addEventListener("cell-change", (event) => {
      changes.push((event as CustomEvent<VioletDataGridChangeDetail>).detail);
    });

    grid.activeCell = { rowId: "row-0", columnId: "value" };
    privateGrid.startEditingCell(grid.activeCell);
    await nextFrames(2);
    expect(grid.editingCell).toEqual({ rowId: "row-0", columnId: "value" });
    expect(changes).toHaveLength(0);
    const editor = grid.shadowRoot?.querySelector(".cell-editor") as HTMLInputElement | null;
    if (!editor) throw new Error("Expected the first-row editor.");
    editor.value = "Committed once";
    privateGrid.editingValue = "Committed once";

    if (!scroll) throw new Error("Expected a virtual scroll container.");
    scroll.scrollTop = 1_600;
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrames(4);

    expect(changes).toEqual([{ rowId: "row-0", columnId: "value", value: "Committed once" }]);
    expect(grid.editingCell).toBeNull();
    expect(grid.shadowRoot?.activeElement).toBe(scroll);

    scroll.scrollTop = 2_000;
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrames(2);
    expect(changes).toHaveLength(1);
  });

  it("keeps rendered rows in sync when a cell-change handler replaces rows during editor recycling", async () => {
    const makeRows = (prefix: string, count: number): VioletDataGridRow<{ value: string }>[] =>
      Array.from({ length: count }, (_, index) => ({
        id: `${prefix}-${index}`,
        data: { value: `Value ${index}` },
      }));
    const columns: VioletDataGridColumn<{ value: string }>[] = [
      { id: "value", label: "Value", editable: true, editor: "text", value: (row) => row.value },
    ];
    const grid = await renderVirtualGrid({ rows: makeRows("row", 100), columns, height: 160, focusMode: "cell" });
    const privateGrid = grid as any;
    const scroll = grid.shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;
    if (!scroll) throw new Error("Expected a virtual scroll container.");
    grid.addEventListener("cell-change", () => {
      grid.rows = makeRows("next", 100);
    });

    grid.activeCell = { rowId: "row-0", columnId: "value" };
    privateGrid.startEditingCell(grid.activeCell);
    await nextFrames(2);
    privateGrid.editingValue = "Changed";

    // Drive the synchronous path directly: the virtualizer window has moved past
    // the editing row, so syncRenderedRows commits the edit, which re-enters via rows.
    scroll.scrollTop = 1_600;
    scroll.dispatchEvent(new Event("scroll"));
    const committedRows = grid.presentedRows.map((row) => row.id);
    expect(committedRows.every((id) => id.startsWith("next-"))).toBe(true);

    const renderedIds = grid.renderedRows.map((rendered) => rendered.row.id);
    expect(renderedIds.length).toBeGreaterThan(0);
    expect(renderedIds.every((id) => id.startsWith("next-"))).toBe(true);
  });

  it("derives collision-free cell ids and survives quote characters in row and column ids", async () => {
    const rows: VioletDataGridRow<Record<string, string>>[] = [
      { id: "a-b", data: { c: "one", 'b"]-c': "two" } },
      { id: 'a"]', data: { c: "three", 'b"]-c': "four" } },
      { id: "a", data: { c: "five", 'b"]-c': "six" } },
    ];
    const columns: VioletDataGridColumn<Record<string, string>>[] = [
      { id: "c", label: "C", editable: true, editor: "text" },
      { id: 'b"]-c', label: "B-C", editable: true, editor: "text" },
      { id: "b-c", label: "B dash C", editable: true, editor: "text" },
    ];
    const grid = await renderGrid({ rows: rows as any, columns: columns as any });
    const privateGrid = grid as any;

    expect(privateGrid.cellIdFor("a-b", "c")).not.toBe(privateGrid.cellIdFor("a", "b-c"));
    const ids = rows.flatMap((row) => columns.map((column) => privateGrid.cellIdFor(row.id, column.id)));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    expect(grid.shadowRoot?.querySelectorAll("td[id]").length).toBe(ids.length);
    expect(new Set([...grid.shadowRoot!.querySelectorAll("td[id]")].map((cell) => cell.id)).size).toBe(ids.length);

    grid.activeCell = { rowId: 'a"]', columnId: 'b"]-c' };
    privateGrid.startEditingCell(grid.activeCell);
    await nextFrames(2);

    expect(grid.editingCell).toEqual({ rowId: 'a"]', columnId: 'b"]-c' });
    const editor = privateGrid.getActiveEditorElement() as HTMLElement | null;
    expect(editor).toBeInstanceOf(HTMLElement);
    expect(editor?.dataset.rowId).toBe('a"]');
    expect(editor?.dataset.columnId).toBe('b"]-c');
  });

  it("cancels an invalid editor recycled offscreen once and restores interaction", async () => {
    const rows: VioletDataGridRow<{ dtm: string; name: string }>[] = Array.from(
      { length: 100 },
      (_, index) => ({ id: `row-${index}`, data: { dtm: String(index), name: `Plant ${index}` } }),
    );
    const columns: VioletDataGridColumn<{ dtm: string; name: string }>[] = [
      {
        id: "dtm",
        label: "Days to maturity",
        editable: true,
        editor: "number",
        value: (row) => row.dtm,
      },
      { id: "name", label: "Plant", editable: true, editor: "text", value: (row) => row.name },
    ];
    const grid = await renderVirtualGrid({ rows, columns, height: 160, focusMode: "cell" });
    const scroll = grid.shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;
    const changes: VioletDataGridChangeDetail[] = [];
    const cancellations: VioletDataGridCellLocation[] = [];
    let announcementAtCancellation = "";
    grid.addEventListener("cell-change", (event) => {
      changes.push((event as CustomEvent<VioletDataGridChangeDetail>).detail);
    });
    grid.addEventListener("edit-cancel", (event) => {
      announcementAtCancellation = grid.editAnnouncement;
      cancellations.push((event as CustomEvent<VioletDataGridCellLocation>).detail);
    });
    grid.activeCell = { rowId: "row-0", columnId: "dtm" };
    (grid as any).startEditingCell(grid.activeCell);
    await nextFrames(2);
    const editor = grid.shadowRoot?.querySelector(
      '.cell-editor[data-row-id="row-0"][data-column-id="dtm"]',
    ) as HTMLInputElement | null;
    if (!editor) throw new Error("Expected the rendered number editor.");
    editor.value = "eight days";
    editor.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    editor.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, composed: true, relatedTarget: null }),
    );
    if (!scroll) throw new Error("Expected a virtual scroll container.");

    scroll.scrollTop = 1_600;
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrames(4);

    expect(changes).toEqual([]);
    expect(cancellations).toEqual([{ rowId: "row-0", columnId: "dtm" }]);
    expect(announcementAtCancellation).toMatch(/unsaved invalid edit.+cancelled/i);
    expect(grid.editingCell).toBeNull();
    const editStatus = grid.shadowRoot?.querySelector<HTMLElement>('[role="status"]');
    expect(editStatus?.textContent).toMatch(/unsaved invalid edit.+cancelled/i);
    expect(editStatus ? getComputedStyle(editStatus).display : "none").not.toBe("none");
    expect(grid.shadowRoot?.querySelector('tr[data-row-index="0"]')).toBeNull();
    expect(grid.renderedRows.length).toBeLessThan(rows.length);

    const nextCell = grid.shadowRoot?.querySelector<HTMLTableCellElement>(
      'tbody td[data-column-id="name"]',
    );
    if (!nextCell) throw new Error("Expected another rendered cell after scrolling.");
    const nextLocation = {
      rowId: nextCell.dataset.rowId ?? "",
      columnId: nextCell.dataset.columnId ?? "",
    };
    const firstColumnCell = nextCell.closest("tr")?.querySelector<HTMLTableCellElement>(
      'td[data-column-id="dtm"]',
    );
    if (!firstColumnCell) throw new Error("Expected the first column beside the rendered cell.");
    const firstColumnLocation = {
      rowId: firstColumnCell.dataset.rowId ?? "",
      columnId: firstColumnCell.dataset.columnId ?? "",
    };
    grid.activeCell = firstColumnLocation;
    scroll.focus();

    const sameCellArrow = new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    scroll.dispatchEvent(sameCellArrow);
    expect(sameCellArrow.defaultPrevented).toBe(true);
    expect(grid.activeCell).toEqual(firstColumnLocation);
    expect(grid.editAnnouncement).toMatch(/unsaved invalid edit.+cancelled/i);

    const arrowToNextCell = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    scroll.dispatchEvent(arrowToNextCell);
    expect(arrowToNextCell.defaultPrevented).toBe(true);
    expect(grid.activeCell).toEqual(nextLocation);
    expect(grid.editAnnouncement).toBe("");

    grid.editAnnouncement = "Unsaved invalid edit was cancelled.";
    const tabToNextRow = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    scroll.dispatchEvent(tabToNextRow);
    expect(tabToNextRow.defaultPrevented).toBe(true);
    expect(grid.editAnnouncement).toBe("");

    const rect = nextCell.getBoundingClientRect();
    nextCell.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        composed: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
    await nextFrames(2);

    expect(grid.activeCell).toEqual(nextLocation);
    expect(cancellations).toHaveLength(1);
    expect(changes).toEqual([]);
    expect(grid.editAnnouncement).toBe("");
  });

  it("does not cancel a replacement session created reentrantly during recycling", async () => {
    const rows: VioletDataGridRow<{ dtm: string; name: string }>[] = Array.from(
      { length: 100 },
      (_, index) => ({ id: `row-${index}`, data: { dtm: String(index), name: `Plant ${index}` } }),
    );
    let grid!: VioletDataGrid;
    let replaced = false;
    const columns: VioletDataGridColumn<{ dtm: string; name: string }>[] = [
      {
        id: "dtm",
        label: "Days to maturity",
        editable: true,
        editor: "number",
        value: (row) => row.dtm,
        parse: (value) => {
          if (!replaced) {
            replaced = true;
            grid.cancelActiveEdit();
            (grid as any).startEditingCell({ rowId: "row-1", columnId: "name" });
          }
          return Number(value);
        },
      },
      { id: "name", label: "Plant", editable: true, editor: "text", value: (row) => row.name },
    ];
    grid = await renderVirtualGrid({ rows, columns, height: 160, focusMode: "cell" });
    const cancellations: VioletDataGridCellLocation[] = [];
    const changes: VioletDataGridChangeDetail[] = [];
    grid.addEventListener("edit-cancel", (event) => {
      cancellations.push((event as CustomEvent<VioletDataGridCellLocation>).detail);
    });
    grid.addEventListener("cell-change", (event) => {
      changes.push((event as CustomEvent<VioletDataGridChangeDetail>).detail);
    });
    grid.activeCell = { rowId: "row-0", columnId: "dtm" };
    (grid as any).startEditingCell(grid.activeCell);
    await nextFrames(2);
    const editor = grid.shadowRoot?.querySelector(".cell-editor") as HTMLInputElement | null;
    if (!editor) throw new Error("Expected the initial editor.");
    editor.value = "8";
    editor.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    (grid as any).recycleFocusedRowIfNeeded(new Set([1]));
    await nextFrames(2);

    expect(cancellations).toEqual([{ rowId: "row-0", columnId: "dtm" }]);
    expect(changes).toEqual([]);
    expect(grid.editingCell).toEqual({ rowId: "row-1", columnId: "name" });
    expect(grid.shadowRoot?.activeElement).not.toBe(grid.shadowRoot?.querySelector(".table-scroll"));
    expect(grid.editAnnouncement).toBe("");
  });

  it("clears edit lifecycle feedback when the row collection is reset", async () => {
    const grid = await renderGrid();
    grid.editAnnouncement = "An earlier edit was cancelled.";

    grid.rows = [];
    await nextFrame();

    expect(grid.editAnnouncement).toBe("");
    expect(grid.shadowRoot?.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("clears the active edit before a reentrant commit listener runs", async () => {
    const grid = await renderGrid();
    const editor = await openRenderedEditor(grid, "black-currant", "commonName");
    const changes: VioletDataGridChangeDetail[] = [];
    const reentrantResults: boolean[] = [];
    grid.addEventListener("cell-change", (event) => {
      changes.push((event as CustomEvent<VioletDataGridChangeDetail>).detail);
      reentrantResults.push(grid.commitActiveEdit());
    });
    editor.value = "Gooseberry";
    editor.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    await nextFrames(2);

    expect(changes).toEqual([
      { rowId: "black-currant", columnId: "commonName", value: "Gooseberry" },
    ]);
    expect(reentrantResults).toEqual([false]);
    expect(grid.editingCell).toBeNull();
  });

  it("does not commit a session cancelled by a reentrant custom parser", async () => {
    let grid!: VioletDataGrid;
    const columns = widgetColumns.map((column) =>
      column.id === "commonName"
        ? {
            ...column,
            parse: (value: unknown) => {
              grid.cancelActiveEdit();
              return String(value).toUpperCase();
            },
          }
        : column,
    );
    grid = await renderGrid({ columns });
    const editor = await openRenderedEditor(grid, "black-currant", "commonName");
    const changes: VioletDataGridChangeDetail[] = [];
    const cancellations: VioletDataGridCellLocation[] = [];
    grid.addEventListener("cell-change", (event) => {
      changes.push((event as CustomEvent<VioletDataGridChangeDetail>).detail);
    });
    grid.addEventListener("edit-cancel", (event) => {
      cancellations.push((event as CustomEvent<VioletDataGridCellLocation>).detail);
    });
    editor.value = "Gooseberry";
    editor.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    expect(grid.commitActiveEdit()).toBe(false);
    expect(changes).toEqual([]);
    expect(cancellations).toEqual([{ rowId: "black-currant", columnId: "commonName" }]);
    expect(grid.editingCell).toBeNull();
  });

  it("leaves editing keys untouched while an IME composition is active", async () => {
    const grid = await renderGrid();
    const editor = await openRenderedEditor(grid, "black-currant", "commonName");
    const changes: VioletDataGridChangeDetail[] = [];
    const cancellations: VioletDataGridCellLocation[] = [];
    grid.addEventListener("cell-change", (event) => {
      changes.push((event as CustomEvent<VioletDataGridChangeDetail>).detail);
    });
    grid.addEventListener("edit-cancel", (event) => {
      cancellations.push((event as CustomEvent<VioletDataGridCellLocation>).detail);
    });

    for (const key of ["Enter", "ArrowRight", "Escape"]) {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        composed: true,
        isComposing: true,
      });
      editor.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    expect(grid.editingCell).toEqual({ rowId: "black-currant", columnId: "commonName" });
    expect(changes).toEqual([]);
    expect(cancellations).toEqual([]);
  });

  it("keeps invalid numeric drafts in the same rendered editor with an accessible error", async () => {
    const grid = await renderGrid();
    const editor = await openRenderedEditor(grid, "romanesco", "dtm");
    editor.value = "eight days";
    editor.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    const editingCell = grid.editingCell;

    editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, composed: true }),
    );
    await nextFrames(2);

    const retainedEditor = grid.shadowRoot?.querySelector(
      '.cell-editor[data-row-id="romanesco"][data-column-id="dtm"]',
    ) as HTMLInputElement | null;
    expect(grid.editingCell).toBe(editingCell);
    expect(retainedEditor?.value).toBe("eight days");
    expect(retainedEditor?.getAttribute("aria-label")).toBe(
      "Edit DTM for Romanesco cauliflower",
    );
    expect(retainedEditor?.getAttribute("aria-invalid")).toBe("true");
    expect(retainedEditor?.getAttribute("aria-errormessage")).toBeTruthy();
    expect(grid.shadowRoot?.querySelector('[role="alert"]')?.textContent).toContain("number");
    expect(
      getComputedStyle(grid.shadowRoot?.querySelector('[role="alert"]') as Element).display,
    ).not.toBe("none");
  });

  it("names select editors with the column and human-readable row label", async () => {
    const columns: VioletDataGridColumn<TestRow>[] = [
      {
        id: "status",
        label: "Status",
        editable: true,
        editor: "select",
        value: (row) => row.status,
        editorOptions: statusEditorOptions,
      },
    ];
    const grid = await renderGrid({ columns });
    const editor = await openRenderedEditor(grid, "black-currant", "status");

    expect(editor.tagName).toBe("SELECT");
    expect(editor.getAttribute("aria-label")).toBe("Edit Status for Black currant");
  });

  it("gives custom editors a persistent association with their validation message", async () => {
    const columns = widgetColumns.map((column) =>
      column.id === "status"
        ? {
            ...column,
            parse: () => {
              throw new Error("Choose a valid status.");
            },
          }
        : column,
    );
    const grid = await renderGrid({ columns });
    grid.activeCell = { rowId: "black-currant", columnId: "status" };
    (grid as any).startEditingCell(grid.activeCell);
    await nextFrames(2);
    const editor = grid.shadowRoot?.querySelector(
      '.cell-editor[data-cell-editor="custom"]',
    ) as (HTMLElement & { value: string }) | null;
    if (!editor) throw new Error("Expected the rendered custom editor.");
    editor.value = "Unknown";
    editor.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    expect(grid.commitActiveEdit()).toBe(false);
    await nextFrames(2);

    const messageId = editor.getAttribute("aria-errormessage");
    const trigger = editor.shadowRoot?.querySelector<HTMLButtonElement>(".trigger");
    trigger?.focus();
    const internalMessageId = trigger?.getAttribute("aria-errormessage");
    expect(editor.getAttribute("invalid")).not.toBeNull();
    expect(messageId).toBeNull();
    expect(editor.shadowRoot?.activeElement).toBe(trigger);
    expect(trigger?.getAttribute("aria-label")).toContain("Black currant");
    expect(trigger?.getAttribute("aria-invalid")).toBe("true");
    expect(internalMessageId).toBeTruthy();
    expect(editor.shadowRoot?.getElementById(internalMessageId ?? "")?.textContent).toContain(
      "valid status",
    );
    expect(editor.shadowRoot?.querySelectorAll('[role="alert"]')).toHaveLength(0);
    const gridAlerts = Array.from(grid.shadowRoot?.querySelectorAll('[role="alert"]') ?? []).filter(
      (alert) => Boolean(alert.textContent?.trim()),
    );
    expect(gridAlerts).toHaveLength(1);
    expect(gridAlerts[0]?.textContent).toContain("valid status");
  });

  it("retains an invalid draft when a rendered filter transition is attempted", async () => {
    const grid = await renderGrid();
    grid.showFilter = true;
    await nextFrames(2);
    const editor = await openRenderedEditor(grid, "romanesco", "dtm");
    editor.value = "eight days";
    editor.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    const filter = grid.shadowRoot?.querySelector("violet-text-field.filter-field") as
      | (HTMLElement & { value: string })
      | null;
    if (!filter) throw new Error("Expected the rendered filter field.");
    filter.value = "currant";

    filter.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await nextFrames(3);

    expect(grid.filterState).toEqual({});
    expect(filter.value).toBe("");
    expect(grid.editingCell).toEqual({ rowId: "romanesco", columnId: "dtm" });
    expect(grid.shadowRoot?.querySelector('[role="alert"]')?.textContent).toContain("number");
  });

  it("retains draft selection when a same-identity row refreshes", async () => {
    const grid = await renderGrid();
    const transitions: string[] = [];
    grid.addEventListener("cell-change", () => transitions.push("commit"));
    grid.addEventListener("edit-cancel", () => transitions.push("cancel"));
    const editor = await openRenderedEditor(grid, "black-currant", "commonName");
    editor.value = "Gooseberry";
    editor.setSelectionRange(3, 3);
    editor.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    expect(grid.shadowRoot?.activeElement).toBe(editor);

    grid.rows = widgetRows.map((row) =>
      row.id === "romanesco" ? { ...row, data: { ...row.data, status: "Harvesting" } } : row,
    );
    await nextFrames(5);

    const retainedEditor = grid.shadowRoot?.querySelector(
      '.cell-editor[data-row-id="black-currant"][data-column-id="commonName"]',
    ) as HTMLInputElement | null;
    expect(transitions).toEqual([]);
    expect(grid.editingCell).toEqual({ rowId: "black-currant", columnId: "commonName" });
    expect(retainedEditor).toBeTruthy();
    expect(retainedEditor?.value).toBe("Gooseberry");
    expect(retainedEditor?.selectionStart).toBe(3);
    expect(retainedEditor?.selectionEnd).toBe(3);
    expect(grid.shadowRoot?.activeElement).toBe(retainedEditor);
  });

  it("commits deliberate focus departure during a same-identity refresh", async () => {
    const grid = await renderGrid();
    const changes: VioletDataGridChangeDetail[] = [];
    grid.addEventListener("cell-change", (event) => changes.push((event as CustomEvent).detail));
    const editor = await openRenderedEditor(grid, "black-currant", "commonName");
    editor.value = "Gooseberry";
    editor.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    const outside = document.createElement("button");
    outside.textContent = "Outside grid";
    document.body.append(outside);

    grid.rows = widgetRows.map((row) => ({ ...row }));
    outside.focus();
    await nextFrames(5);

    expect(changes).toEqual([{ rowId: "black-currant", columnId: "commonName", value: "Gooseberry" }]);
    expect(grid.editingCell).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it("keeps unmarked native and marked shadow widget activation out of grid ownership", async () => {
    const columns: VioletDataGridColumn<TestRow>[] = [
      { ...widgetColumns[1]!, cellTemplate: nativeWidgetCellTemplate },
      { ...widgetColumns[2]!, cellTemplate: shadowWidgetCellTemplate },
    ];
    const grid = await renderGrid({ columns });
    grid.activeCell = { rowId: "romanesco", columnId: "commonName" };
    grid.cellSelection = {
      anchor: { rowId: "romanesco", columnId: "commonName" },
      focus: { rowId: "romanesco", columnId: "status" },
    };
    const initialSelection = grid.cellSelection;
    await nextFrames(2);
    const nativeButton = grid.shadowRoot?.querySelector(
      'td[data-row-id="black-currant"][data-column-id="commonName"] button',
    ) as HTMLButtonElement | null;
    const shadowHost = grid.shadowRoot?.querySelector(
      'td[data-row-id="black-currant"][data-column-id="status"] violet-button',
    ) as HTMLElement | null;
    const shadowButton = shadowHost?.shadowRoot?.querySelector(
      "button",
    ) as HTMLButtonElement | null;
    if (!nativeButton || !shadowButton) throw new Error("Expected rendered cell widgets.");
    const nativeHeaderButton = grid.shadowRoot?.querySelector(
      'th[data-column-id="commonName"] .header-button',
    );
    if (!nativeHeaderButton) throw new Error("Expected the native sortable header button.");

    const nativeCheckbox = nativeButton.parentElement?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    const nativeTextInput = nativeButton.parentElement?.querySelector(
      'input[type="text"]',
    ) as HTMLInputElement | null;
    if (!nativeCheckbox || !nativeTextInput) throw new Error("Expected the native input fixtures.");
    const nativeNestedTarget = nativeButton.querySelector("circle");
    if (!nativeNestedTarget) throw new Error("Expected the nested SVG target.");
    let nativeActions = 0;
    nativeButton.addEventListener("click", () => {
      nativeActions += 1;
    });

    const pointerDown = new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      button: 0,
      pointerId: 7,
    });
    nativeNestedTarget.dispatchEvent(pointerDown);
    nativeNestedTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    const nativeDoubleClick = new MouseEvent("dblclick", {
      bubbles: true,
      composed: true,
      detail: 2,
    });
    nativeNestedTarget.dispatchEvent(nativeDoubleClick);
    nativeHeaderButton.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, composed: true, detail: 2 }),
    );
    expect(nativeCheckbox.checked).toBe(false);
    let nativeInputDefaultPrevented: boolean | undefined;
    document.addEventListener(
      "click",
      (event) => {
        nativeInputDefaultPrevented = event.defaultPrevented;
      },
      { once: true },
    );
    await userEvent.click(nativeCheckbox);
    expect(nativeCheckbox.checked).toBe(true);
    await userEvent.click(nativeTextInput);
    expect(grid.shadowRoot?.activeElement).toBe(nativeTextInput);
    shadowButton.click();
    shadowButton.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, composed: true, detail: 2 }),
    );
    await nextFrames(2);

    expect(grid.activeCell).toEqual({ rowId: "romanesco", columnId: "commonName" });
    expect(grid.cellSelection).toBe(initialSelection);
    expect(grid.editingCell).toBeNull();
    expect(pointerDown.defaultPrevented).toBe(false);
    expect(nativeDoubleClick.defaultPrevented).toBe(false);
    expect(nativeActions).toBe(1);
    expect(nativeInputDefaultPrevented).toBe(false);
  });

  it("opens an ordinary editable cell with a real double click", async () => {
    const grid = await renderGrid();
    const cell = grid.shadowRoot?.querySelector(
      'td[data-row-id="black-currant"][data-column-id="commonName"]',
    ) as HTMLTableCellElement | null;
    if (!cell) throw new Error("Expected an ordinary editable cell.");

    await userEvent.dblClick(cell);
    await nextFrames(2);

    expect(grid.activeCell).toEqual({ rowId: "black-currant", columnId: "commonName" });
    expect(grid.editingCell).toEqual({ rowId: "black-currant", columnId: "commonName" });
    expect(
      grid.shadowRoot?.querySelector(
        '.cell-editor[data-row-id="black-currant"][data-column-id="commonName"]',
      ),
    ).not.toBeNull();
  });

  it("commits a valid draft exactly once before a rendered sort transition", async () => {
    const grid = await renderGrid();
    const editor = await openRenderedEditor(grid, "black-currant", "commonName");
    const changes: VioletDataGridChangeDetail[] = [];
    grid.addEventListener("cell-change", (event) => {
      changes.push((event as CustomEvent<VioletDataGridChangeDetail>).detail);
    });
    editor.value = "Gooseberry";
    editor.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    const sortButton = grid.shadowRoot?.querySelector(
      'th[data-column-id="commonName"] .header-button',
    ) as HTMLButtonElement | null;
    sortButton?.click();
    await nextFrames(2);

    expect(changes).toEqual([
      { rowId: "black-currant", columnId: "commonName", value: "Gooseberry" },
    ]);
    expect(grid.editingCell).toBeNull();
    expect(grid.sort).toEqual({ columnId: "commonName", direction: "ascending" });
  });

  it("cancels once when edited row removal invalidates the stable target", async () => {
    const grid = await renderGrid();
    await openRenderedEditor(grid, "black-currant", "commonName");
    const cancellations: VioletDataGridCellLocation[] = [];
    const changes: VioletDataGridChangeDetail[] = [];
    grid.addEventListener("edit-cancel", (event) => {
      cancellations.push((event as CustomEvent<VioletDataGridCellLocation>).detail);
    });
    grid.addEventListener("cell-change", (event) => {
      changes.push((event as CustomEvent<VioletDataGridChangeDetail>).detail);
    });

    grid.rows = [widgetRows[1]!];
    await nextFrames(2);

    expect(cancellations).toEqual([{ rowId: "black-currant", columnId: "commonName" }]);
    expect(changes).toEqual([]);
    expect(grid.editingCell).toBeNull();
  });

  const invalidatingColumnTransitions: Array<{
    transition: string;
    columns: VioletDataGridColumn<TestRow>[];
  }> = [
    {
      transition: "column removal",
      columns: widgetColumns.filter((column) => column.id !== "commonName"),
    },
    {
      transition: "column becoming read-only",
      columns: widgetColumns.map((column) =>
        column.id === "commonName" ? { ...column, editable: false } : column,
      ),
    },
  ];

  it.each(invalidatingColumnTransitions)(
    "cancels once when $transition invalidates the stable target",
    async ({ columns }) => {
    const grid = await renderGrid();
    await openRenderedEditor(grid, "black-currant", "commonName");
    const cancellations: VioletDataGridCellLocation[] = [];
    grid.addEventListener("edit-cancel", (event) => {
      cancellations.push((event as CustomEvent<VioletDataGridCellLocation>).detail);
    });

    grid.columns = columns as VioletDataGridColumn[];
    await nextFrames(2);

    expect(cancellations).toEqual([{ rowId: "black-currant", columnId: "commonName" }]);
    expect(grid.editingCell).toBeNull();
    },
  );

  it("cancels an unresolved session synchronously when the grid disconnects", async () => {
    const grid = await renderGrid();
    await openRenderedEditor(grid, "black-currant", "commonName");
    const cancellations: VioletDataGridCellLocation[] = [];
    grid.addEventListener("edit-cancel", (event) => {
      cancellations.push((event as CustomEvent<VioletDataGridCellLocation>).detail);
    });

    grid.remove();

    expect(cancellations).toEqual([{ rowId: "black-currant", columnId: "commonName" }]);
    expect(grid.editingCell).toBeNull();
  });
});
