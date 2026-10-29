import { html } from "@lushly-dev/fast-element";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "../button/violet-button";
import "./violet-data-grid-pill-select";
import "./violet-data-grid";
import type {
    VioletDataGridCellLocation,
  VioletDataGridCellRange,
  VioletDataGridCellTemplateContext,
  VioletDataGridChangeDetail,
  VioletDataGridColumn,
    VioletDataGridColumnWidthDetail,
    VioletDataGridCopyDetail,
    VioletDataGridFillDetail,
    VioletDataGridFilterState,
    VioletDataGridFocusMode,
    VioletDataGridPasteDetail,
    VioletDataGridRow,
    VioletDataGridSort,
} from "./violet-data-grid";

type CultivationRow = {
    commonName: string;
    family: string;
    light: string;
    dtm: string;
    status: string;
    botanicalName?: string;
    cultivar?: string;
    spacing?: string;
    bed?: string;
    irrigationZone?: string;
    seedSource?: string;
    tracked?: boolean;
};

type StatusTone = "teal" | "green" | "olive" | "gold" | "blue" | "gray";

const columns: VioletDataGridColumn<CultivationRow>[] = [
    {
        id: "commonName",
        label: "Plant",
        sortable: true,
    value: (row) => row.commonName,
    },
    {
        id: "family",
        label: "Family",
        sortable: true,
    value: (row) => row.family,
    },
    {
        id: "light",
        label: "Light",
    value: (row) => row.light,
    },
    {
        id: "dtm",
        label: "DTM",
        sortable: true,
        align: "end",
    value: (row) => row.dtm,
    },
    {
        id: "status",
        label: "Status",
    value: (row) => row.status,
    },
];

const editableColumns: VioletDataGridColumn<CultivationRow>[] = [
    {
        id: "commonName",
        label: "Plant",
        sortable: true,
        editable: true,
        editor: "text",
    value: (row) => row.commonName,
    },
    {
        id: "family",
        label: "Family",
        sortable: true,
    value: (row) => row.family,
    },
    {
        id: "light",
        label: "Light",
    value: (row) => row.light,
    },
    {
        id: "dtm",
        label: "DTM",
        sortable: true,
        align: "end",
        editable: true,
        editor: "number",
    value: (row) => row.dtm,
    },
    {
        id: "status",
        label: "Status",
        editable: true,
        editor: "text",
    value: (row) => row.status,
    },
];

const statusChipTemplate = html<VioletDataGridCellTemplateContext<CultivationRow>>`
    <span
        style="
            display:inline-flex;
            align-items:center;
            justify-content:flex-start;
            box-sizing:border-box;
            inline-size:fit-content;
            min-inline-size:0;
            max-inline-size:100%;
            min-block-size:1.5rem;
            gap:0.3125rem;
            padding-inline:0.625rem 0.5625rem;
            border:1px solid transparent;
            border-radius:999px;
            ${(x) => statusOptionStyle(String(x.rawValue ?? x.text))};
            font-size:0.8125rem;
            line-height:1;
            white-space:nowrap;
        "
    >
        <span
            style="
                min-inline-size:0;
                overflow:hidden;
                text-overflow:ellipsis;
                white-space:nowrap;
            "
        >
            ${(x) => x.text}
        </span>
        <span
            aria-hidden="true"
            style="
                inline-size:0.375rem;
                block-size:0.375rem;
                flex:0 0 auto;
                margin-inline-start:0.0625rem;
                border-inline-end:1.25px solid currentColor;
                border-block-end:1.25px solid currentColor;
                transform:translateY(-2.5px) rotate(45deg);
                opacity:0;
            "
        ></span>
    </span>
`;

const statusEditorOptions: Array<{ label: string; value: string; tone: StatusTone }> = [
    { label: "Seedling", value: "Seedling", tone: "blue" },
    { label: "In bed", value: "In bed", tone: "teal" },
    { label: "Established", value: "Established", tone: "olive" },
    { label: "Harvesting", value: "Harvesting", tone: "green" },
];

function statusOptionStyle(value: string): string {
  const option = statusEditorOptions.find((candidate) => candidate.value === value);

    switch (option?.tone) {
        case "teal":
            return "background:#0b7280;color:#ffffff;border-color:transparent;";
        case "green":
            return "background:#176c27;color:#ffffff;border-color:transparent;";
        case "olive":
            return "background:#547d46;color:#f5fbf2;border-color:transparent;";
        case "gold":
            return "background:#8b6b24;color:#fff7de;border-color:transparent;";
        case "blue":
            return "background:#416b89;color:#ffffff;border-color:transparent;";
        case "gray":
            return "background:#606672;color:#f6f7fa;border-color:transparent;";
        default:
            return "background:color-mix(in srgb, var(--color-surface-subtle, #f0efe6) 86%, white);color:var(--color-text-primary, #18181b);border-color:color-mix(in srgb, var(--color-border-subtle, rgba(28, 26, 13, 0.10)) 80%, transparent);";
    }
}

