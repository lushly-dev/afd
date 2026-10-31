import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-gantt";
import {
  VIOLET_GANTT_DATE_LIMITS,
  type VioletGantt,
  type VioletGanttExpandedChangeDetail,
  type VioletGanttItem,
  type VioletGanttItemActivateDetail,
  type VioletGanttRow,
  type VioletGanttViewportChangeDetail,
} from "./violet-gantt";
import { ganttDateToDay } from "./violet-gantt-geometry";

function nextFrames(count = 2): Promise<void> {
  return new Promise((resolve) => {
    const advance = (remaining: number) =>
      requestAnimationFrame(() => (remaining <= 1 ? resolve() : advance(remaining - 1)));
    advance(count);
  });
}

const rows: VioletGanttRow[] = [
  { id: "program", label: "Program", itemIds: [], description: "Program group" },
  {
    id: "design",
    parentId: "program",
    label: "Design",
    itemIds: ["design-work", "design-window", "review"],
  },
  { id: "delivery", parentId: "program", label: "Delivery", itemIds: ["release"] },
];

const items: VioletGanttItem[] = [
  {
    id: "design-work",
    rowId: "design",
    label: "Design work",
    time: { kind: "day-range", start: "2028-02-26", endExclusive: "2028-03-03" },
    presentation: "work",
    provenance: "planned",
  },
  {
    id: "design-window",
    rowId: "design",
    label: "Review window",
    time: { kind: "day-range", start: "2028-02-28", endExclusive: "2028-03-05" },
    presentation: "window",
    provenance: "derived",
  },
  {
    id: "review",
    rowId: "design",
    label: "Review",
    time: { kind: "day-point", at: "2028-02-29" },
    presentation: "milestone",
    provenance: "actual",
  },
  {
    id: "release",
    rowId: "delivery",
    label: "Release",
    time: null,
    presentation: "milestone",
    provenance: "advisory",
    readOnlyReason: "No date supplied",
  },
];

async function renderGantt(overrides: Partial<VioletGantt> = {}): Promise<VioletGantt> {
  const element = document.createElement("violet-gantt") as VioletGantt;
  element.style.cssText = "display:block;width:760px;height:280px";
  element.rows = rows;
  element.items = items;
  element.expandedRowIds = ["program"];
  element.viewport = { start: "2028-02-27", endExclusive: "2028-03-08", scale: "day" };
  Object.assign(element, overrides);
  document.body.append(element);
  await customElements.whenDefined("violet-gantt");
  await nextFrames(3);
  return element;
}

