import type {} from "@vitest/browser-playwright";
import { afterEach, describe, expect, it } from "vitest";
import { cdp, page, server, userEvent } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "./violet-data-grid.define";
import type { VioletDataGrid, VioletDataGridFillDetail } from "./violet-data-grid";

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

async function renderGrid() {
    document.body.innerHTML = "";
    const grid = document.createElement("violet-data-grid") as VioletDataGrid;
    grid.setAttribute("aria-label", "Plants");
    grid.focusMode = "cell";
    grid.columns = [
        { id: "name", label: "Name", width: "140px", editable: true },
        { id: "bed", label: "Bed", width: "120px", editable: true },
        { id: "notes", label: "Notes", width: "120px" },
    ];
    grid.rows = ["Alder", "Birch", "Cedar"].map((name, index) => ({
        id: String(index), data: { name, bed: "North", notes: "Read only" },
    }));
    const fills: VioletDataGridFillDetail[] = [];
    grid.addEventListener("cell-fill", event => fills.push((event as CustomEvent<VioletDataGridFillDetail>).detail));
    document.body.append(grid);
    await nextFrame();
    await nextFrame();
    return { grid, fills };
}

function cell(grid: VioletDataGrid, row: number, column = "name") {
    return grid.shadowRoot!.querySelector<HTMLElement>(`td[data-row-id="${row}"][data-column-id="${column}"]`)!;
}

function handle(grid: VioletDataGrid) {
    return grid.shadowRoot!.querySelector<HTMLElement>('[data-fill-handle="true"]')!;
}

function action(grid: VioletDataGrid, direction: "down" | "right") {
    return page.elementLocator(grid).getByRole("button", { name: `Fill ${direction}`, exact: true });
}

// CDP injects trusted browser touch input, rather than dispatching synthetic PointerEvents.
async function tap(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const frame = window.frameElement?.getBoundingClientRect();
    const point = { x: rect.x + rect.width / 2 + (frame?.x ?? 0), y: rect.y + rect.height / 2 + (frame?.y ?? 0) };
    await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 1 }] });
    await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await nextFrame();
}

