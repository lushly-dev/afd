import { afterEach, describe, expect, it } from "vitest";

import "./violet-data-grid.define";
import type { VioletDataGrid } from "./violet-data-grid";
import {
  beginColumnResize,
  clearedColumnResizeSession,
  isColumnResizeEventForSession,
  resizedColumnWidth,
} from "./violet-data-grid-resize";

describe("violet-data-grid-resize helpers", () => {
  it("starts resize sessions only for the primary pointer button", () => {
    expect(
      beginColumnResize({
        button: 0,
        pointerId: 12,
        columnId: "status",
        clientX: 240,
        startWidth: 180,
        element: document.body,
      }),
    ).toEqual({
      pointerId: 12,
      columnId: "status",
      startX: 240,
      startWidth: 180,
      rtl: false,
    });

    expect(
      beginColumnResize({
        button: 1,
        pointerId: 12,
        columnId: "status",
        clientX: 240,
        startWidth: 180,
        element: document.body,
      }),
    ).toBeNull();
  });

  it("matches pointer events against the active resize session", () => {
    const session = {
      pointerId: 7,
      columnId: "dtm",
      startX: 0,
      startWidth: 120,
      rtl: false,
    };

    expect(isColumnResizeEventForSession(session, 7)).toBe(true);
    expect(isColumnResizeEventForSession(session, 8)).toBe(false);
    expect(
      isColumnResizeEventForSession(
        {
          pointerId: null,
          columnId: null,
          startX: 0,
          startWidth: 0,
          rtl: false,
        },
        7,
      ),
    ).toBe(false);
  });

  it("computes clamped resized widths from pointer movement", () => {
    const session = {
      pointerId: 9,
      columnId: "plant",
      startX: 100,
      startWidth: 180,
      rtl: false,
    };

    expect(
      resizedColumnWidth({
        session,
        clientX: 132,
        minimumWidth: 120,
      }),
    ).toBe(212);

    expect(
      resizedColumnWidth({
        session,
        clientX: 10,
        minimumWidth: 120,
      }),
    ).toBe(120);
  });

  it("grows the column toward the trailing edge in right-to-left", () => {
    const session = {
      pointerId: 9,
      columnId: "plant",
      startX: 300,
      startWidth: 180,
      rtl: true,
    };

    // In RTL the trailing edge is on the left, so a leftward drag grows the column.
    expect(resizedColumnWidth({ session, clientX: 268, minimumWidth: 120 })).toBe(212);
    expect(resizedColumnWidth({ session, clientX: 340, minimumWidth: 120 })).toBe(140);
    expect(resizedColumnWidth({ session, clientX: 600, minimumWidth: 120 })).toBe(120);
  });

  it("clears resize sessions back to the inert state", () => {
    expect(clearedColumnResizeSession()).toEqual({
      pointerId: null,
      columnId: null,
      startX: 0,
      startWidth: 0,
      rtl: false,
    });
  });
});

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function renderGrid(dir: "ltr" | "rtl"): Promise<VioletDataGrid> {
  const host = document.createElement("div");
  host.setAttribute("dir", dir);
  const grid = document.createElement("violet-data-grid") as VioletDataGrid;
  const target = grid as unknown as Record<string, unknown>;
  target.columns = [
    { id: "name", label: "Name", width: "200px" },
    { id: "status", label: "Status", width: "160px" },
  ];
  target.rows = [{ id: "a", data: { name: "Alder", status: "Seedling" } }];
  target.virtualize = false;
  host.append(grid);
  document.body.append(host);
  await customElements.whenDefined("violet-data-grid");
  await nextFrame();
  await nextFrame();
  return grid;
}

/** Drags a column's resizer by `deltaX` pixels and returns the width the grid committed. */
async function dragResizer(
  grid: VioletDataGrid,
  columnId: string,
  deltaX: number,
): Promise<{ start: number; committed: string }> {
  const resizer = grid.shadowRoot?.querySelector<HTMLButtonElement>(
    `[data-column-resizer="${columnId}"]`,
  );
  if (!resizer) {
    throw new Error(`Expected a resizer for ${columnId}.`);
  }
  const start = resizer.closest("th")?.getBoundingClientRect().width ?? 0;
  const widths: string[] = [];
  grid.addEventListener("column-width-change", (event) => {
    widths.push((event as CustomEvent<{ width: string }>).detail.width);
  });

  const startX = resizer.getBoundingClientRect().left + 2;
  const pointer = { bubbles: true, composed: true, cancelable: true, pointerId: 41, button: 0 };
  resizer.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, clientX: startX }));
  resizer.dispatchEvent(new PointerEvent("pointermove", { ...pointer, clientX: startX + deltaX }));
  resizer.dispatchEvent(new PointerEvent("pointerup", { ...pointer, clientX: startX + deltaX }));
  await nextFrame();

  return { start, committed: widths.at(-1) ?? "" };
}

describe("violet-data-grid pointer column resizing", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("grows the column when the resizer is dragged right in left-to-right", async () => {
    const grid = await renderGrid("ltr");
    const { start, committed } = await dragResizer(grid, "name", 40);

    expect(committed).toBe(`${Math.round(start + 40)}px`);
  });

  it("grows the column when the resizer is dragged left in right-to-left", async () => {
    const grid = await renderGrid("rtl");
    const { start, committed } = await dragResizer(grid, "name", -40);

    expect(committed).toBe(`${Math.round(start + 40)}px`);
  });

  it("shrinks the column when the resizer is dragged right in right-to-left", async () => {
    const grid = await renderGrid("rtl");
    const { start, committed } = await dragResizer(grid, "name", 30);

    expect(committed).toBe(`${Math.round(start - 30)}px`);
  });
});
