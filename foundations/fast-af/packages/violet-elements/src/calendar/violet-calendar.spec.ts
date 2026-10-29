import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-calendar";
import type { VioletCalendar } from "./violet-calendar";

function nextFrame(): Promise<void> {
    // FAST flushes template updates in its own animation-frame batch; wait two frames so the DOM has settled.
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function renderCalendar(configure: (calendar: VioletCalendar) => void = () => undefined): Promise<VioletCalendar> {
    document.body.innerHTML = "";
    const calendar = document.createElement("violet-calendar") as VioletCalendar;
    calendar.locale = "en-US";
    calendar.value = "2026-03-23";
    configure(calendar);
    document.body.append(calendar);
    await customElements.whenDefined("violet-calendar");
    await nextFrame();
    return calendar;
}

function dayButton(calendar: VioletCalendar, iso: string): HTMLButtonElement | null {
    return calendar.shadowRoot?.querySelector<HTMLButtonElement>(`button[data-date="${iso}"]`) ?? null;
}

function requireDayButton(calendar: VioletCalendar, iso: string): HTMLButtonElement {
    const button = dayButton(calendar, iso);
    if (!button) {
        throw new Error(`Expected a day button for ${iso}.`);
    }
    return button;
}

function dayButtons(calendar: VioletCalendar): HTMLButtonElement[] {
    return Array.from(calendar.shadowRoot?.querySelectorAll<HTMLButtonElement>("button[data-date]") ?? []);
}

// NOTE: `monthDate`, `focusedDate` and `weekStartDay` are declared with `@observable` only. Under this vitest
// project esbuild does not see `experimentalDecorators` (there is no tsconfig.json next to src/), so those
// decorators are not applied and such fields are plain properties that do not trigger template updates. After a
// mutation of those fields we therefore assert on the derived models (`monthLabel`, `weeks`, ...) instead of
// re-rendered DOM, and drive initial-render scenarios through the `configure` callback before mounting.
function cellModel(calendar: VioletCalendar, iso: string) {
    return calendar.weeks.flat().find(cell => cell.iso === iso);
}

function heading(calendar: VioletCalendar): string {
    return calendar.shadowRoot?.querySelector('[part="heading"]')?.textContent?.trim() ?? "";
}

function weekdayShortLabels(calendar: VioletCalendar): string[] {
    return Array.from(calendar.shadowRoot?.querySelectorAll('[part="weekday"]') ?? []).map(
        element => element.textContent?.trim() ?? ""
    );
}

function press(calendar: VioletCalendar, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
    const target = dayButton(calendar, calendar.focusedDate) ?? calendar.shadowRoot?.querySelector('[part="grid"]');
    target?.dispatchEvent(event);
    return event;
}

function todayIso(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

describe("violet-calendar", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("selects a day and emits change in single mode", async () => {
        const calendar = await renderCalendar();
        const handler = vi.fn();
        calendar.addEventListener("change", handler);

        calendar.handleDaySelect("2026-03-24");

        expect(calendar.value).toBe("2026-03-24");
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("supports range selection across two picks", async () => {
        const calendar = await renderCalendar();
        calendar.selectionMode = "range";
        calendar.start = "";
        calendar.end = "";

        calendar.handleDaySelect("2026-03-20");
        calendar.handleDaySelect("2026-03-25");

        expect(calendar.start).toBe("2026-03-20");
        expect(calendar.end).toBe("2026-03-25");
    });

    it("moves keyboard focus through the month grid", async () => {
        const calendar = await renderCalendar();
        calendar.focusedDate = "2026-03-23";

        calendar.handleGridKeydown(new KeyboardEvent("keydown", { key: "ArrowRight" }));
        await nextFrame();

        expect(calendar.focusedDate).toBe("2026-03-24");
    });

    describe("rendering", () => {
        it("renders the month heading, a labelled grid and six full weeks", async () => {
            const calendar = await renderCalendar();
            const grid = calendar.shadowRoot?.querySelector('[role="grid"]');

            expect(heading(calendar)).toBe("March 2026");
            expect(grid?.getAttribute("aria-label")).toBe("March 2026");
            expect(calendar.shadowRoot?.querySelectorAll('[role="row"]')).toHaveLength(6);
            expect(calendar.shadowRoot?.querySelectorAll('[role="gridcell"]')).toHaveLength(42);
            expect(dayButtons(calendar)).toHaveLength(42);
        });

        it("labels each day button with its day number and marks leading and trailing days as other-month", async () => {
            const calendar = await renderCalendar();

            expect(requireDayButton(calendar, "2026-03-05").getAttribute("aria-label")).toBe("5");
            expect(requireDayButton(calendar, "2026-03-05").classList.contains("current-month")).toBe(true);
            // March 1st 2026 is a Sunday, so a Sunday-first grid starts on it and ends on April 11th.
            expect(dayButtons(calendar)[0]?.dataset.date).toBe("2026-03-01");
            expect(dayButtons(calendar).at(-1)?.dataset.date).toBe("2026-04-11");
            expect(requireDayButton(calendar, "2026-04-02").classList.contains("other-month")).toBe(true);
        });

        it("reflects the selected value through aria-selected and the roving tabindex", async () => {
            const calendar = await renderCalendar();
            const cells = Array.from(calendar.shadowRoot?.querySelectorAll('[role="gridcell"]') ?? []);
            const selected = cells.filter(cell => cell.getAttribute("aria-selected") === "true");

            expect(selected).toHaveLength(1);
            expect(selected[0]?.querySelector("button")?.dataset.date).toBe("2026-03-23");
            expect(requireDayButton(calendar, "2026-03-23").classList.contains("selected")).toBe(true);
            const tabbable = dayButtons(calendar).filter(button => button.tabIndex === 0);
            expect(tabbable.map(button => button.dataset.date)).toEqual(["2026-03-23"]);
        });

        it("marks today", async () => {
            const today = todayIso();
            const calendar = await renderCalendar(element => {
                element.value = today;
            });

            expect(requireDayButton(calendar, today).classList.contains("today")).toBe(true);
            expect(calendar.shadowRoot?.querySelectorAll("button.today")).toHaveLength(1);
        });

        it("syncs the visible month when value changes", async () => {
            const calendar = await renderCalendar();

            calendar.value = "2027-11-02";
            await nextFrame();

            expect(calendar.monthLabel).toBe("November 2027");
            expect(calendar.focusedDate).toBe("2027-11-02");
            expect(cellModel(calendar, "2027-11-02")?.tabIndex).toBe(0);
            expect(cellModel(calendar, "2027-11-02")?.selected).toBe(true);
        });

        it("ignores malformed values when syncing the month", async () => {
            const calendar = await renderCalendar();

            calendar.value = "2026-02-31";
            await nextFrame();

            expect(calendar.monthLabel).toBe("March 2026");
        });
    });

    describe("locale and week start", () => {
        it("starts weeks on Sunday for en-US", async () => {
            const calendar = await renderCalendar();

            expect(calendar.resolvedWeekStartDay).toBe(0);
            expect(weekdayShortLabels(calendar)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
        });

        it("starts weeks on Monday for locales whose week begins on Monday", async () => {
            const calendar = await renderCalendar(element => {
                element.locale = "de-DE";
            });

            expect(calendar.resolvedWeekStartDay).toBe(1);
            expect(weekdayShortLabels(calendar)[0]).toMatch(/^Mo/);
            expect(heading(calendar)).toBe("März 2026");
            expect(dayButtons(calendar)[0]?.dataset.date).toBe("2026-02-23");
        });

        it("lets weekStartDay override the locale default", async () => {
            const calendar = await renderCalendar(element => {
                element.weekStartDay = 1;
            });

            expect(calendar.resolvedWeekStartDay).toBe(1);
            expect(weekdayShortLabels(calendar)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
            expect(dayButtons(calendar)[0]?.dataset.date).toBe("2026-02-23");

            calendar.weekStartDay = 6;
            expect(calendar.weekdayLabels[0]?.short).toBe("Sat");
            expect(calendar.weeks[0]?.[0]?.iso).toBe("2026-02-28");
        });

        it("ignores out-of-range weekStartDay values and falls back to the locale", async () => {
            const calendar = await renderCalendar();

            calendar.weekStartDay = 9;
            expect(calendar.resolvedWeekStartDay).toBe(0);
            calendar.weekStartDay = -1;
            expect(calendar.resolvedWeekStartDay).toBe(0);
        });

        it("exposes long weekday names for assistive technology", async () => {
            const calendar = await renderCalendar();
            const first = calendar.shadowRoot?.querySelector('[part="weekday"]');

            expect(first?.getAttribute("aria-label")).toBe("Sunday");
        });

        it("localises the month heading and emits locale-change when the locale changes", async () => {
            const calendar = await renderCalendar();
            const handler = vi.fn();
            calendar.addEventListener("locale-change", handler);

            calendar.locale = "fr-FR";
            await nextFrame();

            expect(heading(calendar)).toBe("mars 2026");
            expect(handler).toHaveBeenCalledTimes(1);
            expect((handler.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ locale: "fr-FR" });
        });
    });

    describe("month navigation", () => {
        it("moves to the next and previous month with the header buttons", async () => {
            const calendar = await renderCalendar();
            const previous = calendar.shadowRoot?.querySelector<HTMLButtonElement>('[part="previous-month"]');
            const next = calendar.shadowRoot?.querySelector<HTMLButtonElement>('[part="next-month"]');

            next?.click();
            expect(calendar.monthLabel).toBe("April 2026");

            previous?.click();
            previous?.click();
            expect(calendar.monthLabel).toBe("February 2026");
        });

        it("rolls over the year boundary in both directions", async () => {
            const calendar = await renderCalendar(element => {
                element.value = "2026-12-15";
            });

            calendar.showNextMonth();
            expect(calendar.monthLabel).toBe("January 2027");

            calendar.showPreviousMonth();
            calendar.showPreviousMonth();
            expect(calendar.monthLabel).toBe("November 2026");
        });

        it("moves the focused date into the visible month so a day stays tabbable", async () => {
            const calendar = await renderCalendar();

            calendar.showNextMonth();
            await nextFrame();

            expect(calendar.focusedDate).toBe("2026-04-01");
            expect(cellModel(calendar, "2026-04-01")?.tabIndex).toBe(0);
        });

        it("does not change the selected value when navigating months", async () => {
            const calendar = await renderCalendar();
            const handler = vi.fn();
            calendar.addEventListener("change", handler);

            calendar.showNextMonth();
            await nextFrame();

            expect(calendar.value).toBe("2026-03-23");
            expect(handler).not.toHaveBeenCalled();
        });

        it("disables the navigation buttons when the calendar is disabled", async () => {
            const calendar = await renderCalendar(element => {
                element.disabled = true;
            });

            const buttons = calendar.shadowRoot?.querySelectorAll<HTMLButtonElement>(".nav");
            expect(buttons).toHaveLength(2);
            expect(Array.from(buttons ?? []).every(button => button.disabled)).toBe(true);
        });
    });

    describe("single selection", () => {
        it("emits input and change with the new value when a day is clicked", async () => {
            const calendar = await renderCalendar();
            const input = vi.fn();
            const change = vi.fn();
            calendar.addEventListener("input", input);
            calendar.addEventListener("change", change);

            requireDayButton(calendar, "2026-03-10").click();
            await nextFrame();

            expect(calendar.value).toBe("2026-03-10");
            expect(calendar.focusedDate).toBe("2026-03-10");
            expect((input.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ value: "2026-03-10" });
            expect((change.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ value: "2026-03-10" });
            expect(requireDayButton(calendar, "2026-03-10").closest('[role="gridcell"]')?.getAttribute("aria-selected")).toBe("true");
            expect(requireDayButton(calendar, "2026-03-23").closest('[role="gridcell"]')?.getAttribute("aria-selected")).toBe("false");
        });

        it("selects a day from the adjacent month shown in the grid", async () => {
            const calendar = await renderCalendar();

            requireDayButton(calendar, "2026-04-02").click();
            await nextFrame();

            expect(calendar.value).toBe("2026-04-02");
            expect(calendar.monthLabel).toBe("April 2026");
        });

        it("selects with a real pointer click", async () => {
            const calendar = await renderCalendar();

            await userEvent.click(requireDayButton(calendar, "2026-03-12"));

            await vi.waitFor(() => expect(calendar.value).toBe("2026-03-12"));
        });
    });

    describe("range selection", () => {
        function rangeCalendar(): Promise<VioletCalendar> {
            return renderCalendar(element => {
                element.selectionMode = "range";
                element.value = "";
                element.start = "";
                element.end = "";
                element.setAttribute("selection-mode", "range");
            });
        }

        it("emits a partial range after the first pick and a complete range after the second", async () => {
            const calendar = await rangeCalendar();
            const change = vi.fn();
            calendar.addEventListener("change", change);

            requireDayButton(calendar, "2026-03-10").click();
            requireDayButton(calendar, "2026-03-14").click();

            expect(change).toHaveBeenCalledTimes(2);
            expect((change.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ start: "2026-03-10", end: null });
            expect((change.mock.calls[1]?.[0] as CustomEvent).detail).toEqual({ start: "2026-03-10", end: "2026-03-14" });
        });

        it("emits input alongside change for each pick", async () => {
            const calendar = await rangeCalendar();
            const input = vi.fn();
            calendar.addEventListener("input", input);

            calendar.handleDaySelect("2026-03-10");
            calendar.handleDaySelect("2026-03-14");

            expect(input).toHaveBeenCalledTimes(2);
        });

        it("restarts the range when a third day is picked", async () => {
            const calendar = await rangeCalendar();

            calendar.handleDaySelect("2026-03-10");
            calendar.handleDaySelect("2026-03-14");
            calendar.handleDaySelect("2026-03-20");

            expect(calendar.start).toBe("2026-03-20");
            expect(calendar.end).toBe("");
        });

        it("uses an earlier second pick as the new start instead of producing a reversed range", async () => {
            const calendar = await rangeCalendar();

            calendar.handleDaySelect("2026-03-20");
            calendar.handleDaySelect("2026-03-05");

            expect(calendar.start).toBe("2026-03-05");
            expect(calendar.end).toBe("");
        });

        it("allows a single-day range by picking the start day twice", async () => {
            const calendar = await rangeCalendar();

            calendar.handleDaySelect("2026-03-10");
            calendar.handleDaySelect("2026-03-10");

            expect(calendar.start).toBe("2026-03-10");
            expect(calendar.end).toBe("2026-03-10");
        });

        it("marks the start, end and in-between days in the grid", async () => {
            const calendar = await rangeCalendar();
            calendar.start = "2026-03-10";
            calendar.end = "2026-03-13";
            await nextFrame();

            expect(requireDayButton(calendar, "2026-03-10").classList.contains("range-start")).toBe(true);
            expect(requireDayButton(calendar, "2026-03-13").classList.contains("range-end")).toBe(true);
            const inRange = Array.from(calendar.shadowRoot?.querySelectorAll(".day-cell.range") ?? []).map(
                cell => cell.querySelector("button")?.dataset.date
            );
            expect(inRange).toEqual(["2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13"]);
            const selected = Array.from(calendar.shadowRoot?.querySelectorAll('[aria-selected="true"]') ?? []).map(
                cell => cell.querySelector("button")?.dataset.date
            );
            expect(selected).toEqual(["2026-03-10", "2026-03-13"]);
        });

        it("does not render the single value as selected in range mode", async () => {
            const calendar = await renderCalendar(element => {
                element.selectionMode = "range";
                element.value = "2026-03-23";
            });

            expect(calendar.shadowRoot?.querySelectorAll('[aria-selected="true"]')).toHaveLength(0);
        });

        it("shows the month of the range start", async () => {
            const calendar = await rangeCalendar();

            calendar.start = "2026-07-04";
            await nextFrame();

            expect(calendar.monthLabel).toBe("July 2026");
        });
    });

    describe("min, max and disabled dates", () => {
        it("disables days outside min and max", async () => {
            const calendar = await renderCalendar(element => {
                element.min = "2026-03-10";
                element.max = "2026-03-20";
            });

            expect(requireDayButton(calendar, "2026-03-09").disabled).toBe(true);
            expect(requireDayButton(calendar, "2026-03-10").disabled).toBe(false);
            expect(requireDayButton(calendar, "2026-03-20").disabled).toBe(false);
            expect(requireDayButton(calendar, "2026-03-21").disabled).toBe(true);
        });

        it("ignores selection of days outside min and max", async () => {
            const calendar = await renderCalendar(element => {
                element.min = "2026-03-10";
                element.max = "2026-03-20";
            });
            const handler = vi.fn();
            calendar.addEventListener("change", handler);

            calendar.handleDaySelect("2026-03-09");
            calendar.handleDaySelect("2026-03-21");
            requireDayButton(calendar, "2026-03-25").click();

            expect(calendar.value).toBe("2026-03-23");
            expect(handler).not.toHaveBeenCalled();
        });

        it("honours a disabledDates predicate in the grid and in selection", async () => {
            const calendar = await renderCalendar(element => {
                element.disabledDates = iso => iso.endsWith("-15") || iso.endsWith("-16");
            });
            const handler = vi.fn();
            calendar.addEventListener("change", handler);

            expect(requireDayButton(calendar, "2026-03-15").disabled).toBe(true);
            expect(requireDayButton(calendar, "2026-03-17").disabled).toBe(false);
            calendar.handleDaySelect("2026-03-15");
            expect(handler).not.toHaveBeenCalled();
            calendar.handleDaySelect("2026-03-17");
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it("ignores selection and keyboard input when the whole calendar is disabled", async () => {
            const calendar = await renderCalendar(element => {
                element.disabled = true;
            });
            const handler = vi.fn();
            calendar.addEventListener("change", handler);

            calendar.handleDaySelect("2026-03-24");
            press(calendar, "ArrowRight");

            expect(handler).not.toHaveBeenCalled();
            expect(calendar.value).toBe("2026-03-23");
            expect(calendar.focusedDate).toBe("2026-03-23");
        });

        it("does not select a disabled focused day with Enter", async () => {
            const calendar = await renderCalendar(element => {
                element.max = "2026-03-23";
            });
            const handler = vi.fn();
            calendar.addEventListener("change", handler);
            calendar.focusedDate = "2026-03-30";

            press(calendar, "Enter");

            expect(handler).not.toHaveBeenCalled();
            expect(calendar.value).toBe("2026-03-23");
        });
    });

    describe("keyboard navigation", () => {
        it("moves by day and by week with the arrow keys and prevents default scrolling", async () => {
            const calendar = await renderCalendar();

            expect(press(calendar, "ArrowRight").defaultPrevented).toBe(true);
            expect(calendar.focusedDate).toBe("2026-03-24");
            press(calendar, "ArrowLeft");
            press(calendar, "ArrowLeft");
            expect(calendar.focusedDate).toBe("2026-03-22");
            press(calendar, "ArrowDown");
            expect(calendar.focusedDate).toBe("2026-03-29");
            press(calendar, "ArrowUp");
            press(calendar, "ArrowUp");
            expect(calendar.focusedDate).toBe("2026-03-15");
        });

        it("crosses month boundaries and updates the visible month", async () => {
            const calendar = await renderCalendar(element => {
                element.value = "2026-03-31";
            });

            press(calendar, "ArrowRight");
            await nextFrame();

            expect(calendar.focusedDate).toBe("2026-04-01");
            expect(calendar.monthLabel).toBe("April 2026");

            press(calendar, "ArrowLeft");
            await nextFrame();
            expect(calendar.focusedDate).toBe("2026-03-31");
            expect(calendar.monthLabel).toBe("March 2026");
        });

        it("moves to the start and end of the week with Home and End", async () => {
            const calendar = await renderCalendar(element => {
                element.value = "2026-03-25";
            });

            press(calendar, "Home");
            expect(calendar.focusedDate).toBe("2026-03-22");
            press(calendar, "End");
            expect(calendar.focusedDate).toBe("2026-03-28");
        });

        it("makes Home and End respect a Monday week start", async () => {
            const calendar = await renderCalendar(element => {
                element.value = "2026-03-25";
                element.weekStartDay = 1;
            });

            press(calendar, "Home");
            expect(calendar.focusedDate).toBe("2026-03-23");
            press(calendar, "End");
            expect(calendar.focusedDate).toBe("2026-03-29");
        });

        it("keeps Home and End on the current day when already at the edge of the week", async () => {
            const calendar = await renderCalendar(element => {
                element.value = "2026-03-22";
            });

            press(calendar, "Home");
            expect(calendar.focusedDate).toBe("2026-03-22");
            press(calendar, "End");
            press(calendar, "End");
            expect(calendar.focusedDate).toBe("2026-03-28");
        });

        it("moves by month with PageUp and PageDown and clamps the day to the target month length", async () => {
            const calendar = await renderCalendar(element => {
                element.value = "2026-03-31";
            });

            press(calendar, "PageUp");
            await nextFrame();
            expect(calendar.focusedDate).toBe("2026-02-28");
            expect(calendar.monthLabel).toBe("February 2026");

            press(calendar, "PageDown");
            await nextFrame();
            expect(calendar.focusedDate).toBe("2026-03-28");
            expect(calendar.monthLabel).toBe("March 2026");
        });

        it("moves by year with Shift+PageUp and Shift+PageDown, handling leap days", async () => {
            const calendar = await renderCalendar(element => {
                element.value = "2028-02-29";
            });

            press(calendar, "PageDown", { shiftKey: true });
            await nextFrame();
            expect(calendar.focusedDate).toBe("2029-02-28");
            expect(calendar.monthLabel).toBe("February 2029");

            press(calendar, "PageUp", { shiftKey: true });
            await nextFrame();
            expect(calendar.focusedDate).toBe("2028-02-28");
            expect(calendar.monthLabel).toBe("February 2028");
        });

        it("clamps keyboard navigation to min and max", async () => {
            const calendar = await renderCalendar(element => {
                element.min = "2026-03-20";
                element.max = "2026-03-25";
                element.value = "2026-03-23";
            });

            calendar.focusedDate = "2026-03-20";
            press(calendar, "ArrowLeft");
            expect(calendar.focusedDate).toBe("2026-03-20");

            calendar.focusedDate = "2026-03-25";
            press(calendar, "ArrowDown");
            expect(calendar.focusedDate).toBe("2026-03-25");

            press(calendar, "PageDown");
            await nextFrame();
            expect(calendar.focusedDate).toBe("2026-03-25");
            expect(calendar.monthLabel).toBe("March 2026");
        });

        it("moves DOM focus to the newly focused day", async () => {
            const calendar = await renderCalendar();
            requireDayButton(calendar, "2026-03-23").focus();

            press(calendar, "ArrowDown");

            await vi.waitFor(() => {
                expect(calendar.shadowRoot?.activeElement?.getAttribute("data-date")).toBe("2026-03-30");
            });
        });

        it("tracks focusin on a day button as the focused date", async () => {
            const calendar = await renderCalendar();

            requireDayButton(calendar, "2026-03-11").focus();

            expect(calendar.focusedDate).toBe("2026-03-11");
            expect(cellModel(calendar, "2026-03-11")?.tabIndex).toBe(0);
            expect(cellModel(calendar, "2026-03-23")?.tabIndex).toBe(-1);
        });

        it("selects the focused day with Enter and Space", async () => {
            const calendar = await renderCalendar();
            const change = vi.fn();
            calendar.addEventListener("change", change);

            press(calendar, "ArrowRight");
            const enter = press(calendar, "Enter");
            expect(enter.defaultPrevented).toBe(true);
            expect(calendar.value).toBe("2026-03-24");

            press(calendar, "ArrowDown");
            press(calendar, " ");
            expect(calendar.value).toBe("2026-03-31");
            expect(change).toHaveBeenCalledTimes(2);
            expect((change.mock.calls[1]?.[0] as CustomEvent).detail).toEqual({ value: "2026-03-31" });
        });

        it("extends a range from the keyboard", async () => {
            const calendar = await renderCalendar(element => {
                element.selectionMode = "range";
                element.value = "";
                element.start = "";
                element.end = "";
                element.focusedDate = "2026-03-10";
            });

            press(calendar, "Enter");
            press(calendar, "ArrowRight");
            press(calendar, "ArrowRight");
            press(calendar, "Enter");

            expect(calendar.start).toBe("2026-03-10");
            expect(calendar.end).toBe("2026-03-12");
        });

        it("does not cancel keys the grid does not handle, so Tab can leave the calendar", async () => {
            const calendar = await renderCalendar();
            const after = document.createElement("button");
            document.body.append(after);
            requireDayButton(calendar, "2026-03-23").focus();

            const event = press(calendar, "Tab");

            expect(event.defaultPrevented).toBe(false);
        });
    });

    describe("native key handling", () => {
        it("returns true for unhandled keys and false for handled keys", async () => {
            const calendar = await renderCalendar();
            const key = (value: string) => new KeyboardEvent("keydown", { key: value, cancelable: true });

            expect(calendar.handleGridKeydown(key("Tab"))).toBe(true);
            expect(calendar.handleGridKeydown(key("a"))).toBe(true);
            expect(calendar.handleGridKeydown(key("ArrowRight"))).toBe(false);
        });

        it("still cancels the keys it handles", async () => {
            const calendar = await renderCalendar();

            expect(press(calendar, "ArrowRight").defaultPrevented).toBe(true);
            expect(press(calendar, "Enter").defaultPrevented).toBe(true);
        });

        it("does not cancel Shift+Tab or printable keys", async () => {
            const calendar = await renderCalendar();

            expect(press(calendar, "Tab", { shiftKey: true }).defaultPrevented).toBe(false);
            expect(press(calendar, "x").defaultPrevented).toBe(false);
        });
    });
});
