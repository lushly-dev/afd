import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type { VioletCalendar } from "../calendar/violet-calendar";
import "./violet-date-range-picker";
import type { VioletDateRangePicker } from "./violet-date-range-picker";

function nextFrame(): Promise<void> {
    // FAST flushes template updates in its own animation-frame batch; wait two frames so the DOM has settled.
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function renderDateRangePicker(
    configure: (picker: VioletDateRangePicker) => void = () => undefined
): Promise<VioletDateRangePicker> {
    document.body.innerHTML = "";
    const picker = document.createElement("violet-date-range-picker") as VioletDateRangePicker;
    picker.label = "Harvest window";
    picker.supportingText = "Choose the planned harvest period for this crop plan.";
    picker.start = "2026-03-20";
    picker.end = "2026-03-27";
    picker.min = "2026-03-01";
    picker.max = "2026-04-30";
    configure(picker);
    document.body.append(picker);
    await customElements.whenDefined("violet-date-range-picker");
    await nextFrame();
    return picker;
}

function getTrigger(picker: VioletDateRangePicker): HTMLButtonElement {
    const trigger = picker.shadowRoot?.querySelector<HTMLButtonElement>(".trigger");
    if (!trigger) {
        throw new Error("Expected the trigger to render.");
    }
    return trigger;
}

function getPanel(picker: VioletDateRangePicker): HTMLElement {
    const panel = picker.shadowRoot?.querySelector<HTMLElement>(".panel");
    if (!panel) {
        throw new Error("Expected the panel to render.");
    }
    return panel;
}

function getCalendar(picker: VioletDateRangePicker): VioletCalendar {
    const calendar = picker.shadowRoot?.querySelector<VioletCalendar>("violet-calendar");
    if (!calendar) {
        throw new Error("Expected the calendar to render.");
    }
    return calendar;
}

function calendarDay(picker: VioletDateRangePicker, iso: string): HTMLButtonElement {
    const button = getCalendar(picker).shadowRoot?.querySelector<HTMLButtonElement>(`button[data-date="${iso}"]`);
    if (!button) {
        throw new Error(`Expected calendar day ${iso} to render.`);
    }
    return button;
}

function segmentTexts(picker: VioletDateRangePicker): string[] {
    return Array.from(picker.shadowRoot?.querySelectorAll(".segment") ?? []).map(
        element => element.textContent?.trim() ?? ""
    );
}

function triggerKeydown(picker: VioletDateRangePicker, key: string): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true });
    getTrigger(picker).dispatchEvent(event);
    return event;
}

function calendarChange(detail: { start?: string; end?: string }): CustomEvent {
    return new CustomEvent("change", { detail, bubbles: true });
}

function eventDetails(mock: ReturnType<typeof vi.fn>): unknown[] {
    return mock.mock.calls.map(([event]) => (event as CustomEvent).detail);
}

