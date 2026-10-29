export interface VioletCalendarCell {
    iso: string;
    label: string;
    day: number;
    currentMonth: boolean;
    disabled: boolean;
    selected: boolean;
    rangeStart: boolean;
    rangeEnd: boolean;
    inRange: boolean;
    today: boolean;
    tabIndex: number;
}

export function createLocalDate(year: number, monthIndex: number, day: number): Date {
    return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

export function parseIsoDate(value: string | null | undefined): Date | null {
    if (!value) {
        return null;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = createLocalDate(year, month - 1, day);

    if (
        Number.isNaN(candidate.getTime()) ||
        candidate.getFullYear() !== year ||
        candidate.getMonth() !== month - 1 ||
        candidate.getDate() !== day
    ) {
        return null;
    }

    return candidate;
}

export function formatIsoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function addDays(date: Date, amount: number): Date {
    const next = createLocalDate(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + amount);
    return createLocalDate(next.getFullYear(), next.getMonth(), next.getDate());
}

export function addMonths(date: Date, amount: number): Date {
    const year = date.getFullYear();
    const month = date.getMonth();
    const targetStart = createLocalDate(year, month + amount, 1);
    const day = Math.min(date.getDate(), daysInMonth(targetStart.getFullYear(), targetStart.getMonth()));
    return createLocalDate(targetStart.getFullYear(), targetStart.getMonth(), day);
}

export function addYears(date: Date, amount: number): Date {
    return addMonths(date, amount * 12);
}

export function startOfMonth(date: Date): Date {
    return createLocalDate(date.getFullYear(), date.getMonth(), 1);
}

export function daysInMonth(year: number, monthIndex: number): number {
    return createLocalDate(year, monthIndex + 1, 0).getDate();
}

export function clampDate(date: Date, min: string, max: string): Date {
    const iso = formatIsoDate(date);
    if (min && iso < min) {
        return parseIsoDate(min) ?? date;
    }

    if (max && iso > max) {
        return parseIsoDate(max) ?? date;
    }

    return date;
}

export function compareIsoDates(a: string, b: string): number {
    return a.localeCompare(b);
}

export function sameCalendarDate(a: Date | null, b: Date | null): boolean {
    if (!a || !b) {
        return false;
    }

    return formatIsoDate(a) === formatIsoDate(b);
}

export function resolveWeekStart(locale: string, explicit?: number): number {
    if (typeof explicit === "number" && explicit >= 0 && explicit <= 6) {
        return explicit;
    }

    try {
        const localeInfo = new Intl.Locale(locale || "en-US") as Intl.Locale & {
            getWeekInfo?: () => { firstDay?: number };
        };
        const weekInfo = localeInfo.getWeekInfo?.();
        if (weekInfo && typeof weekInfo.firstDay === "number") {
            return weekInfo.firstDay % 7;
        }
    } catch {
        // fall through to Sunday default
    }

    return 0;
}

export function getWeekdayLabels(locale: string, weekStartDay: number): Array<{ short: string; long: string }> {
    const formatter = new Intl.DateTimeFormat(locale || undefined, { weekday: "short" });
    const longFormatter = new Intl.DateTimeFormat(locale || undefined, { weekday: "long" });
    const sunday = createLocalDate(2026, 0, 4);

    return Array.from({ length: 7 }, (_, index) => {
        const date = addDays(sunday, (weekStartDay + index) % 7);
        return {
            short: formatter.format(date),
            long: longFormatter.format(date),
        };
    });
}

export function getMonthLabel(locale: string, date: Date): string {
    return new Intl.DateTimeFormat(locale || undefined, {
        month: "long",
        year: "numeric",
    }).format(date);
}

export function formatDisplayDate(locale: string, value: string): string {
    const date = parseIsoDate(value);
    if (!date) {
        return value;
    }

    return new Intl.DateTimeFormat(locale || undefined, {
        dateStyle: "medium",
    }).format(date);
}

export function formatDisplayRange(locale: string, start: string, end: string): string {
    if (!start && !end) {
        return "";
    }

    if (start && end) {
        const startDate = parseIsoDate(start);
        const endDate = parseIsoDate(end);
        if (startDate && endDate && typeof Intl.DateTimeFormat.prototype.formatRange === "function") {
            return new Intl.DateTimeFormat(locale || undefined, { dateStyle: "medium" }).formatRange(startDate, endDate);
        }
    }

    if (start && end) {
        return `${formatDisplayDate(locale, start)} - ${formatDisplayDate(locale, end)}`;
    }

    return start ? `${formatDisplayDate(locale, start)} - End date` : `Start date - ${formatDisplayDate(locale, end)}`;
}

export function buildMonthGrid(options: {
    locale: string;
    monthDate: Date;
    weekStartDay: number;
    value?: string;
    start?: string;
    end?: string;
    focused?: string;
    min?: string;
    max?: string;
    disabledDate?: ((iso: string) => boolean) | null;
}): VioletCalendarCell[][] {
    const {
        locale,
        monthDate,
        weekStartDay,
        value = "",
        start = "",
        end = "",
        focused = "",
        min = "",
        max = "",
        disabledDate = null,
    } = options;

    const firstOfMonth = startOfMonth(monthDate);
    const weekdayOffset = (firstOfMonth.getDay() - weekStartDay + 7) % 7;
    const gridStart = addDays(firstOfMonth, -weekdayOffset);
    const todayIso = formatIsoDate(createLocalDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));

    return Array.from({ length: 6 }, (_, rowIndex) =>
        Array.from({ length: 7 }, (_, columnIndex) => {
            const date = addDays(gridStart, rowIndex * 7 + columnIndex);
            const iso = formatIsoDate(date);
            const isDisabled = Boolean((min && iso < min) || (max && iso > max) || disabledDate?.(iso));
            const inRange = Boolean(start && end && iso >= start && iso <= end);
            const selected = value === iso || start === iso || end === iso;

            return {
                iso,
                label: new Intl.DateTimeFormat(locale || undefined, { day: "numeric" }).format(date),
                day: date.getDate(),
                currentMonth: date.getMonth() === monthDate.getMonth(),
                disabled: isDisabled,
                selected,
                rangeStart: start === iso,
                rangeEnd: end === iso,
                inRange,
                today: todayIso === iso,
                tabIndex: focused ? (focused === iso ? 0 : -1) : value === iso ? 0 : -1,
            };
        }),
    );
}

export function parseTimeValue(value: string | null | undefined): { hour: number; minute: number; second: number } | null {
    if (!value) {
        return null;
    }

    const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (!match) {
        return null;
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3] ?? "0");

    if (hour > 23 || minute > 59 || second > 59) {
        return null;
    }

    return { hour, minute, second };
}

export function formatTimeValue(hour: number, minute: number, second = 0, includeSeconds = false): string {
    const base = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    return includeSeconds ? `${base}:${String(second).padStart(2, "0")}` : base;
}
