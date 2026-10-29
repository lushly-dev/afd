import {
  attr,
  FASTElement,
  html,
  observable,
  repeat,
  when,
} from "@lushly-dev/fast-element";
import { violetGanttStyles } from "./violet-gantt.styles";
import {
  ganttClippedGeometry,
  ganttDateToDay,
  ganttDayToDate,
  ganttTimeBounds,
  ganttTimeIntersects,
} from "./violet-gantt-geometry";

/** A calendar-day string in strict `YYYY-MM-DD` form. */
export type VioletGanttDate = string;

/** An explicit half-open range of calendar days. */
export interface VioletGanttRange {
  start: VioletGanttDate;
  endExclusive: VioletGanttDate;
}

/** Calendar-day geometry. Instants must be projected by the consumer before rendering. */
export type VioletGanttTime =
  | { kind: "day-range"; start: VioletGanttDate; endExclusive: VioletGanttDate }
  | { kind: "day-point"; at: VioletGanttDate };

export type VioletGanttPresentation = "work" | "window" | "milestone";
export type VioletGanttProvenance =
  | "planned"
  | "derived"
  | "actual"
  | "advisory";
export type VioletGanttScale = "day" | "week" | "month";
export type VioletGanttDensity = "compact" | "natural" | "comfortable";

/** Supported calendar-day values and maximum rendered viewport span. */
export const VIOLET_GANTT_DATE_LIMITS = Object.freeze({
  min: "0000-01-01",
  max: "9999-12-30",
  endExclusive: "9999-12-31",
  maxViewportDays: 36_600,
} as const);

/** A stable, domain-neutral logical row. `itemIds` controls item order within the row. */
export interface VioletGanttRow {
  id: string;
  parentId?: string;
  label: string;
  itemIds: readonly string[];
  description?: string;
}

/**
 * A read-only item. Work represents a scheduled interval, window an availability or
 * estimated interval, and milestone a calendar-day point. A null time is unscheduled.
 */
export interface VioletGanttItem {
  id: string;
  rowId: string;
  label: string;
  time: VioletGanttTime | null;
  presentation: VioletGanttPresentation;
  provenance: VioletGanttProvenance;
  note?: string;
  readOnlyReason?: string;
}

/** The controlled range and presentation scale. Range ends are always exclusive. */
export interface VioletGanttViewport extends VioletGanttRange {
  scale: VioletGanttScale;
}

/** Consumer-owned surface status. */
export interface VioletGanttStatus {
  kind: "ready" | "loading" | "empty" | "error";
  message?: string;
}

export interface VioletGanttItemSelectionChangeDetail {
  itemId: string | null;
}

export interface VioletGanttItemActivateDetail {
  itemId: string;
}

export interface VioletGanttRowInspectDetail {
  rowId: string;
}

export interface VioletGanttExpandedChangeDetail {
  expandedRowIds: readonly string[];
}

export interface VioletGanttViewportChangeDetail {
  viewport: VioletGanttViewport;
  reason: "pan" | "today" | "fit" | "programmatic" | "resize";
}

interface PendingViewportFillRequest {
  source: VioletGanttViewport;
  requestedDays: number;
}

interface PresentedRow {
  row: VioletGanttRow;
  logicalIndex: number;
  level: number;
  positionInSet: number;
  setSize: number;
  parentId: string | null;
  hasChildren: boolean;
  expanded: boolean;
}

interface RenderedDay {
  date: VioletGanttDate;
  label: string;
  title: string;
  style: string;
  gridStyle: string;
  gridBoundary: boolean;
}

interface RenderedItem {
  item: VioletGanttItem;
  style: string;
  className: string;
  partName: string;
  selected: boolean;
  active: boolean;
  title: string;
  elementId: string;
}

interface RenderedRow extends PresentedRow {
  style: string;
  indentStyle: string;
  items: RenderedItem[];
  tabIndex: string;
  activeDescendant: string | null;
  overflowCount: number;
  singleItemOverflow: boolean;
}

interface RowLayout {
  top: number;
  height: number;
  laneCapacity: number;
}

const HEADER_HEIGHT = 52;
const OVERSCAN_ROWS = 5;
const OVERSCAN_DAYS = 2;
const DEFAULT_NAME_COLUMN_WIDTH = 256;
const ITEM_LANE_HEIGHT = 24;
const ITEM_LANE_BREATHING_ROOM = 12;
const MAX_VISIBLE_ITEM_LANES = 6;
const POINT_LABEL_MAX_WIDTH = 192;
const MILLISECONDS_PER_DAY = 86_400_000;

const SCALE_DAY_WIDTH: Record<VioletGanttScale, number> = {
  day: 40,
  week: 16,
  month: 4,
};

const DENSITY_ROW_HEIGHT: Record<VioletGanttDensity, number> = {
  compact: 36,
  natural: 64,
  comfortable: 76,
};

let ganttInstanceId = 0;

const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();

/** Reuses `Intl.DateTimeFormat` instances; constructing one per label per scroll frame is costly. */
function cachedDateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = dateTimeFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateTimeFormatCache.set(key, formatter);
  }
  return formatter;
}

function elementFromPath(event: Event, attribute: string): HTMLElement | null {
  return (
    (event
      .composedPath()
      .find(
        (node) => node instanceof HTMLElement && node.hasAttribute(attribute)
      ) as HTMLElement | undefined) ?? null
  );
}

const itemTemplate = html<RenderedItem>`
  <div
    id="${(x) => x.elementId}"
    class="${(x) => x.className}"
    part="${(x) => x.partName}"
    style="${(x) => x.style}"
    role="button"
    tabindex="-1"
    data-item-id="${(x) => x.item.id}"
    data-presentation="${(x) => x.item.presentation}"
    data-provenance="${(x) => x.item.provenance}"
    data-active="${(x) => String(x.active)}"
    aria-pressed="${(x) => String(x.selected)}"
    aria-label="${(x) => x.title}"
  >
    <span class="item-geometry" aria-hidden="true"></span>
    <span class="item-label">${(x) => x.item.label}</span>
  </div>
`;

const rowTemplate = html<RenderedRow>`
  <div
    class="row"
    part="row"
    style="${(x) => x.style}"
    role="row"
    tabindex="${(x) => x.tabIndex}"
    data-row-id="${(x) => x.row.id}"
    aria-rowindex="${(x) => String(x.logicalIndex + 2)}"
    aria-level="${(x) => String(x.level)}"
    aria-posinset="${(x) => String(x.positionInSet)}"
    aria-setsize="${(x) => String(x.setSize)}"
    aria-expanded="${(x) => (x.hasChildren ? String(x.expanded) : null)}"
    aria-activedescendant="${(x) => x.activeDescendant}"
  >
    <div
      class="row-header"
      part="row-header"
      role="rowheader"
      style="${(x) => x.indentStyle}"
    >
      ${when(
        (x) => x.hasChildren,
        html<RenderedRow>`
          <button
            class="expander"
            type="button"
            tabindex="-1"
            data-action="toggle"
            data-row-id="${(x) => x.row.id}"
            aria-label="${(x) =>
              `${x.expanded ? "Collapse" : "Expand"} ${x.row.label}`}"
            aria-expanded="${(x) => String(x.expanded)}"
          >
            ${(x) => (x.expanded ? "▾" : "▸")}
          </button>
        `,
        html`<span class="expander-placeholder" aria-hidden="true"></span>`
      )}
      <button
        class="row-label"
        part="row-label"
        type="button"
        tabindex="-1"
        data-action="inspect-row"
        data-row-id="${(x) => x.row.id}"
        title="${(x) => x.row.description || null}"
      >
        ${(x) => x.row.label}
      </button>
      ${when(
        (x) => x.singleItemOverflow,
        html<RenderedRow>`
          <button
            class="overflow-step single-item-overflow"
            part="overflow"
            type="button"
            data-action="cycle-overflow"
            data-direction="next"
            data-row-id="${(x) => x.row.id}"
            aria-label="${(x) => `Reveal item in ${x.row.label}`}"
          >
            ›
          </button>
        `
      )}
      ${when(
        (x) => x.overflowCount > 0 && !x.singleItemOverflow,
        html<RenderedRow>`
          <div
            class="overflow-controls"
            role="group"
            aria-label="${(x) =>
              `Review ${x.overflowCount} additional item${
                x.overflowCount === 1 ? "" : "s"
              } in ${x.row.label}`}"
          >
            <button
              class="overflow-step"
              type="button"
              data-action="cycle-overflow"
              data-direction="previous"
              data-row-id="${(x) => x.row.id}"
              aria-label="${(x) => `Previous item in ${x.row.label}`}"
            >
              ‹
            </button>
            <span class="item-overflow" part="overflow"
              >+${(x) => x.overflowCount}</span
            >
            <button
              class="overflow-step"
              type="button"
              data-action="cycle-overflow"
              data-direction="next"
              data-row-id="${(x) => x.row.id}"
              aria-label="${(x) => `Next item in ${x.row.label}`}"
            >
              ›
            </button>
          </div>
        `
      )}
    </div>
    <div class="chart" part="chart" role="gridcell">
      ${repeat((x) => x.items, itemTemplate)}
    </div>
  </div>
`;

