import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, waitFor } from "storybook/test";

import "./violet-gantt";
import type {
  VioletGantt,
  VioletGanttExpandedChangeDetail,
  VioletGanttItem,
  VioletGanttItemSelectionChangeDetail,
  VioletGanttRow,
  VioletGanttStatus,
  VioletGanttViewport,
  VioletGanttViewportChangeDetail,
} from "./violet-gantt";
import { ganttAddDays } from "./violet-gantt-geometry";

interface GanttStoryArgs {
  rows: VioletGanttRow[];
  items: VioletGanttItem[];
  expandedRowIds: string[];
  selectedItemId: string | null;
  viewport: VioletGanttViewport;
  today: string | null;
  status: VioletGanttStatus;
  density: "compact" | "natural" | "comfortable";
  direction: "ltr" | "rtl";
  width: string;
  height: string;
  focusItemId?: string;
}

const unscheduledRow: VioletGanttRow = {
  id: "follow-up",
  label: "Follow-up",
  itemIds: ["retrospective"],
};

const unscheduledItem: VioletGanttItem = {
  id: "retrospective",
  rowId: "follow-up",
  label: "Retrospective",
  time: null,
  presentation: "milestone",
  provenance: "planned",
  readOnlyReason: "No date supplied",
};

const overviewRows: VioletGanttRow[] = [
  { id: "launch", label: "Launch program", description: "Inspect launch program", itemIds: [] },
  {
    id: "research",
    parentId: "launch",
    label: "Research",
    itemIds: ["interviews", "research-window", "research-review"],
  },
  { id: "delivery", parentId: "launch", label: "Delivery", itemIds: ["implementation", "release"] },
  unscheduledRow,
];

const overviewItems: VioletGanttItem[] = [
  {
    id: "interviews",
    rowId: "research",
    label: "Interviews",
    time: { kind: "day-range", start: "2026-09-02", endExclusive: "2026-09-10" },
    presentation: "work",
    provenance: "actual",
  },
  {
    id: "research-window",
    rowId: "research",
    label: "Evidence window",
    time: { kind: "day-range", start: "2026-09-06", endExclusive: "2026-09-18" },
    presentation: "window",
    provenance: "derived",
  },
  {
    id: "research-review",
    rowId: "research",
    label: "Review",
    time: { kind: "day-point", at: "2026-09-12" },
    presentation: "milestone",
    provenance: "planned",
  },
  {
    id: "implementation",
    rowId: "delivery",
    label: "Implementation",
    time: { kind: "day-range", start: "2026-09-14", endExclusive: "2026-10-03" },
    presentation: "work",
    provenance: "planned",
  },
  {
    id: "release",
    rowId: "delivery",
    label: "Release",
    time: { kind: "day-point", at: "2026-10-05" },
    presentation: "milestone",
    provenance: "advisory",
    note: "Date requires confirmation",
  },
  unscheduledItem,
];

const wideViewportRows: VioletGanttRow[] = [
  {
    id: "spring-bed",
    label: "Spring bed",
    itemIds: ["bed-preparation", "planting-window"],
  },
];

const wideViewportItems: VioletGanttItem[] = [
  {
    id: "bed-preparation",
    rowId: "spring-bed",
    label: "Bed preparation",
    time: { kind: "day-range", start: "2026-04-20", endExclusive: "2026-05-05" },
    presentation: "work",
    provenance: "planned",
  },
  {
    id: "planting-window",
    rowId: "spring-bed",
    label: "Planting window",
    time: { kind: "day-range", start: "2026-04-27", endExclusive: "2026-05-18" },
    presentation: "window",
    provenance: "derived",
  },
];

function fixtureDate(base: string, offset: number): string {
  const value = ganttAddDays(base, offset);
  if (!value) throw new TypeError(`Invalid benchmark date ${base} + ${offset}`);
  return value;
}

function fixture(rowCount: number): { rows: VioletGanttRow[]; items: VioletGanttItem[] } {
  const rows: VioletGanttRow[] = [];
  const items: VioletGanttItem[] = [];
  const base = "2026-01-01";
  for (let index = 0; index < rowCount; index += 1) {
    const rowId = `benchmark-row-${index}`;
    const day = index % 700;
    const workId = `${rowId}-work`;
    const windowId = `${rowId}-window`;
    const pointId = `${rowId}-point`;
    const itemIds = [workId, windowId, pointId];
    rows.push({ id: rowId, label: `Program row ${index + 1}`, itemIds });
    items.push(
      {
        id: workId,
        rowId,
        label: `Work ${index + 1}`,
        time: {
          kind: "day-range",
          start: fixtureDate(base, day),
          endExclusive: fixtureDate(base, day + 12),
        },
        presentation: "work",
        provenance: index % 4 === 0 ? "actual" : "planned",
      },
      {
        id: windowId,
        rowId,
        label: `Window ${index + 1}`,
        time: {
          kind: "day-range",
          start: fixtureDate(base, day + 4),
          endExclusive: fixtureDate(base, day + 24),
        },
        presentation: "window",
        provenance: "derived",
      },
      {
        id: pointId,
        rowId,
        label: `Checkpoint ${index + 1}`,
        time: { kind: "day-point", at: fixtureDate(base, day + 10) },
        presentation: "milestone",
        provenance: "advisory",
      },
    );
  }
  return { rows, items };
}