describe("violet-date-range-picker", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("reflects start and end values from the calendar selection detail", async () => {
        const picker = await renderDateRangePicker();

        picker.handleCalendarChange(
            new CustomEvent("change", {
                detail: { start: "2026-03-22", end: "2026-03-29" },
                bubbles: true,
            }),
        );
        await nextFrame();

        expect(picker.start).toBe("2026-03-22");
        expect(picker.end).toBe("2026-03-29");
    });

    it("closes once a complete range is selected", async () => {
        const picker = await renderDateRangePicker();
        picker.show();

        picker.handleCalendarChange(
            new CustomEvent("change", {
                detail: { start: "2026-03-22", end: "2026-03-29" },
                bubbles: true,
            }),
        );
        await nextFrame();

        expect(picker.open).toBe(false);
    });

    it("fails custom validity when required and incomplete", async () => {
        const picker = await renderDateRangePicker();
        picker.required = true;
        picker.start = "2026-03-22";
        picker.end = "";

        expect(picker.checkValidity()).toBe(false);
    });

    describe("rendering and ARIA", () => {
        it("shows localised start and end dates in the trigger", async () => {
            const picker = await renderDateRangePicker();

            expect(segmentTexts(picker)).toEqual(["Mar 20, 2026", "Mar 27, 2026"]);
            expect(picker.shadowRoot?.querySelectorAll(".segment.placeholder")).toHaveLength(0);
        });

        it("shows placeholders for an empty range", async () => {
            const picker = await renderDateRangePicker(element => {
                element.start = "";
                element.end = "";
            });

            expect(segmentTexts(picker)).toEqual(["Start date", "End date"]);
            expect(picker.shadowRoot?.querySelectorAll(".segment.placeholder")).toHaveLength(2);
        });

        it("shows only the placeholder for the missing end of a partial range", async () => {
            const picker = await renderDateRangePicker(element => {
                element.end = "";
            });

            expect(segmentTexts(picker)).toEqual(["Mar 20, 2026", "End date"]);
            const placeholders = Array.from(picker.shadowRoot?.querySelectorAll(".segment.placeholder") ?? []);
            expect(placeholders.map(element => element.textContent?.trim())).toEqual(["End date"]);
        });

        it("formats the trigger with the configured locale", async () => {
            const picker = await renderDateRangePicker(element => {
                element.locale = "de-DE";
            });

            expect(segmentTexts(picker)).toEqual(["20.03.2026", "27.03.2026"]);
        });

        it("exposes the range through the value getter with null for missing ends", async () => {
            const picker = await renderDateRangePicker();
            expect(picker.value).toEqual({ start: "2026-03-20", end: "2026-03-27" });

            picker.start = "";
            picker.end = "";
            expect(picker.value).toEqual({ start: null, end: null });
        });

        it("wires the trigger to the label, panel and descriptions", async () => {
            const picker = await renderDateRangePicker();
            const trigger = getTrigger(picker);

            expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
            expect(trigger.getAttribute("aria-expanded")).toBe("false");
            expect(trigger.getAttribute("aria-controls")).toBe(picker.panelId);
            expect(trigger.getAttribute("aria-labelledby")).toBe(picker.labelId);
            expect(trigger.getAttribute("aria-describedby")).toBe(picker.supportingId);
            expect(trigger.getAttribute("aria-invalid")).toBe("false");
            expect(picker.shadowRoot?.getElementById(picker.labelId)?.textContent?.trim()).toBe("Harvest window");
            expect(getPanel(picker).id).toBe(picker.panelId);
            expect(getPanel(picker).hidden).toBe(true);
        });

        it("labels the trigger by itself when there is no label", async () => {
            const picker = await renderDateRangePicker(element => {
                element.label = "";
            });

            expect(getTrigger(picker).getAttribute("aria-labelledby")).toBe(picker.triggerId);
            expect(getTrigger(picker).id).toBe(picker.triggerId);
        });

        it("renders the calendar in range mode with the range, min, max and locale", async () => {
            const picker = await renderDateRangePicker(element => {
                element.locale = "en-GB";
            });
            const calendar = getCalendar(picker);

            expect(calendar.getAttribute("selection-mode")).toBe("range");
            expect(calendar.start).toBe("2026-03-20");
            expect(calendar.end).toBe("2026-03-27");
            expect(calendar.min).toBe("2026-03-01");
            expect(calendar.max).toBe("2026-04-30");
            expect(calendar.locale).toBe("en-GB");
        });

        it("reflects the invalid state and error text", async () => {
            const picker = await renderDateRangePicker(element => {
                element.invalid = true;
                element.errorText = "Pick dates in season.";
            });

            expect(getTrigger(picker).getAttribute("aria-invalid")).toBe("true");
            expect(getTrigger(picker).getAttribute("aria-describedby")).toBe(`${picker.supportingId} ${picker.errorId}`);
            expect(picker.shadowRoot?.getElementById(picker.errorId)?.textContent?.trim()).toBe("Pick dates in season.");
        });
    });

    describe("popup", () => {
        it("opens and closes, updating aria-expanded, the panel and emitting open-change", async () => {
            const picker = await renderDateRangePicker();
            const handler = vi.fn();
            picker.addEventListener("open-change", handler);

            picker.show();
            await nextFrame();
            expect(picker.open).toBe(true);
            expect(getPanel(picker).hidden).toBe(false);
            expect(getTrigger(picker).getAttribute("aria-expanded")).toBe("true");
            expect(picker.shadowRoot?.querySelector(".control-shell")?.classList.contains("open")).toBe(true);

            picker.hide();
            await nextFrame();
            expect(picker.open).toBe(false);
            expect(getPanel(picker).hidden).toBe(true);
            expect(getTrigger(picker).getAttribute("aria-expanded")).toBe("false");

            expect(eventDetails(handler)).toEqual([{ open: true }, { open: false }]);
        });

        it("closes with Escape from calendar focus and returns focus to the trigger", async () => {
            const picker = await renderDateRangePicker();
            const outer = vi.fn();
            document.body.addEventListener("keydown", outer);
            const before = picker.value;

            picker.show();
            await vi.waitFor(() => {
                expect(getCalendar(picker).shadowRoot?.activeElement?.getAttribute("data-date")).toBeTruthy();
            });

            await userEvent.keyboard("{Escape}");
            await nextFrame();

            expect(picker.open).toBe(false);
            expect(picker.value).toEqual(before);
            expect(picker.shadowRoot?.activeElement).toBe(getTrigger(picker));
            // A handled Escape must not reach an enclosing dialog.
            expect(outer.mock.calls.some(([e]) => (e as KeyboardEvent).key === "Escape")).toBe(false);
            document.body.removeEventListener("keydown", outer);
        });

        it("lets Escape propagate when the popup is closed", async () => {
            const picker = await renderDateRangePicker();
            const outer = vi.fn();
            document.body.addEventListener("keydown", outer);

            const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true, cancelable: true });
            getPanel(picker).dispatchEvent(event);

            expect(event.defaultPrevented).toBe(false);
            expect(outer).toHaveBeenCalledTimes(1);
            document.body.removeEventListener("keydown", outer);
        });

        it("toggles from a trigger click", async () => {
            const picker = await renderDateRangePicker();

            getTrigger(picker).click();
            await nextFrame();
            expect(picker.open).toBe(true);

            getTrigger(picker).click();
            await nextFrame();
            expect(picker.open).toBe(false);
        });

        it("moves focus to the tabbable calendar day when opened", async () => {
            const picker = await renderDateRangePicker();

            picker.show();

            await vi.waitFor(() => {
                expect(getCalendar(picker).shadowRoot?.activeElement?.getAttribute("data-date")).toBe("2026-03-27");
            });
        });

        it("opens from the trigger with ArrowDown, Enter and Space and prevents default", async () => {
            for (const key of ["ArrowDown", "Enter", " "]) {
                const picker = await renderDateRangePicker();

                const event = triggerKeydown(picker, key);

                expect(event.defaultPrevented, key).toBe(true);
                expect(picker.open, key).toBe(true);
            }
        });

        it("closes with Escape and ignores Escape while closed", async () => {
            const picker = await renderDateRangePicker();
            const handler = vi.fn();
            picker.addEventListener("open-change", handler);

            triggerKeydown(picker, "Escape");
            await nextFrame();
            expect(handler).not.toHaveBeenCalled();

            picker.show();
            await nextFrame();
            triggerKeydown(picker, "Escape");
            await nextFrame();

            expect(picker.open).toBe(false);
            expect(eventDetails(handler)).toEqual([{ open: true }, { open: false }]);
        });

        it("does not open when disabled", async () => {
            const picker = await renderDateRangePicker(element => {
                element.disabled = true;
            });

            picker.show();
            picker.toggleOpen();
            triggerKeydown(picker, "ArrowDown");
            await nextFrame();

            expect(picker.open).toBe(false);
            expect(getTrigger(picker).disabled).toBe(true);
        });

        it("closes when the pointer goes down outside and stays open for presses inside", async () => {
            const picker = await renderDateRangePicker();
            picker.show();
            await nextFrame();

            getTrigger(picker).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
            expect(picker.open).toBe(true);

            document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
            expect(picker.open).toBe(false);
        });

        it("lets Tab move focus past the trigger", async () => {
            const picker = await renderDateRangePicker();
            const after = document.createElement("button");
            document.body.append(after);
            getTrigger(picker).focus();

            await userEvent.tab();

            await vi.waitFor(() => expect(document.activeElement).toBe(after));
        });
    });

    describe("selection", () => {
        it("keeps the popup open and reports a partial range after the first pick", async () => {
            const picker = await renderDateRangePicker();
            const input = vi.fn();
            const change = vi.fn();
            picker.addEventListener("input", input);
            picker.addEventListener("change", change);
            picker.show();

            picker.handleCalendarChange(calendarChange({ start: "2026-03-22" }));

            expect(picker.start).toBe("2026-03-22");
            expect(picker.end).toBe("");
            expect(picker.open).toBe(true);
            expect(eventDetails(input)).toEqual([{ start: "2026-03-22", end: null }]);
            expect(eventDetails(change)).toEqual([{ start: "2026-03-22", end: null }]);
        });

        it("emits the complete range, closes and returns focus to the trigger", async () => {
            const picker = await renderDateRangePicker();
            const change = vi.fn();
            picker.addEventListener("change", change);
            picker.show();

            picker.handleCalendarChange(calendarChange({ start: "2026-03-22", end: "2026-03-29" }));

            expect(eventDetails(change)).toEqual([{ start: "2026-03-22", end: "2026-03-29" }]);
            expect(picker.open).toBe(false);
            expect(picker.shadowRoot?.activeElement).toBe(getTrigger(picker));
        });

        it("clears both ends when the calendar reports an empty detail", async () => {
            const picker = await renderDateRangePicker();

            picker.handleCalendarChange(calendarChange({}));

            expect(picker.value).toEqual({ start: null, end: null });
        });

        it("emits a single change per calendar pick because the nested calendar event is swallowed", async () => {
            const picker = await renderDateRangePicker();
            const outer = vi.fn();
            document.body.addEventListener("change", outer);
            picker.show();
            await nextFrame();

            calendarDay(picker, "2026-03-05").click();
            await nextFrame();
            document.body.removeEventListener("change", outer);

            expect(outer).toHaveBeenCalledTimes(1);
            expect((outer.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ start: "2026-03-05", end: null });
        });

        it("selects a range by clicking two days in the calendar", async () => {
            const picker = await renderDateRangePicker(element => {
                element.start = "";
                element.end = "";
                element.min = "";
                element.max = "";
            });
            const change = vi.fn();
            picker.addEventListener("change", change);
            picker.show();
            await nextFrame();
            const today = new Date();
            const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

            calendarDay(picker, `${month}-10`).click();
            await nextFrame();
            expect(picker.start).toBe(`${month}-10`);
            expect(picker.end).toBe("");
            expect(picker.open).toBe(true);
            expect(segmentTexts(picker)[1]).toBe("End date");

            calendarDay(picker, `${month}-14`).click();
            await nextFrame();
            expect(picker.start).toBe(`${month}-10`);
            expect(picker.end).toBe(`${month}-14`);
            expect(picker.open).toBe(false);

            const details = eventDetails(change).filter(Boolean);
            expect(details.at(-1)).toEqual({ start: `${month}-10`, end: `${month}-14` });
            expect(details).toHaveLength(2);
        });

        it("normalises an earlier second pick into a new start instead of a reversed range", async () => {
            const picker = await renderDateRangePicker(element => {
                element.start = "2026-03-20";
                element.end = "";
            });
            picker.show();
            await nextFrame();

            calendarDay(picker, "2026-03-10").click();
            await nextFrame();

            expect(picker.start).toBe("2026-03-10");
            expect(picker.end).toBe("");
            expect(picker.open).toBe(true);
        });

        it("restarts the range when a complete range is clicked again", async () => {
            const picker = await renderDateRangePicker();
            picker.show();
            await nextFrame();

            calendarDay(picker, "2026-03-05").click();
            await nextFrame();

            expect(picker.start).toBe("2026-03-05");
            expect(picker.end).toBe("");
            expect(picker.open).toBe(true);
        });

        it("does not accept days outside min and max", async () => {
            const picker = await renderDateRangePicker(element => {
                element.min = "2026-03-10";
                element.max = "2026-03-20";
                element.start = "2026-03-12";
                element.end = "";
            });
            picker.show();
            await nextFrame();

            expect(calendarDay(picker, "2026-03-09").disabled).toBe(true);
            expect(calendarDay(picker, "2026-03-21").disabled).toBe(true);
            calendarDay(picker, "2026-03-25").click();
            await nextFrame();

            expect(picker.start).toBe("2026-03-12");
            expect(picker.end).toBe("");
        });

        it("shows the in-range days and range ends inside the calendar", async () => {
            const picker = await renderDateRangePicker();
            picker.show();
            await nextFrame();

            const calendar = getCalendar(picker);
            expect(calendarDay(picker, "2026-03-20").classList.contains("range-start")).toBe(true);
            expect(calendarDay(picker, "2026-03-27").classList.contains("range-end")).toBe(true);
            expect(calendar.shadowRoot?.querySelectorAll(".day-cell.range")).toHaveLength(8);
        });
    });

    describe("validity", () => {
        it("is valid for an empty optional range and a complete ordered range", async () => {
            const picker = await renderDateRangePicker();
            expect(picker.checkValidity()).toBe(true);

            picker.start = "";
            picker.end = "";
            expect(picker.checkValidity()).toBe(true);
        });

        it("is valid for a single-day range", async () => {
            const picker = await renderDateRangePicker();

            picker.start = "2026-03-20";
            picker.end = "2026-03-20";

            expect(picker.checkValidity()).toBe(true);
        });

        it("rejects a reversed range", async () => {
            const picker = await renderDateRangePicker();

            picker.start = "2026-03-27";
            picker.end = "2026-03-20";

            expect(picker.checkValidity()).toBe(false);
        });

        it("requires both ends when required", async () => {
            const picker = await renderDateRangePicker(element => {
                element.required = true;
                element.start = "";
                element.end = "";
            });
            expect(picker.checkValidity()).toBe(false);

            picker.start = "2026-03-20";
            expect(picker.checkValidity()).toBe(false);

            picker.end = "2026-03-27";
            expect(picker.checkValidity()).toBe(true);
        });

        it("is invalid when the invalid flag is set", async () => {
            const picker = await renderDateRangePicker();

            picker.invalid = true;

            expect(picker.checkValidity()).toBe(false);
        });

        it("derives the displayed error text from invalid, required and errorText", async () => {
            const picker = await renderDateRangePicker();
            expect(picker.displayErrorText).toBe("");

            picker.invalid = true;
            expect(picker.displayErrorText).toBe("Choose a valid date range.");
            picker.errorText = "Pick dates in season.";
            expect(picker.displayErrorText).toBe("Pick dates in season.");

            picker.invalid = false;
            picker.errorText = "";
            picker.required = true;
            picker.end = "";
            expect(picker.displayErrorText).toBe("Please choose a start and end date.");

            picker.end = "2026-03-27";
            expect(picker.displayErrorText).toBe("");
        });
    });

    describe("native key handling", () => {
        it("does not cancel Tab or other unhandled keys on the trigger", async () => {
            const picker = await renderDateRangePicker();

            for (const key of ["Tab", "a", "ArrowLeft"]) {
                expect(triggerKeydown(picker, key).defaultPrevented, key).toBe(false);
            }
        });

        it("still cancels the keys it handles", async () => {
            const picker = await renderDateRangePicker();

            expect(triggerKeydown(picker, "ArrowDown").defaultPrevented).toBe(true);
            expect(picker.open).toBe(true);
            expect(triggerKeydown(picker, "Escape").defaultPrevented).toBe(true);
            expect(picker.open).toBe(false);
        });

        it("does not cancel Escape while closed", async () => {
            const picker = await renderDateRangePicker();

            expect(triggerKeydown(picker, "Escape").defaultPrevented).toBe(false);
        });
    });
});
