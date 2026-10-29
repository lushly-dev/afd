import { describe, expect, it } from "vitest";

import {
  ganttClippedGeometry,
  ganttDateToDay,
  ganttDayToDate,
  ganttTimeIntersects,
} from "./violet-gantt-geometry";

describe("violet-gantt calendar-day geometry", () => {
  it("parses leap days strictly without local-time conversion", () => {
    const leapDay = ganttDateToDay("2028-02-29");
    expect(leapDay).not.toBeNull();
    expect(ganttDayToDate(leapDay ?? 0)).toBe("2028-02-29");
    expect(ganttDateToDay("2027-02-29")).toBeNull();
    expect(ganttDateToDay("2028-2-9")).toBeNull();
  });

  it("keeps adjacent half-open ranges independent", () => {
    const start = ganttDateToDay("2026-04-01") ?? 0;
    const end = ganttDateToDay("2026-04-03") ?? 0;

    expect(
      ganttTimeIntersects(
        { kind: "day-range", start: "2026-03-30", endExclusive: "2026-04-01" },
        start,
        end,
      ),
    ).toBe(false);
    expect(
      ganttTimeIntersects(
        { kind: "day-range", start: "2026-04-03", endExclusive: "2026-04-05" },
        start,
        end,
      ),
    ).toBe(false);
    expect(
      ganttTimeIntersects(
        { kind: "day-range", start: "2026-04-02", endExclusive: "2026-04-03" },
        start,
        end,
      ),
    ).toBe(true);
  });

  it("clips crossing ranges to the viewport", () => {
    const start = ganttDateToDay("2026-04-01") ?? 0;
    const end = ganttDateToDay("2026-04-05") ?? 0;
    const geometry = ganttClippedGeometry(
      { kind: "day-range", start: "2026-03-30", endExclusive: "2026-04-07" },
      start,
      end,
      20,
    );

    expect(geometry).toEqual({
      left: 0,
      width: 80,
      clippedStart: true,
      clippedEnd: true,
      point: false,
    });
  });

  it("positions points explicitly without inventing a one-day duration", () => {
    const start = ganttDateToDay("2026-04-01") ?? 0;
    const end = ganttDateToDay("2026-04-05") ?? 0;
    const geometry = ganttClippedGeometry({ kind: "day-point", at: "2026-04-02" }, start, end, 40);

    expect(geometry?.left).toBe(60);
    expect(geometry?.width).toBe(0);
    expect(geometry?.point).toBe(true);
  });
});
