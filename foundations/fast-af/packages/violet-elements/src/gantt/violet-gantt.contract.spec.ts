import { afterEach, describe, expect, it, vi } from "vitest";
import "./violet-gantt";
import {
  VIOLET_GANTT_DATE_LIMITS,
  type VioletGantt,
  type VioletGanttItem,
  type VioletGanttRow,
  type VioletGanttViewportChangeDetail,
} from "./violet-gantt";
import { ganttDateToDay } from "./violet-gantt-geometry";

const settle = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    ),
  );
const item = (id: string, label = id): VioletGanttItem => ({
  id,
  rowId: "row",
  label,
  time: { kind: "day-range", start: "2028-02-28", endExclusive: "2028-03-03" },
  presentation: "work",
  provenance: "planned",
});

async function mount(rows: VioletGanttRow[], items: VioletGanttItem[] = []): Promise<VioletGantt> {
  const element = document.createElement("violet-gantt") as VioletGantt;
  element.style.cssText = "display:block;width:760px;height:320px";
  element.rows = rows;
  element.items = items;
  element.viewport = { start: "2028-02-25", endExclusive: "2028-03-10", scale: "day" };
  document.body.append(element);
  await settle();
  return element;
}

function assertValidViewport(detail: VioletGanttViewportChangeDetail): void {
  const start = ganttDateToDay(detail.viewport.start);
  const end = ganttDateToDay(detail.viewport.endExclusive);
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  expect(end!).toBeGreaterThan(start!);
  expect(start!).toBeGreaterThanOrEqual(ganttDateToDay(VIOLET_GANTT_DATE_LIMITS.min)!);
  expect(end!).toBeLessThanOrEqual(ganttDateToDay(VIOLET_GANTT_DATE_LIMITS.endExclusive)!);
  expect(end! - start!).toBeLessThanOrEqual(VIOLET_GANTT_DATE_LIMITS.maxViewportDays);
}

describe("violet-gantt public data and boundary contract", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps a valid collapsed hierarchy ready, and diagnoses cycles separately", async () => {
    const element = await mount([
      { id: "root", label: "Root", itemIds: [] },
      { id: "child", parentId: "root", label: "Child", itemIds: [] },
    ]);
    expect(element.shadowRoot?.querySelectorAll('[part~="row"]')).toHaveLength(1);
    expect(element.validationMessage).toBe("");
    element.expandedRowIds = ["root"];
    await settle();
    expect(element.shadowRoot?.querySelectorAll('[part~="row"]')).toHaveLength(2);
    expect(element.validationMessage).toBe("");
    element.rows = [
      { id: "root", label: "Root", itemIds: [] },
      { id: "a", parentId: "b", label: "A", itemIds: [] },
      { id: "b", parentId: "a", label: "B", itemIds: [] },
    ];
    await settle();
    expect(element.validationMessage).toContain("invalid timeline record");
    expect(element.shadowRoot?.querySelectorAll('[part~="row"]')).toHaveLength(1);
  });

  it("gives distinct source IDs distinct DOM IDs and a resolvable active descendant", async () => {
    const element = await mount(
      [{ id: "row", label: "Row", itemIds: ["a:b", "a-b"] }],
      [item("a:b"), item("a-b")],
    );
    const nodes = [...element.shadowRoot!.querySelectorAll<HTMLElement>('[part~="item"]')];
    expect(nodes).toHaveLength(2);
    expect(new Set(nodes.map((node) => node.id)).size).toBe(2);
    expect(element.focusItem("a-b")).toBe(true);
    await settle();
    const activeId = element.shadowRoot?.activeElement?.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    expect(element.shadowRoot?.getElementById(activeId!)?.getAttribute("data-item-id")).toBe("a-b");
  });

  it("renders markup-like text literally and rejects template-like rich-data values", async () => {
    const create = vi.fn(() => {
      throw new Error("Rich-data text must never execute a FAST template");
    });
    const hostile = { create } as unknown as string;
    const element = await mount(
      [
        { id: "row", label: '<img src="x" onerror="alert(1)">', itemIds: ["literal", "unsafe"] },
        { id: "unsafe-row", label: hostile, itemIds: [] },
      ],
      [item("literal", "<strong>Literal label</strong>"), item("unsafe", hostile)],
    );
    expect(create).not.toHaveBeenCalled();
    expect(element.shadowRoot?.querySelector("img")).toBeNull();
    expect(element.shadowRoot?.querySelector("strong")).toBeNull();
    expect(element.shadowRoot?.textContent).toContain("<strong>Literal label</strong>");
    expect(element.validationMessage).toContain("invalid timeline record");
  });

  it("never composes status messages or item notes as FAST templates", async () => {
    const create = vi.fn(() => {
      throw new Error("Status and notes are text");
    });
    const hostile = { create } as unknown as string;
    const element = await mount(
      [{ id: "row", label: "Row", itemIds: ["note"] }],
      [{ ...item("note"), note: hostile }],
    );
    element.status = { kind: "error", message: hostile };
    await settle();
    expect(create).not.toHaveBeenCalled();
    expect(element.shadowRoot?.querySelector('[part~="status"]')?.textContent).not.toContain(
      "[object Object]",
    );
  });

  it("emits only supported ranges when Today or reveal targets a date boundary", async () => {
    const element = await mount([{ id: "row", label: "Row", itemIds: [] }]);
    const requests: VioletGanttViewportChangeDetail[] = [];
    element.addEventListener("viewport-change", (event) =>
      requests.push((event as CustomEvent<VioletGanttViewportChangeDetail>).detail),
    );
    for (const boundary of [VIOLET_GANTT_DATE_LIMITS.min, VIOLET_GANTT_DATE_LIMITS.max]) {
      const before = requests.length;
      element.today = boundary;
      const changed = element.showToday();
      if (changed) expect(requests.length).toBeGreaterThan(before);
      element.scrollToDate(boundary);
    }
    for (const request of requests) assertValidViewport(request);
    expect(element.panBy(Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it("models two semantic columns while day ticks remain presentation detail", async () => {
    const element = await mount([{ id: "row", label: "Row", itemIds: ["one"] }], [item("one")]);
    expect(
      element.shadowRoot?.querySelector('[role="treegrid"]')?.getAttribute("aria-colcount"),
    ).toBe("2");
    expect(element.shadowRoot?.querySelectorAll('[role="columnheader"]')).toHaveLength(2);
    expect(element.shadowRoot?.querySelector('[role="button"][aria-selected]')).toBeNull();
  });
});
