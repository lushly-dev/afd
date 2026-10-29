import type { VioletGanttDate, VioletGanttTime } from "./violet-gantt";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;

export interface VioletGanttClippedGeometry {
  left: number;
  width: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  point: boolean;
}

export function ganttDateToDay(value: VioletGanttDate): number | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return Math.floor(date.getTime() / MILLISECONDS_PER_DAY);
}

export function ganttDayToDate(day: number): VioletGanttDate {
  const date = new Date(day * MILLISECONDS_PER_DAY);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dateOfMonth = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${dateOfMonth}`;
}

export function ganttTimeBounds(
  time: VioletGanttTime,
): { start: number; endExclusive: number; point: boolean } | null {
  if (time.kind === "day-point") {
    const at = ganttDateToDay(time.at);
    return at === null ? null : { start: at, endExclusive: at, point: true };
  }

  const start = ganttDateToDay(time.start);
  const endExclusive = ganttDateToDay(time.endExclusive);
  if (start === null || endExclusive === null || endExclusive <= start) {
    return null;
  }

  return { start, endExclusive, point: false };
}

export function ganttTimeIntersects(
  time: VioletGanttTime,
  viewportStart: number,
  viewportEndExclusive: number,
): boolean {
  const bounds = ganttTimeBounds(time);
  if (!bounds) {
    return false;
  }

  if (bounds.point) {
    return bounds.start >= viewportStart && bounds.start < viewportEndExclusive;
  }

  return bounds.start < viewportEndExclusive && bounds.endExclusive > viewportStart;
}

export function ganttClippedGeometry(
  time: VioletGanttTime,
  viewportStart: number,
  viewportEndExclusive: number,
  dayWidth: number,
): VioletGanttClippedGeometry | null {
  const bounds = ganttTimeBounds(time);
  if (!bounds || !ganttTimeIntersects(time, viewportStart, viewportEndExclusive)) {
    return null;
  }

  if (bounds.point) {
    return {
      left: (bounds.start - viewportStart + 0.5) * dayWidth,
      width: 0,
      clippedStart: false,
      clippedEnd: false,
      point: true,
    };
  }

  const visibleStart = Math.max(bounds.start, viewportStart);
  const visibleEnd = Math.min(bounds.endExclusive, viewportEndExclusive);
  return {
    left: (visibleStart - viewportStart) * dayWidth,
    width: (visibleEnd - visibleStart) * dayWidth,
    clippedStart: bounds.start < viewportStart,
    clippedEnd: bounds.endExclusive > viewportEndExclusive,
    point: false,
  };
}

export function ganttAddDays(value: VioletGanttDate, amount: number): VioletGanttDate | null {
  const day = ganttDateToDay(value);
  return day === null ? null : ganttDayToDate(day + amount);
}