describe("violet-data-grid built-in pointer fill", () => {
    afterEach(async () => {
        if (isChromium) {
            await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
        }
        document.body.innerHTML = "";
    });

    it("drags from the invisible part of a 24px target while retaining the handle visual", async () => {
        const { grid, fills } = await renderGrid();
        grid.density = "compact";
        await userEvent.click(cell(grid, 0));
        await nextFrame();
        const target = handle(grid);
        const box = target.getBoundingClientRect();
        const visual = getComputedStyle(target, "::after");
        expect(box.width).toBe(24);
        expect(box.height).toBe(24);
        expect(visual.width).toBe("6px");
        expect(visual.height).toBe("6px");
        expect(visual.borderWidth).toBe("1px");
        expect(target.getAttribute("aria-hidden")).toBe("true");
        // Upper-left target corner is well outside the small square at bottom-right.
        expect(grid.shadowRoot!.elementFromPoint(box.x + 2, box.y + 2)).toBe(target);
        await userEvent.dragAndDrop(target, cell(grid, 1), { sourcePosition: { x: 2, y: 2 } });
        await nextFrame();
        expect(fills).toHaveLength(1);
        expect(fills[0]?.changes).toEqual([{ rowId: "1", columnId: "name", value: "Alder" }]);

        // At the final corner of the viewport, the full target remains hittable.
        grid.columns = grid.columns.map(column => ({ ...column, editable: true }));
        await nextFrame();
        await userEvent.click(cell(grid, 2, "notes"));
        await nextFrame();
        const lastBox = handle(grid).getBoundingClientRect();
        for (const x of [lastBox.left + 2, lastBox.right - 2]) {
            for (const y of [lastBox.top + 2, lastBox.bottom - 2]) {
                expect(grid.shadowRoot!.elementFromPoint(x, y)).toBe(handle(grid));
            }
        }
    });

    for (const direction of ["down", "right"] as const) {
        it(`built-in Fill ${direction} emits the same detail as a real drag`, async () => {
            const dragged = await renderGrid();
            await userEvent.click(cell(dragged.grid, 0));
            await nextFrame();
            await userEvent.dragAndDrop(
                handle(dragged.grid),
                cell(dragged.grid, direction === "down" ? 1 : 0, direction === "right" ? "bed" : "name"),
                { sourcePosition: { x: 10, y: 10 }, targetPosition: { x: 60, y: 16 } },
            );
            await nextFrame();
            expect(dragged.fills).toHaveLength(1);

            const clicked = await renderGrid();
            await userEvent.click(cell(clicked.grid, 0));
            await action(clicked.grid, direction).click();
            await nextFrame();
            expect(clicked.fills).toEqual(dragged.fills);
            expect(clicked.grid.cellSelection).toEqual(dragged.grid.cellSelection);
            expect(clicked.grid.shadowRoot!.querySelector(".fill-status")?.textContent).toContain(`Filled 1 cell ${direction}.`);
        });
    }

    it.runIf(isChromium)("offers the same fill using trusted touch taps with no drag or consumer controls", async () => {
        await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
        const { grid, fills } = await renderGrid();
        const pointerTypes: string[] = [];
        grid.addEventListener("pointerdown", event => {
            expect(event.isTrusted).toBe(true);
            pointerTypes.push(event.pointerType);
        });
        await tap(cell(grid, 0));
        const button = grid.shadowRoot!.querySelector<HTMLButtonElement>(".fill-action")!;
        await tap(button);
        expect(pointerTypes).toEqual(["touch", "touch"]);
        expect(fills).toEqual([{
            source: { anchor: { rowId: "0", columnId: "name" }, focus: { rowId: "0", columnId: "name" } },
            target: { anchor: { rowId: "0", columnId: "name" }, focus: { rowId: "1", columnId: "name" } },
            changes: [{ rowId: "1", columnId: "name", value: "Alder" }],
        }]);
    });

    it("keeps native keyboard actions, the grid's navigation and accessible selection description", async () => {
        const { grid, fills } = await renderGrid();
        await expect.element(action(grid, "down")).toBeDisabled();
        await userEvent.click(cell(grid, 0));
        await nextFrame();
        await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
        expect(grid.shadowRoot!.activeElement).toBe(action(grid, "right").element());
        await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
        expect(grid.shadowRoot!.activeElement).toBe(action(grid, "down").element());
        await userEvent.keyboard("{Enter}");
        expect(fills).toHaveLength(1);
        await nextFrame();
        await userEvent.keyboard("{Tab}");
        expect(grid.shadowRoot!.activeElement).toBe(action(grid, "right").element());
        await userEvent.keyboard("{Tab}");
        await expect.poll(() => grid.shadowRoot!.activeElement).toBe(cell(grid, 0, "name"));
        await userEvent.keyboard("{ArrowRight}");
        expect(grid.activeCell).toEqual({ rowId: "0", columnId: "bed" });
        expect(grid.shadowRoot!.querySelector(".table-scroll")?.hasAttribute("aria-describedby")).toBe(false);
        expect(grid.shadowRoot!.activeElement).toBe(cell(grid, 0, "bed"));
        expect(cell(grid, 0, "bed").getAttribute("role")).toBe("gridcell");
        expect(grid.activeCellDescription).toContain("column Bed");
        await expect.element(action(grid, "right")).toBeDisabled();
        await userEvent.keyboard("{F2}");
        await nextFrame();
        await expect.element(action(grid, "down")).toBeDisabled();
        await userEvent.keyboard("{Escape}");
        expect(grid.editingCell).toBeNull();
        expect(fills).toHaveLength(1);
    });

    it("renews live feedback when consecutive fills change the destination", async () => {
        const { grid, fills } = await renderGrid();
        await userEvent.click(cell(grid, 0));
        await action(grid, "down").click();
        await nextFrame();
        const status = grid.shadowRoot!.querySelector(".fill-status")!;
        expect(status.getAttribute("role")).toBe("status");
        expect(status.getAttribute("aria-live")).toBe("polite");
        expect(status.textContent).toContain("Filled 1 cell down. Selection ends at row 2, column Name.");
        // Native Space activation repeats the action without moving the pointer (WebKit does not focus buttons on click).
        (action(grid, "down").element() as HTMLElement).focus();
        await userEvent.keyboard(" ");
        await nextFrame();
        expect(fills).toHaveLength(2);
        expect(status.textContent).toContain("Filled 1 cell down. Selection ends at row 3, column Name.");
        await expect.element(action(grid, "down")).toBeDisabled();
    });

    it("tiles a selected row, respects locked edges, and hides the actions in row focus mode", async () => {
        const { grid, fills } = await renderGrid();
        await userEvent.click(cell(grid, 0));
        await userEvent.click(cell(grid, 0, "bed"), { modifiers: ["Shift"] });
        await action(grid, "down").click();
        expect(fills[0]?.changes).toEqual([
            { rowId: "1", columnId: "name", value: "Alder" },
            { rowId: "1", columnId: "bed", value: "North" },
        ]);
        await expect.element(action(grid, "right")).toBeDisabled();
        await userEvent.click(cell(grid, 2));
        await expect.element(action(grid, "down")).toBeDisabled();
        grid.focusMode = "row";
        await nextFrame();
        expect(grid.shadowRoot!.querySelector(".fill-actions")).toBeNull();
        expect(grid.shadowRoot!.querySelector(".fill-handle")).toBeNull();
    });
});