function renderGantt(args: GanttStoryArgs): HTMLElement {
  const frame = document.createElement("div");
  frame.style.cssText = `inline-size:${args.width};block-size:${args.height};max-inline-size:100%;`;
  const gantt = document.createElement("violet-gantt") as VioletGantt;
  gantt.rows = args.rows;
  gantt.items = args.items;
  gantt.expandedRowIds = args.expandedRowIds;
  gantt.selectedItemId = args.selectedItemId;
  gantt.viewport = args.viewport;
  gantt.today = args.today;
  gantt.status = args.status;
  gantt.density = args.density;
  gantt.dir = args.direction;
  gantt.ariaLabel = "Delivery timeline";
  gantt.addEventListener("item-selection-change", (event) => {
    gantt.selectedItemId = (
      event as CustomEvent<VioletGanttItemSelectionChangeDetail>
    ).detail.itemId;
  });
  gantt.addEventListener("expanded-change", (event) => {
    gantt.expandedRowIds = [
      ...(event as CustomEvent<VioletGanttExpandedChangeDetail>).detail.expandedRowIds,
    ];
  });
  gantt.addEventListener("viewport-change", (event) => {
    gantt.viewport = (event as CustomEvent<VioletGanttViewportChangeDetail>).detail.viewport;
  });
  frame.append(gantt);
  const focusItemId = args.focusItemId;
  if (focusItemId) requestAnimationFrame(() => gantt.focusItem(focusItemId));
  return frame;
}

const meta = {
  title: "Components/Gantt",
  component: "violet-gantt",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Read-only, virtualized day-axis Gantt foundation with controlled hierarchy, selection, expansion, and viewport state.",
      },
    },
  },
  render: renderGantt,
} satisfies Meta<GanttStoryArgs>;

export default meta;
type Story = StoryObj<GanttStoryArgs>;

const baselineArgs: GanttStoryArgs = {
  rows: overviewRows,
  items: overviewItems,
  expandedRowIds: ["launch"],
  selectedItemId: null,
  viewport: { start: "2026-09-01", endExclusive: "2026-10-12", scale: "day" },
  today: "2026-09-11",
  status: { kind: "ready" },
  density: "natural",
  direction: "ltr",
  width: "70rem",
  height: "30rem",
};

export const Overview: Story = {
  args: baselineArgs,
  play: async ({ canvasElement }) => {
    const gantt = canvasElement.querySelector("violet-gantt") as VioletGantt | null;
    await waitFor(() => {
      expect(gantt?.shadowRoot?.querySelectorAll("[part~='row']").length).toBe(4);
      expect(
        gantt?.shadowRoot?.querySelector('[data-item-id="interviews"]')?.textContent,
      ).toContain("Interviews");
    });
  },
};

export const WideControlledViewport: Story = {
  args: {
    ...baselineArgs,
    rows: wideViewportRows,
    items: wideViewportItems,
    expandedRowIds: [],
    viewport: { start: "2026-04-01", endExclusive: "2026-06-01", scale: "month" },
    width: "120rem",
  },
  play: async ({ canvasElement }) => {
    const gantt = canvasElement.querySelector("violet-gantt") as VioletGantt | null;
    await waitFor(() => {
      expect((gantt?.viewport?.endExclusive ?? "") > "2026-06-01").toBe(true);
      expect(gantt?.shadowRoot?.querySelector('[part~="work"]')?.textContent).toContain(
        "Bed preparation",
      );
      expect(gantt?.shadowRoot?.querySelector('[part~="window"]')?.textContent).toContain(
        "Planting window",
      );
    });
    const scrollViewport = gantt?.shadowRoot?.querySelector<HTMLElement>(".viewport");
    const nameHeader = gantt?.shadowRoot?.querySelector<HTMLElement>(".name-header");
    if (!gantt || !scrollViewport || !nameHeader)
      throw new Error("Expected a measured Gantt viewport.");
    expect(gantt.chartWidth).toBeGreaterThanOrEqual(
      scrollViewport.clientWidth - nameHeader.getBoundingClientRect().width,
    );
  },
};

export const HierarchyAndMultipleItems: Story = {
  args: { ...baselineArgs, selectedItemId: "research-window" },
};

export const SelectedAndFocused: Story = {
  args: { ...baselineArgs, selectedItemId: "research-window", focusItemId: "research-review" },
};