const dayTemplate = html<RenderedDay>`
  <div
    class="${(x) => `day${x.gridBoundary ? " grid-boundary" : ""}`}"
    part="day"
    style="${(x) => x.style}"
    aria-hidden="true"
    title="${(x) => x.title}"
  >
    <span class="day-label">${(x) => x.label}</span>
  </div>
`;

const gridLineTemplate = html<RenderedDay>`
  <span
    class="grid-line"
    style="${(x) => x.gridStyle}"
    aria-hidden="true"
    ?hidden="${(x) => !x.gridBoundary}"
  ></span>
`;

const template = html<VioletGantt>`
  <section class="root" part="root">
    <div
      class="toolbar"
      part="toolbar"
      ?hidden="${(x) => !x.hasToolbarContent}"
    >
      <slot
        name="toolbar"
        @slotchange="${(x, context) =>
          x.handleToolbarSlotChange(context.event)}"
      ></slot>
    </div>
    <div
      class="viewport"
      part="viewport"
      tabindex="${(x) => (x.renderedRows.length === 0 ? "0" : null)}"
      @scroll="${(x) => {
        x.handleScroll();
        return true;
      }}"
      @click="${(x, context) => {
        x.handleClick(context.event);
        return true;
      }}"
      @keydown="${(x, context) => {
        x.handleKeydown(context.event as KeyboardEvent);
        return true;
      }}"
      @focusin="${(x, context) => {
        x.handleFocusIn(context.event as FocusEvent);
        return true;
      }}"
    >
      <div
        class="grid"
        part="canvas"
        role="treegrid"
        aria-label="${(x) => x.ariaLabel}"
        aria-rowcount="${(x) => String(x.logicalRowCount)}"
        aria-colcount="2"
        aria-describedby="${(x) => x.instructionsId}"
        style="${(x) => x.gridStyle}"
      >
        <p class="sr-only" id="${(x) => x.instructionsId}">
          Use Up and Down to move between rows. Use Right and Left to expand or
          collapse groups. Use Alt plus Right or Left to move between items in a
          row, Enter to activate an item, Shift plus Enter to inspect the row,
          and Escape to return to the row.
        </p>
        <div class="header" part="header" role="row" aria-rowindex="1">
          <div class="name-header" part="name-header" role="columnheader">
            Name
          </div>
          <div
            class="time-header"
            part="time-header"
            role="columnheader"
            aria-label="Timeline"
          >
            <span class="sr-only">Timeline</span>
            <span
              class="axis-context"
              part="axis-context"
              style="${(x) => x.axisContextStyle}"
            >
              ${(x) => x.axisContextLabel}
            </span>
            ${repeat((x) => x.renderedDays, dayTemplate)}
          </div>
        </div>
        <div class="body" part="body" style="${(x) => x.bodyStyle}">
          <div class="body-grid" aria-hidden="true">
            ${repeat((x) => x.renderedDays, gridLineTemplate)}
          </div>
          ${repeat((x) => x.renderedRows, rowTemplate)}
        </div>
      </div>
      ${when(
        (x) => x.shouldShowStatus,
        html<VioletGantt>`
          <div
            class="status"
            part="status"
            data-kind="${(x) => x.effectiveStatusKind}"
            role="${(x) =>
              x.effectiveStatusKind === "error" ? "alert" : "status"}"
            aria-live="polite"
          >
            ${(x) => x.statusText}
          </div>
        `
      )}
    </div>
  </section>
`;

/**
 * Read-only, virtualized calendar-day Gantt foundation.
 *
 * @summary Renders controlled hierarchical rows and read-only day ranges, windows, milestones, and unscheduled items.
 * @remarks Dates are strict `YYYY-MM-DD` values and range ends are exclusive. Supported dates are
 * 0000-01-01 through 9999-12-30, with 9999-12-31 as the final exclusive boundary;
 * a viewport may span at most 36,600 days. Invalid, duplicate,
 * orphaned, cyclic, mismatched, or unsupported records are omitted and reported in the visible status.
 * The host must fill a definite-height parent. Density sets a 36px compact, 64px natural, or
 * 76px comfortable minimum; rows grow in 24px item lanes, capped at six visible lanes with
 * overflow controls for the remainder. The component is presentational and intentionally not form-associated.
 * @fires item-selection-change - Requests a controlled item selection. Detail: `{ itemId }`.
 * @fires item-activate - Activates or inspects an item. Detail: `{ itemId }`.
 * @fires row-inspect - Activates or inspects a row without selecting its children. Detail: `{ rowId }`.
 * @fires expanded-change - Requests controlled expansion state. Detail: `{ expandedRowIds }`.
 * @fires viewport-change - Requests a controlled viewport. Detail: `{ viewport, reason }`.
 * @slot toolbar - Consumer-owned presentation controls such as zoom, fit, Today, and pan actions.
 * @csspart root - Outer component surface.
 * @csspart toolbar - Optional consumer toolbar region.
 * @csspart viewport - The one shared vertical and horizontal scroll viewport.
 * @csspart canvas - Virtual treegrid canvas.
 * @csspart header - Sticky header row.
 * @csspart name-header - Sticky name column header.
 * @csspart time-header - Time-axis header.
 * @csspart axis-context - Persistent year context at month scale, month and year at finer scales.
 * @csspart day - A mounted, visible calendar-day header.
 * @csspart body - Virtual row body.
 * @csspart row - A mounted logical row.
 * @csspart row-header - Sticky row-name cell.
 * @csspart row-label - Row inspection action.
 * @csspart chart - Time-axis cell for a row.
 * @csspart item - A read-only scheduled item.
 * @csspart window - A read-only availability or estimated interval.
 * @csspart milestone - A read-only calendar-day point.
 * @csspart unscheduled - A read-only item without calendar geometry.
 * @csspart overflow - Reports items beyond visible lane capacity beside pointer-accessible cycling controls.
 * @csspart selection - The controlled selected item.
 * @csspart status - Loading, empty, error, or invalid-data status.
 * @cssproperty --violet-gantt-name-column-width - Sticky row-name column width; defaults to 16rem.
 * @cssproperty --violet-gantt-name-column-width-narrow - Name width below the 34rem container breakpoint; defaults to 10rem.
 * @cssproperty --violet-gantt-work-background - Scheduled interval background.
 * @cssproperty --violet-gantt-work-foreground - Scheduled interval text color.
 * @cssproperty --violet-gantt-window-background - Window background.
 * @cssproperty --violet-gantt-window-foreground - Window text color.
 * @cssproperty --violet-gantt-actual-border - Non-color-only underline for actual provenance.
 * @cssproperty --violet-gantt-advisory-border - Leading edge for advisory provenance, paired with a glyph.
 * @cssproperty --violet-gantt-selection-ring - Controlled selection ring.
 */
export class VioletGantt extends FASTElement {
  /** Controlled logical rows. */
  public declare rows: readonly VioletGanttRow[];

  /** Controlled read-only items. */
  public declare items: readonly VioletGanttItem[];

  /** Controlled expanded group row identities. */
  public declare expandedRowIds: readonly string[];

  /** Controlled selected item identity. Selection does not move keyboard focus. */
  public declare selectedItemId: string | null;

  /** Controlled half-open viewport and scale. */
  public declare viewport: VioletGanttViewport;

  /** Consumer-owned surface status. */
  public declare status: VioletGanttStatus;

  /** Explicit consumer-supplied calendar day for `showToday`; null disables the action. */
  public declare today: VioletGanttDate | null;

  /** Count of presented logical rows; observable so `aria-rowcount` tracks row and expansion changes. */
  public declare presentedRowCount: number;

  /** Mounted rows for the current measured viewport plus overscan. */
  public declare renderedRows: RenderedRow[];

  /** Mounted day headers for the horizontal viewport plus overscan. */
  public declare renderedDays: RenderedDay[];

  /** Visible calendar context for the leading day in the horizontal window. */
  public declare axisContextLabel: string;

  public declare axisContextStyle: string;

  public declare validationMessage: string;
  public declare viewportError: string;
  public declare activeRowId: string | null;
  public declare activeItemId: string | null;
  public declare viewportWidth: number;
  public declare viewportHeight: number;
  public declare scrollTop: number;
  public declare scrollLeft: number;
  public declare hasToolbarContent: boolean;

  /** Density controls the minimum logical row height; rows grow to fit visible item lanes. */
  public declare density: VioletGanttDensity;

  /** BCP 47 locale used only for visible calendar labels. */
  public declare locale: string;

  /** Accessible name for the treegrid. */
  public declare ariaLabel: string;