const statusPillEditorTemplate = html<VioletDataGridCellTemplateContext<CultivationRow>>`
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

const widgetColumns: VioletDataGridColumn<CultivationRow>[] = [
    {
        id: "tracked",
        label: "Track",
        width: "5rem",
        align: "center",
        editable: true,
        editor: "checkbox",
    value: (row) => row.tracked ?? false,
    parse: (value) => Boolean(value),
    serialize: (value) => (value ? "true" : "false"),
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
        cellTemplate: statusChipTemplate,
        editorTemplate: statusPillEditorTemplate,
        editorOptions: statusEditorOptions,
    },
    {
        id: "dtm",
        label: "DTM",
        sortable: true,
        align: "end",
        editable: true,
        editor: "number",
    value: (row) => row.dtm,
    },
];

const rows: VioletDataGridRow<CultivationRow>[] = [
    {
        id: "black-currant",
        label: "Black currant",
        data: {
            commonName: "Black currant",
            family: "Grossulariaceae",
            light: "Part sun",
            dtm: "365",
            status: "Established",
            tracked: true,
        },
    },
    {
        id: "romanesco",
        label: "Romanesco cauliflower",
        data: {
            commonName: "Romanesco",
            family: "Brassicaceae",
            light: "Full sun",
            dtm: "80",
            status: "In bed",
            tracked: false,
        },
    },
    {
        id: "tomato-midnight",
        label: "Midnight Roma tomato",
        data: {
            commonName: "Midnight Roma tomato",
            family: "Solanaceae",
            light: "Full sun",
            dtm: "78",
            status: "Seedling",
            tracked: true,
        },
    },
];

const wideColumns: VioletDataGridColumn<CultivationRow>[] = [
    {
        id: "commonName",
        label: "Plant",
        sortable: true,
        width: "18rem",
    value: (row) => row.commonName,
    },
    {
        id: "botanicalName",
        label: "Botanical name",
        width: "20rem",
    value: (row) => row.botanicalName ?? "",
    },
    {
        id: "cultivar",
        label: "Cultivar",
        width: "16rem",
    value: (row) => row.cultivar ?? "",
    },
    {
        id: "family",
        label: "Family",
        width: "16rem",
    value: (row) => row.family,
    },
    {
        id: "spacing",
        label: "Spacing",
        width: "12rem",
    value: (row) => row.spacing ?? "",
    },
    {
        id: "light",
        label: "Light",
        width: "12rem",
    value: (row) => row.light,
    },
    {
        id: "dtm",
        label: "Days to maturity",
        sortable: true,
        align: "end",
        width: "14rem",
    value: (row) => row.dtm,
    },
    {
        id: "bed",
        label: "Bed",
        width: "12rem",
    value: (row) => row.bed ?? "",
    },
    {
        id: "irrigationZone",
        label: "Irrigation zone",
        width: "14rem",
    value: (row) => row.irrigationZone ?? "",
    },
    {
        id: "seedSource",
        label: "Seed source",
        width: "18rem",
    value: (row) => row.seedSource ?? "",
    },
    {
        id: "status",
        label: "Status",
        width: "14rem",
    value: (row) => row.status,
    },
];

const resizableColumns: VioletDataGridColumn<CultivationRow>[] = [
    {
        id: "commonName",
        label: "Plant",
        sortable: true,
        width: "7rem",
    value: (row) => row.commonName,
    },
    {
        id: "family",
        label: "Family",
        sortable: true,
        width: "8rem",
    value: (row) => row.family,
    },
    {
        id: "light",
        label: "Light",
        width: "7rem",
    value: (row) => row.light,
    },
    {
        id: "dtm",
        label: "DTM",
        sortable: true,
        align: "end",
        width: "4.5rem",
    value: (row) => row.dtm,
    },
    {
        id: "status",
        label: "Status",
        width: "6rem",
    value: (row) => row.status,
    },
];

function createPlantRows(count: number): VioletDataGridRow<CultivationRow>[] {
    const statuses = ["Seedling", "In bed", "Established", "Harvesting"];
    const lights = ["Full sun", "Part sun", "Part shade"];
    const families = ["Rosaceae", "Brassicaceae", "Solanaceae", "Asteraceae", "Apiaceae"];

    return Array.from({ length: count }, (_, index) => {
        const position = index + 1;

        return {
            id: `plant-${position}`,
            label: `Plant ${position}`,
            data: {
                commonName: `Plant ${position}`,
                family: families[index % families.length] ?? "Rosaceae",
                light: lights[index % lights.length] ?? "Full sun",
                dtm: String(55 + (index % 140)),
                status: statuses[index % statuses.length] ?? "Seedling",
                botanicalName: "Solanum lycopersicum",
                cultivar: "Midnight Roma",
                spacing: `${12 + (index % 4) * 6} in`,
                bed: `North bed ${1 + (index % 6)}`,
                irrigationZone: `Zone ${1 + (index % 4)}`,
                seedSource: "Experimental Seed Co.",
            },
        };
    });
}

type GridArgs = {
    columns: VioletDataGridColumn<CultivationRow>[];
    columnWidths?: Record<string, string>;
    busy: boolean;
    density: "compact" | "natural" | "comfortable";
    focusMode: VioletDataGridFocusMode;
    selectionMode: "none" | "single" | "multiple";
    showFilter: boolean;
    showToolbarAction: boolean;
    stickyHeader: boolean;
    virtualize: boolean;
    estimatedRowHeight: number;
    overscanCount: number;
    maxInlineSize?: string;
  blockSize?: string;
    virtualizedMaxBlockSize?: string;
    rows: VioletDataGridRow<CultivationRow>[];
    filterState?: VioletDataGridFilterState;
};

type VioletDataGridElement = HTMLElement & {
    columns: VioletDataGridColumn<CultivationRow>[];
    columnWidths: Record<string, string>;
    rows: VioletDataGridRow<CultivationRow>[];
    presentedRows: VioletDataGridRow<CultivationRow>[];
  renderedRows: Array<{
    item: { index: number; start: number; end: number; size: number };
    row: VioletDataGridRow<CultivationRow>;
  }>;
    busy: boolean;
    density: "compact" | "natural" | "comfortable";
    focusMode: VioletDataGridFocusMode;
    selectionMode: "none" | "single" | "multiple";
    showFilter: boolean;
    stickyHeader: boolean;
    virtualize: boolean;
    estimatedRowHeight: number;
    overscanCount: number;
    virtualPaddingStart: number;
    virtualPaddingEnd: number;
    filterState: VioletDataGridFilterState;
    selectedRowIds: string[];
    sort: VioletDataGridSort | null;
    activeCell: VioletDataGridCellLocation | null;
    cellSelection: VioletDataGridCellRange | null;
    editingCell: VioletDataGridCellLocation | null;
};

function applyGridChanges(
    rowsToUpdate: VioletDataGridRow<CultivationRow>[],
  changes: VioletDataGridChangeDetail[],
): VioletDataGridRow<CultivationRow>[] {
    const changesByRow = new Map<string, VioletDataGridChangeDetail[]>();

    for (const change of changes) {
        const existing = changesByRow.get(change.rowId) ?? [];
        existing.push(change);
        changesByRow.set(change.rowId, existing);
    }

  return rowsToUpdate.map((row) => {
        const rowChanges = changesByRow.get(row.id);
        if (!rowChanges?.length) {
            return row;
        }

        const nextData = { ...row.data } as Record<string, string | boolean | undefined>;
        for (const change of rowChanges) {
            nextData[change.columnId] =
                change.value === null
                    ? ""
                    : typeof change.value === "boolean"
                      ? change.value
                      : String(change.value);
        }

        return {
            ...row,
            data: nextData as CultivationRow,
        };
    });
}

function renderGrid(args: GridArgs): HTMLElement {
    const grid = document.createElement("violet-data-grid") as VioletDataGridElement;
    grid.columns = args.columns;
    grid.columnWidths = args.columnWidths ?? {};
    grid.rows = args.rows;
    grid.busy = args.busy;
    grid.density = args.density;
    grid.focusMode = args.focusMode;
    grid.selectionMode = args.selectionMode;
    grid.showFilter = args.showFilter;
    grid.stickyHeader = args.stickyHeader;
    grid.virtualize = args.virtualize;
    grid.estimatedRowHeight = args.estimatedRowHeight;
    grid.overscanCount = args.overscanCount;
    grid.filterState = args.filterState ?? {};
    if (args.maxInlineSize) {
        grid.style.maxInlineSize = args.maxInlineSize;
    }
  if (args.blockSize) {
    grid.style.blockSize = args.blockSize;
  }
    if (args.virtualizedMaxBlockSize) {
    grid.style.setProperty(
      "--violet-data-grid-virtualized-max-block-size",
      args.virtualizedMaxBlockSize,
    );
    }

    if (args.showToolbarAction) {
        const toolbarButton = document.createElement("violet-button");
        toolbarButton.slot = "toolbar";
        toolbarButton.textContent = "Add plant";
        grid.append(toolbarButton);
    }

    return grid;
}

function renderMutableGrid(args: GridArgs): HTMLElement {
    const grid = renderGrid(args) as VioletDataGridElement;

    const handleCellChange = (event: Event) => {
        const detail = (event as CustomEvent<VioletDataGridChangeDetail>).detail;
        grid.rows = applyGridChanges(grid.rows, [detail]);
    };

    grid.addEventListener("cell-change", handleCellChange);

    return grid;
}

const meta: Meta<GridArgs> = {
    title: "Components/Data Grid/Grid",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Reference-grade FAST-AF data grid with semantic table markup, local sorting, selection, and semantic-token-driven styling.",
            },
        },
    },
    argTypes: {
        busy: { control: "boolean" },
        density: {
            control: "inline-radio",
            options: ["compact", "natural", "comfortable"],
        },
        focusMode: {
            control: "inline-radio",
            options: ["row", "cell"],
        },
        selectionMode: {
            control: "inline-radio",
            options: ["none", "single", "multiple"],
        },
        showFilter: { control: "boolean" },
        showToolbarAction: { control: "boolean" },
        stickyHeader: { control: "boolean" },
        virtualize: { control: "boolean" },
        estimatedRowHeight: { control: { type: "number", min: 24, max: 80, step: 2 } },
        overscanCount: { control: { type: "number", min: 1, max: 20, step: 1 } },
    },
    render: (args: GridArgs) => renderGrid(args),
};

export default meta;

type Story = StoryObj<GridArgs>;

export const Overview: Story = {
    args: {
        columns,
        busy: false,
        density: "natural",
        focusMode: "row",
        selectionMode: "multiple",
        showFilter: true,
        showToolbarAction: true,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {
            query: "",
        },
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;
        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.shadowRoot?.querySelector("table")).toBeTruthy();
            expect(grid?.presentedRows?.length ?? 0).toBeGreaterThan(0);
        });

        if (!grid) {
            throw new Error("Expected overview grid to render.");
        }

        const shadowRoot = grid?.shadowRoot;
        const table = shadowRoot?.querySelector("table");
        const sortButton = shadowRoot?.querySelector(".header-button") as HTMLButtonElement | null;
        const selectionCheckboxes = shadowRoot?.querySelectorAll("violet-checkbox");

        await expect(Boolean(table)).toBe(true);
        await expect(sortButton?.textContent ?? "").toContain("Plant");

        if (!sortButton || !selectionCheckboxes || selectionCheckboxes.length < 2) {
            throw new Error("Expected sort and selection controls to render.");
        }

        const rowCheckbox = selectionCheckboxes[1] as (HTMLElement & { checked?: boolean }) | undefined;

        if (!rowCheckbox) {
            throw new Error("Expected row selection checkbox to render.");
        }

        await userEvent.click(rowCheckbox);

        await waitFor(() => {
            expect(grid.selectedRowIds).toContain("black-currant");
        });

        await userEvent.click(sortButton);

        await waitFor(() => {
            expect(grid?.sort?.columnId).toBe("commonName");
            expect(grid?.sort?.direction).toBe("ascending");
            // Selection is keyed by row id and survives sorting.
            expect(grid.selectedRowIds).toEqual(["black-currant"]);
            expect(grid.activeCell).toBeNull();
        });
    },
};

export const ColumnResizing: Story = {
    args: {
        columns: resizableColumns,
        columnWidths: {},
        busy: false,
        density: "natural",
        focusMode: "row",
        selectionMode: "multiple",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
        });

        const shadowRoot = grid?.shadowRoot;
        const dtmHandle = shadowRoot?.querySelector(
      '[data-column-resizer="dtm"]',
        ) as HTMLButtonElement | null;
        const dtmHeader = shadowRoot?.querySelector(
      'th[data-column-id="dtm"]',
        ) as HTMLTableCellElement | null;
        const plantHandle = shadowRoot?.querySelector(
      '[data-column-resizer="commonName"]',
        ) as HTMLButtonElement | null;
        const plantHeader = shadowRoot?.querySelector(
      'th[data-column-id="commonName"]',
        ) as HTMLTableCellElement | null;

        if (!grid || !shadowRoot || !dtmHandle || !dtmHeader || !plantHandle || !plantHeader) {
            throw new Error("Expected resize handles and headers to render.");
        }

        const resizeHandles = Array.from(
            shadowRoot.querySelectorAll<HTMLButtonElement>(".column-resizer"),
        );

        for (const handle of resizeHandles) {
            const handleBounds = handle.getBoundingClientRect();
            const header = handle.closest("th");
            const sortButton = header?.querySelector<HTMLButtonElement>(".header-button");
            const nextSortButton = header?.nextElementSibling?.querySelector<HTMLButtonElement>(
                ".header-button",
            );

            await expect(handleBounds.width).toBeGreaterThanOrEqual(24);
            await expect(handleBounds.height).toBeGreaterThanOrEqual(24);
            await expect(handle.getAttribute("aria-label")).toMatch(/^Resize .+ column$/);

            if (sortButton) {
                await expect(handleBounds.left).toBeGreaterThanOrEqual(
                    sortButton.getBoundingClientRect().right,
                );
            }

            if (nextSortButton) {
                await expect(handleBounds.right).toBeLessThanOrEqual(
                    nextSortButton.getBoundingClientRect().left,
                );
            }
        }

    let widthDetail:
      | (VioletDataGridColumnWidthDetail & { columnWidths: Record<string, string> })
      | null = null;
        const handleWidthChange = (event: Event) => {
            widthDetail = (
        event as CustomEvent<
          VioletDataGridColumnWidthDetail & { columnWidths: Record<string, string> }
        >
            ).detail;
        };

        grid.addEventListener("column-width-change", handleWidthChange as EventListener);

        try {
            const startWidth = dtmHeader.getBoundingClientRect().width;
            const dtmRect = dtmHandle.getBoundingClientRect();
            const pointerId = 21;

            dtmHandle.dispatchEvent(
                new PointerEvent("pointerdown", {
                    bubbles: true,
                    composed: true,
                    pointerId,
                    pointerType: "mouse",
                    button: 0,
                    buttons: 1,
                    clientX: dtmRect.left + dtmRect.width / 2,
                    clientY: dtmRect.top + dtmRect.height / 2,
        }),
            );

            dtmHandle.dispatchEvent(
                new PointerEvent("pointermove", {
                    bubbles: true,
                    composed: true,
                    pointerId,
                    pointerType: "mouse",
                    button: 0,
                    buttons: 1,
                    clientX: dtmRect.left + dtmRect.width / 2 + 36,
                    clientY: dtmRect.top + dtmRect.height / 2,
        }),
            );

            dtmHandle.dispatchEvent(
                new PointerEvent("pointerup", {
                    bubbles: true,
                    composed: true,
                    pointerId,
                    pointerType: "mouse",
                    button: 0,
                    buttons: 0,
                    clientX: dtmRect.left + dtmRect.width / 2 + 36,
                    clientY: dtmRect.top + dtmRect.height / 2,
        }),
            );

            await waitFor(() => {
                expect(grid.columnWidths.dtm).toMatch(/px$/);
                expect(dtmHeader.getBoundingClientRect().width).toBeGreaterThan(startWidth + 20);
            });

            const previousPlantWidth = grid.columnWidths.commonName;
            plantHandle.dispatchEvent(
                new MouseEvent("dblclick", {
                    bubbles: true,
                    composed: true,
        }),
            );

            await waitFor(() => {
                expect(grid.columnWidths.commonName).toMatch(/px$/);
                expect(grid.columnWidths.commonName).not.toBe(previousPlantWidth);
                expect(widthDetail?.columnWidths.commonName).toBe(grid.columnWidths.commonName);
            });
        } finally {
            grid.removeEventListener("column-width-change", handleWidthChange as EventListener);
        }
    },
};

export const EmptyState: Story = {
    args: {
        columns,
        busy: false,
        density: "natural",
        focusMode: "row",
        selectionMode: "none",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: false,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows: [],
        filterState: {},
    },
};

export const BusyState: Story = {
    args: {
        columns,
        busy: true,
        density: "compact",
        focusMode: "row",
        selectionMode: "single",
        showFilter: true,
        showToolbarAction: true,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {
            query: "",
        },
    },
};

export const SingleSelection: Story = {
    args: {
        columns,
        busy: false,
        density: "natural",
        focusMode: "row",
        selectionMode: "single",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.selectionMode).toBe("single");
        });

        const shadowRoot = grid?.shadowRoot;
    const selectionRadios = shadowRoot?.querySelectorAll("violet-radio.selection-radio") as
      | NodeListOf<HTMLElement & { checked?: boolean; shadowRoot?: ShadowRoot | null }>
      | undefined;

        if (!grid || !selectionRadios || selectionRadios.length < 2) {
            throw new Error("Expected single-selection radio controls to render.");
        }

        const firstRadio = selectionRadios[0];
        const secondRadio = selectionRadios[1];
        const firstControl = firstRadio.shadowRoot?.querySelector(".root") as HTMLElement | null;
        const secondControl = secondRadio.shadowRoot?.querySelector(".root") as HTMLElement | null;

        if (!firstControl || !secondControl) {
            throw new Error("Expected inline radio controls to render.");
        }

        await userEvent.click(firstControl);

        await waitFor(() => {
            expect(grid.selectedRowIds).toEqual(["black-currant"]);
            expect(firstRadio.checked).toBe(true);
            expect(secondRadio.checked).toBe(false);
        });

        await userEvent.click(secondControl);

        await waitFor(() => {
            expect(grid.selectedRowIds).toEqual(["romanesco"]);
            expect(firstRadio.checked).toBe(false);
            expect(secondRadio.checked).toBe(true);
        });

        secondRadio.focus();
        expect(shadowRoot?.activeElement).toBe(secondRadio);
        let refreshSelectionChanges = 0;
        const handleRefreshSelectionChange = () => {
            refreshSelectionChanges += 1;
        };
        grid.addEventListener("selection-change", handleRefreshSelectionChange);
        grid.rows = grid.rows.map((row) => ({ ...row, data: { ...row.data } })).reverse();

        await waitFor(() => {
            const refreshedRadio = Array.from(
                shadowRoot?.querySelectorAll<HTMLElement>("violet-radio.selection-radio") ?? [],
            ).find((radio) => radio.getAttribute("value") === "romanesco");
            expect(shadowRoot?.activeElement).toBe(refreshedRadio);
            expect(grid.selectedRowIds).toEqual(["romanesco"]);
            expect(refreshSelectionChanges).toBe(0);
        });
        grid.removeEventListener("selection-change", handleRefreshSelectionChange);
    },
};

export const BareGrid: Story = {
    args: {
        columns,
        busy: false,
        density: "natural",
        focusMode: "row",
        selectionMode: "multiple",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
};

export const CellNavigation: Story = {
    args: {
        columns,
        busy: false,
        density: "natural",
        focusMode: "cell",
        selectionMode: "multiple",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.focusMode).toBe("cell");
        });

        const shadowRoot = grid?.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;

        if (!grid || !shadowRoot || !scrollContainer) {
            throw new Error("Expected cell-navigation grid to render.");
        }

        scrollContainer.focus();

        await waitFor(() => {
            expect(grid.activeCell?.rowId).toBe("black-currant");
            expect(grid.activeCell?.columnId).toBe("commonName");
            expect(
        shadowRoot.querySelector('td[data-active="true"]')?.getAttribute("data-column-id"),
            ).toBe("commonName");
        });

        await userEvent.keyboard("{ArrowRight}");
        await waitFor(() => {
            expect(grid.activeCell?.columnId).toBe("family");
        });

        await userEvent.keyboard("{End}");
        await waitFor(() => {
            expect(grid.activeCell?.columnId).toBe("status");
        });

        shadowRoot
            .querySelector(".table-scroll")
            ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", metaKey: true, bubbles: true }));

        await waitFor(() => {
            expect(grid.activeCell?.rowId).toBe("black-currant");
            expect(grid.activeCell?.columnId).toBe("commonName");
        });

        await userEvent.keyboard("{ArrowDown}");
        await waitFor(() => {
            expect(grid.activeCell?.rowId).toBe("romanesco");
            expect(grid.activeCell?.columnId).toBe("commonName");
        });
    },
};

/**
 * The column headers are part of the grid's keyboard model. In cell focus mode, ArrowUp from the first
 * row moves focus to the active column's header, ArrowLeft/ArrowRight move between headers, Enter or
 * Space sorts, Ctrl+Alt+R reaches the column's resizer and ArrowDown returns to the first row.
 */
export const HeaderKeyboard: Story = {
    args: {
        columns,
        busy: false,
        density: "natural",
        focusMode: "cell",
        selectionMode: "none",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(grid?.shadowRoot?.querySelector(".table-scroll")).toBeTruthy();
        });

        const shadowRoot = grid?.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;
        if (!grid || !shadowRoot || !scrollContainer) {
            throw new Error("Expected header-keyboard grid to render.");
        }

        for (const button of shadowRoot.querySelectorAll(".header-button")) {
            await expect(button.getAttribute("tabindex")).toBe("-1");
        }

        scrollContainer.focus();
        await waitFor(() => expect(grid.activeCell?.columnId).toBe("commonName"));

        await userEvent.keyboard("{ArrowUp}");
        const commonNameHeader = shadowRoot.querySelector<HTMLElement>(
            'th[data-column-id="commonName"] .header-button',
        );
        await waitFor(() => expect(shadowRoot.activeElement).toBe(commonNameHeader));

        await userEvent.keyboard("{Enter}");
        await waitFor(() => {
            expect(grid.sort).toEqual({ columnId: "commonName", direction: "ascending" });
            expect(
                shadowRoot.querySelector('th[data-column-id="commonName"]')?.getAttribute("aria-sort"),
            ).toBe("ascending");
        });

        await userEvent.keyboard("{ArrowRight}");
        const familyHeader = shadowRoot.querySelector('th[data-column-id="family"]');
        await waitFor(() => expect(familyHeader?.contains(shadowRoot.activeElement)).toBe(true));

        await userEvent.keyboard("{ArrowDown}");
        await waitFor(() => {
            expect(shadowRoot.activeElement).toBe(scrollContainer);
            expect(grid.activeCell?.columnId).toBe("family");
        });
    },
};

export const CellRangeSelection: Story = {
    args: {
        columns,
        busy: false,
        density: "natural",
        focusMode: "cell",
        selectionMode: "multiple",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.focusMode).toBe("cell");
        });

        const shadowRoot = grid?.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;

        if (!grid || !shadowRoot || !scrollContainer) {
            throw new Error("Expected range-selection grid to render.");
        }

        scrollContainer.focus();

        await waitFor(() => {
            expect(grid.activeCell?.rowId).toBe("black-currant");
            expect(grid.activeCell?.columnId).toBe("commonName");
            expect(grid.cellSelection).toBeNull();
        });

        await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowDown}{/Shift}");

        await waitFor(() => {
            expect(grid.activeCell?.rowId).toBe("romanesco");
            expect(grid.activeCell?.columnId).toBe("family");
            expect(grid.cellSelection?.anchor.rowId).toBe("black-currant");
            expect(grid.cellSelection?.anchor.columnId).toBe("commonName");
            expect(grid.cellSelection?.focus.rowId).toBe("romanesco");
            expect(grid.cellSelection?.focus.columnId).toBe("family");
            expect(shadowRoot.querySelectorAll('td[data-selected="true"]').length).toBe(4);
        });

        await userEvent.keyboard("{ArrowRight}");

        await waitFor(() => {
            expect(grid.activeCell?.columnId).toBe("light");
            expect(grid.cellSelection).toBeNull();
            expect(shadowRoot.querySelectorAll('td[data-selected="true"]').length).toBe(0);
        });
    },
};

export const FilterClearsSelection: Story = {
    args: {
        columns,
        busy: false,
        density: "natural",
        focusMode: "cell",
        selectionMode: "multiple",
        showFilter: true,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.focusMode).toBe("cell");
        });

        const shadowRoot = grid?.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;
    const filterField = shadowRoot?.querySelector(".filter-field") as
      | (HTMLElement & { value?: string })
      | null;

        if (!grid || !shadowRoot || !scrollContainer || !filterField) {
            throw new Error("Expected filterable grid to render.");
        }

        scrollContainer.focus();

        await waitFor(() => {
            expect(grid.activeCell?.rowId).toBe("black-currant");
            expect(grid.activeCell?.columnId).toBe("commonName");
        });

        await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowDown}{/Shift}");

        await waitFor(() => {
            expect(grid.cellSelection?.focus.rowId).toBe("romanesco");
            expect(grid.cellSelection?.focus.columnId).toBe("family");
        });

        filterField.value = "roma";
        filterField.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

        await waitFor(() => {
            expect(grid.filterState.query).toBe("roma");
            expect(grid.selectedRowIds).toEqual([]);
            expect(grid.activeCell?.rowId).toBe("romanesco");
            expect(grid.activeCell?.columnId).toBe("family");
            expect(grid.cellSelection).toBeNull();
        });
    },
};

export const PointerDragSelection: Story = {
    args: {
        columns,
        busy: false,
        density: "natural",
        focusMode: "cell",
        selectionMode: "multiple",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.focusMode).toBe("cell");
        });

        const shadowRoot = grid?.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;
        const startCell = shadowRoot?.querySelector(
      'td[data-row-id="black-currant"][data-column-id="commonName"]',
        ) as HTMLTableCellElement | null;
        const endCell = shadowRoot?.querySelector(
      'td[data-row-id="romanesco"][data-column-id="light"]',
        ) as HTMLTableCellElement | null;

        if (!grid || !shadowRoot || !scrollContainer || !startCell || !endCell) {
            throw new Error("Expected pointer-drag grid to render.");
        }

        const startRect = startCell.getBoundingClientRect();
        const endRect = endCell.getBoundingClientRect();
        const pointerId = 1;

        startCell.dispatchEvent(
            new PointerEvent("pointerdown", {
                bubbles: true,
                composed: true,
                pointerId,
                pointerType: "mouse",
                button: 0,
                buttons: 1,
                clientX: startRect.left + startRect.width / 2,
                clientY: startRect.top + startRect.height / 2,
      }),
        );

        scrollContainer.dispatchEvent(
            new PointerEvent("pointermove", {
                bubbles: true,
                composed: true,
                pointerId,
                pointerType: "mouse",
                button: 0,
                buttons: 1,
                clientX: endRect.left + endRect.width / 2,
                clientY: endRect.top + endRect.height / 2,
      }),
        );

        scrollContainer.dispatchEvent(
            new PointerEvent("pointerup", {
                bubbles: true,
                composed: true,
                pointerId,
                pointerType: "mouse",
                button: 0,
                buttons: 0,
                clientX: endRect.left + endRect.width / 2,
                clientY: endRect.top + endRect.height / 2,
      }),
        );

        await waitFor(() => {
            expect(grid.activeCell?.rowId).toBe("black-currant");
            expect(grid.activeCell?.columnId).toBe("commonName");
            expect(grid.cellSelection?.anchor.rowId).toBe("black-currant");
            expect(grid.cellSelection?.anchor.columnId).toBe("commonName");
            expect(grid.cellSelection?.focus.rowId).toBe("romanesco");
            expect(grid.cellSelection?.focus.columnId).toBe("light");
            expect(shadowRoot.querySelectorAll('td[data-selected="true"]').length).toBe(6);
        });
    },
};

export const CellCopy: Story = {
    args: {
        columns,
        busy: false,
        density: "natural",
        focusMode: "cell",
        selectionMode: "multiple",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.focusMode).toBe("cell");
        });

        const shadowRoot = grid?.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;

        if (!grid || !shadowRoot || !scrollContainer) {
            throw new Error("Expected copy-enabled grid to render.");
        }

        let copiedDetail: VioletDataGridCopyDetail | null = null;
        const handleCopy = (event: Event) => {
            copiedDetail = (event as CustomEvent<VioletDataGridCopyDetail>).detail;
        };
        grid.addEventListener("cell-copy", handleCopy);

        const originalClipboard = navigator.clipboard;
        let copiedText = "";
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                writeText: async (value: string) => {
                    copiedText = value;
                },
            },
        });

        try {
            scrollContainer.focus();

            await waitFor(() => {
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("commonName");
            });

            await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowDown}{/Shift}");

            await waitFor(() => {
                expect(grid.cellSelection?.focus.rowId).toBe("romanesco");
                expect(grid.cellSelection?.focus.columnId).toBe("family");
            });

            shadowRoot
                .querySelector(".table-scroll")
                ?.dispatchEvent(new KeyboardEvent("keydown", { key: "c", metaKey: true, bubbles: true }));

            await waitFor(() => {
        expect(copiedText).toBe("Black currant\tGrossulariaceae\nRomanesco\tBrassicaceae");
                expect(copiedDetail?.text).toBe(copiedText);
                expect(copiedDetail?.cells.length).toBe(4);
            });
        } finally {
            grid.removeEventListener("cell-copy", handleCopy);
            Object.defineProperty(navigator, "clipboard", {
                configurable: true,
                value: originalClipboard,
            });
        }
    },
};

export const CellEditing: Story = {
    args: {
        columns: editableColumns,
        busy: false,
        density: "natural",
        focusMode: "cell",
        selectionMode: "multiple",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.focusMode).toBe("cell");
        });

        const shadowRoot = grid?.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;

        if (!grid || !shadowRoot || !scrollContainer) {
            throw new Error("Expected editable grid to render.");
        }

        const handleCellChange = (event: Event) => {
            const detail = (event as CustomEvent<VioletDataGridChangeDetail>).detail;
            grid.rows = applyGridChanges(grid.rows, [detail]);
        };

        grid.addEventListener("cell-change", handleCellChange);

        try {
            scrollContainer.focus();

            await waitFor(() => {
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("commonName");
            });

            const firstCell = shadowRoot.querySelector(
        'td[data-row-id="black-currant"][data-column-id="commonName"]',
            ) as HTMLTableCellElement | null;

            if (!firstCell) {
                throw new Error("Expected first editable cell to render.");
            }

            await userEvent.dblClick(firstCell);

            await waitFor(() => {
                expect(grid.editingCell?.rowId).toBe("black-currant");
                expect(grid.editingCell?.columnId).toBe("commonName");
            });

            await waitFor(() => {
                expect(Boolean(shadowRoot.querySelector(".cell-editor"))).toBe(true);
            });

            const editor = shadowRoot.querySelector(".cell-editor") as HTMLInputElement | null;
            if (!editor) {
                throw new Error("Expected inline cell editor to render.");
            }

            editor.focus();
            editor.value = "Black currant reserve";
            editor.dispatchEvent(new Event("input", { bubbles: true }));
            editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

            await waitFor(() => {
                expect(grid.editingCell).toBeNull();
                expect(grid.rows[0]?.data.commonName).toBe("Black currant reserve");
                expect(
                    shadowRoot.querySelector('td[data-row-id="black-currant"][data-column-id="commonName"]')
            ?.textContent,
                ).toContain("Black currant reserve");
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("family");
            });

            shadowRoot
                .querySelector(".table-scroll")
                ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

            await waitFor(() => {
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("light");
            });

            shadowRoot
                .querySelector(".table-scroll")
                ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

            await waitFor(() => {
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("dtm");
            });

            shadowRoot
                .querySelector(".table-scroll")
                ?.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));

            await waitFor(() => {
                expect(grid.editingCell?.rowId).toBe("black-currant");
                expect(grid.editingCell?.columnId).toBe("dtm");
            });

            await waitFor(() => {
                expect(Boolean(shadowRoot.querySelector(".cell-editor"))).toBe(true);
            });

            const tabEditor = shadowRoot.querySelector(".cell-editor") as HTMLInputElement | null;
            if (!tabEditor) {
                throw new Error("Expected inline cell editor to render for tab navigation.");
            }

            tabEditor.focus();
            tabEditor.value = "412";
            tabEditor.dispatchEvent(new Event("input", { bubbles: true }));
            tabEditor.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
            );

            await waitFor(() => {
                expect(grid.editingCell).toBeNull();
                expect(grid.rows[0]?.data.dtm).toBe("412");
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("light");
            });

            shadowRoot
                .querySelector(".table-scroll")
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
        );

            await waitFor(() => {
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("family");
            });

            shadowRoot
                .querySelector(".table-scroll")
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
        );

            await waitFor(() => {
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("commonName");
            });

            shadowRoot
                .querySelector(".table-scroll")
                ?.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));

            await waitFor(() => {
                expect(grid.editingCell?.rowId).toBe("black-currant");
                expect(grid.editingCell?.columnId).toBe("commonName");
            });

            await waitFor(() => {
                expect(Boolean(shadowRoot.querySelector(".cell-editor"))).toBe(true);
            });

            const cancelEditor = shadowRoot.querySelector(".cell-editor") as HTMLInputElement | null;
            if (!cancelEditor) {
                throw new Error("Expected inline cell editor to render for cancel test.");
            }

            cancelEditor.focus();
            cancelEditor.value = "Discarded value";
            cancelEditor.dispatchEvent(new Event("input", { bubbles: true }));
            cancelEditor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

            await waitFor(() => {
                expect(grid.editingCell).toBeNull();
                expect(grid.rows[0]?.data.commonName).toBe("Black currant reserve");
                expect(grid.rows[0]?.data.dtm).toBe("412");
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("commonName");
            });
        } finally {
            grid.removeEventListener("cell-change", handleCellChange);
        }
    },
};

export const WidgetCells: Story = {
    render: (args: GridArgs) => renderMutableGrid(args),
    args: {
        columns: widgetColumns,
        busy: false,
        density: "natural",
        focusMode: "cell",
        selectionMode: "none",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
        });

        const shadowRoot = grid?.shadowRoot;
        const checkbox = shadowRoot?.querySelector(
      'td[data-row-id="romanesco"][data-column-id="tracked"] violet-checkbox[data-cell-widget="checkbox"]',
        ) as (HTMLElement & { checked?: boolean }) | null;
        const checkboxControl = checkbox?.shadowRoot?.querySelector(".box") as HTMLElement | null;

        if (!grid || !shadowRoot || !checkbox || !checkboxControl) {
            throw new Error("Expected widget checkbox cell to render.");
        }

        await userEvent.click(checkboxControl);

        await waitFor(() => {
      expect(grid.rows.find((row) => row.id === "romanesco")?.data.tracked).toBe(true);
            expect(checkbox.checked).toBe(true);
        });
    },
};

export const WidgetCellsDoubleClickEditing: Story = {
    render: (args: GridArgs) => renderMutableGrid(args),
    args: {
        columns: widgetColumns,
        busy: false,
        density: "natural",
        focusMode: "cell",
        selectionMode: "none",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.focusMode).toBe("cell");
        });

        const shadowRoot = grid?.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;
        const plantCell = shadowRoot?.querySelector(
      'td[data-row-id="black-currant"][data-column-id="commonName"]',
        ) as HTMLTableCellElement | null;
        const dtmCell = shadowRoot?.querySelector(
      'td[data-row-id="black-currant"][data-column-id="dtm"]',
        ) as HTMLTableCellElement | null;

        const dispatchCellDoubleClick = (cell: HTMLTableCellElement): void => {
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
        };

        if (!grid || !shadowRoot || !scrollContainer || !plantCell || !dtmCell) {
            throw new Error("Expected widget editing cells to render.");
        }

        scrollContainer.focus();

        const plantWidthBefore = plantCell.getBoundingClientRect().width;
        dispatchCellDoubleClick(plantCell);

        await waitFor(() => {
            expect(grid.editingCell?.rowId).toBe("black-currant");
            expect(grid.editingCell?.columnId).toBe("commonName");
            expect(Boolean(shadowRoot.querySelector('.cell-editor[data-cell-editor="text"]'))).toBe(true);
        });

        const plantWidthAfter = plantCell.getBoundingClientRect().width;
        expect(Math.abs(plantWidthAfter - plantWidthBefore)).toBeLessThan(2);

        const plantEditor = shadowRoot.querySelector(
      '.cell-editor[data-cell-editor="text"]',
        ) as HTMLInputElement | null;

        if (!plantEditor) {
            throw new Error("Expected plant text editor to render.");
        }

        plantEditor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

        await waitFor(() => {
            expect(grid.editingCell).toBeNull();
        });

        const dtmWidthBefore = dtmCell.getBoundingClientRect().width;
        dispatchCellDoubleClick(dtmCell);

        await waitFor(() => {
            expect(grid.editingCell?.rowId).toBe("black-currant");
            expect(grid.editingCell?.columnId).toBe("dtm");
      expect(Boolean(shadowRoot.querySelector('.cell-editor[data-cell-editor="number"]'))).toBe(
        true,
      );
        });

        const dtmWidthAfter = dtmCell.getBoundingClientRect().width;
        expect(Math.abs(dtmWidthAfter - dtmWidthBefore)).toBeLessThan(2);

    const dtmEditor = shadowRoot.querySelector(
      '.cell-editor[data-cell-editor="number"]',
    ) as HTMLInputElement | null;
    if (!dtmEditor) {
      throw new Error("Expected DTM number editor to render.");
    }
    dtmEditor.value = "eight days";
    dtmEditor.dispatchEvent(new Event("input", { bubbles: true }));
    dtmEditor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await waitFor(() => {
      expect(grid.editingCell?.columnId).toBe("dtm");
      expect(dtmEditor.getAttribute("aria-invalid")).toBe("true");
      expect(shadowRoot.querySelector('[role="alert"]')?.textContent).toContain("number");
    });

    dtmEditor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitFor(() => {
      expect(grid.editingCell).toBeNull();
    });
    },
};

export const CellPaste: Story = {
    args: {
        columns: editableColumns,
        busy: false,
        density: "natural",
        focusMode: "cell",
        selectionMode: "multiple",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.focusMode).toBe("cell");
        });

        const shadowRoot = grid?.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;

        if (!grid || !shadowRoot || !scrollContainer) {
            throw new Error("Expected paste-enabled grid to render.");
        }

        let pastedDetail: VioletDataGridPasteDetail | null = null;
        const handleCellPaste = (event: Event) => {
            pastedDetail = (event as CustomEvent<VioletDataGridPasteDetail>).detail;
            grid.rows = applyGridChanges(grid.rows, pastedDetail.changes);
        };

        grid.addEventListener("cell-paste", handleCellPaste);

        try {
            scrollContainer.focus();

            await waitFor(() => {
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("commonName");
            });

            await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");

            await waitFor(() => {
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("dtm");
            });

      const pasteEvent = new Event("paste", {
        bubbles: true,
        cancelable: true,
      }) as ClipboardEvent;
            Object.defineProperty(pasteEvent, "clipboardData", {
                configurable: true,
                value: {
          getData: (type: string) => (type === "text/plain" ? "412\tQueued\n510\tStarted" : ""),
                },
            });

            scrollContainer.dispatchEvent(pasteEvent);

            await waitFor(() => {
                expect(pastedDetail?.origin.rowId).toBe("black-currant");
                expect(pastedDetail?.origin.columnId).toBe("dtm");
                expect(pastedDetail?.changes.length).toBe(4);
                expect(grid.rows[0]?.data.dtm).toBe("412");
                expect(grid.rows[0]?.data.status).toBe("Queued");
                expect(grid.rows[1]?.data.dtm).toBe("510");
                expect(grid.rows[1]?.data.status).toBe("Started");
            });

            await userEvent.keyboard("{Home}");
            await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowDown}{/Shift}");

            await waitFor(() => {
                expect(grid.cellSelection?.focus.rowId).toBe("romanesco");
                expect(grid.cellSelection?.focus.columnId).toBe("family");
            });

      const fillPasteEvent = new Event("paste", {
        bubbles: true,
        cancelable: true,
      }) as ClipboardEvent;
            Object.defineProperty(fillPasteEvent, "clipboardData", {
                configurable: true,
                value: {
                    getData: (type: string) => (type === "text/plain" ? "Queued" : ""),
                },
            });

            scrollContainer.dispatchEvent(fillPasteEvent);

            await waitFor(() => {
                expect(pastedDetail?.changes.length).toBe(2);
                expect(grid.rows[0]?.data.commonName).toBe("Queued");
                expect(grid.rows[1]?.data.commonName).toBe("Queued");
                expect(grid.rows[0]?.data.family).toBe("Grossulariaceae");
                expect(grid.rows[1]?.data.family).toBe("Brassicaceae");
            });
        } finally {
            grid.removeEventListener("cell-paste", handleCellPaste);
        }
    },
};

export const CellAutofill: Story = {
    args: {
        columns: editableColumns,
        busy: false,
        density: "natural",
        focusMode: "cell",
        selectionMode: "multiple",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.focusMode).toBe("cell");
        });

        const shadowRoot = grid?.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;

        if (!grid || !shadowRoot || !scrollContainer) {
            throw new Error("Expected autofill-enabled grid to render.");
        }

        let fillDetail: VioletDataGridFillDetail | null = null;
        const handleCellFill = (event: Event) => {
            fillDetail = (event as CustomEvent<VioletDataGridFillDetail>).detail;
            grid.rows = applyGridChanges(grid.rows, fillDetail.changes);
        };

        grid.addEventListener("cell-fill", handleCellFill);

        try {
            scrollContainer.focus();

            await waitFor(() => {
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("commonName");
            });

      await waitFor(() => {
        expect(shadowRoot.querySelector('[data-fill-handle="true"]')).toBeTruthy();
        expect(
          shadowRoot.querySelector(
            'td[data-row-id="tomato-midnight"][data-column-id="commonName"]',
          ),
        ).toBeTruthy();
      });
      const handle = shadowRoot.querySelector(
        '[data-fill-handle="true"]',
      ) as HTMLSpanElement | null;
            const targetCell = shadowRoot.querySelector(
        'td[data-row-id="tomato-midnight"][data-column-id="commonName"]',
            ) as HTMLTableCellElement | null;

            if (!handle || !targetCell) {
                throw new Error("Expected fill handle and target cell to render.");
            }

            const handleRect = handle.getBoundingClientRect();
            const targetRect = targetCell.getBoundingClientRect();
            const pointerId = 7;

            handle.dispatchEvent(
                new PointerEvent("pointerdown", {
                    bubbles: true,
                    composed: true,
                    pointerId,
                    pointerType: "mouse",
                    button: 0,
                    buttons: 1,
                    clientX: handleRect.left + handleRect.width / 2,
                    clientY: handleRect.top + handleRect.height / 2,
        }),
            );

            scrollContainer.dispatchEvent(
                new PointerEvent("pointermove", {
                    bubbles: true,
                    composed: true,
                    pointerId,
                    pointerType: "mouse",
                    button: 0,
                    buttons: 1,
                    clientX: targetRect.left + targetRect.width / 2,
                    clientY: targetRect.top + targetRect.height / 2,
        }),
            );

            await waitFor(() => {
                expect(shadowRoot.querySelectorAll('td[data-fill-preview="true"]').length).toBe(2);
            });

            scrollContainer.dispatchEvent(
                new PointerEvent("pointerup", {
                    bubbles: true,
                    composed: true,
                    pointerId,
                    pointerType: "mouse",
                    button: 0,
                    buttons: 0,
                    clientX: targetRect.left + targetRect.width / 2,
                    clientY: targetRect.top + targetRect.height / 2,
        }),
            );

            await waitFor(() => {
                expect(fillDetail?.source.anchor.rowId).toBe("black-currant");
                expect(fillDetail?.source.anchor.columnId).toBe("commonName");
                expect(fillDetail?.target.focus.rowId).toBe("tomato-midnight");
                expect(fillDetail?.target.focus.columnId).toBe("commonName");
                expect(fillDetail?.changes.length).toBe(2);
                expect(grid.rows[1]?.data.commonName).toBe("Black currant");
                expect(grid.rows[2]?.data.commonName).toBe("Black currant");
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("commonName");
            });
        } finally {
            grid.removeEventListener("cell-fill", handleCellFill);
        }
    },
};

export const CellAutofillHorizontal: Story = {
    args: {
        columns: editableColumns,
        busy: false,
        density: "natural",
        focusMode: "cell",
        selectionMode: "multiple",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.focusMode).toBe("cell");
        });

        const shadowRoot = grid?.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;

        if (!grid || !shadowRoot || !scrollContainer) {
            throw new Error("Expected horizontal autofill-enabled grid to render.");
        }

        let fillDetail: VioletDataGridFillDetail | null = null;
        const handleCellFill = (event: Event) => {
            fillDetail = (event as CustomEvent<VioletDataGridFillDetail>).detail;
            grid.rows = applyGridChanges(grid.rows, fillDetail.changes);
        };

        grid.addEventListener("cell-fill", handleCellFill);

        try {
            scrollContainer.focus();

            await waitFor(() => {
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("commonName");
            });

            await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");

            await waitFor(() => {
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("dtm");
            });

            await waitFor(() => {
                expect(Boolean(shadowRoot.querySelector('[data-fill-handle="true"]'))).toBe(true);
                expect(
                    Boolean(
            shadowRoot.querySelector('td[data-row-id="black-currant"][data-column-id="status"]'),
          ),
                ).toBe(true);
            });

      const handle = shadowRoot.querySelector(
        '[data-fill-handle="true"]',
      ) as HTMLSpanElement | null;
            const targetCell = shadowRoot.querySelector(
        'td[data-row-id="black-currant"][data-column-id="status"]',
            ) as HTMLTableCellElement | null;

            if (!handle || !targetCell) {
                throw new Error("Expected horizontal fill handle and target cell to render.");
            }

            const handleRect = handle.getBoundingClientRect();
            const targetRect = targetCell.getBoundingClientRect();
            const pointerId = 8;

            handle.dispatchEvent(
                new PointerEvent("pointerdown", {
                    bubbles: true,
                    composed: true,
                    pointerId,
                    pointerType: "mouse",
                    button: 0,
                    buttons: 1,
                    clientX: handleRect.left + handleRect.width / 2,
                    clientY: handleRect.top + handleRect.height / 2,
        }),
            );

            scrollContainer.dispatchEvent(
                new PointerEvent("pointermove", {
                    bubbles: true,
                    composed: true,
                    pointerId,
                    pointerType: "mouse",
                    button: 0,
                    buttons: 1,
                    clientX: targetRect.left + targetRect.width / 2,
                    clientY: targetRect.top + targetRect.height / 2,
        }),
            );

            await waitFor(() => {
                expect(shadowRoot.querySelectorAll('td[data-fill-preview="true"]').length).toBe(1);
            });

            scrollContainer.dispatchEvent(
                new PointerEvent("pointerup", {
                    bubbles: true,
                    composed: true,
                    pointerId,
                    pointerType: "mouse",
                    button: 0,
                    buttons: 0,
                    clientX: targetRect.left + targetRect.width / 2,
                    clientY: targetRect.top + targetRect.height / 2,
        }),
            );

            await waitFor(() => {
                expect(fillDetail?.source.anchor.rowId).toBe("black-currant");
                expect(fillDetail?.source.anchor.columnId).toBe("dtm");
                expect(fillDetail?.target.focus.rowId).toBe("black-currant");
                expect(fillDetail?.target.focus.columnId).toBe("status");
                expect(fillDetail?.changes.length).toBe(1);
                expect(grid.rows[0]?.data.status).toBe("365");
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("dtm");
            });
        } finally {
            grid.removeEventListener("cell-fill", handleCellFill);
        }
    },
};

export const CellAutofillBlock: Story = {
    args: {
        columns: editableColumns,
        busy: false,
        density: "natural",
        focusMode: "cell",
        selectionMode: "multiple",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.focusMode).toBe("cell");
        });

        const shadowRoot = grid?.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;

        if (!grid || !shadowRoot || !scrollContainer) {
            throw new Error("Expected block autofill-enabled grid to render.");
        }

        let fillDetail: VioletDataGridFillDetail | null = null;
        const handleCellFill = (event: Event) => {
            fillDetail = (event as CustomEvent<VioletDataGridFillDetail>).detail;
            grid.rows = applyGridChanges(grid.rows, fillDetail.changes);
        };

        grid.addEventListener("cell-fill", handleCellFill);

        try {
            scrollContainer.focus();

            await waitFor(() => {
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("commonName");
            });

            await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");

            await waitFor(() => {
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("dtm");
            });

            await waitFor(() => {
                expect(Boolean(shadowRoot.querySelector('[data-fill-handle="true"]'))).toBe(true);
                expect(
                    Boolean(
            shadowRoot.querySelector('td[data-row-id="tomato-midnight"][data-column-id="status"]'),
          ),
                ).toBe(true);
            });

      const handle = shadowRoot.querySelector(
        '[data-fill-handle="true"]',
      ) as HTMLSpanElement | null;
            const targetCell = shadowRoot.querySelector(
        'td[data-row-id="tomato-midnight"][data-column-id="status"]',
            ) as HTMLTableCellElement | null;

            if (!handle || !targetCell) {
                throw new Error("Expected block fill handle and target cell to render.");
            }

            const handleRect = handle.getBoundingClientRect();
            const targetRect = targetCell.getBoundingClientRect();
            const pointerId = 9;

            handle.dispatchEvent(
                new PointerEvent("pointerdown", {
                    bubbles: true,
                    composed: true,
                    pointerId,
                    pointerType: "mouse",
                    button: 0,
                    buttons: 1,
                    clientX: handleRect.left + handleRect.width / 2,
                    clientY: handleRect.top + handleRect.height / 2,
        }),
            );

            scrollContainer.dispatchEvent(
                new PointerEvent("pointermove", {
                    bubbles: true,
                    composed: true,
                    pointerId,
                    pointerType: "mouse",
                    button: 0,
                    buttons: 1,
                    clientX: targetRect.left + targetRect.width / 2,
                    clientY: targetRect.top + targetRect.height / 2,
        }),
            );

            await waitFor(() => {
                expect(shadowRoot.querySelectorAll('td[data-fill-preview="true"]').length).toBe(5);
            });

            scrollContainer.dispatchEvent(
                new PointerEvent("pointerup", {
                    bubbles: true,
                    composed: true,
                    pointerId,
                    pointerType: "mouse",
                    button: 0,
                    buttons: 0,
                    clientX: targetRect.left + targetRect.width / 2,
                    clientY: targetRect.top + targetRect.height / 2,
        }),
            );

            await waitFor(() => {
                expect(fillDetail?.source.anchor.rowId).toBe("black-currant");
                expect(fillDetail?.source.anchor.columnId).toBe("dtm");
                expect(fillDetail?.target.focus.rowId).toBe("tomato-midnight");
                expect(fillDetail?.target.focus.columnId).toBe("status");
                expect(fillDetail?.changes.length).toBe(5);
                expect(grid.rows[0]?.data.status).toBe("365");
                expect(grid.rows[1]?.data.dtm).toBe("365");
                expect(grid.rows[1]?.data.status).toBe("365");
                expect(grid.rows[2]?.data.dtm).toBe("365");
                expect(grid.rows[2]?.data.status).toBe("365");
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("dtm");
            });
        } finally {
            grid.removeEventListener("cell-fill", handleCellFill);
        }
    },
};

export const CellAutofillStopsAtLockedBoundary: Story = {
    args: {
        columns: editableColumns,
        busy: false,
        density: "natural",
        focusMode: "cell",
        selectionMode: "multiple",
        showFilter: false,
        showToolbarAction: false,
        stickyHeader: true,
        virtualize: false,
        estimatedRowHeight: 44,
        overscanCount: 5,
        rows,
        filterState: {},
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.focusMode).toBe("cell");
        });

        const shadowRoot = grid?.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;

        if (!grid || !shadowRoot || !scrollContainer) {
            throw new Error("Expected lock-boundary autofill grid to render.");
        }

        let fillDetail: VioletDataGridFillDetail | null = null;
        const handleCellFill = (event: Event) => {
            fillDetail = (event as CustomEvent<VioletDataGridFillDetail>).detail;
            grid.rows = applyGridChanges(grid.rows, fillDetail.changes);
        };

        grid.addEventListener("cell-fill", handleCellFill);

        try {
            scrollContainer.focus();

            await waitFor(() => {
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("commonName");
            });

      await waitFor(() => {
        expect(shadowRoot.querySelector('[data-fill-handle="true"]')).toBeTruthy();
        expect(
          shadowRoot.querySelector('td[data-row-id="romanesco"][data-column-id="dtm"]'),
        ).toBeTruthy();
      });
      const handle = shadowRoot.querySelector(
        '[data-fill-handle="true"]',
      ) as HTMLSpanElement | null;
            const targetCell = shadowRoot.querySelector(
        'td[data-row-id="romanesco"][data-column-id="dtm"]',
            ) as HTMLTableCellElement | null;

            if (!handle || !targetCell) {
                throw new Error("Expected lock-boundary fill handle and target cell to render.");
            }

            const handleRect = handle.getBoundingClientRect();
            const targetRect = targetCell.getBoundingClientRect();
            const pointerId = 10;

            handle.dispatchEvent(
                new PointerEvent("pointerdown", {
                    bubbles: true,
                    composed: true,
                    pointerId,
                    pointerType: "mouse",
                    button: 0,
                    buttons: 1,
                    clientX: handleRect.left + handleRect.width / 2,
                    clientY: handleRect.top + handleRect.height / 2,
        }),
            );

            scrollContainer.dispatchEvent(
                new PointerEvent("pointermove", {
                    bubbles: true,
                    composed: true,
                    pointerId,
                    pointerType: "mouse",
                    button: 0,
                    buttons: 1,
                    clientX: targetRect.left + targetRect.width / 2,
                    clientY: targetRect.top + targetRect.height / 2,
        }),
            );

            await waitFor(() => {
                expect(shadowRoot.querySelectorAll('td[data-fill-preview="true"]').length).toBe(1);
            });

            scrollContainer.dispatchEvent(
                new PointerEvent("pointerup", {
                    bubbles: true,
                    composed: true,
                    pointerId,
                    pointerType: "mouse",
                    button: 0,
                    buttons: 0,
                    clientX: targetRect.left + targetRect.width / 2,
                    clientY: targetRect.top + targetRect.height / 2,
        }),
            );

            await waitFor(() => {
                expect(fillDetail?.source.anchor.rowId).toBe("black-currant");
                expect(fillDetail?.source.anchor.columnId).toBe("commonName");
                expect(fillDetail?.target.focus.rowId).toBe("romanesco");
                expect(fillDetail?.target.focus.columnId).toBe("commonName");
                expect(fillDetail?.changes.length).toBe(1);
                expect(grid.rows[1]?.data.commonName).toBe("Black currant");
                expect(grid.rows[1]?.data.dtm).toBe("80");
                expect(grid.activeCell?.rowId).toBe("black-currant");
                expect(grid.activeCell?.columnId).toBe("commonName");
            });
        } finally {
            grid.removeEventListener("cell-fill", handleCellFill);
        }
    },
};

export const Virtualized: Story = {
    args: {
        columns,
        busy: false,
        density: "compact",
        focusMode: "row",
        selectionMode: "multiple",
        showFilter: true,
        showToolbarAction: true,
        stickyHeader: true,
        virtualize: true,
    estimatedRowHeight: 24,
        overscanCount: 6,
        rows: createPlantRows(1000),
    blockSize: "80vh",
    virtualizedMaxBlockSize: "none",
        filterState: {
            query: "",
        },
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.rows.length).toBe(1000);
            expect(grid?.virtualize).toBe(true);
      expect(grid?.shadowRoot?.querySelector(".table-scroll")).toBeTruthy();
        });

        const shadowRoot = grid?.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;

        if (!grid || !shadowRoot || !scrollContainer) {
            throw new Error("Expected virtualized grid and scroll container to render.");
        }

        await waitFor(() => {
      const renderedRows = shadowRoot.querySelectorAll("tbody tr[data-row-index]");
            expect(renderedRows.length).toBeGreaterThan(0);
      expect(renderedRows.length).toBeLessThanOrEqual(
        Math.ceil(scrollContainer.clientHeight / grid.estimatedRowHeight) +
          2 * grid.overscanCount +
          2,
      );
      expect(shadowRoot.querySelectorAll("table").length).toBe(1);
      expect(shadowRoot.querySelector("table")?.getAttribute("aria-rowcount")).toBe("1001");
        });

        await waitFor(() => {
            expect(grid.virtualPaddingEnd).toBeGreaterThan(0);
            expect(scrollContainer.scrollHeight).toBeGreaterThan(scrollContainer.clientHeight);
      expect(grid.renderedRows.at(-1)?.item.end ?? 0).toBeGreaterThanOrEqual(
        scrollContainer.scrollTop + scrollContainer.clientHeight - grid.estimatedRowHeight,
      );
    });

    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    scrollContainer.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    await waitFor(() => {
      expect(grid.renderedRows.at(-1)?.item.index).toBe(999);
      expect(
        scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop,
      ).toBeLessThanOrEqual(1);
      const lastRow = shadowRoot.querySelector<HTMLTableRowElement>(
        'tbody tr[data-row-index="999"]',
      );
      expect(lastRow?.getAttribute("aria-rowindex")).toBe("1001");
      const scrollRect = scrollContainer.getBoundingClientRect();
      expect(lastRow?.getBoundingClientRect().bottom ?? 0).toBeGreaterThanOrEqual(
        scrollRect.bottom - 2,
      );
      expect(lastRow?.getBoundingClientRect().bottom ?? 0).toBeLessThanOrEqual(
        scrollRect.bottom + 2,
      );
    });

    scrollContainer.scrollTop = 0;
    scrollContainer.dispatchEvent(new Event("scroll"));
    await waitFor(() => {
      expect(scrollContainer.scrollTop).toBeLessThanOrEqual(1);
      expect(grid.renderedRows[0]?.item.index).toBe(0);
      expect(grid.renderedRows.at(-1)?.item.index ?? 999).toBeLessThan(999);
    });

    let requestedScrollTop: number | null = null;
    const moveAwayFromTail = () => {
      const endGap =
        scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop;
      if (requestedScrollTop === null && endGap < 3) {
        requestedScrollTop = scrollContainer.scrollTop - 100;
        scrollContainer.scrollTop = requestedScrollTop;
      }
    };
    scrollContainer.addEventListener("scroll", moveAwayFromTail);
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    scrollContainer.dispatchEvent(new Event("scroll"));
    await waitFor(() => {
      expect(requestedScrollTop).not.toBeNull();
      expect(Math.abs(scrollContainer.scrollTop - (requestedScrollTop ?? 0))).toBeLessThanOrEqual(
        1,
      );
      expect(
        scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop,
      ).toBeGreaterThanOrEqual(90);
      expect(grid.renderedRows.at(-1)?.item.index).toBe(999);
        });
    scrollContainer.removeEventListener("scroll", moveAwayFromTail);
    },
};

export const VirtualizedWideGrid: Story = {
    args: {
        columns: wideColumns,
        busy: false,
        density: "compact",
        focusMode: "row",
        selectionMode: "multiple",
        showFilter: true,
        showToolbarAction: true,
        stickyHeader: true,
        virtualize: true,
    estimatedRowHeight: 24,
        overscanCount: 6,
        maxInlineSize: "48rem",
        virtualizedMaxBlockSize: "18rem",
        rows: createPlantRows(1000),
        filterState: {
            query: "",
        },
    },
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector("violet-data-grid") as VioletDataGridElement | null;

        await waitFor(() => {
            expect(Boolean(grid)).toBe(true);
            expect(grid?.rows.length).toBe(1000);
            expect(grid?.virtualize).toBe(true);
      expect(grid?.shadowRoot?.querySelector(".table-scroll")).toBeTruthy();
      expect(grid?.shadowRoot?.querySelector("thead th:last-child")).toBeTruthy();
        });

        const shadowRoot = grid?.shadowRoot;
        const scrollContainer = shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;
    const lastHeader = shadowRoot?.querySelector(
      "thead th:last-child",
    ) as HTMLTableCellElement | null;

        if (!grid || !shadowRoot || !scrollContainer || !lastHeader) {
            throw new Error("Expected wide virtualized grid to render.");
        }

        await waitFor(() => {
            expect(scrollContainer.scrollWidth).toBeGreaterThan(scrollContainer.clientWidth);
            expect(grid.renderedRows.length).toBeLessThan(grid.rows.length);
        });

    const assertColumnAlignment = () => {
      const headers = [...shadowRoot.querySelectorAll<HTMLElement>("thead th[data-column-id]")];
      const firstRow = shadowRoot.querySelector<HTMLTableRowElement>("tbody tr[data-row-index]");
      const cells = [...(firstRow?.querySelectorAll<HTMLElement>("td[data-column-id]") ?? [])];
      expect(cells.length).toBe(headers.length);
      headers.forEach((header, index) => {
        const cell = cells[index];
        expect(
          Math.abs(header.getBoundingClientRect().left - (cell?.getBoundingClientRect().left ?? 0)),
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(
            header.getBoundingClientRect().width - (cell?.getBoundingClientRect().width ?? 0),
          ),
        ).toBeLessThanOrEqual(1);
      });
    };

    await waitFor(assertColumnAlignment);

        const initialScrollLeft = scrollContainer.scrollLeft;
        const initialContainerRight = scrollContainer.getBoundingClientRect().right;
        const initialHeaderRight = lastHeader.getBoundingClientRect().right;

        expect(initialHeaderRight).toBeGreaterThan(initialContainerRight);

        scrollContainer.scrollLeft = scrollContainer.scrollWidth;
        scrollContainer.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        await waitFor(() => {
            expect(scrollContainer.scrollLeft).toBeGreaterThan(initialScrollLeft);
            expect(lastHeader.getBoundingClientRect().right).toBeLessThan(initialHeaderRight);
        });

    scrollContainer.scrollTop = scrollContainer.scrollHeight / 2;
    scrollContainer.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await waitFor(assertColumnAlignment);
    },
};