export const Loading: Story = {
  args: {
    ...baselineArgs,
    rows: [],
    items: [],
    status: { kind: "loading", message: "Loading schedule…" },
  },
};
export const Empty: Story = {
  args: {
    ...baselineArgs,
    rows: [],
    items: [],
    status: { kind: "empty", message: "No scheduled or unscheduled items." },
  },
};
export const ErrorState: Story = {
  name: "Error",
  args: {
    ...baselineArgs,
    rows: [],
    items: [],
    status: { kind: "error", message: "The timeline could not be loaded." },
  },
};
export const Unscheduled: Story = {
  args: {
    ...baselineArgs,
    expandedRowIds: [],
    rows: [unscheduledRow],
    items: [unscheduledItem],
  },
};
export const LongLabels: Story = {
  args: {
    ...baselineArgs,
    rows: [
      {
        id: "long",
        label: "A deliberately long row label that remains readable through a title and ellipsis",
        itemIds: ["long-item"],
      },
    ],
    items: [
      {
        id: "long-item",
        rowId: "long",
        label: "A long scheduled interval label that is safely rendered as text",
        time: { kind: "day-range", start: "2026-09-03", endExclusive: "2026-10-04" },
        presentation: "work",
        provenance: "planned",
      },
    ],
  },
};
export const NarrowContainer: Story = {
  args: { ...baselineArgs, width: "25rem", height: "28rem" },
};

export const DenseOverflow: Story = {
  args: {
    ...baselineArgs,
    rows: [
      {
        id: "research",
        label: "Research",
        itemIds: ["interviews", "research-window", "research-review"],
      },
    ],
    items: overviewItems.slice(0, 3),
    expandedRowIds: [],
    density: "compact",
  },
};

export const MonthScale: Story = {
  args: {
    ...baselineArgs,
    viewport: { start: "2026-01-01", endExclusive: "2027-01-01", scale: "month" },
    focusItemId: "implementation",
  },
};

export const CalendarScalePolish: Story = {
  args: {
    ...baselineArgs,
    rows: [{ id: "calendar-row", label: "Season checkpoint", itemIds: ["calendar-point"] }],
    items: [
      {
        id: "calendar-point",
        rowId: "calendar-row",
        label: "A long checkpoint label at the end of the calendar",
        time: { kind: "day-point", at: "2026-06-14" },
        presentation: "milestone",
        provenance: "planned",
      },
    ],
    expandedRowIds: [],
    viewport: { start: "2026-03-31", endExclusive: "2026-06-15", scale: "month" },
    width: "50rem",
  },
  play: async ({ canvasElement }) => {
    const gantt = canvasElement.querySelector("violet-gantt") as VioletGantt | null;
    await waitFor(() => {
      expect(gantt?.axisContextLabel).toBe("2026");
      expect(gantt?.shadowRoot?.querySelectorAll(".day-label").length).toBeGreaterThan(0);
    });
    const labels = [
      ...(gantt?.shadowRoot?.querySelectorAll<HTMLElement>(".day-label") ?? []),
    ].filter((label) => label.textContent?.trim());
    for (let index = 1; index < labels.length; index += 1) {
      expect(labels[index - 1]!.getBoundingClientRect().right).toBeLessThanOrEqual(
        labels[index]!.getBoundingClientRect().left,
      );
    }

    const rowLabel = gantt?.shadowRoot?.querySelector<HTMLElement>(".row-label");
    const item = gantt?.shadowRoot?.querySelector<HTMLElement>(".item");
    const itemLabel = item?.querySelector<HTMLElement>(".item-label");
    const chart = gantt?.shadowRoot?.querySelector<HTMLElement>(".chart");
    expect(rowLabel).toBeTruthy();
    expect(item).toBeTruthy();
    expect(itemLabel).toBeTruthy();
    expect(chart).toBeTruthy();
    const rowBounds = rowLabel!.getBoundingClientRect();
    const itemBounds = item!.getBoundingClientRect();
    expect(
      Math.abs(rowBounds.top + rowBounds.height / 2 - (itemBounds.top + itemBounds.height / 2)),
    ).toBeLessThanOrEqual(1);
    expect(getComputedStyle(rowLabel!).fontSize).toBe(getComputedStyle(item!).fontSize);
    expect(itemLabel!.getBoundingClientRect().right).toBeLessThanOrEqual(
      chart!.getBoundingClientRect().right + 1,
    );
  },
};

export const RightToLeft: Story = {
  args: { ...baselineArgs, direction: "rtl" },
};

const thousand = fixture(1_000);
export const ThousandRows: Story = {
  args: {
    ...baselineArgs,
    ...thousand,
    viewport: { start: "2026-01-01", endExclusive: "2028-01-01", scale: "week" },
  },
};

const tenThousand = fixture(10_000);
export const TenThousandRows: Story = {
  args: {
    ...baselineArgs,
    ...tenThousand,
    viewport: { start: "2026-01-01", endExclusive: "2028-01-01", scale: "month" },
  },
};