  readonly #instanceId = ++ganttInstanceId;
  #presentedRows: PresentedRow[] = [];
  #rowLayouts: RowLayout[] = [];
  #bodyHeight = 0;
  #rowById = new Map<string, VioletGanttRow>();
  #itemsByRowId = new Map<string, VioletGanttItem[]>();
  #itemElementIdById = new Map<string, string>();
  #nextItemElementId = 0;
  #resizeObserver: ResizeObserver | null = null;
  #renderFrame: number | null = null;
  #focusFrame: number | null = null;
  #pendingFocusRowId: string | null = null;
  #pendingRevealDay: number | null = null;
  #pendingViewportFillRequest: PendingViewportFillRequest | null = null;
  #nameColumnWidthCache: number | null = null;
  #viewportDaysCache: {
    start: unknown;
    endExclusive: unknown;
    scale: unknown;
    days: { start: number; endExclusive: number; count: number } | null;
    error: string;
  } | null = null;

  public constructor() {
    super();
    this.rows = [];
    this.items = [];
    this.expandedRowIds = [];
    this.selectedItemId = null;
    this.viewport = {
      start: "2026-01-01",
      endExclusive: "2026-02-01",
      scale: "day",
    };
    this.status = { kind: "ready" };
    this.today = null;
    this.presentedRowCount = 0;
    this.renderedRows = [];
    this.renderedDays = [];
    this.axisContextLabel = "";
    this.axisContextStyle = "";
    this.validationMessage = "";
    this.viewportError = "";
    this.activeRowId = null;
    this.activeItemId = null;
    this.viewportWidth = 0;
    this.viewportHeight = 0;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.hasToolbarContent = false;
    this.density = "natural";
    this.locale = "";
    this.ariaLabel = "Timeline";
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this.handleToolbarSlotChange();
    this.#rebuildData();
    const viewport = this.#scrollElement;
    if (viewport) {
      this.#resizeObserver = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (!rect) {
          return;
        }
        this.viewportWidth = rect.width;
        this.viewportHeight = rect.height;
        this.#nameColumnWidthCache = null;
        this.#rebuildRowLayouts();
        this.#scheduleRenderWindow();
      });
      this.#resizeObserver.observe(viewport);
      this.viewportWidth = viewport.clientWidth;
      this.viewportHeight = viewport.clientHeight;
      this.#rebuildRowLayouts();
    }
    this.#renderWindow();
  }

  public disconnectedCallback(): void {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    if (this.#renderFrame !== null) cancelAnimationFrame(this.#renderFrame);
    if (this.#focusFrame !== null) cancelAnimationFrame(this.#focusFrame);
    this.#renderFrame = null;
    this.#focusFrame = null;
    super.disconnectedCallback();
  }

  public rowsChanged(): void {
    this.#rebuildData();
  }
  public itemsChanged(): void {
    this.#rebuildData();
  }
  public expandedRowIdsChanged(): void {
    this.#rebuildData();
  }
  public selectedItemIdChanged(): void {
    this.#scheduleRenderWindow();
  }
  public viewportChanged(): void {
    this.viewportError = this.#resolveViewport().error;
    const pending = this.#pendingViewportFillRequest;
    if (pending && !this.#sameViewport(this.viewport, pending.source)) {
      this.#pendingViewportFillRequest = null;
    }
    this.#rebuildRowLayouts();
    if (this.#applyPendingDateReveal(true)) return;
    this.#scheduleRenderWindow();
  }
  public statusChanged(): void {
    this.#scheduleRenderWindow();
  }
  public localeChanged(): void {
    this.#scheduleRenderWindow();
  }
  public densityChanged(): void {
    this.#rebuildRowLayouts();
    this.#scheduleRenderWindow();
  }

  public get instructionsId(): string {
    return `violet-gantt-instructions-${this.#instanceId}`;
  }
  public get rowHeight(): number {
    return DENSITY_ROW_HEIGHT[this.density] ?? DENSITY_ROW_HEIGHT.natural;
  }
  public get dayWidth(): number {
    return SCALE_DAY_WIDTH[this.viewport?.scale] ?? SCALE_DAY_WIDTH.day;
  }
  public get logicalRowCount(): number {
    return this.presentedRowCount + 1;
  }
  public get chartWidth(): number {
    const range = this.#viewportDays;
    return Math.max(0, (range?.count ?? 0) * this.dayWidth);
  }
  public get gridStyle(): string {
    return `--_gantt-chart-width:${this.chartWidth}px;--_gantt-day-width:${this.dayWidth}px;`;
  }
  public get bodyStyle(): string {
    void this.renderedRows;
    return `--_gantt-body-height:${this.#bodyHeight}px;`;
  }
  public get effectiveStatusKind(): VioletGanttStatus["kind"] {
    if (this.viewportError) return "error";
    return this.#resolvedStatusKind;
  }
  public get statusText(): string {
    if (this.viewportError) return this.viewportError;
    const kind = this.#resolvedStatusKind;
    if (kind !== "ready") {
      if (!this.#isValidStatus) return "Invalid timeline status.";
      const message =
        typeof this.status.message === "string" ? this.status.message : "";
      return (
        message ||
        (
          {
            loading: "Loading timeline…",
            empty: "No timeline items.",
            error: "Timeline unavailable.",
          } as const
        )[kind]
      );
    }
    return this.validationMessage;
  }
  public get shouldShowStatus(): boolean {
    return Boolean(
      this.viewportError ||
        this.#resolvedStatusKind !== "ready" ||
        this.validationMessage
    );
  }

  public handleScroll(): void {
    const viewport = this.#scrollElement;
    if (!viewport) return;
    this.scrollTop = viewport.scrollTop;
    this.scrollLeft = viewport.scrollLeft;
    this.#scheduleRenderWindow();
  }

  public handleToolbarSlotChange(event?: Event): void {
    const slot =
      event?.currentTarget instanceof HTMLSlotElement
        ? event.currentTarget
        : (this.shadowRoot?.querySelector(
            'slot[name="toolbar"]'
          ) as HTMLSlotElement | null);
    this.hasToolbarContent = (
      slot?.assignedNodes({ flatten: true }) ?? []
    ).some((node) => {
      if (node.nodeType === Node.TEXT_NODE)
        return Boolean(node.textContent?.trim());
      return true;
    });
  }

  public handleFocusIn(event: FocusEvent): void {
    const row = elementFromPath(event, "data-row-id");
    if (row?.dataset.rowId) {
      this.activeRowId = row.dataset.rowId;
      const origin = event.composedPath()[0];
      if (!(origin instanceof HTMLButtonElement)) this.#scheduleRenderWindow();
    }
  }

  public handleClick(event: Event): void {
    const action = elementFromPath(event, "data-action");
    const rowId = action?.dataset.rowId;
    if (action?.dataset.action === "toggle" && rowId) {
      this.#requestExpanded(rowId);
      return;
    }
    if (action?.dataset.action === "inspect-row" && rowId) {
      this.activeRowId = rowId;
      this.activeItemId = null;
      this.$emit("row-inspect", {
        rowId,
      } satisfies VioletGanttRowInspectDetail);
      return;
    }
    if (action?.dataset.action === "cycle-overflow" && rowId) {
      this.activeRowId = rowId;
      this.#cycleItem(rowId, action.dataset.direction === "previous" ? -1 : 1);
      if (action.classList.contains("single-item-overflow"))
        this.#scheduleFocus(rowId);
      return;
    }

    const itemElement = elementFromPath(event, "data-item-id");
    const itemId = itemElement?.dataset.itemId;
    if (!itemId) return;
    const renderedRow = this.renderedRows.find((row) =>
      row.items.some((item) => item.item.id === itemId)
    );
    this.activeRowId = renderedRow?.row.id ?? this.activeRowId;
    this.activeItemId = itemId;
    const item = renderedRow
      ? this.#itemsByRowId
          .get(renderedRow.row.id)
          ?.find((candidate) => candidate.id === itemId)
      : undefined;
    if (item) this.#revealItem(item);
    this.$emit("item-selection-change", {
      itemId,
    } satisfies VioletGanttItemSelectionChangeDetail);
    this.$emit("item-activate", {
      itemId,
    } satisfies VioletGanttItemActivateDetail);
    this.#scheduleRenderWindow();
  }

  public handleKeydown(event: KeyboardEvent): void {
    if (event.composedPath().some((node) => node instanceof HTMLButtonElement))
      return;
    const rowElement = elementFromPath(event, "data-row-id");
    const rowId = rowElement?.dataset.rowId ?? this.activeRowId;
    const index = rowId
      ? this.#presentedRows.findIndex((row) => row.row.id === rowId)
      : -1;
    if (index < 0) return;
    const current = this.#presentedRows[index];

    if (
      event.altKey &&
      (event.key === "ArrowRight" || event.key === "ArrowLeft")
    ) {
      // Only claim Alt+Arrow when there is an item to move to, so rows without
      // items leave the browser's Alt+Left/Right history shortcuts alone.
      if (this.#cycleItem(current.row.id, event.key === "ArrowRight" ? 1 : -1))
        event.preventDefault();
      return;
    }

    const pageDistance = Math.max(
      this.rowHeight,
      this.viewportHeight - HEADER_HEIGHT
    );
    // Tree expand/collapse follows reading direction: in RTL, Left expands.
    const rtl = getComputedStyle(this).direction === "rtl";
    const key =
      event.key === "ArrowRight" || event.key === "ArrowLeft"
        ? (event.key === "ArrowRight") !== rtl
          ? "Expand"
          : "Collapse"
        : event.key;
    switch (key) {
      case "ArrowDown":
        event.preventDefault();
        this.#focusRow(Math.min(this.#presentedRows.length - 1, index + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        this.#focusRow(Math.max(0, index - 1));
        break;
      case "Home":
        event.preventDefault();
        this.#focusRow(0);
        break;
      case "End":
        event.preventDefault();
        this.#focusRow(this.#presentedRows.length - 1);
        break;
      case "PageDown":
        event.preventDefault();
        this.#focusRow(
          Math.max(
            index + 1,
            this.#rowIndexAtOffset(
              (this.#rowLayouts[index]?.top ?? 0) + pageDistance
            )
          )
        );
        break;
      case "PageUp":
        event.preventDefault();
        this.#focusRow(
          Math.min(
            index - 1,
            this.#rowIndexAtOffset(
              (this.#rowLayouts[index]?.top ?? 0) - pageDistance
            )
          )
        );
        break;
      case "Expand":
        event.preventDefault();
        if (current.hasChildren && !current.expanded)
          this.#requestExpanded(current.row.id);
        else if (current.hasChildren && current.expanded)
          this.#focusRow(index + 1);
        break;
      case "Collapse":
        event.preventDefault();
        if (current.hasChildren && current.expanded)
          this.#requestExpanded(current.row.id);
        else if (current.parentId)
          this.#focusRow(
            this.#presentedRows.findIndex(
              (row) => row.row.id === current.parentId
            )
          );
        break;
      case "Enter": {
        event.preventDefault();
        if (event.shiftKey) {
          this.$emit("row-inspect", {
            rowId: current.row.id,
          } satisfies VioletGanttRowInspectDetail);
          break;
        }
        const keyboardItems = this.#keyboardItemsForRow(current);
        const activeItem =
          keyboardItems.find((item) => item.id === this.activeItemId) ??
          keyboardItems[0];
        if (activeItem) {
          this.activeItemId = activeItem.id;
          this.$emit("item-selection-change", {
            itemId: activeItem.id,
          } satisfies VioletGanttItemSelectionChangeDetail);
          this.$emit("item-activate", {
            itemId: activeItem.id,
          } satisfies VioletGanttItemActivateDetail);
        } else {
          this.$emit("row-inspect", {
            rowId: current.row.id,
          } satisfies VioletGanttRowInspectDetail);
        }
        this.#scheduleRenderWindow();
        break;
      }
      case "Escape":
        event.preventDefault();
        this.activeItemId = null;
        this.#scheduleRenderWindow();
        this.#scheduleFocus(current.row.id);
        break;
    }
  }

  /** Focuses and reveals an item when its logical row and date are in the current viewport. */
  public focusItem(itemId: string): boolean {
    const rowIndex = this.#presentedRows.findIndex((row) =>
      this.#itemsByRowId.get(row.row.id)?.some((item) => item.id === itemId)
    );
    if (rowIndex < 0) return false;
    const row = this.#presentedRows[rowIndex];
    if (!row) return false;
    const item = this.#itemsByRowId
      .get(row.row.id)
      ?.find((candidate) => candidate.id === itemId);
    const range = this.#viewportDays;
    if (
      !item ||
      !range ||
      (item.time &&
        !ganttTimeIntersects(item.time, range.start, range.endExclusive))
    )
      return false;
    this.activeItemId = itemId;
    this.#focusRow(rowIndex, true);
    this.#revealItem(item);
    return true;
  }

  /** Scrolls to a date in the current viewport, or requests a centered viewport when outside it. */
  public scrollToDate(date: VioletGanttDate): boolean {
    const day = ganttDateToDay(date);
    const range = this.#viewportDays;
    if (day === null || !range || !this.#isSupportedDay(day)) return false;
    if (day < range.start || day >= range.endExclusive) {
      const centered = this.#centeredViewport(day, range.count);
      if (!centered) return false;
      this.#pendingRevealDay = day;
      this.#emitViewport(
        { ...centered, scale: this.viewport.scale },
        "programmatic"
      );
      this.#applyPendingDateReveal();
      return true;
    }
    const viewport = this.#scrollElement;
    if (viewport)
      viewport.scrollLeft = Math.max(
        0,
        (day - range.start) * this.dayWidth - this.#nameColumnWidth
      );
    return true;
  }

  /** Requests the same viewport span shifted by a number of calendar days. */
  public panBy(days: number): boolean {
    const range = this.#viewportDays;
    if (!range || !Number.isSafeInteger(days)) return false;
    const start = ganttDayToDate(range.start + days);
    const endExclusive = ganttDayToDate(range.endExclusive + days);
    if (!this.#isSupportedViewport(start, endExclusive)) return false;
    this.#emitViewport(
      { start, endExclusive, scale: this.viewport.scale },
      "pan"
    );
    return true;
  }

  /** Requests a viewport centered on the explicit consumer-supplied `today`; no-op when absent or invalid. */
  public showToday(): boolean {
    if (typeof this.today !== "string" || !this.today) return false;
    const day = ganttDateToDay(this.today);
    const range = this.#viewportDays;
    if (day === null || !range || !this.#isSupportedDay(day)) return false;
    const centered = this.#centeredViewport(day, range.count);
    if (!centered) return false;
    this.#pendingRevealDay = day;
    this.#emitViewport({ ...centered, scale: this.viewport.scale }, "today");
    this.#applyPendingDateReveal();
    return true;
  }

  /** Requests the smallest supported day range containing every valid scheduled item. */
  public fitItems(): boolean {
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    for (const items of this.#itemsByRowId.values()) {
      for (const item of items) {
        if (!item.time) continue;
        const bounds = ganttTimeBounds(item.time);
        if (!bounds) continue;
        first = Math.min(first, bounds.start);
        last = Math.max(
          last,
          bounds.point ? bounds.start + 1 : bounds.endExclusive
        );
      }
    }
    if (!Number.isFinite(first) || !Number.isFinite(last)) return false;
    const paddedStart = Math.max(
      ganttDateToDay(VIOLET_GANTT_DATE_LIMITS.min) ?? first,
      first - 1
    );
    const paddedEnd = Math.min(
      ganttDateToDay(VIOLET_GANTT_DATE_LIMITS.endExclusive) ?? last,
      last + 1
    );
    const start = ganttDayToDate(paddedStart);
    const endExclusive = ganttDayToDate(paddedEnd);
    if (!this.#isSupportedViewport(start, endExclusive)) return false;
    this.#emitViewport(
      { start, endExclusive, scale: this.viewport.scale },
      "fit"
    );
    return true;
  }

  #emitViewport(
    viewport: VioletGanttViewport,
    reason: VioletGanttViewportChangeDetail["reason"]
  ): void {
    this.$emit("viewport-change", {
      viewport,
      reason,
    } satisfies VioletGanttViewportChangeDetail);
  }

  #requestViewportFill(range: {
    start: number;
    endExclusive: number;
    count: number;
  }): void {
    if (
      this.#resolvedStatusKind === "loading" ||
      this.#resolvedStatusKind === "error"
    )
      return;
    const viewport = this.#scrollElement;
    if (!viewport) return;
    const available = viewport.clientWidth - this.#nameColumnWidth;
    if (available <= 0) return;
    const requestedDays = Math.ceil(available / this.dayWidth);
    if (requestedDays <= range.count) return;

    const pending = this.#pendingViewportFillRequest;
    if (
      pending &&
      this.#sameViewport(this.viewport, pending.source) &&
      pending.requestedDays >= requestedDays
    )
      return;

    const endLimit = ganttDateToDay(VIOLET_GANTT_DATE_LIMITS.endExclusive);
    if (endLimit === null) return;
    const requestedEnd = Math.min(
      range.start + VIOLET_GANTT_DATE_LIMITS.maxViewportDays,
      range.start + requestedDays,
      endLimit
    );
    if (requestedEnd <= range.endExclusive) return;
    const endExclusive = ganttDayToDate(requestedEnd);
    if (!this.#isSupportedViewport(this.viewport.start, endExclusive)) return;

    this.#pendingViewportFillRequest = {
      source: { ...this.viewport },
      requestedDays,
    };
    this.#emitViewport({ ...this.viewport, endExclusive }, "resize");
  }

  #sameViewport(
    first: VioletGanttViewport | null | undefined,
    second: VioletGanttViewport | null | undefined
  ): boolean {
    return (
      first?.start === second?.start &&
      first?.endExclusive === second?.endExclusive &&
      first?.scale === second?.scale
    );
  }

  #applyPendingDateReveal(clearOnMismatch = false): boolean {
    const day = this.#pendingRevealDay;
    if (day === null) return false;
    const range = this.#viewportDays;
    if (!range || day < range.start || day >= range.endExclusive) {
      if (clearOnMismatch && range) this.#pendingRevealDay = null;
      return false;
    }
    const viewport = this.#scrollElement;
    if (!viewport) return false;
    const available = Math.max(
      this.dayWidth,
      this.viewportWidth - this.#nameColumnWidth
    );
    const left = (day - range.start) * this.dayWidth;
    viewport.scrollLeft = Math.max(0, left - available / 2 + this.dayWidth / 2);
    this.scrollLeft = viewport.scrollLeft;
    this.#pendingRevealDay = null;
    this.#renderWindow();
    return true;
  }

  #centeredViewport(day: number, count: number): VioletGanttRange | null {
    const min = ganttDateToDay(VIOLET_GANTT_DATE_LIMITS.min);
    const endLimit = ganttDateToDay(VIOLET_GANTT_DATE_LIMITS.endExclusive);
    if (
      min === null ||
      endLimit === null ||
      count <= 0 ||
      count > endLimit - min ||
      day < min ||
      day >= endLimit
    )
      return null;
    const preferredStart = day - Math.floor(count / 2);
    const start = Math.max(min, Math.min(preferredStart, endLimit - count));
    return {
      start: ganttDayToDate(start),
      endExclusive: ganttDayToDate(start + count),
    };
  }

  #requestExpanded(rowId: string): void {
    const expanded = new Set(
      Array.isArray(this.expandedRowIds)
        ? this.expandedRowIds.filter((id) => typeof id === "string")
        : []
    );
    if (expanded.has(rowId)) expanded.delete(rowId);
    else expanded.add(rowId);
    this.$emit("expanded-change", {
      expandedRowIds: [...expanded],
    } satisfies VioletGanttExpandedChangeDetail);
  }

  #cycleItem(rowId: string, direction: 1 | -1): boolean {
    const row = this.#presentedRows.find(
      (candidate) => candidate.row.id === rowId
    );
    if (!row) return false;
    const items = this.#keyboardItemsForRow(row);
    if (items.length === 0) return false;
    const current = items.findIndex((item) => item.id === this.activeItemId);
    const next =
      current < 0
        ? direction > 0
          ? 0
          : items.length - 1
        : (current + direction + items.length) % items.length;
    const item = items[next];
    this.activeItemId = item?.id ?? null;
    if (item) this.#revealItem(item);
    return true;
  }

  #rebuildRowLayouts(): void {
    const range = this.#viewportDays;
    const minimumHeight = this.rowHeight;
    let totalHeight = 0;
    this.#rowLayouts = this.#presentedRows.map((row) => {
      const items = (this.#itemsByRowId.get(row.row.id) ?? []).filter(
        (item) =>
          !item.time ||
          (range &&
            ganttTimeIntersects(item.time, range.start, range.endExclusive))
      );
      const visibleLaneCount = Math.min(
        MAX_VISIBLE_ITEM_LANES,
        Math.max(1, items.length)
      );
      const renderedHeight = Math.max(
        minimumHeight,
        visibleLaneCount * ITEM_LANE_HEIGHT + ITEM_LANE_BREATHING_ROOM
      );
      const layout = {
        top: totalHeight,
        height: renderedHeight,
        laneCapacity: visibleLaneCount,
      };
      totalHeight += renderedHeight;
      return layout;
    });
    this.#bodyHeight = totalHeight;
    this.#clampVerticalScroll();
  }

  #rowIndexAtOffset(offset: number): number {
    if (this.#rowLayouts.length === 0) return -1;
    const target = Math.max(
      0,
      Math.min(offset, Math.max(0, this.#bodyHeight - 1))
    );
    let low = 0;
    let high = this.#rowLayouts.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const layout = this.#rowLayouts[middle];
      if (layout && layout.top + layout.height <= target) low = middle + 1;
      else high = middle;
    }
    return Math.min(low, this.#rowLayouts.length - 1);
  }

  #clampVerticalScroll(): void {
    const viewport = this.#scrollElement;
    const viewportHeight = viewport?.clientHeight ?? this.viewportHeight;
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return;
    const maximum = Math.max(
      0,
      HEADER_HEIGHT + this.#bodyHeight - viewportHeight
    );
    const next = Math.max(
      0,
      Math.min(viewport?.scrollTop ?? this.scrollTop, maximum)
    );
    if (viewport && viewport.scrollTop !== next) viewport.scrollTop = next;
    this.scrollTop = next;
  }

  #focusRow(index: number, preserveItem = false): void {
    const row = this.#presentedRows[index];
    const layout = this.#rowLayouts[index];
    if (!row || !layout) return;
    this.activeRowId = row.row.id;
    this.#pendingFocusRowId = row.row.id;
    if (!preserveItem) this.activeItemId = null;
    const viewport = this.#scrollElement;
    if (viewport) {
      const visibleTop = viewport.scrollTop;
      const visibleBottom =
        viewport.scrollTop + Math.max(0, viewport.clientHeight - HEADER_HEIGHT);
      if (layout.top < visibleTop) viewport.scrollTop = layout.top;
      else if (layout.top + layout.height > visibleBottom)
        viewport.scrollTop =
          layout.top + layout.height - (viewport.clientHeight - HEADER_HEIGHT);
      this.scrollTop = viewport.scrollTop;
    }
    this.#renderWindow();
    this.#scheduleFocus(row.row.id);
  }

  #scheduleFocus(rowId: string): void {
    this.#pendingFocusRowId = rowId;
    if (this.#focusFrame !== null) cancelAnimationFrame(this.#focusFrame);
    this.#focusFrame = requestAnimationFrame(() => {
      this.#focusFrame = null;
      const rows =
        this.shadowRoot?.querySelectorAll<HTMLElement>(".row[data-row-id]") ??
        [];
      const row = [...rows].find(
        (candidate) => candidate.dataset.rowId === rowId
      );
      if (row) {
        row.focus();
        this.#pendingFocusRowId = null;
      }
    });
  }

  #scheduleRenderWindow(): void {
    this.#nameColumnWidthCache = null;
    if (!this.$fastController.isConnected || this.#renderFrame !== null) return;
    this.#renderFrame = requestAnimationFrame(() => {
      this.#renderFrame = null;
      this.#renderWindow();
    });
  }

  #renderWindow(): void {
    this.#nameColumnWidthCache = null;
    const range = this.#viewportDays;
    if (!range) {
      this.renderedRows = [];
      this.renderedDays = [];
      this.axisContextLabel = "";
      this.axisContextStyle = "";
      return;
    }
    const availableHeight = Math.max(
      this.rowHeight,
      this.viewportHeight - HEADER_HEIGHT
    );
    const focusedRowId = this.#focusedRowId;
    const retainedRowId = this.#pendingFocusRowId ?? focusedRowId;
    const firstVisibleRow = this.#rowIndexAtOffset(this.scrollTop);
    const lastVisibleRow = this.#rowIndexAtOffset(
      this.scrollTop + availableHeight
    );
    const firstRow = Math.max(0, firstVisibleRow - OVERSCAN_ROWS);
    const lastRow = Math.min(
      this.#presentedRows.length,
      lastVisibleRow + 1 + OVERSCAN_ROWS
    );
    const rowIndexes = new Set(
      Array.from(
        { length: Math.max(0, lastRow - firstRow) },
        (_, offset) => firstRow + offset
      )
    );
    const focusedIndex = retainedRowId
      ? this.#presentedRows.findIndex((row) => row.row.id === retainedRowId)
      : -1;
    if (focusedIndex >= 0) rowIndexes.add(focusedIndex);
    this.renderedRows = [...rowIndexes]
      .sort((a, b) => a - b)
      .flatMap((index) => {
        const row = this.#presentedRows[index];
        return row ? [this.#renderRow(row)] : [];
      });
    if (this.#pendingFocusRowId) this.#scheduleFocus(this.#pendingFocusRowId);

    const chartViewportWidth = Math.max(
      this.dayWidth,
      this.viewportWidth - this.#nameColumnWidth
    );
    const firstDay = Math.max(
      0,
      Math.floor(this.scrollLeft / this.dayWidth) - OVERSCAN_DAYS
    );
    const lastDay = Math.min(
      range.count,
      Math.ceil((this.scrollLeft + chartViewportWidth) / this.dayWidth) +
        OVERSCAN_DAYS
    );
    const firstVisibleDay = Math.min(
      range.endExclusive - 1,
      range.start + Math.max(0, Math.floor(this.scrollLeft / this.dayWidth))
    );
    const lastVisibleDay = Math.min(
      range.endExclusive - 1,
      range.start +
        Math.ceil((this.scrollLeft + chartViewportWidth) / this.dayWidth) -
        1
    );
    this.axisContextLabel = this.#monthYearLabel(firstVisibleDay);
    if (this.viewport.scale === "month") {
      const lastYear = this.#monthYearLabel(lastVisibleDay);
      if (lastYear !== this.axisContextLabel)
        this.axisContextLabel += ` – ${lastYear}`;
    }
    this.axisContextStyle = `--_axis-context-left:${this.scrollLeft + 8}px;`;
    this.renderedDays = Array.from(
      { length: Math.max(0, lastDay - firstDay) },
      (_, offset) => {
        const index = firstDay + offset;
        const day = range.start + index;
        const date = ganttDayToDate(day);
        const labelSpan = Math.min(
          this.#dayLabelSpan(day),
          range.endExclusive - day
        );
        const gridBoundary = this.#isGridBoundary(day);
        return {
          date,
          label: this.#dayLabel(day, firstVisibleDay),
          title: this.#fullDayLabel(day),
          style: `--_day-left:${index * this.dayWidth}px;--_day-width:${
            this.dayWidth
          }px;--_day-label-width:${labelSpan * this.dayWidth}px;`,
          gridStyle: `--_grid-left:${index * this.dayWidth}px;`,
          gridBoundary,
        };
      }
    );
    this.#requestViewportFill(range);
  }

  #renderRow(row: PresentedRow): RenderedRow {
    const layout = this.#rowLayouts[row.logicalIndex] ?? {
      top: row.logicalIndex * this.rowHeight,
      height: this.rowHeight,
      laneCapacity: 1,
    };
    const rendered = this.#renderedItemsForRow(row);
    const items = rendered.items;
    const activeItem = items.find((item) => item.item.id === this.activeItemId);
    return {
      ...row,
      style: `--_row-top:${layout.top}px;--_row-height:${layout.height}px;`,
      indentStyle: `--_row-indent:${Math.max(0, row.level - 1) * 16}px;`,
      items,
      tabIndex:
        this.activeRowId === row.row.id ||
        (!this.activeRowId && row.logicalIndex === 0)
          ? "0"
          : "-1",
      activeDescendant: activeItem?.elementId ?? null,
      overflowCount: rendered.overflowCount,
      singleItemOverflow: rendered.singleItemOverflow,
    };
  }

  #renderedItemsForRow(row: PresentedRow): {
    items: RenderedItem[];
    overflowCount: number;
    singleItemOverflow: boolean;
  } {
    const range = this.#viewportDays;
    if (!range)
      return { items: [], overflowCount: 0, singleItemOverflow: false };
    const visible = this.#horizontalDayWindow(range);
    const sourceItems = this.#itemsByRowId.get(row.row.id) ?? [];
    const geometries = sourceItems.flatMap((item) => {
      if (!item.time) {
        return this.scrollLeft <= 220
          ? [
              {
                item,
                left: 8,
                width: Math.min(180, Math.max(80, item.label.length * 7 + 92)),
                point: false,
                clippedStart: false,
                clippedEnd: false,
                unscheduled: true,
              },
            ]
          : [];
      }
      if (
        !visible ||
        !ganttTimeIntersects(item.time, visible.start, visible.endExclusive)
      )
        return [];
      const geometry = ganttClippedGeometry(
        item.time,
        range.start,
        range.endExclusive,
        this.dayWidth
      );
      return geometry ? [{ item, ...geometry, unscheduled: false }] : [];
    });
    const layout = this.#rowLayouts[row.logicalIndex];
    const rowHeight = layout?.height ?? this.rowHeight;
    const itemCapacity = layout?.laneCapacity ?? 1;
    let mounted = geometries.slice(0, itemCapacity);
    const activeIndex = geometries.findIndex(
      (geometry) =>
        geometry.item.id === this.activeItemId &&
        row.row.id === this.activeRowId
    );
    const activeGeometry = geometries[activeIndex];
    if (activeIndex >= itemCapacity && itemCapacity > 0 && activeGeometry)
      mounted = [...mounted.slice(0, -1), activeGeometry];
    const laneTop = Math.max(
      2,
      (rowHeight - mounted.length * ITEM_LANE_HEIGHT) / 2
    );
    const items = mounted.map((geometry, index) => {
      const item = geometry.item;
      const selected = item.id === this.selectedItemId;
      const active =
        item.id === this.activeItemId && row.row.id === this.activeRowId;
      const preferredWidth = geometry.point
        ? Math.min(
            POINT_LABEL_MAX_WIDTH,
            Math.max(120, item.label.length * 7 + 24)
          )
        : Math.max(ITEM_LANE_HEIGHT, geometry.width);
      const pointAfterSpace = this.chartWidth - (geometry.left - 6);
      const pointBeforeSpace = geometry.left + 6;
      const labelBefore =
        geometry.point &&
        preferredWidth > pointAfterSpace &&
        pointBeforeSpace > pointAfterSpace;
      const width = geometry.point
        ? Math.max(
            ITEM_LANE_HEIGHT,
            Math.min(
              preferredWidth,
              labelBefore ? pointBeforeSpace : pointAfterSpace
            )
          )
        : preferredWidth;
      const left = geometry.point
        ? labelBefore
          ? Math.max(0, pointBeforeSpace - width)
          : geometry.left - 6
        : geometry.left;
      const narrowInterval =
        !geometry.point &&
        !geometry.unscheduled &&
        geometry.width < ITEM_LANE_HEIGHT;
      const className = [
        "item",
        item.presentation === "milestone" ? "milestone" : "",
        labelBefore ? "label-before" : "",
        narrowInterval ? "narrow-interval" : "",
        geometry.unscheduled ? "unscheduled" : "",
        geometry.clippedStart ? "clipped-start" : "",
        geometry.clippedEnd ? "clipped-end" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const partName = [
        "item",
        item.presentation,
        geometry.unscheduled ? "unscheduled" : "",
        selected ? "selection" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return {
        item,
        style: `--_item-left:${left}px;--_item-top:${
          laneTop + index * ITEM_LANE_HEIGHT
        }px;--_item-height:${ITEM_LANE_HEIGHT}px;--_item-geometry-width:${Math.max(
          2,
          geometry.width
        )}px;inline-size:${width}px;`,
        className,
        partName,
        selected,
        active,
        title: this.#itemLabel(item),
        elementId: this.#elementIdForItem(item.id),
      };
    });
    const mountedIds = new Set(items.map((item) => item.item.id));
    const keyboardItems = this.#keyboardItemsForRow(row);
    const overflowCount = keyboardItems.reduce(
      (count, item) => count + (mountedIds.has(item.id) ? 0 : 1),
      0
    );
    return {
      items,
      overflowCount,
      singleItemOverflow: overflowCount === 1 && keyboardItems.length === 1,
    };
  }

  #keyboardItemsForRow(row: PresentedRow): VioletGanttItem[] {
    const range = this.#viewportDays;
    if (!range) return [];
    return (this.#itemsByRowId.get(row.row.id) ?? []).filter(
      (item) =>
        !item.time ||
        ganttTimeIntersects(item.time, range.start, range.endExclusive)
    );
  }

  #revealItem(item: VioletGanttItem): void {
    const viewport = this.#scrollElement;
    const range = this.#viewportDays;
    if (!viewport || !range) return;
    if (!item.time) {
      viewport.scrollLeft = 0;
    } else {
      const bounds = ganttTimeBounds(item.time);
      if (bounds) {
        const left = (bounds.start - range.start) * this.dayWidth;
        const available = Math.max(
          this.dayWidth,
          this.viewportWidth - this.#nameColumnWidth
        );
        if (
          left < this.scrollLeft ||
          left > this.scrollLeft + available - this.dayWidth
        ) {
          viewport.scrollLeft = Math.max(0, left - available / 2);
        }
      }
    }
    this.scrollLeft = viewport.scrollLeft;
    this.#renderWindow();
  }

  #elementIdForItem(itemId: string): string {
    const existing = this.#itemElementIdById.get(itemId);
    if (existing) return existing;
    const next = `violet-gantt-${this.#instanceId}-item-${++this
      .#nextItemElementId}`;
    this.#itemElementIdById.set(itemId, next);
    return next;
  }

  #itemLabel(item: VioletGanttItem): string {
    const time = this.#itemTimeLabel(item.time);
    const reason = item.readOnlyReason
      ? `. Read only: ${item.readOnlyReason}`
      : ". Read only.";
    return `${item.label}. ${item.presentation}. ${time}. ${
      item.provenance
    }${reason}${item.note ? ` ${item.note}` : ""}`;
  }

  /** Spoken-friendly dates ("Mar 3 – 7, 2028 (5 days)") instead of raw ISO and exclusive ends. */
  #itemTimeLabel(time: VioletGanttTime | null): string {
    if (!time) return "Unscheduled";
    const formatter = cachedDateTimeFormat(this.resolvedLocale, {
      dateStyle: "medium",
      timeZone: "UTC",
    });
    if (time.kind === "day-point") {
      const day = ganttDateToDay(time.at);
      return day === null
        ? time.at
        : formatter.format(new Date(day * MILLISECONDS_PER_DAY));
    }
    const start = ganttDateToDay(time.start);
    const endExclusive = ganttDateToDay(time.endExclusive);
    if (start === null || endExclusive === null || endExclusive <= start)
      return `${time.start} to ${time.endExclusive}`;
    const days = endExclusive - start;
    const first = new Date(start * MILLISECONDS_PER_DAY);
    const range =
      days === 1
        ? formatter.format(first)
        : formatter.formatRange(
            first,
            new Date((endExclusive - 1) * MILLISECONDS_PER_DAY)
          );
    return `${range} (${days} ${days === 1 ? "day" : "days"})`;
  }

  #horizontalDayWindow(range: {
    start: number;
    endExclusive: number;
    count: number;
  }): {
    start: number;
    endExclusive: number;
  } {
    const available = Math.max(
      this.dayWidth,
      this.viewportWidth - this.#nameColumnWidth
    );
    const first = Math.max(
      0,
      Math.floor(this.scrollLeft / this.dayWidth) - OVERSCAN_DAYS
    );
    const last = Math.min(
      range.count,
      Math.ceil((this.scrollLeft + available) / this.dayWidth) + OVERSCAN_DAYS
    );
    return {
      start: range.start + first,
      endExclusive: range.start + Math.max(first + 1, last),
    };
  }

  get #focusedRowId(): string | null {
    const active = this.shadowRoot?.activeElement as HTMLElement | null;
    return (
      active?.closest<HTMLElement>(".row[data-row-id]")?.dataset.rowId ?? null
    );
  }

  get #timelineOwnsFocus(): boolean {
    const active = this.shadowRoot?.activeElement as HTMLElement | null;
    return (
      active === this.#scrollElement ||
      Boolean(active?.closest(".row[data-row-id]"))
    );
  }

  #rebuildData(): void {
    const previousRows = this.#rowById;
    const previousActive = this.activeRowId;
    const restoreTimelineFocus = this.#timelineOwnsFocus;
    const errors: string[] = [];
    const candidateRows = new Map<string, VioletGanttRow>();
    for (const row of Array.isArray(this.rows) ? this.rows : []) {
      if (!this.#validRowText(row) || candidateRows.has(row.id)) {
        errors.push("duplicate, empty, or non-text row data");
        continue;
      }
      candidateRows.set(row.id, row);
    }

    const hierarchyState = new Map<string, "valid" | "invalid">();
    for (const rowId of candidateRows.keys()) {
      if (hierarchyState.has(rowId)) continue;
      const chain: string[] = [];
      const local = new Set<string>();
      let currentId: string | null = rowId;
      let result: "valid" | "invalid" = "valid";
      while (currentId) {
        const known = hierarchyState.get(currentId);
        if (known) {
          result = known;
          break;
        }
        if (local.has(currentId)) {
          result = "invalid";
          break;
        }
        const current = candidateRows.get(currentId);
        if (!current) {
          result = "invalid";
          break;
        }
        local.add(currentId);
        chain.push(currentId);
        currentId = current.parentId ?? null;
      }
      for (const id of chain) hierarchyState.set(id, result);
      if (result === "invalid") errors.push("orphan or cyclic row identity");
    }

    const rowById = new Map(
      [...candidateRows].filter(([id]) => hierarchyState.get(id) === "valid")
    );
    const children = new Map<string | null, VioletGanttRow[]>();
    for (const row of rowById.values()) {
      const parentId = row.parentId ?? null;
      const siblings = children.get(parentId) ?? [];
      siblings.push(row);
      children.set(parentId, siblings);
    }
    const expanded = new Set(
      Array.isArray(this.expandedRowIds)
        ? this.expandedRowIds.filter((id) => typeof id === "string")
        : []
    );
    const presented: PresentedRow[] = [];
    const roots = children.get(null) ?? [];
    const stack = roots
      .map((row, index) => ({
        row,
        level: 1,
        positionInSet: index + 1,
        setSize: roots.length,
      }))
      .reverse();
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) break;
      const { row, level, positionInSet, setSize } = current;
      const childRows = children.get(row.id) ?? [];
      const isExpanded = expanded.has(row.id);
      presented.push({
        row,
        logicalIndex: presented.length,
        level,
        positionInSet,
        setSize,
        parentId: row.parentId ?? null,
        hasChildren: childRows.length > 0,
        expanded: isExpanded,
      });
      if (isExpanded) {
        for (let index = childRows.length - 1; index >= 0; index -= 1) {
          const child = childRows[index];
          if (!child) continue;
          stack.push({
            row: child,
            level: level + 1,
            positionInSet: index + 1,
            setSize: childRows.length,
          });
        }
      }
    }

    const rawItemById = new Map<string, VioletGanttItem>();
    for (const item of Array.isArray(this.items) ? this.items : []) {
      if (!this.#validItemText(item) || rawItemById.has(item.id)) {
        errors.push("duplicate, empty, or non-text item data");
        continue;
      }
      rawItemById.set(item.id, item);
    }
    const itemsByRowId = new Map<string, VioletGanttItem[]>();
    const usedItemIds = new Set<string>();
    for (const row of rowById.values()) {
      const rowItems: VioletGanttItem[] = [];
      const rowItemIds = new Set<string>();
      for (const itemId of row.itemIds ?? []) {
        if (rowItemIds.has(itemId)) {
          errors.push("duplicate row item identity");
          continue;
        }
        rowItemIds.add(itemId);
        const item = rawItemById.get(itemId);
        if (!item || item.rowId !== row.id) {
          errors.push("orphan or mismatched item identity");
          continue;
        }
        if (!this.#validItemTime(item)) {
          errors.push("invalid item date or presentation");
          continue;
        }
        usedItemIds.add(item.id);
        rowItems.push(item);
      }
      itemsByRowId.set(row.id, rowItems);
    }
    if (usedItemIds.size !== rawItemById.size)
      errors.push("unreferenced item identity");
    for (const id of this.#itemElementIdById.keys()) {
      if (!usedItemIds.has(id)) this.#itemElementIdById.delete(id);
    }

    this.#rowById = rowById;
    this.#itemsByRowId = itemsByRowId;
    this.#presentedRows = presented;
    this.presentedRowCount = presented.length;
    this.#rebuildRowLayouts();
    this.validationMessage = errors.length
      ? `${errors.length} invalid timeline record${
          errors.length === 1 ? " was" : "s were"
        } omitted.`
      : "";

    if (
      previousActive &&
      !presented.some((row) => row.row.id === previousActive)
    ) {
      let ancestor = previousRows.get(previousActive)?.parentId ?? null;
      while (ancestor && !presented.some((row) => row.row.id === ancestor))
        ancestor = previousRows.get(ancestor)?.parentId ?? null;
      this.activeRowId = ancestor ?? presented[0]?.row.id ?? null;
    } else if (!this.activeRowId)
      this.activeRowId = presented[0]?.row.id ?? null;
    if (!presented.length) this.activeRowId = null;

    const activeItems = this.activeRowId
      ? itemsByRowId.get(this.activeRowId) ?? []
      : [];
    if (!activeItems.some((item) => item.id === this.activeItemId))
      this.activeItemId = null;
    if (
      this.#pendingFocusRowId &&
      !presented.some((row) => row.row.id === this.#pendingFocusRowId)
    )
      this.#pendingFocusRowId = null;
    if (
      restoreTimelineFocus &&
      this.$fastController.isConnected &&
      this.activeRowId
    )
      this.#scheduleFocus(this.activeRowId);
    if (this.$fastController.isConnected) this.#renderWindow();
    else this.#scheduleRenderWindow();
  }

  #validRowText(row: VioletGanttRow): boolean {
    return Boolean(
      row &&
        typeof row.id === "string" &&
        row.id.length > 0 &&
        typeof row.label === "string" &&
        (row.parentId === undefined || typeof row.parentId === "string") &&
        (row.description === undefined ||
          typeof row.description === "string") &&
        Array.isArray(row.itemIds) &&
        row.itemIds.every((id) => typeof id === "string")
    );
  }

  #validItemText(item: VioletGanttItem): boolean {
    return Boolean(
      item &&
        typeof item.id === "string" &&
        item.id.length > 0 &&
        typeof item.rowId === "string" &&
        item.rowId.length > 0 &&
        typeof item.label === "string" &&
        (item.note === undefined || typeof item.note === "string") &&
        (item.readOnlyReason === undefined ||
          typeof item.readOnlyReason === "string") &&
        ["work", "window", "milestone"].includes(item.presentation) &&
        ["planned", "derived", "actual", "advisory"].includes(item.provenance)
    );
  }

  #validItemTime(item: VioletGanttItem): boolean {
    if (!item.time) return true;
    if (typeof item.time !== "object") return false;
    if (item.time.kind === "day-point" && typeof item.time.at !== "string")
      return false;
    if (
      item.time.kind === "day-range" &&
      (typeof item.time.start !== "string" ||
        typeof item.time.endExclusive !== "string")
    )
      return false;
    if (item.time.kind !== "day-point" && item.time.kind !== "day-range")
      return false;
    const bounds = ganttTimeBounds(item.time);
    if (!bounds || !this.#isSupportedDay(bounds.start)) return false;
    if (!bounds.point && !this.#isSupportedDay(bounds.endExclusive - 1))
      return false;
    return item.presentation === "milestone" ? bounds.point : !bounds.point;
  }

  get #isValidStatus(): boolean {
    return Boolean(
      this.status &&
        typeof this.status === "object" &&
        ["ready", "loading", "empty", "error"].includes(this.status.kind) &&
        (this.status.message === undefined ||
          typeof this.status.message === "string")
    );
  }

  get #resolvedStatusKind(): VioletGanttStatus["kind"] {
    return this.#isValidStatus ? this.status.kind : "error";
  }

  get #viewportDays(): {
    start: number;
    endExclusive: number;
    count: number;
  } | null {
    return this.#resolveViewport().days;
  }

  /**
   * Parses and validates the viewport. Pure and memoised on the viewport
   * fields, so render paths can read it per row without reparsing dates or
   * writing observables; `viewportChanged` publishes the error.
   */
  #resolveViewport(): {
    days: { start: number; endExclusive: number; count: number } | null;
    error: string;
  } {
    const viewport = this.viewport;
    const cached = this.#viewportDaysCache;
    if (
      cached &&
      cached.start === viewport?.start &&
      cached.endExclusive === viewport?.endExclusive &&
      cached.scale === viewport?.scale
    ) {
      return cached;
    }
    const start = ganttDateToDay(viewport?.start ?? "");
    const endExclusive = ganttDateToDay(viewport?.endExclusive ?? "");
    const min = ganttDateToDay(VIOLET_GANTT_DATE_LIMITS.min) ?? 0;
    const endLimit = ganttDateToDay(VIOLET_GANTT_DATE_LIMITS.endExclusive) ?? 0;
    const count =
      start === null || endExclusive === null ? 0 : endExclusive - start;
    const validScale =
      viewport && ["day", "week", "month"].includes(viewport.scale);
    const invalid =
      start === null ||
      endExclusive === null ||
      count <= 0 ||
      count > VIOLET_GANTT_DATE_LIMITS.maxViewportDays ||
      start < min ||
      endExclusive > endLimit ||
      !validScale;
    const resolved = {
      start: viewport?.start,
      endExclusive: viewport?.endExclusive,
      scale: viewport?.scale,
      days: invalid ? null : { start, endExclusive, count },
      error: invalid
        ? `Viewport must be a half-open YYYY-MM-DD range within ${
            VIOLET_GANTT_DATE_LIMITS.min
          }–${
            VIOLET_GANTT_DATE_LIMITS.endExclusive
          }, spanning at most ${VIOLET_GANTT_DATE_LIMITS.maxViewportDays.toLocaleString()} days.`
        : "",
    };
    this.#viewportDaysCache = resolved;
    return resolved;
  }

  #isSupportedDay(day: number): boolean {
    const min = ganttDateToDay(VIOLET_GANTT_DATE_LIMITS.min) ?? 0;
    const max = ganttDateToDay(VIOLET_GANTT_DATE_LIMITS.max) ?? 0;
    return day >= min && day <= max;
  }

  #isSupportedViewport(
    start: VioletGanttDate,
    endExclusive: VioletGanttDate
  ): boolean {
    const startDay = ganttDateToDay(start);
    const endDay = ganttDateToDay(endExclusive);
    return (
      startDay !== null &&
      endDay !== null &&
      this.#isSupportedDay(startDay) &&
      endDay > startDay &&
      endDay <=
        (ganttDateToDay(VIOLET_GANTT_DATE_LIMITS.endExclusive) ?? endDay) &&
      endDay - startDay <= VIOLET_GANTT_DATE_LIMITS.maxViewportDays
    );
  }

  #dayLabel(day: number, firstVisibleDay: number): string {
    const date = new Date(day * MILLISECONDS_PER_DAY);
    if (this.viewport.scale === "month")
      return day >= firstVisibleDay &&
        (date.getUTCDate() === 1 ||
          (day === firstVisibleDay &&
            this.#dayLabelSpan(day) * this.dayWidth >= 24))
        ? cachedDateTimeFormat(this.resolvedLocale, {
            month: "short",
            timeZone: "UTC",
          }).format(date)
        : "";
    if (this.viewport.scale === "week")
      return date.getUTCDay() === 1
        ? cachedDateTimeFormat(this.resolvedLocale, {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          }).format(date)
        : "";
    return cachedDateTimeFormat(this.resolvedLocale, {
      day: "numeric",
      timeZone: "UTC",
    }).format(date);
  }

  #dayLabelSpan(day: number): number {
    if (this.viewport.scale === "week") return 7;
    if (this.viewport.scale !== "month") return 1;
    const date = new Date(day * MILLISECONDS_PER_DAY);
    const nextMonth = new Date(date.getTime());
    nextMonth.setUTCFullYear(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    return Math.max(
      1,
      Math.round((nextMonth.getTime() - date.getTime()) / MILLISECONDS_PER_DAY)
    );
  }

  #isGridBoundary(day: number): boolean {
    if (this.viewport.scale === "day") return true;
    const date = new Date(day * MILLISECONDS_PER_DAY);
    return this.viewport.scale === "week"
      ? date.getUTCDay() === 1
      : date.getUTCDate() === 1;
  }

  #fullDayLabel(day: number): string {
    return cachedDateTimeFormat(this.resolvedLocale, {
      dateStyle: "full",
      timeZone: "UTC",
    }).format(new Date(day * MILLISECONDS_PER_DAY));
  }

  #monthYearLabel(day: number): string {
    return cachedDateTimeFormat(this.resolvedLocale, {
      ...(this.viewport.scale === "month" ? {} : { month: "long" as const }),
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(day * MILLISECONDS_PER_DAY));
  }

  /** Measured once per render frame instead of once per row. */
  get #nameColumnWidth(): number {
    if (this.#nameColumnWidthCache === null) {
      const header =
        this.shadowRoot?.querySelector<HTMLElement>(".name-header");
      const measured = header?.getBoundingClientRect().width ?? 0;
      this.#nameColumnWidthCache =
        measured > 0 ? measured : DEFAULT_NAME_COLUMN_WIDTH;
    }
    return this.#nameColumnWidthCache;
  }

  get resolvedLocale(): string {
    return (
      this.locale ||
      document.documentElement.lang ||
      navigator.language ||
      "en-US"
    );
  }

  get #scrollElement(): HTMLDivElement | null {
    return this.shadowRoot?.querySelector(".viewport") as HTMLDivElement | null;
  }
}