describe("violet-gantt", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("omits duplicate and orphan identities with a visible diagnostic", async () => {
    const element = await renderGantt({
      rows: [
        { id: "one", label: "One", itemIds: ["orphan"] },
        { id: "one", label: "Duplicate", itemIds: [] },
        { id: "child", parentId: "missing", label: "Orphan", itemIds: [] },
      ],
      items: [
        {
          id: "orphan",
          rowId: "missing",
          label: "Orphan",
          time: null,
          presentation: "work",
          provenance: "planned",
        },
      ],
      expandedRowIds: [],
    });

    expect(element.shadowRoot?.querySelectorAll(".row").length).toBe(1);
    expect(element.shadowRoot?.querySelector("[part='status']")?.textContent).toContain(
      "invalid timeline records",
    );
  });

  it("renders crossing ranges clipped and keeps overlapping item labels visible", async () => {
    const element = await renderGantt();
    const work = element.shadowRoot?.querySelector(
      '[data-item-id="design-work"]',
    ) as HTMLElement | null;
    const windowItem = element.shadowRoot?.querySelector(
      '[data-item-id="design-window"]',
    ) as HTMLElement | null;

    expect(work?.classList.contains("clipped-start")).toBe(true);
    expect(work?.textContent).toContain("Design work");
    expect(windowItem?.textContent).toContain("Review window");
    expect(work?.style.getPropertyValue("--_item-top")).not.toBe(
      windowItem?.style.getPropertyValue("--_item-top"),
    );
  });

  it("emits controlled selection and activation from a real composed pointer path", async () => {
    const element = await renderGantt();
    let activated: VioletGanttItemActivateDetail | null = null;
    element.addEventListener("item-activate", (event) => {
      activated = (event as CustomEvent<VioletGanttItemActivateDetail>).detail;
    });
    const label = element.shadowRoot?.querySelector(
      '[data-item-id="design-window"] .item-label',
    ) as HTMLElement | null;
    if (!label) throw new Error("Expected the window item label to be mounted.");
    await userEvent.click(label);
    await nextFrames();

    expect(activated).toEqual({ itemId: "design-window" });
    expect(element.selectedItemId).toBeNull();
  });

  it("updates aria-rowcount when controlled rows or expansion change", async () => {
    const element = await renderGantt();
    const grid = () => element.shadowRoot?.querySelector('[role="treegrid"]');
    expect(grid()?.getAttribute("aria-rowcount")).toBe("4");

    element.expandedRowIds = [];
    await nextFrames(3);
    expect(grid()?.getAttribute("aria-rowcount")).toBe("2");

    element.rows = [...rows, { id: "extra", label: "Extra", itemIds: [] }];
    await nextFrames(3);
    expect(grid()?.getAttribute("aria-rowcount")).toBe("3");

    element.expandedRowIds = ["program"];
    await nextFrames(3);
    expect(grid()?.getAttribute("aria-rowcount")).toBe("5");
  });

  it("keeps expansion controlled and restores focus to a collapsed parent", async () => {
    const element = await renderGantt();
    expect(element.focusItem("review")).toBe(true);
    await nextFrames();
    let requested: VioletGanttExpandedChangeDetail | null = null;
    element.addEventListener("expanded-change", (event) => {
      requested = (event as CustomEvent<VioletGanttExpandedChangeDetail>).detail;
    });
    const child = element.shadowRoot?.querySelector('[data-row-id="design"]') as HTMLElement | null;
    child?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, composed: true }),
    );
    expect(requested).toBeNull();

    element.expandedRowIds = [];
    await nextFrames(3);
    const parent = element.shadowRoot?.querySelector(
      '[data-row-id="program"]',
    ) as HTMLElement | null;
    expect(element.activeRowId).toBe("program");
    expect(element.shadowRoot?.activeElement).toBe(parent);
  });

  it("cycles every visible item in a multi-item row and activates with Enter", async () => {
    const element = await renderGantt();
    expect(element.focusItem("design-work")).toBe(true);
    await nextFrames();
    const row = element.shadowRoot?.querySelector('[data-row-id="design"]') as HTMLElement;
    row.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
        composed: true,
      }),
    );
    await nextFrames();
    expect(element.activeItemId).toBe("design-window");
    row.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
        composed: true,
      }),
    );
    await nextFrames();
    expect(element.activeItemId).toBe("review");

    let activated = "";
    element.addEventListener("item-activate", (event) => {
      activated = (event as CustomEvent<VioletGanttItemActivateDetail>).detail.itemId;
    });
    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    expect(activated).toBe("review");
  });

  it("navigates across virtual windows while keeping mounted rows bounded", async () => {
    const manyRows = Array.from({ length: 10_000 }, (_, index) => ({
      id: `row-${index}`,
      label: `Row ${index}`,
      itemIds: [],
    }));
    const element = await renderGantt({ rows: manyRows, items: [], expandedRowIds: [] });
    const first = element.shadowRoot?.querySelector('[data-row-id="row-0"]') as HTMLElement;
    first.focus();
    first.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true, composed: true }),
    );
    await nextFrames(4);

    expect(element.activeRowId).toBe("row-9999");
    expect(element.shadowRoot?.querySelectorAll(".row").length).toBeLessThan(30);
    expect(element.shadowRoot?.activeElement?.getAttribute("data-row-id")).toBe("row-9999");
    expect(element.logicalRowCount).toBe(10_001);
  });

  it("recomputes bounded windows after resize and density changes", async () => {
    const manyRows = Array.from({ length: 1_000 }, (_, index) => ({
      id: `row-${index}`,
      label: `Row ${index}`,
      itemIds: [],
    }));
    const element = await renderGantt({ rows: manyRows, items: [], expandedRowIds: [] });
    const before = element.shadowRoot?.querySelectorAll(".row").length ?? 0;
    element.style.height = "520px";
    element.density = "compact";
    await nextFrames(5);
    const after = element.shadowRoot?.querySelectorAll(".row").length ?? 0;

    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(40);
  });

  it("requests enough authoritative days to fill a wider viewport and grows again without shrinking", async () => {
    const element = document.createElement("violet-gantt") as VioletGantt;
    element.style.cssText = "display:block;width:2000px;height:280px";
    element.rows = [{ id: "row", label: "Row", itemIds: [] }];
    element.items = [];
    element.expandedRowIds = [];
    element.viewport = {
      start: "2028-01-01",
      endExclusive: "2028-01-11",
      scale: "day",
    };
    const details: VioletGanttViewportChangeDetail[] = [];
    element.addEventListener("viewport-change", (event) => {
      const detail = (event as CustomEvent<VioletGanttViewportChangeDetail>)
        .detail;
      details.push(detail);
      element.viewport = detail.viewport;
    });

    document.body.append(element);
    await customElements.whenDefined("violet-gantt");
    await nextFrames(4);

    expect(details).toHaveLength(1);
    expect(details[0]?.reason).toBe("resize");
    expect(details[0]?.viewport.start).toBe("2028-01-01");
    const scrollViewport = element.shadowRoot?.querySelector<HTMLElement>(
      ".viewport"
    );
    const nameHeader = element.shadowRoot?.querySelector<HTMLElement>(
      ".name-header"
    );
    if (!scrollViewport || !nameHeader)
      throw new Error("Expected measured Gantt columns.");
    const available =
      scrollViewport.clientWidth - nameHeader.getBoundingClientRect().width;
    expect(element.dayWidth).toBe(40);
    expect(element.chartWidth).toBeGreaterThanOrEqual(available);

    const accepted = { ...element.viewport };
    element.style.width = "2400px";
    await nextFrames(5);
    expect(details).toHaveLength(2);
    expect(details[1]?.reason).toBe("resize");
    const grownEnd = ganttDateToDay(
      details[1]?.viewport.endExclusive ?? ""
    );
    const acceptedEnd = ganttDateToDay(accepted.endExclusive);
    expect(grownEnd).not.toBeNull();
    expect(acceptedEnd).not.toBeNull();
    expect(grownEnd ?? 0).toBeGreaterThan(acceptedEnd ?? 0);

    const grown = { ...element.viewport };
    element.style.width = "500px";
    await nextFrames(5);
    expect(details).toHaveLength(2);
    expect(element.viewport).toEqual(grown);

    scrollViewport.scrollLeft = 600;
    scrollViewport.dispatchEvent(new Event("scroll"));
    await nextFrames();
    element.style.width = "480px";
    await nextFrames(5);
    expect(details).toHaveLength(2);
    expect(element.viewport).toEqual(grown);
    expect(scrollViewport.scrollLeft).toBeGreaterThan(500);
  });

  it("coalesces refused resize requests and pauses them while loading", async () => {
    const element = document.createElement("violet-gantt") as VioletGantt;
    element.style.cssText = "display:block;width:1800px;height:280px";
    element.rows = [{ id: "row", label: "Row", itemIds: [] }];
    element.items = [];
    element.expandedRowIds = [];
    element.viewport = {
      start: "2028-01-01",
      endExclusive: "2028-01-11",
      scale: "day",
    };
    element.status = { kind: "loading" };
    const details: VioletGanttViewportChangeDetail[] = [];
    element.addEventListener("viewport-change", (event) => {
      details.push(
        (event as CustomEvent<VioletGanttViewportChangeDetail>).detail
      );
    });

    document.body.append(element);
    await customElements.whenDefined("violet-gantt");
    await nextFrames(4);
    expect(details).toHaveLength(0);

    element.status = { kind: "ready" };
    await nextFrames(4);
    expect(details).toHaveLength(1);

    element.viewport = { ...element.viewport };
    element.style.width = "1799px";
    await nextFrames(4);
    element.style.width = "1800px";
    await nextFrames(4);
    expect(details).toHaveLength(1);

    element.status = { kind: "loading" };
    element.style.width = "2400px";
    await nextFrames(4);
    expect(details).toHaveLength(1);
  });

  it("does not emit an unsupported resize range at the final date boundary", async () => {
    const element = document.createElement("violet-gantt") as VioletGantt;
    element.style.cssText = "display:block;width:1800px;height:280px";
    element.rows = [{ id: "row", label: "Row", itemIds: [] }];
    element.items = [];
    element.expandedRowIds = [];
    element.viewport = {
      start: VIOLET_GANTT_DATE_LIMITS.max,
      endExclusive: VIOLET_GANTT_DATE_LIMITS.endExclusive,
      scale: "day",
    };
    const details: VioletGanttViewportChangeDetail[] = [];
    element.addEventListener("viewport-change", (event) => {
      details.push(
        (event as CustomEvent<VioletGanttViewportChangeDetail>).detail
      );
    });

    document.body.append(element);
    await customElements.whenDefined("violet-gantt");
    await nextFrames(4);

    expect(details).toHaveLength(0);
    expect(element.viewportError).toBe("");
    expect(element.chartWidth).toBe(element.dayWidth);
  });

  it("culls horizontally distant items and reveals them without a viewport commit", async () => {
    const rangedItems: VioletGanttItem[] = Array.from({ length: 12 }, (_, index) => ({
      id: `item-${index}`,
      rowId: "row",
      label: `Item ${index}`,
      time: { kind: "day-point", at: `2028-${String(index + 1).padStart(2, "0")}-01` },
      presentation: "milestone",
      provenance: "planned",
    }));
    const element = await renderGantt({
      rows: [{ id: "row", label: "Row", itemIds: rangedItems.map((item) => item.id) }],
      items: rangedItems,
      expandedRowIds: [],
      viewport: { start: "2028-01-01", endExclusive: "2029-01-01", scale: "day" },
    });

    expect(element.shadowRoot?.querySelector('.item[data-item-id="item-11"]')).toBeNull();
    expect(element.focusItem("item-11")).toBe(true);
    await nextFrames(4);

    const viewport = element.shadowRoot?.querySelector(".viewport") as HTMLElement | null;
    expect(viewport?.scrollLeft).toBeGreaterThan(0);
    expect(element.shadowRoot?.querySelector('.item[data-item-id="item-11"]')).not.toBeNull();
  });

  it("rejects focus for an item outside the controlled viewport without changing active state", async () => {
    const localItems: VioletGanttItem[] = [
      {
        id: "inside",
        rowId: "row",
        label: "Inside",
        time: { kind: "day-point", at: "2028-03-01" },
        presentation: "milestone",
        provenance: "planned",
      },
      {
        id: "outside",
        rowId: "row",
        label: "Outside",
        time: { kind: "day-point", at: "2029-03-01" },
        presentation: "milestone",
        provenance: "planned",
      },
    ];
    const element = await renderGantt({
      rows: [{ id: "row", label: "Row", itemIds: localItems.map((item) => item.id) }],
      items: localItems,
      expandedRowIds: [],
    });

    expect(element.focusItem("inside")).toBe(true);
    await nextFrames();
    expect(element.focusItem("outside")).toBe(false);
    expect(element.activeItemId).toBe("inside");
    expect(element.activeRowId).toBe("row");
  });

  it("keeps year context visible above short month-scale tick labels while scrolling", async () => {
    const element = await renderGantt({
      viewport: { start: "2028-01-01", endExclusive: "2029-01-01", scale: "month" },
    });
    const viewport = element.shadowRoot?.querySelector(".viewport") as HTMLElement;
    const context = element.shadowRoot?.querySelector(".axis-context") as HTMLElement;
    const labelledTick = [
      ...(element.shadowRoot?.querySelectorAll<HTMLElement>(".day") ?? []),
    ].find((day) => day.textContent?.trim());

    expect(context.textContent).toContain("2028");
    expect(labelledTick?.style.getPropertyValue("--_day-label-width")).toBe("124px");
    expect(labelledTick?.style.getPropertyValue("--_day-width")).toBe("4px");

    viewport.scrollLeft = 31 * 4;
    viewport.dispatchEvent(new Event("scroll"));
    await nextFrames(3);
    expect(context.textContent).toContain("2028");
  });

  it("labels partial months and keeps visible year boundaries explicit across scale changes", async () => {
    const element = await renderGantt({
      viewport: { start: "2028-12-15", endExclusive: "2029-02-01", scale: "month" },
    });
    expect(element.axisContextLabel).toBe("2028 – 2029");
    expect(element.renderedDays.filter((day) => day.label).map((day) => day.label)).toEqual([
      "Dec", "Jan",
    ]);
    expect(element.renderedDays[0]?.style).toContain("--_day-label-width:68px");
    element.viewport = { ...element.viewport, scale: "day" };
    await nextFrames(3);
    expect(element.axisContextLabel).toBe("December 2028");
  });

  it("uses calendar boundaries for nonoverlapping month labels and scale-aware grid lines", async () => {
    const element = await renderGantt({
      viewport: { start: "2028-03-31", endExclusive: "2028-06-15", scale: "month" },
    });
    const labels = [
      ...(element.shadowRoot?.querySelectorAll<HTMLElement>(".day-label") ?? []),
    ].filter((label) => label.textContent?.trim());

    expect(labels.map((label) => label.textContent?.trim())).toEqual([
      "Apr",
      "May",
      "Jun",
    ]);
    expect(
      labels.map((label) => label.parentElement?.style.getPropertyValue("--_day-label-width")),
    ).toEqual(["120px", "124px", "56px"]);
    for (let index = 1; index < labels.length; index += 1) {
      expect(labels[index - 1]!.getBoundingClientRect().right).toBeLessThanOrEqual(
        labels[index]!.getBoundingClientRect().left,
      );
    }
    const gridDays = element.renderedDays.filter((day) => day.gridBoundary);
    expect(gridDays.map((day) => day.date)).toEqual(["2028-04-01", "2028-05-01", "2028-06-01"]);
    expect(
      element.shadowRoot?.querySelectorAll(".body-grid .grid-line:not([hidden])"),
    ).toHaveLength(3);
    expect(gridDays.length).toBeLessThan(element.renderedDays.length / 20);
    const timeHeader = element.shadowRoot!.querySelector<HTMLElement>(".time-header")!;
    expect(timeHeader.scrollWidth).toBeLessThanOrEqual(element.chartWidth);
  });

  it.each([
    {
      scale: "day" as const,
      start: "2028-04-01",
      endExclusive: "2028-04-08",
      boundaries: [
        "2028-04-01",
        "2028-04-02",
        "2028-04-03",
        "2028-04-04",
        "2028-04-05",
        "2028-04-06",
        "2028-04-07",
      ],
    },
    {
      scale: "week" as const,
      start: "2028-04-01",
      endExclusive: "2028-04-15",
      boundaries: ["2028-04-03", "2028-04-10"],
    },
    {
      scale: "month" as const,
      start: "2028-03-31",
      endExclusive: "2028-05-02",
      boundaries: ["2028-04-01", "2028-05-01"],
    },
  ])("draws $scale grid lines only at its calendar interval", async (fixture) => {
    const element = await renderGantt({
      viewport: {
        start: fixture.start,
        endExclusive: fixture.endExclusive,
        scale: fixture.scale,
      },
    });

    expect(element.renderedDays.filter((day) => day.gridBoundary).map((day) => day.date)).toEqual(
      fixture.boundaries,
    );
  });

  it("centers a single lane with matching row and item typography", async () => {
    const single: VioletGanttItem = {
      id: "single",
      rowId: "single-row",
      label: "Centered work",
      time: { kind: "day-range", start: "2028-03-01", endExclusive: "2028-03-04" },
      presentation: "work",
      provenance: "planned",
    };
    const element = await renderGantt({
      rows: [{ id: "single-row", label: "Centered row", itemIds: [single.id] }],
      items: [single],
      expandedRowIds: [],
    });
    const label = element.shadowRoot!.querySelector<HTMLElement>(".row-label")!;
    const nameHeader = element.shadowRoot!.querySelector<HTMLElement>(".name-header")!;
    const renderedItem = element.shadowRoot!.querySelector<HTMLElement>(".item")!;
    const labelBounds = label.getBoundingClientRect();
    const itemBounds = renderedItem.getBoundingClientRect();

    expect(
      Math.abs(labelBounds.top + labelBounds.height / 2 - (itemBounds.top + itemBounds.height / 2)),
    ).toBeLessThanOrEqual(1);
    expect(getComputedStyle(label).fontSize).toBe(getComputedStyle(renderedItem).fontSize);
    expect(getComputedStyle(label).fontWeight).toBe(getComputedStyle(renderedItem).fontWeight);
    expect(label.getBoundingClientRect().left).toBeCloseTo(
      nameHeader.getBoundingClientRect().left +
        parseFloat(getComputedStyle(nameHeader).paddingLeft),
      0,
    );
  });

  it.each([
    "planned",
    "derived",
    "advisory",
    "actual",
  ] as const)("anchors a %s point at its date while fitting the label inside the chart", async (provenance) => {
    const point: VioletGanttItem = {
      id: "edge-point",
      rowId: "edge-row",
      label: "A long milestone label at the end of the visible calendar",
      time: { kind: "day-point", at: "2028-04-30" },
      presentation: "milestone",
      provenance,
    };
    const element = await renderGantt({
      rows: [{ id: "edge-row", label: "Edge row", itemIds: [point.id] }],
      items: [point],
      expandedRowIds: [],
      viewport: { start: "2028-04-01", endExclusive: "2028-05-01", scale: "month" },
    });
    const chart = element.shadowRoot!.querySelector<HTMLElement>(".chart")!;
    const renderedItem = element.shadowRoot!.querySelector<HTMLElement>(".item")!;
    const label = renderedItem.querySelector<HTMLElement>(".item-label")!;
    const itemLeft = Number.parseFloat(renderedItem.style.getPropertyValue("--_item-left"));
    const itemWidth = Number.parseFloat(renderedItem.style.inlineSize);

    expect(renderedItem.classList.contains("label-before")).toBe(true);
    expect(itemLeft + itemWidth - 6).toBe(29.5 * 4);
    const markerStyle = getComputedStyle(renderedItem, "::before");
    const markerCenter =
      renderedItem.getBoundingClientRect().right -
      parseFloat(getComputedStyle(renderedItem).paddingRight) -
      parseFloat(markerStyle.marginRight) -
      parseFloat(markerStyle.width) / 2;
    expect(markerCenter - chart.getBoundingClientRect().left).toBeCloseTo(29.5 * 4, 0);
    expect(markerStyle.paddingLeft).toBe("0px");
    expect(markerStyle.paddingRight).toBe("0px");
    expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(
      chart.getBoundingClientRect().right + 1,
    );
    expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
    expect(getComputedStyle(label).textOverflow).toBe("ellipsis");
  });

  it("collapses the slot-only toolbar and reveals it when meaningful content is assigned", async () => {
    const element = await renderGantt();
    const toolbar = element.shadowRoot!.querySelector<HTMLElement>(".toolbar")!;
    expect(toolbar.hidden).toBe(true);
    expect(toolbar.getBoundingClientRect().height).toBe(0);
    const root = element.shadowRoot!.querySelector<HTMLElement>(".root")!;
    const viewport = element.shadowRoot!.querySelector<HTMLElement>(".viewport")!;
    expect(viewport.clientHeight).toBe(root.clientHeight);

    const action = document.createElement("button");
    action.slot = "toolbar";
    action.textContent = "Today";
    element.append(action);
    await nextFrames();

    expect(toolbar.hidden).toBe(false);
    expect(toolbar.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(viewport.getBoundingClientRect().bottom).toBeCloseTo(
      root.getBoundingClientRect().bottom - 1,
      0,
    );
  });

  it("keeps dense rows readable with overflow disclosure while keyboard access reaches every item", async () => {
    const denseItems: VioletGanttItem[] = Array.from({ length: 10 }, (_, index) => ({
      id: `dense-${index}`,
      rowId: "dense",
      label: `Dense item ${index + 1}`,
      time: { kind: "day-range", start: "2028-03-01", endExclusive: "2028-03-06" },
      presentation: index % 2 ? "window" : "work",
      provenance: "planned",
    }));
    const element = await renderGantt({
      rows: [{ id: "dense", label: "Dense row", itemIds: denseItems.map((item) => item.id) }],
      items: denseItems,
      expandedRowIds: [],
      density: "compact",
    });
    const row = element.shadowRoot?.querySelector('[data-row-id="dense"]') as HTMLElement;

    expect(element.shadowRoot?.querySelectorAll(".item").length).toBe(6);
    expect(element.shadowRoot?.querySelector(".item-overflow")?.textContent).toContain("+4");
    expect(element.shadowRoot?.querySelectorAll(".overflow-item")).toHaveLength(0);
    let pointerActivated = "";
    element.addEventListener("item-activate", (event) => {
      pointerActivated = (event as CustomEvent<VioletGanttItemActivateDetail>).detail.itemId;
    });
    for (let index = 0; index < 10; index += 1) {
      const next = element.shadowRoot?.querySelector(
        '[data-action="cycle-overflow"][data-direction="next"]',
      ) as HTMLElement;
      await userEvent.click(next);
      await nextFrames();
    }
    const lastItem = element.shadowRoot?.querySelector(
      '.item[data-item-id="dense-9"]',
    ) as HTMLElement;
    await userEvent.click(lastItem);
    expect(pointerActivated).toBe("dense-9");

    row.focus();
    for (let index = 0; index < 10; index += 1) {
      row.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          altKey: true,
          bubbles: true,
          composed: true,
        }),
      );
      await nextFrames();
    }

    expect(element.activeItemId).toBe("dense-9");
    expect(element.shadowRoot?.querySelector('[data-item-id="dense-9"]')).not.toBeNull();
  });

  it("keeps dense-row DOM bounded without allocating hidden item titles", async () => {
    const denseItems: VioletGanttItem[] = Array.from({ length: 2_000 }, (_, index) => ({
      id: `bounded-${index}`,
      rowId: "bounded",
      label: `Bounded item ${index}`,
      time: { kind: "day-range", start: "2028-03-01", endExclusive: "2028-03-06" },
      presentation: "work",
      provenance: "planned",
    }));
    const element = await renderGantt({
      rows: [{ id: "bounded", label: "Bounded row", itemIds: denseItems.map((item) => item.id) }],
      items: denseItems,
      expandedRowIds: [],
      density: "compact",
    });

    expect(element.shadowRoot?.querySelectorAll("[data-item-id]")).toHaveLength(6);
    expect(element.shadowRoot?.querySelectorAll('[data-action="cycle-overflow"]')).toHaveLength(2);
    expect(element.shadowRoot?.querySelector(".item-overflow")?.textContent).toContain("+1994");
  });

  it("keeps narrow interval geometry faithful while providing a 24px pointer target", async () => {
    const narrow: VioletGanttItem = {
      id: "narrow",
      rowId: "narrow-row",
      label: "One day",
      time: { kind: "day-range", start: "2028-01-02", endExclusive: "2028-01-03" },
      presentation: "work",
      provenance: "planned",
    };
    const element = await renderGantt({
      rows: [{ id: "narrow-row", label: "Narrow", itemIds: [narrow.id] }],
      items: [narrow],
      expandedRowIds: [],
      viewport: { start: "2028-01-01", endExclusive: "2028-03-01", scale: "month" },
    });
    const hitTarget = element.shadowRoot?.querySelector('[data-item-id="narrow"]') as HTMLElement;
    const geometry = hitTarget.querySelector(".item-geometry") as HTMLElement;

    expect(hitTarget.getBoundingClientRect().width).toBeGreaterThanOrEqual(24);
    expect(geometry.getBoundingClientRect().width).toBeCloseTo(4, 0);
  });

  it("uses only the explicit today value for Today requests", async () => {
    const element = await renderGantt();
    const details: VioletGanttViewportChangeDetail[] = [];
    element.addEventListener("viewport-change", (event) => {
      details.push((event as CustomEvent<VioletGanttViewportChangeDetail>).detail);
    });

    expect(element.showToday()).toBe(false);
    expect(details).toHaveLength(0);
    element.today = "2028-02-29";
    expect(element.showToday()).toBe(true);
    expect(details[0]?.reason).toBe("today");
    expect(details[0]?.viewport.start).toBe("2028-02-24");
  });

  it("rejects invalid and unbounded viewports without mounting row content", async () => {
    const element = await renderGantt({
      viewport: { start: "1899-12-01", endExclusive: "2200-01-01", scale: "day" },
    });
    expect(element.shadowRoot?.querySelectorAll(".row").length).toBe(0);
    expect(element.shadowRoot?.querySelector('[data-kind="error"]')?.textContent).toContain(
      "half-open YYYY-MM-DD range",
    );
  });

  it("throws nothing when torn down while repeat updates are queued", async () => {
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error ?? event.message);
      event.preventDefault();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      errors.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    try {
      for (const teardown of ["remove", "innerHTML"] as const) {
        const element = await renderGantt();
        // Queue the repeat bindings (days and rows) to re-evaluate, then unbind before they run.
        element.viewport = { start: "2028-03-01", endExclusive: "2028-03-20", scale: "day" };
        element.expandedRowIds = [];
        element.renderedRows = [...element.renderedRows];
        element.renderedDays = [...element.renderedDays];
        if (teardown === "remove") {
          element.remove();
        } else {
          document.body.innerHTML = "";
        }
        await nextFrames(4);
      }
    } finally {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    }

    expect(errors).toEqual([]);
  });
});