attr(VioletGantt.prototype, "density");
attr(VioletGantt.prototype, "locale");
attr({ attribute: "aria-label", mode: "fromView" })(
  VioletGantt.prototype,
  "ariaLabel"
);
observable(VioletGantt.prototype, "rows");
observable(VioletGantt.prototype, "items");
observable(VioletGantt.prototype, "expandedRowIds");
observable(VioletGantt.prototype, "selectedItemId");
observable(VioletGantt.prototype, "viewport");
observable(VioletGantt.prototype, "status");
observable(VioletGantt.prototype, "today");
observable(VioletGantt.prototype, "presentedRowCount");
observable(VioletGantt.prototype, "renderedRows");
observable(VioletGantt.prototype, "renderedDays");
observable(VioletGantt.prototype, "axisContextLabel");
observable(VioletGantt.prototype, "axisContextStyle");
observable(VioletGantt.prototype, "validationMessage");
observable(VioletGantt.prototype, "viewportError");
observable(VioletGantt.prototype, "activeRowId");
observable(VioletGantt.prototype, "activeItemId");
observable(VioletGantt.prototype, "viewportWidth");
observable(VioletGantt.prototype, "viewportHeight");
observable(VioletGantt.prototype, "scrollTop");
observable(VioletGantt.prototype, "scrollLeft");
observable(VioletGantt.prototype, "hasToolbarContent");

if (!customElements.get("violet-gantt")) {
  await FASTElement.define(VioletGantt, {
    name: "violet-gantt",
    template,
    styles: violetGanttStyles,
  });
}
