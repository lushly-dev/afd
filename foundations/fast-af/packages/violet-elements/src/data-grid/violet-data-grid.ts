import type { PartialFASTElementDefinition } from "@lushly-dev/fast-element";
import { attr, FASTElement, observable, Updates } from "@lushly-dev/fast-element";
import {
  elementScroll,
  observeElementOffset,
  observeElementRect,
  Virtualizer,
} from "@tanstack/virtual-core";

import { styles } from "./violet-data-grid.styles";
import { template } from "./violet-data-grid.template";
import {
  handleGridClickEvent,
  handleGridFocusInEvent,
  handleGridKeydownEvent,
} from "./violet-data-grid-cell-keyboard";
import {
  resolveCellPartText as composeCellPartText,
  isCellSelected as computeIsCellSelected,
  isFillPreviewCell as computeIsFillPreviewCell,
  rangeEdgeForCell as computeRangeEdgeForCell,
} from "./violet-data-grid-cell-state";
import {
  copyTextForSelection,
  normalizePastedText as normalizeGridPastedText,
  resolvePasteOriginLocation,
  sampleAutosizeRows,
} from "./violet-data-grid-clipboard";
import {
  cellValueFor as resolveCellValue,
  editorOptionsForColumn as resolveEditorOptionsForColumn,
  serializeCellValue as serializeGridCellValue,
  sortRows as sortGridRows,
  stringifyCellValue,
} from "./violet-data-grid-data";
import {
  beginEditingState,
  cancelEditingState as clearEditingState,
  editorStringValue,
  focusEditorAtEnd,
  seedEditorValue,
} from "./violet-data-grid-editing";
import {
  cellElementFromEvent,
  cellElementFromTarget as eventCellElementFromTarget,
  closestFromEventPath as eventClosestFromEventPath,
} from "./violet-data-grid-events";
import {
  buildFillChanges,
  buildPasteChanges,
  clampFillBoundsToEditableTargets as clampEditableFillBounds,
  hasEditableCellsInBounds,
} from "./violet-data-grid-fill";
import {
  findFocusedSelectionControl,
  isDocumentFocusAvailableForGrid,
  isGridCellElementNode,
  mergePendingCellFocusRecovery,
  type PendingCellFocusRecovery,
  recoverGridCellFocusAfterRender,
  scrollCellIntoScrollContainer,
  selectionControlRowIdFromElement,
  suspendRovingCellTabStops,
} from "./violet-data-grid-focus-recovery";
import {
  locationFromCellElement as geometryLocationFromCellElement,
  nearestLocationForPoint as nearestGeometryLocationForPoint,
  preferredAxisForPoint,
  rectFromCellPair,
} from "./violet-data-grid-geometry";
import {
  type HeaderKeyboardHost,
  handleColumnHeaderKeydownEvent,
  handleColumnResizeKeyDownEvent,
  handleSelectionHeaderKeydownEvent,
} from "./violet-data-grid-header-nav";
import {
  createCellSelection as createNavigationCellSelection,
  firstCellLocation as resolveNavigationFirstCellLocation,
  nextCellLocationForKey as resolveNextCellLocationForKey,
} from "./violet-data-grid-navigation";
import {
  clearedFillSession,
  clearedPointerSelectionSession,
  isFillPointerEventForSession,
  isPointerSelectionEventForSession,
  markPointerSelectionMoved,
  pointerSelectionSuppressesNextClick,
  beginFillDrag as startFillDragSession,
  beginPointerSelection as startPointerSelectionSession,
  type VioletDataGridFillSession,
  type VioletDataGridPointerSelectionSession,
} from "./violet-data-grid-pointer";
import {
  createPresentedColumn as buildPresentedColumn,
  createPresentedRow as buildPresentedRow,
  syncEditingState,
  syncActiveCell as syncPresentedActiveCell,
  syncCellSelection as syncPresentedCellSelection,
  syncFillPreview as syncPresentedFillPreview,
} from "./violet-data-grid-presentation";
import {
  clearedColumnResizeSession,
  resizedColumnWidth as computeResizedColumnWidth,
  isColumnResizeEventForSession,
  beginColumnResize as startColumnResizeSession,
  type VioletDataGridResizeSession,
} from "./violet-data-grid-resize";
import {
  customCellWidgetsInCellElement,
  findCustomCellWidgetFromTarget,
  focusRowModeControlInShadow,
  handleCustomCellWidgetKeydownEvent,
  handleRowModeBodyKeydownEvent,
  handleSelectionCellKeydownEvent,
  syncCustomCellWidgetTabIndexesInShadow,
} from "./violet-data-grid-roving-focus";
import {
  nextTabLocation,
  selectedLocations,
  locationForIndices as selectionLocationForIndices,
  rangeFromBounds as selectionRangeFromBounds,
} from "./violet-data-grid-selection";
import {
  autosizedColumnWidth as computeAutosizedColumnWidth,
  minimumColumnWidth as computeMinimumColumnWidth,
  renderedColumnWidth as computeRenderedColumnWidth,
  resolvedColumnWidth as resolveGridColumnWidth,
} from "./violet-data-grid-sizing";
import {
  isEditorElement as isGridEditorElement,
  isFillHandleTarget as isGridFillHandleTarget,
  isInteractiveCellWidgetTarget as isGridInteractiveCellWidgetTarget,
} from "./violet-data-grid-targets";
import type {
  VioletCellEditorLike,
  VioletCheckboxLike,
  VioletDataGridAlignment,
  VioletDataGridCellEditorTemplate,
  VioletDataGridCellLocation,
  VioletDataGridCellRange,
  VioletDataGridCellTemplate,
  VioletDataGridCellTemplateContext,
  VioletDataGridChangeDetail,
  VioletDataGridColumn,
  VioletDataGridColumnWidthDetail,
  VioletDataGridCopyDetail,
  VioletDataGridDensity,
  VioletDataGridEditingSession,
  VioletDataGridEditor,
  VioletDataGridEditorOption,
  VioletDataGridFillDetail,
  VioletDataGridFillDirection,
  VioletDataGridFilterState,
  VioletDataGridFocusMode,
  VioletDataGridPasteDetail,
  VioletDataGridRow,
  VioletDataGridSelectionMode,
  VioletDataGridSort,
  VioletDataGridSortDirection,
  VioletDataGridSortMode,
  VioletFocusedSelectionControl,
  VioletInteractionSnapshot,
  VioletPresentedCell,
  VioletPresentedColumn,
  VioletPresentedRow,
  VioletRenderedRow,
  VioletTextFieldLike,
} from "./violet-data-grid-types";
import {
  opensOnSingleActiveClick as editorOpensOnSingleActiveClick,
  editStringForRawValue,
  booleanCellValue as normalizeBooleanCellValue,
  normalizedEditingValue as normalizeEditingValue,
  resolveEditingValue,
} from "./violet-data-grid-values";
import {
  buildVirtualizerUpdateOptions,
  buildRenderedRows as computeRenderedRows,
} from "./violet-data-grid-virtualization";

export type {
  VioletDataGridAlignment,
  VioletDataGridCellEditorTemplate,
  VioletDataGridCellLocation,
  VioletDataGridCellRange,
  VioletDataGridCellTemplate,
  VioletDataGridCellTemplateContext,
  VioletDataGridChangeDetail,
  VioletDataGridColumn,
  VioletDataGridColumnWidthDetail,
  VioletDataGridCopyDetail,
  VioletDataGridDensity,
  VioletDataGridEditor,
  VioletDataGridEditorOption,
  VioletDataGridFillDetail,
  VioletDataGridFillDirection,
  VioletDataGridFilterState,
  VioletDataGridFocusMode,
  VioletDataGridPasteDetail,
  VioletDataGridRow,
  VioletDataGridSelectionMode,
  VioletDataGridSort,
  VioletDataGridSortDirection,
  VioletDataGridSortMode,
};

/**
 * Violet reusable data grid component.
 *
 * @summary Semantic table-first data grid for FAST-AF and Violet.
 * @fires sort-change - Emitted when the user changes sort intent.
 * @fires selection-change - Emitted when row selection changes.
 * @fires filter-change - Emitted when the built-in filter input changes.
 * @fires active-cell-change - Emitted when the active cell changes in cell focus mode.
 * @fires cell-selection-change - Emitted when the rectangular cell selection changes.
 * @fires cell-copy - Emitted when an active cell or current range is copied as tab-separated text (cells containing tabs, newlines or quotes are quoted).
 * @fires cell-copy-error - Emitted when writing to the clipboard fails or the async clipboard API is unavailable; detail includes the copy payload and `error`.
 * @fires cell-paste - Emitted when pasted text is mapped onto editable cells.
 * @fires cell-fill - Emitted when an autofill drag, or `fillSelection()`, maps source cells onto a larger target range.
 * @fires column-width-change - Emitted when a column width is resized or autosized.
 * @fires edit-start - Emitted when a cell enters edit mode.
 * @fires edit-cancel - Emitted when a cell edit is cancelled.
 * @fires cell-change - Emitted when a cell edit is committed.
 * @remarks In cell focus mode the table exposes `role="grid"` with `aria-multiselectable="true"` and
 * `role="gridcell"` on body cells, using roving `tabindex` on real cells so the grid adds one Tab stop
 * regardless of row count, selection columns or checkbox columns. Arrow keys, Home and End move focus
 * between cells (including selection cells, which toggle with Space); ArrowUp from the first row moves
 * focus to the column header (and ArrowLeft/Home reaches select-all), ArrowDown returns to the first row,
 * and Shift+Tab returns to the active cell. When the active virtualized row unmounts, `.table-scroll`
 * becomes the single Tab stop and focusing it scrolls the active cell back into view. In row focus mode
 * native table semantics are kept, headers share one roving Tab stop (including select-all) and interactive
 * selection/checkbox controls in the body share at most one roving Tab stop. Enter or Space on a sortable
 * header sorts it. Column resizers are not Tab stops: Ctrl+Alt+R on any column header, or on the active
 * cell in cell focus mode, moves focus to that column's resizer. ArrowLeft/ArrowRight resize it (Shift for
 * larger steps), Enter autosizes it and Escape returns focus to where it came from.
 * Virtualized mode uses TanStack Virtual core. The density-aware estimate bootstraps layout,
 * then rendered rows are measured so theme target sizes and expanded cell controls remain aligned.
 * @slot - Optional default slot rendered above the table region.
 * @slot toolbar - Optional toolbar content rendered alongside grid metadata.
 * @slot empty - Content rendered when no rows are available.
 * @slot loading - Content rendered while the grid is busy.
 * @csspart toolbar - Toolbar wrapper for filter and toolbar actions.
 * @csspart table - Root semantic table element.
 * @csspart head - Table head region.
 * @csspart body - Table body region.
 * @csspart header-row - Header row wrapper.
 * @csspart header-cell - Header cell surface.
 * @csspart selection-header-cell - The selection column's header cell (also a header-cell part).
 * @csspart row - Body row wrapper.
 * @csspart cell - Body cell surface.
 * @csspart active-cell - Active cell state hook.
 * @csspart fill-preview-cell - Autofill preview cell hook.
 * @csspart selected-cell - Selected range cell state hook.
 * @csspart selected-range-edge - Selected range boundary hook.
 * @csspart edit-status - Visible live status for edit lifecycle feedback.
 * @csspart empty-state - Empty-state container.
 * @csspart loading-state - Busy/loading overlay container.
 * @cssproperty --violet-data-grid-default-column-width - Width used when a column has no explicit width.
 * @cssproperty --violet-data-grid-virtualized-max-block-size - Optional maximum virtual viewport height;
 * set to `none` when the grid should fill a definite-height parent.
 */
// biome-ignore format: formatting this class takes the file past its frozen 4,418-line ceiling (scripts/policy/file-size-limits.json); #504 splits it, then this comment goes
export class VioletDataGrid extends FASTElement {
    #internals: ElementInternals;

    /**
     * Selection behavior for the grid.
     * Uses reflected primitive attribute state for HTML configuration.
     */
  public declare selectionMode: VioletDataGridSelectionMode;

    /**
     * Verb for what a single-selection radio does, such as "Open": radios are named
     * "<selection-label> <row label>" and the selection column header "<selection-label>". Only
     * with `selection-mode="single"`.
     */
  public declare selectionLabel: string | null;

    /**
     * Enables sticky table headers.
     */
  public declare stickyHeader: boolean;

    /**
     * Marks the grid as busy and shows the loading overlay.
     */
  public declare busy: boolean;

    /**
   * Enables windowed row rendering for large data sets.
     */
  public declare virtualize: boolean;

    /**
     * Density variant for the grid row spacing.
     */
  public declare density: VioletDataGridDensity;

    /**
     * Keyboard navigation mode for the grid surface.
     */
  public declare focusMode: VioletDataGridFocusMode;

    /**
     * Sorting behavior for the grid.
     * Local mode reorders rows in the component, external mode only reflects sort state and emits intent.
     */
  public declare sortMode: VioletDataGridSortMode;

    /**
     * Column definitions for the grid.
     */
  public declare columns: VioletDataGridColumn[];

    /**
     * Optional persisted width overrides keyed by column identifier.
     */
  public declare columnWidths: Record<string, string>;

    /**
     * Row data for the grid.
     */
  public declare rows: VioletDataGridRow[];

    /**
     * Enables the built-in filter field in the toolbar.
     */
  public declare showFilter: boolean;

    /**
     * Current sort descriptor.
     */
  public declare sort: VioletDataGridSort | null;

    /**
     * Optional built-in filter state.
     */
  public declare filterState: VioletDataGridFilterState;

    /**
     * Controlled or uncontrolled selected row identifiers.
     */
  public declare selectedRowIds: string[];

  public declare presentedColumns: VioletPresentedColumn[];

  public declare presentedRows: VioletPresentedRow[];

  public declare renderedRows: VioletRenderedRow[];

    /**
     * Currently active data cell when cell focus mode is enabled.
     */
  public declare activeCell: VioletDataGridCellLocation | null;

    /**
     * Current rectangular cell selection when range selection is active.
     */
  public declare cellSelection: VioletDataGridCellRange | null;

    /**
     * Cell currently being edited.
     */
  public declare editingCell: VioletDataGridCellLocation | null;

  public declare editingValue: string;

  /** Accessible validation explanation for the active editor. */
  public declare editingError: string;

  /** Visible live feedback for terminal edit lifecycle events. */
  public declare editAnnouncement: string;

  /** Live feedback from the built-in single-pointer fill actions. */
  public declare fillAnnouncement: string;

  public declare fillPreview: VioletDataGridCellRange | null;

    /**
   * Initial row-height estimate used before mounted rows are measured.
   * Defaults to the active density target (24px compact, 32px natural, 44px comfortable).
     */
  public declare estimatedRowHeight: number;

    /**
     * Number of rows to render outside the viewport in virtualized mode.
     */
  public declare overscanCount: number;

  public declare virtualPaddingStart: number;

  public declare virtualPaddingEnd: number;

  public declare virtualTotalSize: number;

  public declare hasToolbarSlotContent: boolean;

    /**
     * Column whose header holds the header row's roving Tab stop in row focus mode.
     * Falls back to the first column while unset or no longer presented.
     */
    public declare headerFocusColumnId: string | null;

    /**
     * True while the select-all checkbox holds the header row's roving Tab stop in row focus mode.
     */
    public declare headerFocusSelection: boolean;

    /**
     * Forwarded `aria-label` from the host element to the semantic table/grid.
     */
    public declare hostAriaLabel: string | null;

    /**
     * Row identifier whose selection cell holds active grid focus in cell focus mode.
     * Kept separate from `activeCell` so `activeCell` always names a data column.
     */
    public declare focusedSelectionRowId: string | null;

    /**
     * Row and optional checkbox column whose control holds the body's roving Tab stop in row mode.
     */
    public declare rowModeFocusRowId: string | null;
    public declare rowModeFocusColumnId: string | null;

    /**
     * Currently mounted row id used for row-mode roving focus fallback under virtualization.
     */
    public declare rowModeMountedRowId: string | null;

    /**
     * True while the cell-mode roving target row is currently mounted in `renderedRows`.
     * Tracked as an observable because `renderedRows` is mutated via `splice`.
     */
    public declare rovingCellMounted: boolean;

    private readonly instanceId = ++violetDataGridInstanceCount;
    readonly #rowVirtualizer: Virtualizer<HTMLDivElement, HTMLTableRowElement>;
    #virtualizerCleanup: (() => void) | null = null;
    #virtualizerFrame: number | null = null;
  #rowMeasurementFrame: number | null = null;
    #pointerSelectionSession: VioletDataGridPointerSelectionSession<VioletDataGridCellLocation> =
        clearedPointerSelectionSession();
    #suppressNextGridClick = false; #editorPointerId: number | null = null;
    readonly #handleEditorPointerEnd = (e: PointerEvent): void => { if (e.pointerId === this.#editorPointerId) this.#editorPointerId = null; };
    #nativeCopyPending = false;
    #fillSession: VioletDataGridFillSession<VioletDataGridCellRange> = clearedFillSession();
    #columnResizeReturnTarget: HTMLElement | null = null;
    #lastCellClickLocation: VioletDataGridCellLocation | null = null;
    #lastCellClickTimestamp = 0;
    #columnResizeSession: VioletDataGridResizeSession = clearedColumnResizeSession();
    #columnResizeHandle: HTMLElement | null = null;
    #measurementCanvas: HTMLCanvasElement | null = null;
  #rowIndexById = new Map<string, number>();
  #columnIndexById = new Map<string, number>();
  #selectedRowIdSet = new Set<string>();
  #columnRevision = 0;
  #rowPresentationCache = new Map<
    string,
    { source: VioletDataGridRow; columnRevision: number; row: VioletPresentedRow }
  >();
  #baseCellsByPresentedRow = new WeakMap<VioletPresentedRow, () => VioletPresentedCell[]>();
  #sortKeyCache = new Map<
    string,
    { source: VioletDataGridRow; column: VioletDataGridColumn; key: string }
  >();
  #decoratedRowCache = new Map<
    string,
    { source: VioletPresentedRow; interactionRevision: number; row: VioletPresentedRow }
  >();
  #presentationRevision = 0;
  #interactionRevision = 0;
  #renderedPresentationRevision = -1;
  #renderedInteractionRevision = -1;
  #automaticEstimatedRowHeight = true;
  #settingAutomaticEstimatedRowHeight = false;
  #editorRecycleInProgress = false;
  #editorRecycleFocusFrame: number | null = null;
  #focusGeneration = 0;
  #gridCellFocusGeneration = 0;
  #selectionControlFocusRevision = 0;
  #cellFocusRecoveryRevision = 0;
  #pendingCellFocusRecovery: PendingCellFocusRecovery | null = null;
  #pendingCellFocusRevision = 0;
  #pendingGridFocus = false;
  #pendingRowModeFocus: { rowId: string; columnId: string | null; focusGeneration: number } | null =
    null;
  #pendingRowModeFocusRevision = 0;
  #managedCustomWidgetTabIndexes = new WeakMap<HTMLElement, string | null>();
  #parkingFocusOnScrollContainer = false;
  #hostAriaObserver: MutationObserver | null = null;
  #editorRestoreFrame: number | null = null;
  #editingEditorElement: VioletCellEditorLike | null = null;
  #nextEditingSessionId = 0;
  #editingSession: VioletDataGridEditingSession | null = null;
  #resolvingEditingSessionId: number | null = null;
  #presentationRetainingSessionId: number | null = null;
  #pendingEditorSelection: {
    sessionId: number;
    start: number;
    end: number;
    direction?: "forward" | "backward" | "none";
  } | null = null;

    public constructor() {
        super();
        this.#internals = this.attachInternals();
        this.selectionMode = "none";
        this.stickyHeader = false;
        this.busy = false;
        this.virtualize = false;
        this.density = "natural";
        this.focusMode = "row";
        this.sortMode = "local";
        this.columns = [];
        this.columnWidths = {};
        this.rows = [];
        this.showFilter = false;
        this.sort = null;
        this.filterState = {};
        this.selectedRowIds = [];
        this.presentedColumns = [];
        this.presentedRows = [];
        this.renderedRows = [];
        this.activeCell = null;
        this.cellSelection = null;
        this.editingCell = null;
        this.editingValue = "";
    this.editingError = "";
    this.editAnnouncement = "";
        this.fillPreview = null;
        this.fillAnnouncement = "";
    this.#settingAutomaticEstimatedRowHeight = true;
    this.estimatedRowHeight = this.rowHeightForDensity(this.density);
    this.#settingAutomaticEstimatedRowHeight = false;
        this.overscanCount = 5;
        this.virtualPaddingStart = 0;
        this.virtualPaddingEnd = 0;
    this.virtualTotalSize = 0;
        this.hasToolbarSlotContent = false;
        this.headerFocusColumnId = null;
        this.headerFocusSelection = false;
        this.hostAriaLabel = null;
        this.focusedSelectionRowId = null;
        this.rowModeFocusRowId = null;
        this.rowModeFocusColumnId = null;
        this.rowModeMountedRowId = null;
        this.rovingCellMounted = false;
        this.#rowVirtualizer = new Virtualizer<HTMLDivElement, HTMLTableRowElement>({
            count: 0,
            getScrollElement: () => this.getScrollContainer(),
            estimateSize: () => this.estimatedRowHeight,
            scrollToFn: elementScroll,
            observeElementRect,
            observeElementOffset,
            overscan: this.overscanCount,
            getItemKey: (index: number) => this.presentedRows[index]?.id ?? index,
            enabled: false,
            onChange: () => {
                this.syncRenderedRows();
            },
        });
    }

  #overlayResizeObserver: ResizeObserver | null = null;
  #overlayResizeFrame: number | null = null;
  #observedOverlayTargets = new Set<Element>();

  readonly #handleViewportResize = (): void => {
    if (this.editingCell) {
      this.positionEditingOverlay();
    }
  };

    public connectedCallback(): void {
    this.hostAriaLabel = this.getAttribute("aria-label");
    this.refreshPresentation();
        super.connectedCallback();
    this.#hostAriaObserver ??= new MutationObserver(() => {
      this.hostAriaLabel = this.getAttribute("aria-label");
    });
    this.#hostAriaObserver.observe(this, {
      attributes: true,
      attributeFilter: ["aria-label"],
    });
    this.ownerDocument.addEventListener("focusin", this.#handleFocusIntent, true);
    this.ownerDocument.addEventListener("pointerdown", this.#handleFocusIntent, true);
    this.ownerDocument.addEventListener("pointerup", this.#handleEditorPointerEnd, true);
    this.ownerDocument.addEventListener("pointercancel", this.#handleEditorPointerEnd, true);
    window.addEventListener("resize", this.#handleViewportResize);
        this.#virtualizerCleanup ??= this.#rowVirtualizer._didMount();
        this.hasToolbarSlotContent = this.querySelector('[slot="toolbar"]') !== null;
        this.syncHostStates();
        this.scheduleVirtualizerUpdate();
    }

    public disconnectedCallback(): void {
    // Consumers commit valid route transitions before detaching listeners.
    // Disconnect is the fail-safe terminal path for anything still active,
    // including invalid drafts that cannot remain in an invisible editor.
    this.cancelActiveEdit();
    this.disconnectOverlayResizeObserver();
    this.#hostAriaObserver?.disconnect();
    this.#hostAriaObserver = null;
    this.ownerDocument.removeEventListener("focusin", this.#handleFocusIntent, true);
    this.ownerDocument.removeEventListener("pointerdown", this.#handleFocusIntent, true);
    this.ownerDocument.removeEventListener("pointerup", this.#handleEditorPointerEnd, true);
    this.ownerDocument.removeEventListener("pointercancel", this.#handleEditorPointerEnd, true);
    this.#editorPointerId = null;
    window.removeEventListener("resize", this.#handleViewportResize);
        if (this.#virtualizerFrame !== null) {
            cancelAnimationFrame(this.#virtualizerFrame);
            this.#virtualizerFrame = null;
        }
    if (this.#editorRecycleFocusFrame !== null) {
      cancelAnimationFrame(this.#editorRecycleFocusFrame);
      this.#editorRecycleFocusFrame = null;
    }
    this.#selectionControlFocusRevision += 1;
    this.#cellFocusRecoveryRevision += 1;
    this.#pendingCellFocusRevision += 1;
    this.#pendingGridFocus = false;
    this.#pendingCellFocusRecovery = null;
    if (this.#editorRestoreFrame !== null) {
      cancelAnimationFrame(this.#editorRestoreFrame);
      this.#editorRestoreFrame = null;
    }
    if (this.#rowMeasurementFrame !== null) {
      cancelAnimationFrame(this.#rowMeasurementFrame);
      this.#rowMeasurementFrame = null;
    }
    this.#rowVirtualizer.measureElement(null);
        this.#virtualizerCleanup?.();
        this.#virtualizerCleanup = null;
        super.disconnectedCallback();
    }

    public selectionModeChanged(): void {
        if (this.selectionMode === "none") {
            this.focusedSelectionRowId = null;
            this.headerFocusSelection = false;
            this.selectedRowIds = [];
            return;
        }

        if (this.selectionMode !== "multiple") {
            this.headerFocusSelection = false;
        }

        if (this.selectionMode === "single" && this.selectedRowIds.length > 1) {
            this.selectedRowIds = this.selectedRowIds.slice(0, 1);
        }

    this.updateInteractionState();
    this.scheduleVirtualizerUpdate();
    }

    public stickyHeaderChanged(): void {
        this.syncHostStates();
    }

    public busyChanged(): void {
        this.syncHostStates();
    }

    public virtualizeChanged(): void {
        this.syncHostStates();
        this.syncRenderedRows();
        this.scheduleVirtualizerUpdate();
    }

    public focusModeChanged(): void {
        this.#pendingRowModeFocus = null;
        if (this.focusMode !== "cell") {
      this.cancelActiveEdit();
            this.focusedSelectionRowId = null;
            this.activeCell = null;
            this.cellSelection = null;
            this.fillPreview = null;
            Updates.enqueue(() => this.syncCustomCellWidgetTabIndexes());
            return;
        }

        this.headerFocusSelection = false;
        if (!this.activeCell && this.presentedRows.length > 0 && this.presentedColumns.length > 0) {
            this.activeCell = this.firstCellLocation();
        }
        Updates.enqueue(() => this.syncCustomCellWidgetTabIndexes());
    }

    public sortModeChanged(): void {
    this.schedulePresentationRefresh();
    }

    public columnsChanged(): void {
    this.captureActiveEditorSelection();
    this.cancelEditIfSourceTargetInvalidated();
    this.#presentationRetainingSessionId = this.#editingSession?.id ?? null;
    this.#columnRevision += 1;
    this.#sortKeyCache.clear();
    this.schedulePresentationRefresh();
    }

    public columnWidthsChanged(): void {
    this.#columnRevision += 1;
    this.schedulePresentationRefresh();
    }

    public rowsChanged(): void {
    if (this.rows.length === 0) {
      this.editAnnouncement = "";
    }
    this.captureActiveEditorSelection();
    this.cancelEditIfSourceTargetInvalidated();
    this.#presentationRetainingSessionId = this.#editingSession?.id ?? null;
    this.#rowPresentationCache.clear();
    this.#sortKeyCache.clear();
    this.schedulePresentationRefresh();
    }

    public showFilterChanged(): void {
    this.syncHostStates();
    }

    public sortChanged(): void {
    this.commitActiveEdit();
        this.clearRangeSelectionState();
    this.schedulePresentationRefresh();
    }

    public selectedRowIdsChanged(): void {
    this.#selectedRowIdSet = new Set(this.selectedRowIds ?? []);
    this.#interactionRevision += 1;
    this.syncRenderedRows();
    }

    public activeCellChanged(): void {
        if (this.focusMode !== "cell") {
            return;
        }

        if (this.activeCell && this.focusedSelectionRowId !== null) {
            this.focusedSelectionRowId = null;
        }

        this.updateInteractionState();
        this.ensureActiveCellVisible();
        this.$emit("active-cell-change", this.activeCell);
    }

    public focusedSelectionRowIdChanged(): void {
        if (this.focusMode !== "cell") {
            return;
        }

        this.updateInteractionState();
        if (this.focusedSelectionRowId) {
            this.ensureRovingRowVisible();
        }
    }

    public cellSelectionChanged(): void {
        if (this.focusMode !== "cell") {
            return;
        }

        this.updateInteractionState();
        this.$emit("cell-selection-change", this.cellSelection);
    }

    public editingCellChanged(): void {
    if (!this.editingCell) {
      this.#editingSession = null;
      this.editingError = "";
    } else if (!this.sameEditingLocation(this.#editingSession?.location, this.editingCell)) {
      this.#editingSession = {
        id: ++this.#nextEditingSessionId,
        location: { ...this.editingCell },
      };
      this.editingError = "";
    }

        this.updateInteractionState();

    if (!this.editingCell || !this.#editingSession) {
      this.disconnectOverlayResizeObserver();
      return;
    }

    this.scheduleEditorRestore(this.#editingSession.id);
    }

    public fillPreviewChanged(): void {
        if (this.focusMode !== "cell") {
            return;
        }

        this.updateInteractionState();
    }

    public estimatedRowHeightChanged(): void {
    if (!this.#settingAutomaticEstimatedRowHeight) {
      this.#automaticEstimatedRowHeight = false;
    }
    this.syncRenderedRows();
    this.scheduleVirtualizerUpdate();
  }

  public densityChanged(): void {
    if (this.#automaticEstimatedRowHeight) {
      this.#settingAutomaticEstimatedRowHeight = true;
      this.estimatedRowHeight = this.rowHeightForDensity(this.density);
      this.#settingAutomaticEstimatedRowHeight = false;
    }

        this.syncRenderedRows();
        this.scheduleVirtualizerUpdate();
        if (this.editingCell) {
          this.scheduleOverlayPosition();
        }
    }

    public overscanCountChanged(): void {
        this.syncRenderedRows();
        this.scheduleVirtualizerUpdate();
    }

    public get hasRows(): boolean {
        return this.presentedRows.length > 0;
    }

    public get columnSpan(): number {
        return this.logicalColumnCount;
  }

  public get logicalRowCount(): number {
    return this.presentedRows.length + 1;
  }

  public get logicalColumnCount(): number {
        return this.presentedColumns.length + (this.selectionMode === "none" ? 0 : 1);
    }

  public get selectionHeaderId(): string {
    return `${this.localName}-selection-header-${this.instanceId}`;
  }

  public columnHeaderIdFor(columnId: string): string {
    return `${this.localName}-header-${this.instanceId}-${this.sanitizeForId(columnId)}`;
  }

    public get filterQuery(): string {
        return this.filterState.query ?? "";
    }

    public get showsBuiltInFilter(): boolean {
        return this.showFilter;
    }

    public get shouldShowToolbar(): boolean {
        return this.focusMode === "cell" || this.showsBuiltInFilter || this.hasToolbarSlotContent;
    }

    public get activeCellLabelId(): string {
        return `${this.localName}-active-cell-${this.instanceId}`;
    }

    public get activeCellDescribeId(): string {
        return `${this.localName}-active-cell-describe-${this.instanceId}`;
    }

    public get activeCellDescribeText(): string {
        if (!this.activeCell || this.focusedSelectionRowId) {
            return "";
        }

        const rowIndex = this.#rowIndexById.get(this.activeCell.rowId) ?? -1;
        return this.columnAccessoryText(
            this.activeCell.columnId,
            this.presentedRows[rowIndex]?.data,
            "describe",
        );
    }

    public columnAriaColIndexFor(columnId: string): number {
        const index = this.#columnIndexById.get(columnId) ?? 0;
        return index + (this.selectionMode === "none" ? 1 : 2);
    }

    public isSelectionCellActive(rowId: string): boolean {
        return (
            this.focusMode === "cell" &&
            this.selectionMode !== "none" &&
            this.focusedSelectionRowId === rowId
        );
    }

    public get hasSelectAllHeaderControl(): boolean {
        return this.selectionMode === "multiple" && this.presentedRows.length > 0;
    }

    public get selectionHeaderCellTabIndex(): string | null {
        return this.focusMode === "cell" && this.selectionMode === "single" ? "-1" : null;
    }

    public get selectAllTabIndex(): string {
        if (this.focusMode === "cell") {
            return "-1";
        }
        return this.headerFocusSelection && this.hasSelectAllHeaderControl ? "0" : "-1";
    }

    public override focus(options?: FocusOptions): void {
        this.#focusGeneration += 1;
        if (this.focusMode === "cell") {
            if (
                !this.focusedSelectionRowId &&
                !this.activeCell &&
                this.presentedRows.length > 0 &&
                this.presentedColumns.length > 0
            ) {
                this.activeCell = this.firstCellLocation();
            }
            if (this.focusActiveCell({ preventScroll: options?.preventScroll ?? false })) {
                return;
            }
        }
        super.focus(options);
    }

    public get scrollContainerTabIndex(): string {
        if (this.focusMode !== "cell" || this.presentedRows.length === 0) {
            return "-1";
        }

        const target = this.rovingCellTarget();
        if (!target) {
            return "-1";
        }

        return this.rovingCellMounted ? "-1" : "0";
    }

    public selectionCellTabIndexFor(rowId: string): string | null {
        if (this.focusMode !== "cell" || this.selectionMode === "none") {
            return null;
        }

        const target = this.rovingCellTarget();
        return target?.kind === "selection" && target.rowId === rowId ? "0" : "-1";
    }

    public cellTabIndexFor(rowId: string, columnId: string): string | null {
        if (this.focusMode !== "cell") {
            return null;
        }

        const target = this.rovingCellTarget();
        return target?.kind === "data" && target.rowId === rowId && target.columnId === columnId
            ? "0"
            : "-1";
    }

    public cellAriaSelectedFor(cell: VioletPresentedCell): string | null {
        if (this.focusMode !== "cell") {
            return null;
        }

        if (cell.selected) {
            return "true";
        }

        return this.cellSelection ? "false" : null;
    }

    public cellAriaDescribedByFor(cell: VioletPresentedCell): string | null {
        if (this.focusMode !== "cell" || !cell.active) {
            return null;
        }

        return this.activeCellDescribeText ? this.activeCellDescribeId : null;
    }

    public rowSelectionControlTabIndexFor(rowId: string): number {
        if (this.focusMode !== "row") {
            return -1;
        }

        const target = this.resolveRowModeBodyTarget();
        return target && target.rowId === rowId && target.columnId === null ? 0 : -1;
    }

    public cellCheckboxTabIndexFor(rowId: string, columnId: string): number {
        if (this.focusMode !== "row") {
            return -1;
        }

        const target = this.resolveRowModeBodyTarget();
        return target && target.rowId === rowId && target.columnId === columnId ? 0 : -1;
    }

    private rovingCellTarget():
        | { kind: "selection"; rowId: string }
        | { kind: "data"; rowId: string; columnId: string }
        | null {
        if (this.focusMode !== "cell" || this.presentedRows.length === 0) {
            return null;
        }

        if (
            this.selectionMode !== "none" &&
            this.focusedSelectionRowId &&
            this.#rowIndexById.has(this.focusedSelectionRowId)
        ) {
            return { kind: "selection", rowId: this.focusedSelectionRowId };
        }

        if (this.activeCell && this.isValidCellLocation(this.activeCell)) {
            return {
                kind: "data",
                rowId: this.activeCell.rowId,
                columnId: this.activeCell.columnId,
            };
        }

        const first = this.firstCellLocation();
        return first ? { kind: "data", rowId: first.rowId, columnId: first.columnId } : null;
    }

    private rowModeInteractiveColumns(): Array<string | null> {
        const columns: Array<string | null> = [];
        if (this.selectionMode !== "none") {
            columns.push(null);
        }
        for (const column of this.presentedColumns) {
            if (column.source.editor === "checkbox" && column.source.editable) {
                columns.push(column.id);
            }
        }
        return columns;
    }

    private resolveRowModeBodyTarget(): { rowId: string; columnId: string | null } | null {
        if (this.focusMode !== "row" || this.presentedRows.length === 0) {
            return null;
        }

        const columns = this.rowModeInteractiveColumns();
        if (columns.length === 0) {
            return null;
        }

        const preferredRowId =
            this.rowModeFocusRowId && this.#rowIndexById.has(this.rowModeFocusRowId)
                ? this.rowModeFocusRowId
                : this.presentedRows[0]!.id;
        const rowId =
            this.virtualize && this.rowModeMountedRowId && this.#rowIndexById.has(this.rowModeMountedRowId)
                ? this.rowModeMountedRowId
                : preferredRowId;
        const columnId = columns.includes(this.rowModeFocusColumnId)
            ? this.rowModeFocusColumnId
            : columns[0]!;
        return { rowId, columnId };
    }

    public get activeCellDescription(): string {
        if (!this.activeCell) {
            return "No active cell.";
        }

    const rowIndex = this.#rowIndexById.get(this.activeCell.rowId) ?? -1;
    const columnIndex = this.#columnIndexById.get(this.activeCell.columnId) ?? -1;
        const columnLabel = this.presentedColumns[columnIndex]?.label ?? this.activeCell.columnId;
        const cellText = this.cellTextAt(this.activeCell) || "empty";
        const description = this.columnAccessoryText(
            this.activeCell.columnId,
            this.presentedRows[rowIndex]?.data,
            "describe",
        );

        return `Active cell row ${rowIndex + 1}, column ${columnLabel}, value ${cellText}${description ? `, ${description}` : ""}.`;
    }

    public get rowSummary(): string {
        const totalRows = this.presentedRows.length;
    const selectedRows = this.selectedRowIds.filter((id) => this.#rowIndexById.has(id)).length;

        if (this.selectionMode === "none") {
            return `${totalRows} row${totalRows === 1 ? "" : "s"}`;
        }

        return `${selectedRows} selected / ${totalRows} row${totalRows === 1 ? "" : "s"}`;
    }

    public get selectionHeaderLabel(): string {
        if (this.selectionMode === "multiple") {
            return "Select rows";
        }

        // Named for what its radios do ("Open"), the same verb that begins each radio's name.
        return this.selectionLabel?.trim() || "Selected row";
    }

    public get selectionControlName(): string {
        return `${this.localName}-selection-${this.instanceId}`;
    }

    public get allRowsSelected(): boolean {
    const selectedRowIds = this.selectedRowIds ?? [];
    return (
      this.hasRows &&
      selectedRowIds.length >= this.presentedRows.length &&
      this.presentedRows.every((row) => this.#selectedRowIdSet.has(row.id))
    );
    }

    public get partiallySelected(): boolean {
    const selectedRowIds = this.selectedRowIds ?? [];
    if (selectedRowIds.length === 0) {
      return false;
    }

    const selectedCount = this.presentedRows.filter((row) =>
      this.#selectedRowIdSet.has(row.id),
    ).length;
        return selectedCount > 0 && selectedCount < this.presentedRows.length;
    }

    public sortStateFor(columnId: string): string {
        if (!this.sort || this.sort.columnId !== columnId) {
            return "none";
        }

        return this.sort.direction;
    }

    public sortDirectionFor(columnId: string): string {
        if (!this.sort || this.sort.columnId !== columnId) {
            return "ascending";
        }

        return this.sort.direction;
    }

    public isSortedColumn(columnId: string): boolean {
        return this.sort?.columnId === columnId;
    }

    public sortIconNameFor(columnId: string): string {
        return this.sortDirectionFor(columnId) === "descending"
            ? "system/sort-descending"
            : "system/sort-ascending";
    }

    public isRowSelected(rowId: string): boolean {
    return this.#selectedRowIdSet.has(rowId);
    }

    public selectionLabelFor(rowId: string, rowLabel?: string): string {
        const name = rowLabel?.trim() || rowId;
        const verb = this.selectionLabel?.trim();
        if (verb && this.selectionMode === "single") {
            return `${verb} ${name}`;
        }
        return `Select row ${name}`;
    }

    public handleToolbarSlotChange(event: Event): void {
        const slot = event.target as HTMLSlotElement | null;
        this.hasToolbarSlotContent = Boolean(slot?.assignedNodes({ flatten: true }).length);
    }

    public handleFilterInput(event: Event): void {
    const input = event.currentTarget as VioletTextFieldLike | null;
    if (this.editingCell && !this.commitActiveEdit()) {
      if (input) {
        input.value = this.filterState.query ?? "";
      }
      this.refocusActiveEditor();
      return;
    }
        const nextState: VioletDataGridFilterState = {
            ...this.filterState,
            query: input?.value ?? "",
        };

        this.clearRangeSelectionState();
        this.filterState = nextState;
        this.$emit("filter-change", nextState);
    }

    public handleSelectionControlPointerDown(event: PointerEvent): void {
        event.stopPropagation();
    }

    public handleSelectionControlClick(event: Event): void {
        event.stopPropagation();
    }

    public handleToggleAllCheckboxClick(event: Event): void {
        event.stopPropagation();
        const checkbox = event.currentTarget as VioletCheckboxLike | null;
        const nextChecked = !this.allRowsSelected;

        if (checkbox) {
            checkbox.checked = nextChecked;
            if ("indeterminate" in checkbox) {
                checkbox.indeterminate = false;
            }
        }

    this.updateSelection(nextChecked ? this.presentedRows.map((row) => row.id) : []);
    }

    public handleRowCheckboxClick(rowId: string, event: Event): void {
        event.stopPropagation();
        const checkbox = event.currentTarget as VioletCheckboxLike | null;
        const nextChecked = !(checkbox?.checked ?? false);

        if (checkbox) {
            checkbox.checked = nextChecked;
            if ("indeterminate" in checkbox) {
                checkbox.indeterminate = false;
            }
        }

        const current = new Set(this.selectedRowIds);
        if (nextChecked) {
            current.add(rowId);
        } else {
            current.delete(rowId);
        }

        this.updateSelection([...current]);
    }

    public handleCellCheckboxClick(rowId: string, columnId: string, event: Event): void {
        event.stopPropagation();

        const location = { rowId, columnId };
    if (
      this.editingCell &&
      !this.sameEditingLocation(this.editingCell, location) &&
      !this.commitActiveEdit()
    ) {
      this.refocusActiveEditor();
      return;
    }
        const cell = this.presentedCellAt(location);
        if (!cell?.editable || cell.editor !== "checkbox") {
            return;
        }

        const checkbox = event.currentTarget as VioletCheckboxLike | null;
        const nextChecked = !this.booleanCellValue(cell.rawValue);

        if (checkbox) {
            checkbox.checked = nextChecked;
            if ("indeterminate" in checkbox) {
                checkbox.indeterminate = false;
            }
        }

        this.commitCheckboxCellToggle(location, nextChecked);
    }

    public handleGridFocus(event?: FocusEvent): void {
        if (this.focusMode !== "cell" || this.#parkingFocusOnScrollContainer) {
            return;
        }

        if (event && event.target !== this.getScrollContainer()) {
            return;
        }

        if (
            !this.focusedSelectionRowId &&
            !this.activeCell &&
            this.presentedRows.length > 0 &&
            this.presentedColumns.length > 0
        ) {
            this.activeCell = this.firstCellLocation();
        }

        if (this.focusActiveCell({ preventScroll: true })) {
            return;
        }
    }

    public handleGridFocusIn(event: FocusEvent): void {
        const self = this;
        handleGridFocusInEvent(
            {
                focusMode: this.focusMode,
                editingCell: this.editingCell,
                activeCell: this.activeCell,
                get focusedSelectionRowId() {
                    return self.focusedSelectionRowId;
                },
                set focusedSelectionRowId(value) {
                    self.focusedSelectionRowId = value;
                },
                get rowModeFocusRowId() {
                    return self.rowModeFocusRowId;
                },
                set rowModeFocusRowId(value) {
                    self.rowModeFocusRowId = value;
                },
                get rowModeFocusColumnId() {
                    return self.rowModeFocusColumnId;
                },
                set rowModeFocusColumnId(value) {
                    self.rowModeFocusColumnId = value;
                },
                setActiveCellDirect: (location) => {
                    this.activeCell = location;
                },
                setFocusedSelectionRow: (rowId) => this.setFocusedSelectionRow(rowId),
                sameEditingLocation: (left, right) => this.sameEditingLocation(left, right),
                selectionControlRowId: (el) => this.selectionControlRowId(el),
            },
            event,
        );
    }

    /**
     * Returns true to let the browser perform the key's default action.
     *
     * FAST cancels the default action of any `@event` binding whose expression
     * does not return exactly `true` (`HTMLBindingDirective.handleEvent`). A
     * `void` return therefore cancels every keystroke, including characters and
     * Backspace typed into an open cell editor. Return false only for keys this
     * handler consumes.
     */
    public handleGridKeydown(event: KeyboardEvent): boolean {
        return handleGridKeydownEvent(
            {
                element: this,
                focusMode: this.focusMode,
                selectionMode: this.selectionMode,
                activeCell: this.activeCell,
                focusedSelectionRowId: this.focusedSelectionRowId,
                presentedRows: this.presentedRows,
                shadowActiveElement: this.shadowRoot?.activeElement ?? null,
                handleRowModeBodyKeydown: (e) => this.handleRowModeBodyKeydown(e),
                isEditorElement: (target) => this.isEditorElement(target),
                commitActiveEdit: () => this.commitActiveEdit(),
                focusActiveCell: (options) => this.focusActiveCell(options),
                refocusActiveEditor: () => this.refocusActiveEditor(),
                commitEditingCellAndMove: (step) => this.commitEditingCellAndMove(step),
                cancelActiveEdit: () => this.cancelActiveEdit(),
                customCellWidgetFromTarget: (target) => this.customCellWidgetFromTarget(target),
                handleCustomCellWidgetKeydown: (widget, e) => this.handleCustomCellWidgetKeydown(widget, e),
                getScrollContainer: () => this.getScrollContainer(),
                handleSelectionCellKeydown: (e, target, move) =>
                    this.handleSelectionCellKeydown(e, target, move),
                focusColumnResizer: (columnId, returnTarget) =>
                    this.focusColumnResizer(columnId, returnTarget),
                getActiveGridCellElement: () => this.getActiveGridCellElement(),
                scheduleNativeCopyFallback: () => {
                    this.#nativeCopyPending = true;
                    setTimeout(() => {
                        if (!this.#nativeCopyPending) {
                            return;
                        }
                        this.#nativeCopyPending = false;
                        void this.handleCopyRequest();
                    }, 0);
                },
                presentedCellAt: (location) => this.presentedCellAt(location),
                booleanCellValue: (value) => this.booleanCellValue(value),
                commitCheckboxCellToggle: (location, checked) =>
                    this.commitCheckboxCellToggle(location, checked),
                getActiveCellElement: () => this.getActiveCellElement(),
                customCellWidgetsInCell: (cell) => this.customCellWidgetsInCell(cell),
                startEditingCell: (location) => this.startEditingCell(location),
                columnHeaderFocusTargetFor: (columnId) => this.columnHeaderFocusTargetFor(columnId),
                columnIndexForId: (columnId) => this.#columnIndexById.get(columnId) ?? -1,
                setFocusedSelectionRow: (rowId) => this.setFocusedSelectionRow(rowId),
                nextCellLocationForKey: (e, key) => this.nextCellLocationForKey(e, key),
                setActiveCell: (location, options) => this.setActiveCell(location, options),
            },
            event,
        );
    }

    public handleGridClick(event: Event): boolean {
        const self = this;
        return handleGridClickEvent(
            {
                focusMode: this.focusMode,
                get editingCell() { return self.editingCell; },
                get activeCell() { return self.activeCell; },
                get suppressNextGridClick() { return self.#suppressNextGridClick; },
                set suppressNextGridClick(v) { self.#suppressNextGridClick = v; },
                get lastCellClickLocation() { return self.#lastCellClickLocation; },
                set lastCellClickLocation(v) { self.#lastCellClickLocation = v; },
                get lastCellClickTimestamp() { return self.#lastCellClickTimestamp; },
                set lastCellClickTimestamp(v) { self.#lastCellClickTimestamp = v; },
                isEditorEvent: (e) => this.isEditorEvent(e),
                isEditorElement: (t) => this.isEditorElement(t),
                isInteractiveCellWidgetEvent: (e) => this.isInteractiveCellWidgetEvent(e),
                isInteractiveCellWidgetTarget: (t) => this.isInteractiveCellWidgetTarget(t),
                commitActiveEdit: () => this.commitActiveEdit(),
                refocusActiveEditor: () => this.refocusActiveEditor(),
                setFocusedSelectionRow: (rowId) => this.setFocusedSelectionRow(rowId),
                focusActiveCell: (options) => this.focusActiveCell(options),
                locationFromMouseEvent: (e) => this.locationFromMouseEvent(e),
                locationFromEvent: (e) => this.locationFromEvent(e),
                locationFromTarget: (t) => this.locationFromTarget(t),
                presentedCellAt: (loc) => this.presentedCellAt(loc),
                startEditingCell: (loc) => this.startEditingCell(loc),
                sameEditingLocation: (l, r) => this.sameEditingLocation(l, r),
                opensOnSingleActiveClick: (ed) => this.opensOnSingleActiveClick(ed),
                handleCellPointerActivate: (r, c, s) => this.handleCellPointerActivate(r, c, s),
            },
            event,
        );
    }

    public handleGridDoubleClick(event: MouseEvent): boolean {
        if (this.focusMode !== "cell") {
            return true;
        }

        const target = event.target as HTMLElement | null;
        if (
            (!target && !this.locationFromEvent(event)) ||
            this.isEditorEvent(event) ||
            this.isEditorElement(target) ||
      this.isInteractiveCellWidgetEvent(event) ||
      this.isInteractiveCellWidgetTarget(target) ||
            this.isFillHandleEvent(event) ||
            this.isFillHandleTarget(target)
        ) {
            return true;
        }

        const location =
            this.locationFromMouseEvent(event) ??
            this.locationFromEvent(event) ??
            this.locationFromTarget(target);
        if (!location) {
            if (this.activeCell) {
                const activeCell = this.presentedCellAt(this.activeCell);
                if (activeCell?.editable && activeCell.editor !== "checkbox") {
                    event.preventDefault();
                    this.startEditingCell(this.activeCell);
                    return false;
                }
            }
            return true;
        }

        const cell = this.presentedCellAt(location);
        if (cell?.editor === "checkbox") {
            return true;
        }

        event.preventDefault();
        this.handleCellPointerActivate(location.rowId, location.columnId, false);
        this.startEditingCell(location);
        return false;
    }

    public handleGridPointerDown(event: PointerEvent): boolean {
        if (this.isEditorEvent(event) || this.isEditorElement(event.target)) {
            this.#editorPointerId = event.pointerId;
            return true;
        }
        if (
            this.focusMode !== "cell" ||
            event.button !== 0 ||
            this.isInteractiveCellWidgetEvent(event) ||
            this.isInteractiveCellWidgetTarget(event.target)
        ) {
            return true;
        }

        if (event.shiftKey) {
            const location = this.locationFromEvent(event) ?? this.locationFromTarget(event.target);
            if (location) {
                // Keep browser mousedown focus from firing focusin and overwriting `activeCell`
                // before `handleGridClick` extends the range from the previous anchor.
                event.preventDefault();
                return false;
            }
            return true;
        }

        if (this.isFillHandleEvent(event) || this.isFillHandleTarget(event.target)) {
            this.beginFillDrag(event);
            return false;
        }
        const location = this.locationFromEvent(event) ?? this.locationFromTarget(event.target);
        if (!location) return true;

        const scrollContainer = this.getScrollContainer();

        this.#pointerSelectionSession = startPointerSelectionSession(event.pointerId, location);
        this.setActiveCell(location);
        this.focusActiveCell({ preventScroll: true });
        try {
            scrollContainer?.setPointerCapture(event.pointerId);
        } catch {
            // Synthetic Storybook pointer events do not always create a capturable pointer.
        }
        event.preventDefault();
        return false;
    }

    public handleGridPointerMove(event: PointerEvent): void {
        if (isFillPointerEventForSession(this.#fillSession, event.pointerId)) {
            this.handleFillPointerMove(event);
            return;
        }

        const session = this.#pointerSelectionSession;
    if (this.focusMode !== "cell" || !isPointerSelectionEventForSession(session, event.pointerId)) {
            return;
        }

        const location = this.locationFromPointerEvent(event);
        if (!location) {
            return;
        }

        const anchor = session.anchor;
        if (!anchor) {
            return;
        }

        const currentFocus = this.cellSelection?.focus ?? anchor;
        if (currentFocus.rowId === location.rowId && currentFocus.columnId === location.columnId) {
            return;
        }

        this.#pointerSelectionSession = markPointerSelectionMoved(session);
        this.cellSelection = this.createCellSelection(anchor, location);
        this.updateInteractionState();
    }

    public handleGridPointerUp(event: PointerEvent): void {
        if (isFillPointerEventForSession(this.#fillSession, event.pointerId)) {
            if (event.isTrusted && (event.clientX || event.clientY)) this.handleFillPointerMove(event);
            this.handleFillPointerUp();
            return;
        }

        if (!isPointerSelectionEventForSession(this.#pointerSelectionSession, event.pointerId)) {
            return;
        }

        this.endPointerSelection(true);
    }

    public handleGridPointerCancel(event: PointerEvent): void {
        if (isFillPointerEventForSession(this.#fillSession, event.pointerId)) {
            this.endFillDrag(false);
            return;
        }

        if (!isPointerSelectionEventForSession(this.#pointerSelectionSession, event.pointerId)) {
            return;
        }

        this.endPointerSelection(false);
    }

    public handleGridInput(event: Event): void {
        const target = event.target as HTMLElement | null;
        if (!this.isEditorElement(target) || !this.editingCell) {
            return;
        }

        this.editingValue = this.editorValueFromTarget(target);
    if (this.editingError) {
      this.editingError = "";
      this.updateInteractionState();
      this.scheduleEditorRestore(this.#editingSession?.id ?? null);
    }
    }

    public handleGridChange(event: Event): void {
        const target = event.target as HTMLElement | null;

        if (this.isEditorElement(target) && this.editingCell) {
            this.editingValue = this.editorValueFromTarget(target);
            const cell = this.presentedCellAt(this.editingCell);
            if (cell?.editor === "select" || target.dataset.commitOnChange === "true") {
        if (this.commitActiveEdit()) {
                this.focusActiveCell({ preventScroll: true });
        } else {
          this.refocusActiveEditor();
        }
            }
            return;
        }
    }

    public handleGridPaste(event: ClipboardEvent): boolean {
    if (
      this.focusMode !== "cell" ||
      this.focusedSelectionRowId !== null ||
      this.isEditorEvent(event) ||
      this.isEditorElement(event.target) ||
      this.isInteractiveCellWidgetEvent(event) ||
      this.isInteractiveCellWidgetTarget(event.target)
    ) {
            return true;
        }

        const text = event.clipboardData?.getData("text/plain") ?? "";
        const detail = this.pasteDetailForText(text);
        if (!detail) {
            return true;
        }

        event.preventDefault();
        this.$emit("cell-paste", detail);
        return false;
    }

    public handleGridFocusOut(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        if (!this.isEditorElement(target)) {
            return;
        }
    const sessionId = this.#editingSession?.id ?? null;
    const relatedTarget = (event as FocusEvent).relatedTarget;
    if (this.isTargetWithinEditingOwnership(relatedTarget) || (this.#editorPointerId !== null && (!relatedTarget || relatedTarget === this.getScrollContainer()))) {
      return;
    }
    // A concrete outside target is an intentional focus transfer. Resolve it
    // before a pending row refresh can mistake the departure for DOM recycling.
    if (relatedTarget) {
      if (!this.commitActiveEdit()) {
        this.refocusActiveEditor();
      }
      return;
    }
    if (sessionId && this.#presentationRetainingSessionId === sessionId) {
      this.captureEditorSelection(target, sessionId);
      this.scheduleEditorRestore(sessionId, true);
      return;
    }

        requestAnimationFrame(() => {
      if (!this.editingCell || !sessionId || this.#editingSession?.id !== sessionId) {
                return;
            }

            const currentEditor = this.getActiveEditorElement();
      if (currentEditor && currentEditor !== target) {
        seedEditorValue(currentEditor, this.editingValue);
        this.restoreEditorSelection(currentEditor, sessionId);
        return;
      }

      if (
        this.#presentationRetainingSessionId === sessionId &&
        currentEditor !== target &&
        this.presentedCellAt(this.#editingSession.location)?.editable
      ) {
        this.captureEditorSelection(target, sessionId);
        this.scheduleEditorRestore(sessionId, true);
        return;
      }

            if (this.#editorPointerId !== null || currentEditor?.matches?.(":focus-within") || (currentEditor as { open?: boolean } | null)?.open) {
                return;
            }

      const editorShadowActiveElement = (
        currentEditor as (HTMLElement & { shadowRoot?: ShadowRoot | null }) | null
      )?.shadowRoot?.activeElement;
            if (editorShadowActiveElement) {
                return;
            }

            const activeElement = this.shadowRoot?.activeElement as Element | null;
            if (activeElement && this.isEditorElement(activeElement)) {
                return;
            }

      if (!this.commitActiveEdit()) {
        this.refocusActiveEditor();
      }
        });
    }

    public async handleCopyRequest(): Promise<void> {
        if (this.focusedSelectionRowId !== null) {
            return;
        }
        const detail = this.copyDetailForCurrentSelection();
        if (!detail) {
            return;
        }

        this.$emit("cell-copy", detail);

        const clipboard = globalThis.navigator?.clipboard;
        if (!clipboard?.writeText) {
            this.$emit("cell-copy-error", { ...detail, error: new Error("Clipboard API is unavailable.") });
            return;
        }

        try {
            await clipboard.writeText(detail.text);
        } catch (error) {
            this.$emit("cell-copy-error", { ...detail, error });
        }
    }

    /** Handles the native `copy` event, writing TSV through `clipboardData`. */
    public handleGridCopy(event: ClipboardEvent): boolean {
        if (
            this.focusMode !== "cell" ||
            this.focusedSelectionRowId !== null ||
            this.isEditorEvent(event) ||
            this.isEditorElement(event.target) ||
            this.isInteractiveCellWidgetEvent(event) ||
            this.isInteractiveCellWidgetTarget(event.target)
        ) {
            return true;
        }

        this.#nativeCopyPending = false;
        const detail = this.copyDetailForCurrentSelection();
        if (!detail || !event.clipboardData) {
            return true;
        }

        event.clipboardData.setData("text/plain", detail.text);
        event.preventDefault();
        this.$emit("cell-copy", detail);
        return false;
    }

    public handleSortRequest(columnId: string): void {
    if (this.editingCell && !this.commitActiveEdit()) {
      this.refocusActiveEditor();
      return;
    }
        const currentDirection = this.sort?.columnId === columnId ? this.sort.direction : null;
        let nextSort: VioletDataGridSort | null;

        if (currentDirection === null) {
            nextSort = { columnId, direction: "ascending" };
        } else if (currentDirection === "ascending") {
            nextSort = { columnId, direction: "descending" };
        } else {
            nextSort = null;
        }

        this.sort = nextSort;
        this.$emit("sort-change", nextSort);
    }

    public handleColumnResizePointerDown(columnId: string, event: PointerEvent): void {
        const session = startColumnResizeSession({
            button: event.button,
            pointerId: event.pointerId,
            columnId,
            clientX: event.clientX,
            startWidth: this.renderedColumnWidth(columnId),
        });

        if (!session) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const handle = event.currentTarget as HTMLElement | null;
        this.#columnResizeSession = session;
        this.#columnResizeHandle = handle;

        try {
            handle?.setPointerCapture(event.pointerId);
        } catch {
            // Ignore capture failures for synthetic Storybook pointer events.
        }
    }

    public handleColumnResizePointerMove(event: PointerEvent): void {
        const session = this.#columnResizeSession;
        if (!isColumnResizeEventForSession(session, event.pointerId) || !session.columnId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const width = computeResizedColumnWidth({
            session,
            clientX: event.clientX,
            minimumWidth: this.minimumColumnWidth(session.columnId),
        });

        this.applyLiveColumnWidth(session.columnId, `${width}px`);
    }

    public handleColumnResizePointerUp(event: PointerEvent): void {
        const session = this.#columnResizeSession;
        if (!isColumnResizeEventForSession(session, event.pointerId) || !session.columnId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const width = computeResizedColumnWidth({
            session,
            clientX: event.clientX,
            minimumWidth: this.minimumColumnWidth(session.columnId),
        });

        this.commitColumnWidth(session.columnId, `${width}px`);
        this.endColumnResize();
    }

    public handleColumnResizePointerCancel(event: PointerEvent): void {
        const session = this.#columnResizeSession;
        if (!isColumnResizeEventForSession(session, event.pointerId) || !session.columnId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        this.applyLiveColumnWidth(session.columnId, this.resolvedColumnWidth(session.columnId));
        this.endColumnResize();
    }

    public handleColumnResizeKeyDown(columnId: string, event: KeyboardEvent): boolean {
        return handleColumnResizeKeyDownEvent(
            {
                element: this,
                returnFocusFromColumnResizer: (id) => this.returnFocusFromColumnResizer(id),
                handleColumnResizeDoubleClick: (id, e) => this.handleColumnResizeDoubleClick(id, e),
                resolvedColumnWidth: (id) => this.resolvedColumnWidth(id),
                renderedColumnWidth: (id) => this.renderedColumnWidth(id),
                minimumColumnWidth: (id) => this.minimumColumnWidth(id),
                applyLiveColumnWidth: (id, w) => this.applyLiveColumnWidth(id, w),
                commitColumnWidth: (id, w) => this.commitColumnWidth(id, w),
            },
            columnId,
            event,
        );
    }

    /**
     * Tab index for a column header's focus target: its sort button, or the header cell when it is not
     * sortable. Row focus mode keeps one header in the tab order; cell focus mode keeps none, because the
     * grid itself is the Tab stop.
     */
    public columnHeaderTabIndexFor(columnId: string): string {
        if (this.focusMode === "cell") {
            return "-1";
        }

        if (this.headerFocusSelection && this.hasSelectAllHeaderControl) {
            return "-1";
        }

        const columns = this.presentedColumns;
        const tabStopColumnId = columns.some((column) => column.id === this.headerFocusColumnId)
            ? this.headerFocusColumnId
            : columns[0]?.id;
        return columnId === tabStopColumnId ? "0" : "-1";
    }

    public handleSelectionHeaderFocus(event: FocusEvent): void {
        if (this.hasSelectAllHeaderControl && event.target === this.selectionHeaderFocusTarget()) {
            this.headerFocusSelection = true;
        }
    }

    private headerKeyboardHost(): HeaderKeyboardHost {
        return {
            element: this,
            focusMode: this.focusMode,
            presentedColumns: this.presentedColumns,
            presentedRows: this.presentedRows,
            selectionHeaderFocusTarget: () => this.selectionHeaderFocusTarget(),
            columnHeaderFocusTargetFor: (columnId) => this.columnHeaderFocusTargetFor(columnId),
            focusColumnResizer: (columnId, returnTarget) =>
                this.focusColumnResizer(columnId, returnTarget),
            temporarilySuspendRovingCellTabStop: () => this.temporarilySuspendRovingCellTabStop(),
            focusActiveCell: (options) => this.focusActiveCell(options),
            setFocusedSelectionRow: (rowId) => this.setFocusedSelectionRow(rowId),
            focusFirstRowFromHeader: (columnId, event) =>
                this.focusFirstRowFromHeader(columnId, event),
        };
    }

    public handleSelectionHeaderKeydown(event: KeyboardEvent): boolean {
        return handleSelectionHeaderKeydownEvent(this.headerKeyboardHost(), event);
    }

    public handleColumnHeaderFocus(columnId: string, event: FocusEvent): void {
        if (event.target === this.columnHeaderFocusTargetFor(columnId)) {
            this.headerFocusSelection = false;
            this.headerFocusColumnId = columnId;
        }
    }

    /**
     * Handles keydown on a column header: the arrow keys, Home and End move between headers, ArrowDown
     * returns to the first row in cell focus mode, Shift+Tab returns to the active cell in cell focus mode,
     * and Ctrl+Alt+R moves focus to the column's resizer. Enter and Space reach the sort button natively.
     */
    public handleColumnHeaderKeydown(columnId: string, event: KeyboardEvent): boolean {
        return handleColumnHeaderKeydownEvent(this.headerKeyboardHost(), columnId, event);
    }

    public handleColumnResizeDoubleClick(columnId: string, event: Event): void {
        event.preventDefault();
        event.stopPropagation();

        const width = `${this.autosizedColumnWidth(columnId)}px`;
        this.applyLiveColumnWidth(columnId, width);
        this.commitColumnWidth(columnId, width);
    }

    private columnResizerFor(columnId: string): HTMLButtonElement | null {
        return (
            this.shadowRoot?.querySelector<HTMLButtonElement>(
                `[data-column-resizer="${CSS.escape(columnId)}"]`,
            ) ?? null
        );
    }

    /**
     * The element that takes focus for a column header: its sort button, or the header cell itself.
     */
    private columnHeaderFocusTargetFor(columnId: string): HTMLElement | null {
        const header = this.shadowRoot?.querySelector<HTMLTableCellElement>(
            `th[data-column-id="${CSS.escape(columnId)}"]`,
        );
        if (!header) {
            return null;
        }

        return header.querySelector<HTMLElement>(".header-button") ?? header;
    }

    private selectionHeaderFocusTarget(): HTMLElement | null {
        if (this.hasSelectAllHeaderControl) {
            return (
                this.shadowRoot?.querySelector<HTMLElement>(
                    "th.selection-header violet-checkbox.selection-checkbox",
                ) ?? null
            );
        }

        if (this.focusMode === "cell" && this.selectionMode === "single") {
            return this.shadowRoot?.querySelector<HTMLElement>("th.selection-header") ?? null;
        }

        return null;
    }

    private focusFirstRowFromHeader(columnId: string, event: KeyboardEvent): boolean {
        const rowId = this.presentedRows[0]?.id;
        if (this.focusMode !== "cell" || !rowId) {
            return true;
        }

        event.preventDefault();
        this.focusedSelectionRowId = null;
        this.setActiveCell({ rowId, columnId });
        this.focusActiveCell({ preventScroll: true });
        return false;
    }

    private focusColumnResizer(columnId: string, returnTarget: HTMLElement | null): boolean {
        const resizer = this.columnResizerFor(columnId);
        if (!resizer) {
            return false;
        }

        this.#columnResizeReturnTarget = returnTarget;
        resizer.focus();
        return true;
    }

    private returnFocusFromColumnResizer(columnId: string): void {
        const returnTarget = this.#columnResizeReturnTarget;
        this.#columnResizeReturnTarget = null;
        const fallback = this.columnHeaderFocusTargetFor(columnId) ?? this.getScrollContainer();
        (returnTarget?.isConnected ? returnTarget : fallback)?.focus({ preventScroll: true });
    }

    public handleToggleAll(event: Event): void {
        const input = event.currentTarget as VioletCheckboxLike | null;
    const nextSelected = input?.checked ? this.presentedRows.map((row) => row.id) : [];
        this.updateSelection(nextSelected);
    }

    public handleRowSelection(rowId: string, event: Event): void {
        if (this.selectionMode === "none") {
            return;
        }

        const input = event.currentTarget as HTMLInputElement | VioletCheckboxLike | null;
        const checked = Boolean(input?.checked);

        if (this.selectionMode === "single") {
            this.updateSelection(checked ? [rowId] : []);
            return;
        }

        const current = new Set(this.selectedRowIds);
        if (checked) {
            current.add(rowId);
        } else {
            current.delete(rowId);
        }
        this.updateSelection([...current]);
    }

    public handleCellPointerActivate(rowId: string, columnId: string, extendRange = false): void {
        if (this.focusMode !== "cell") {
            return;
        }

        this.editAnnouncement = "";
        this.fillAnnouncement = "";
        this.focusedSelectionRowId = null;
        this.setActiveCell({ rowId, columnId }, { extendRange });
        this.focusActiveCell({ preventScroll: true });
    }

    private updateSelection(nextSelectedRowIds: string[]): void {
        const uniqueSelected = [...new Set(nextSelectedRowIds)];
        this.selectedRowIds = uniqueSelected;
        this.$emit("selection-change", { selectedRowIds: uniqueSelected });
    }

    private clearRangeSelectionState(): void {
        // Row selection is keyed by row id, so it intentionally survives sort and
        // filter changes; only the positional range/fill state is reset here.
        if (this.cellSelection) {
            this.cellSelection = null;
        }

        if (this.fillPreview) {
            this.fillPreview = null;
        }
    }

    private commitColumnWidth(columnId: string, width: string): void {
        const nextWidths = {
            ...(this.columnWidths ?? {}),
            [columnId]: width,
        };

        this.columnWidths = nextWidths;
        this.$emit("column-width-change", {
            columnId,
            width,
            columnWidths: nextWidths,
        } satisfies VioletDataGridColumnWidthDetail & { columnWidths: Record<string, string> });
    }

    private endColumnResize(): void {
        if (
            this.#columnResizeHandle &&
            this.#columnResizeSession.pointerId !== null &&
            this.#columnResizeHandle.hasPointerCapture?.(this.#columnResizeSession.pointerId)
        ) {
            try {
                this.#columnResizeHandle.releasePointerCapture(this.#columnResizeSession.pointerId);
            } catch {
                // Ignore release failures for synthetic Storybook pointer events.
            }
        }

        this.#columnResizeSession = clearedColumnResizeSession();
        this.#columnResizeHandle = null;
    }

  private schedulePresentationRefresh(): void {
    if (!this.$fastController.isConnected) {
      return;
    }
    this.refreshPresentation();
  }

    private refreshPresentation(): void {
    this.#presentationRevision += 1;
        const sourceColumns = this.columns ?? [];
        const sourceRows = this.rows ?? [];
        const sourceSelectedRowIds = this.selectedRowIds ?? [];
    const presentedColumns = sourceColumns.map((column) => this.createPresentedColumn(column));
        const sortedRows = this.sortRows(sourceRows, presentedColumns);
    const validSelectedIds = new Set(sortedRows.map((row) => row.id));
    const sourceRowsById = new Map(sourceRows.map((row) => [row.id, row]));
    const prunedSelection = sourceSelectedRowIds.filter((id) => validSelectedIds.has(id));

        if (prunedSelection.length !== sourceSelectedRowIds.length) {
            this.selectedRowIds = prunedSelection;
            this.$emit("selection-change", { selectedRowIds: prunedSelection });
        }

        this.presentedColumns = presentedColumns;
    this.#columnIndexById = new Map(presentedColumns.map((column, index) => [column.id, index]));
    this.#rowIndexById = new Map(sortedRows.map((row, index) => [row.id, index]));
    this.#selectedRowIdSet = new Set(prunedSelection);
    this.presentedRows = sortedRows.map((row) => this.createPresentedRow(row, presentedColumns));

    for (const [rowId, cached] of this.#rowPresentationCache) {
      if (!validSelectedIds.has(rowId) || sourceRowsById.get(rowId) !== cached.source) {
        this.#rowPresentationCache.delete(rowId);
      }
    }
    for (const [rowId, cached] of this.#sortKeyCache) {
      if (!validSelectedIds.has(rowId) || sourceRowsById.get(rowId) !== cached.source) {
        this.#sortKeyCache.delete(rowId);
      }
    }

        this.syncActiveCell();
        if (
            this.focusedSelectionRowId &&
            (this.focusMode !== "cell" ||
                this.selectionMode === "none" ||
                !this.#rowIndexById.has(this.focusedSelectionRowId))
        ) {
            this.focusedSelectionRowId = null;
        }
        this.syncCellSelection();
        this.syncEditingCell();
        this.syncFillPreview();
        this.updateInteractionState();
        this.syncRenderedRows();
        this.scheduleVirtualizerUpdate();
        this.syncHostStates();
    }

    private createPresentedColumn<RowData>(
    column: VioletDataGridColumn<RowData>,
    ): VioletPresentedColumn<RowData> {
        return buildPresentedColumn(column, {
            resolvedWidth: this.columnWidths?.[column.id] ?? column.width,
            mergePartNames: (base, extra) => this.mergePartNames(base, extra),
        }) as VioletPresentedColumn<RowData>;
    }

    private createPresentedRow<RowData>(
        row: VioletDataGridRow<RowData>,
    columns: VioletPresentedColumn<RowData>[],
    ): VioletPresentedRow<RowData> {
    const cached = this.#rowPresentationCache.get(row.id);
    if (cached?.source === row && cached.columnRevision === this.#columnRevision) {
      return cached.row as VioletPresentedRow<RowData>;
    }

    const rowLabel = row.label?.trim() || row.id;
    let materializedCells: VioletPresentedCell[] | null = null;
    const presentedRow = {
      id: row.id,
      label: rowLabel,
      data: row.data,
    } as VioletPresentedRow<RowData>;
    const baseCells = (): VioletPresentedCell[] => {
      if (!materializedCells) {
        materializedCells = (
          buildPresentedRow(row, columns, {
            cellValueFor: (rowValue, column) => this.cellValueFor(rowValue, column),
            serializeCellValue: (column, rowData, rawValue) =>
              this.serializeCellValue(column, rowData, rawValue),
            cellIdFor: (rowId, columnId) => this.cellIdFor(rowId, columnId),
            editingErrorIdFor: (rowId, columnId) => this.cellEditorErrorIdFor(rowId, columnId),
            editorOptionsForColumn: (column, rowData) =>
              this.editorOptionsForColumn(column, rowData),
          }) as VioletPresentedRow<RowData>
        ).cells;
      }

      return materializedCells;
    };

    this.#baseCellsByPresentedRow.set(presentedRow as VioletPresentedRow, baseCells);

    Object.defineProperty(presentedRow, "cells", {
      configurable: false,
      enumerable: true,
      get: () => {
        const cells = baseCells();
        if (this.focusMode !== "cell") {
          return cells;
        }

        const rowIndex = this.#rowIndexById.get(row.id);
        if (rowIndex === undefined) {
          return cells;
        }

        return this.withInteractionState(presentedRow, rowIndex, this.interactionSnapshot()).cells;
      },
    });

    this.#rowPresentationCache.set(row.id, {
      source: row as VioletDataGridRow,
      columnRevision: this.#columnRevision,
      row: presentedRow as VioletPresentedRow,
    });
    return presentedRow;
    }

    private updateInteractionState(): void {
    this.#interactionRevision += 1;
        this.syncRenderedRows();
    }

  private withInteractionState<RowData>(
    row: VioletPresentedRow<RowData>,
    rowIndex: number,
    snapshot: VioletInteractionSnapshot,
  ): VioletPresentedRow<RowData> {
    if (this.focusMode !== "cell") {
      return row;
    }

    const cached = this.#decoratedRowCache.get(row.id);
    if (cached?.source === row && cached.interactionRevision === this.#interactionRevision) {
      return cached.row as VioletPresentedRow<RowData>;
    }

    const baseCells = this.#baseCellsByPresentedRow.get(row)?.() ?? row.cells;
    const decoratedRow = {
      id: row.id,
      label: row.label,
      data: row.data,
      cells: baseCells.map((cell, columnIndex) => {
        const indices = { rowIndex, columnIndex };
        const selected = computeIsCellSelected(snapshot.selectionBounds, indices);
        const rangeEdge = computeRangeEdgeForCell(snapshot.selectionBounds, indices);
        const fillPreview = computeIsFillPreviewCell(
          snapshot.fillPreviewBounds,
          snapshot.fillSourceBounds,
          indices,
        );
        const active = this.isActiveCell(cell.rowId, cell.columnId);
        const editing = this.isEditingCell(cell.rowId, cell.columnId);
        const editingHint = editing && !this.editingError
          ? this.columnAccessoryText(cell.columnId, cell.rowData, "editorHint")
          : "";

        return {
          ...cell,
          active,
          selected,
          fillPreview,
          rangeEdge,
          editing,
          editValue: editing ? this.editingValue : "",
          editingError: editing ? this.editingError : "",
          editingHint,
          editingHintId: editingHint ? this.cellEditorHintIdFor(cell.rowId, cell.columnId) : "",
          resolvedCellPartText: composeCellPartText(cell.cellPartText, {
            selected,
            rangeEdge,
            fillPreview,
            active,
            editing,
          }),
        };
      }),
    };
    this.#decoratedRowCache.set(row.id, {
      source: row as VioletPresentedRow,
      interactionRevision: this.#interactionRevision,
      row: decoratedRow as VioletPresentedRow,
    });
    return decoratedRow;
    }

    private resolvedColumnWidth(columnId: string): string | undefined {
        return resolveGridColumnWidth(columnId, this.columnWidths, this.columns);
    }

    private renderedColumnWidth(columnId: string): number {
        const headerCell = this.headerCellElement(columnId);
        return computeRenderedColumnWidth({
            headerCell,
            resolvedWidth: this.resolvedColumnWidth(columnId),
        });
    }

    private minimumColumnWidth(columnId: string): number {
        const headerCell = this.headerCellElement(columnId);
        return computeMinimumColumnWidth(headerCell);
    }

    private applyLiveColumnWidth(columnId: string, width: string | undefined): void {
        const value = width ?? "";
        const rowId = CSS.escape(columnId);

    this.shadowRoot?.querySelectorAll(`[data-column-id="${rowId}"]`).forEach((element) => {
                const style = (element as HTMLElement).style;
                style.width = value;
                style.inlineSize = value;
                style.minInlineSize = value;
                style.maxInlineSize = value;
            });
    }

    private headerCellElement(columnId: string): HTMLTableCellElement | null {
        const escaped = CSS.escape(columnId);
    return this.shadowRoot?.querySelector(
      `th[data-column-id="${escaped}"]`,
    ) as HTMLTableCellElement | null;
    }

    private autosizedColumnWidth(columnId: string): number {
    const columnIndex = this.#columnIndexById.get(columnId);
    const column = columnIndex === undefined ? undefined : this.presentedColumns[columnIndex];
        const headerCell = this.headerCellElement(columnId);
        const sampleCell = this.cellElementForLocation(
      this.presentedRows[0] ? { rowId: this.presentedRows[0].id, columnId } : null,
        );
    if (!this.#measurementCanvas) {
      this.#measurementCanvas = document.createElement("canvas");
    }
    const canvas = this.#measurementCanvas;
        return computeAutosizedColumnWidth({
            columnId,
            column: column ?? null,
            rows: this.presentedRows,
            headerCell,
            sampleCell,
      getCellText: (location) => this.cellTextAt(location),
            sampleRows: sampleAutosizeRows(this.presentedRows),
            measurementCanvas: canvas,
            fontSource: this,
        });
    }

    private cellValueFor<RowData>(
        row: VioletDataGridRow<RowData>,
    column: VioletPresentedColumn<RowData>,
    ): unknown {
        return resolveCellValue(row, column.source);
    }

    private editorOptionsForColumn<RowData>(
        column: VioletDataGridColumn<RowData>,
    rowData: RowData,
    ): VioletDataGridEditorOption[] {
    return resolveEditorOptionsForColumn<RowData, VioletDataGridEditorOption>(column, rowData);
    }

    private serializeCellValue<RowData>(
        column: VioletDataGridColumn<RowData>,
        rowData: RowData,
    rawValue: unknown,
    ): string {
        return serializeGridCellValue({
            column,
            rowData,
            rawValue,
      booleanCellValue: (value) => this.booleanCellValue(value),
        });
    }

    private sortRows<RowData>(
        rows: VioletDataGridRow<RowData>[] | undefined,
    columns: VioletPresentedColumn<RowData>[],
    ): VioletDataGridRow<RowData>[] {
        return sortGridRows({
            rows,
      columns: columns.map((column) => column.source),
            sort: this.sort,
            sortMode: this.sortMode,
      getSortKey: (row, column) => this.sortKeyFor(row, column as VioletDataGridColumn<RowData>),
        });
    }

  private sortKeyFor<RowData>(
    row: VioletDataGridRow<RowData>,
    column: VioletDataGridColumn<RowData>,
  ): string {
    const cached = this.#sortKeyCache.get(row.id);
    if (cached?.source === row && cached.column === column) {
      return cached.key;
    }

    const key = stringifyCellValue(resolveCellValue(row, column));
    this.#sortKeyCache.set(row.id, {
      source: row as VioletDataGridRow,
      column: column as VioletDataGridColumn,
      key,
    });
    return key;
  }

    private syncActiveCell(): void {
        this.activeCell = syncPresentedActiveCell({
            focusMode: this.focusMode,
            rows: this.presentedRows,
            columns: this.presentedColumns,
            activeCell: this.activeCell,
        }) as VioletDataGridCellLocation | null;
    }

    private syncCellSelection(): void {
        this.cellSelection = syncPresentedCellSelection({
            focusMode: this.focusMode,
            activeCell: this.activeCell,
            cellSelection: this.cellSelection,
      isValidLocation: (location) => this.isValidCellLocation(location),
        }) as VioletDataGridCellRange | null;
    }

    private syncFillPreview(): void {
        this.fillPreview = syncPresentedFillPreview({
            focusMode: this.focusMode,
            fillPreview: this.fillPreview,
      isValidLocation: (location) => this.isValidCellLocation(location),
        }) as VioletDataGridCellRange | null;
    }

    private syncEditingCell(): void {
        const nextState = syncEditingState({
            focusMode: this.focusMode,
            editingCell: this.editingCell,
            editingValue: this.editingValue,
      isEditableLocation: (location) => Boolean(this.presentedCellAt(location)?.editable),
        });

    if (this.editingCell && !nextState.editingCell) {
      this.cancelActiveEdit();
      return;
    }
        this.editingCell = nextState.editingCell as VioletDataGridCellLocation | null;
        this.editingValue = nextState.editingValue;
    if (this.#editingSession) {
      this.scheduleEditorRestore(this.#editingSession.id);
    }
    }

    private firstCellLocation(): VioletDataGridCellLocation | null {
        return resolveNavigationFirstCellLocation(
            this.presentedRows,
      this.presentedColumns,
        ) as VioletDataGridCellLocation | null;
    }

    private nextCellLocationForKey(
        event: KeyboardEvent,
        key = event.key,
    ): VioletDataGridCellLocation | null {
        return resolveNextCellLocationForKey({
            rows: this.presentedRows,
            columns: this.presentedColumns,
            activeCell: this.activeCell,
            key,
            metaKey: event.ctrlKey || event.metaKey,
        }) as VioletDataGridCellLocation | null;
    }

    private setActiveCell(
        location: VioletDataGridCellLocation,
    options: { extendRange?: boolean } = {},
    ): void {
        const extendRange = options.extendRange ?? false;

        if (!this.sameEditingLocation(this.activeCell, location)) {
            this.editAnnouncement = "";
        }

        this.focusedSelectionRowId = null;

        if (extendRange) {
            const anchor = this.cellSelection?.anchor ?? this.activeCell ?? location;
            this.cellSelection = this.createCellSelection(anchor, location);
        } else if (this.cellSelection) {
            this.cellSelection = null;
        }

        this.activeCell = location;
        this.updateInteractionState();
    }

    private setFocusedSelectionRow(rowId: string): void {
        if (this.selectionMode === "none" || !this.#rowIndexById.has(rowId)) {
            return;
        }
        this.editAnnouncement = "";
        this.fillAnnouncement = "";
        if (this.cellSelection) {
            this.cellSelection = null;
        }
        this.focusedSelectionRowId = rowId;
        this.updateInteractionState();
    }

    private toggleRowSelectionFromKeyboard(rowId: string): void {
        if (this.selectionMode === "none" || !this.#rowIndexById.has(rowId)) {
            return;
        }

        if (this.selectionMode === "single") {
            this.updateSelection([rowId]);
            return;
        }

        const current = new Set(this.selectedRowIds);
        if (current.has(rowId)) {
            current.delete(rowId);
        } else {
            current.add(rowId);
        }
        this.updateSelection([...current]);
    }

    private handleSelectionCellKeydown(
        event: KeyboardEvent,
        target: HTMLElement | null,
        moveDomFocus: boolean,
    ): boolean {
        return handleSelectionCellKeydownEvent(
            {
                element: this,
                focusedSelectionRowId: this.focusedSelectionRowId,
                presentedRows: this.presentedRows,
                presentedColumns: this.presentedColumns,
                rowIndexForId: (rowId) => this.#rowIndexById.get(rowId),
                toggleRowSelectionFromKeyboard: (rowId) => this.toggleRowSelectionFromKeyboard(rowId),
                selectionHeaderFocusTarget: () => this.selectionHeaderFocusTarget(),
                columnHeaderFocusTargetFor: (columnId) => this.columnHeaderFocusTargetFor(columnId),
                setFocusedSelectionRow: (rowId) => this.setFocusedSelectionRow(rowId),
                setActiveCell: (location) => this.setActiveCell(location),
                focusActiveCell: (options) => this.focusActiveCell(options),
            },
            event,
            target,
            moveDomFocus,
        );
    }

    private handleRowModeBodyKeydown(event: KeyboardEvent): boolean {
        return handleRowModeBodyKeydownEvent(
            {
                element: this,
                presentedRows: this.presentedRows,
                rowModeInteractiveColumns: () => this.rowModeInteractiveColumns(),
                selectionControlRowId: (el) => this.selectionControlRowId(el),
                rowIndexForId: (rowId) => this.#rowIndexById.get(rowId),
                setRowModeFocusTarget: (nextRowId, nextColumnId, nextRowIndex) => {
                    this.rowModeFocusRowId = nextRowId;
                    this.rowModeFocusColumnId = nextColumnId;
                    if (this.virtualize) {
                        const focusGeneration = this.#focusGeneration;
                        this.#pendingRowModeFocus = {
                            rowId: nextRowId,
                            columnId: nextColumnId,
                            focusGeneration,
                        };
                        this.#rowVirtualizer.scrollToIndex(nextRowIndex, { align: "auto" });
                        if (this.focusRowModeBodyControl(nextRowId, nextColumnId, { preventScroll: false })) {
                            this.#pendingRowModeFocus = null;
                        }
                    } else {
                        this.#pendingRowModeFocus = null;
                        this.focusRowModeBodyControl(nextRowId, nextColumnId, { preventScroll: false });
                    }
                },
            },
            event,
        );
    }

    private focusRowModeBodyControl(
        rowId: string,
        columnId: string | null,
        options: { preventScroll?: boolean } = {},
    ): boolean {
        return focusRowModeControlInShadow(this.shadowRoot, rowId, columnId, options);
    }

    private temporarilySuspendRovingCellTabStop(): void {
        suspendRovingCellTabStops(this.shadowRoot, () =>
            this.$fastController.isConnected && this.focusMode === "cell"
                ? this.getActiveGridCellElement()
                : null,
        );
    }

    private customCellWidgetsInCell(cell: HTMLTableCellElement): HTMLElement[] {
        return customCellWidgetsInCellElement(cell);
    }

    private customCellWidgetFromTarget(target: HTMLElement | null): HTMLElement | null {
        return findCustomCellWidgetFromTarget(target);
    }

    private handleCustomCellWidgetKeydown(widget: HTMLElement, event: KeyboardEvent): boolean {
        return handleCustomCellWidgetKeydownEvent(
            {
                setActiveCell: (location) => this.setActiveCell(location),
                focusActiveCell: (options) => this.focusActiveCell(options),
                temporarilySuspendRovingCellTabStop: () => this.temporarilySuspendRovingCellTabStop(),
            },
            widget,
            event,
        );
    }

    private syncCustomCellWidgetTabIndexes(): void {
        if (!this.$fastController.isConnected) {
            return;
        }
        syncCustomCellWidgetTabIndexesInShadow(
            this.shadowRoot,
            this.focusMode,
            this.#managedCustomWidgetTabIndexes,
        );
    }

    private startEditingCell(location: VioletDataGridCellLocation): void {
    if (this.editingCell) {
      if (this.sameEditingLocation(this.editingCell, location)) {
        this.refocusActiveEditor();
        return;
      }
      if (!this.commitActiveEdit()) {
        this.refocusActiveEditor();
        return;
      }
    }
        const cell = this.presentedCellAt(location);
        const nextState = beginEditingState(location, cell, cell ? this.editStringForCell(cell) : "");
        if (!nextState) {
            return;
        }

        this.cellSelection = null;
        this.editAnnouncement = "";
    this.editingError = "";
    this.#editingSession = {
      id: ++this.#nextEditingSessionId,
      location: { ...location },
    };
        this.editingValue = nextState.editingValue;
        this.editingCell = nextState.editingCell;
        this.$emit("edit-start", location);
    }

    private opensOnSingleActiveClick(editor: VioletDataGridEditor): boolean {
        return editorOpensOnSingleActiveClick(editor);
    }

  /**
   * Commit the active edit synchronously.
   *
   * Returns true only when one session resolves. False means either there
   * was no edit or validation retained the same session; inspect
   * `editingCell` before and after when the distinction matters.
   */
  public commitActiveEdit(): boolean {
    const session = this.currentEditingSession();
    if (!session || this.#resolvingEditingSessionId === session.id) {
      return false;
        }

    const cell = this.presentedCellAt(session.location);
    if (!cell?.editable || cell.editor === "checkbox") {
      return this.cancelActiveEdit();
    }

    const editor = this.getActiveEditorElement();
    if (editor) {
      this.editingValue = this.editorValueFromTarget(editor);
    }

    this.#resolvingEditingSessionId = session.id;
    const resolution = resolveEditingValue(cell, this.editingValue);
    this.#resolvingEditingSessionId = null;
    if (this.#editingSession?.id !== session.id) {
      return false;
    }
    if (!resolution.valid) {
      this.editingError = resolution.message;
      this.updateInteractionState();
      this.scheduleEditorRestore(session.id);
      return false;
    }

    const detail = {
      rowId: session.location.rowId,
      columnId: session.location.columnId,
      value: resolution.value,
    } satisfies VioletDataGridChangeDetail;
    this.clearEditingSession(session.id);
    this.$emit("cell-change", detail);
    return true;
        }

  private commitEditingCell(): boolean {
    return this.commitActiveEdit();
    }

    private commitEditingCellAndMove(direction: -1 | 1): void {
        const currentCell = this.editingCell;
        if (!currentCell) {
            return;
        }

    if (!this.commitActiveEdit()) {
      this.refocusActiveEditor();
      return;
    }

        const nextCell = this.nextTabCellLocation(currentCell, direction);
        this.setActiveCell(nextCell ?? currentCell);
        this.focusActiveCell({ preventScroll: true });
    }

  /** Cancel the active edit synchronously and emit `edit-cancel` once. */
  public cancelActiveEdit(): boolean {
    const session = this.currentEditingSession();
    if (!session) {
      return false;
    }

    const result = clearEditingState(session.location);
    this.clearEditingSession(session.id);
    this.$emit("edit-cancel", result.cancelledCell);
    return true;
  }

    /**
     * Fills from the current cell selection, or the active cell, without dragging (WCAG 2.5.7).
     * The source extends `count` rows or columns in `direction` and the new cells are filled exactly as
     * dragging the fill handle there would: the target stops at the first strip with a read-only
     * cell, the source tiles across it, `cell-fill` is emitted with the same detail, and the filled
     * range becomes the cell selection. Consumers can call it from a row or cell menu.
     * @returns The emitted `cell-fill` detail, or `null` when nothing was filled.
     */
    public fillSelection(direction: VioletDataGridFillDirection, count = 1): VioletDataGridFillDetail | null {
        const ranges = this.fillSelectionRanges(direction, count);
        const detail = ranges ? this.fillDetailFor(ranges.source, ranges.target) : null;
        if (detail) {
            this.$emit("cell-fill", detail);
            this.cellSelection = this.createCellSelection(detail.target.anchor, detail.target.focus);
        }
        return detail;
    }

    public canFillSelection(direction: VioletDataGridFillDirection): boolean {
        return this.fillSelectionRanges(direction, 1) !== null;
    }

    public handleFillAction(direction: VioletDataGridFillDirection): void {
        const detail = this.fillSelection(direction);
        if (detail) {
            const end = this.cellIndicesFor(detail.target.focus);
            const destination = end
                ? `row ${end.rowIndex + 1}, column ${this.presentedColumns[end.columnIndex]?.label ?? detail.target.focus.columnId}`
                : `row ${detail.target.focus.rowId}, column ${detail.target.focus.columnId}`;
            this.fillAnnouncement = `Filled ${detail.changes.length} cell${detail.changes.length === 1 ? "" : "s"} ${direction}. Selection ends at ${destination}.`;
        }
    }

    private fillSelectionRanges(direction: VioletDataGridFillDirection, count: number): {
        source: VioletDataGridCellRange;
        target: VioletDataGridCellRange;
    } | null {
        if (this.focusMode !== "cell" || this.editingCell) {
            return null;
        }

        const source = this.currentFillSourceRange();
        const sourceBounds = this.boundsForRange(source);
        const steps = Math.floor(count);
        if (!source || !sourceBounds || !(steps >= 1) || !this.hasEditableCellsInRange(source)) {
            return null;
        }

        const lastRow = this.presentedRows.length - 1;
        const lastColumn = this.presentedColumns.length - 1;
        const rowIndex =
            direction === "down"
                ? Math.min(lastRow, sourceBounds.rowEnd + steps)
                : direction === "up"
                  ? Math.max(0, sourceBounds.rowStart - steps)
                  : sourceBounds.rowEnd;
        const columnIndex =
            direction === "right"
                ? Math.min(lastColumn, sourceBounds.columnEnd + steps)
                : direction === "left"
                  ? Math.max(0, sourceBounds.columnStart - steps)
                  : sourceBounds.columnEnd;
        const location = this.locationForIndices(rowIndex, columnIndex);
        const target = location ? this.fillPreviewRangeForLocation(location, source) : null;
        if (!target) {
            return null;
        }

        const targetBounds = this.boundsForRange(target);
        if (!targetBounds || (
            targetBounds.rowStart === sourceBounds.rowStart && targetBounds.rowEnd === sourceBounds.rowEnd &&
            targetBounds.columnStart === sourceBounds.columnStart && targetBounds.columnEnd === sourceBounds.columnEnd
        )) {
            return null;
        }
        return { source, target };
    }

  private currentEditingSession(): VioletDataGridEditingSession | null {
        if (!this.editingCell) {
      return null;
    }
    if (this.sameEditingLocation(this.#editingSession?.location, this.editingCell)) {
      return this.#editingSession;
    }
    this.#editingSession = {
      id: ++this.#nextEditingSessionId,
      location: { ...this.editingCell },
    };
    return this.#editingSession;
  }

  private clearEditingSession(sessionId: number): void {
    if (this.#editingSession?.id !== sessionId) {
            return;
        }
    this.#editingSession = null;
    this.#editingEditorElement = null;
    this.#pendingEditorSelection = null;
    this.#presentationRetainingSessionId = null;
    this.#resolvingEditingSessionId = null;
    this.editingCell = null;
    this.editingValue = "";
    this.editingError = "";
  }

  private sameEditingLocation(
    left: VioletDataGridCellLocation | null | undefined,
    right: VioletDataGridCellLocation | null | undefined,
  ): boolean {
    return Boolean(left && right && left.rowId === right.rowId && left.columnId === right.columnId);
  }

  private cancelEditIfSourceTargetInvalidated(): void {
    const location = this.editingCell;
    if (!location) {
      return;
    }
    const rowExists = (this.rows ?? []).some((row) => row.id === location.rowId);
    const column = (this.columns ?? []).find((column) => column.id === location.columnId);
    if (!rowExists || !column?.editable || column.editor === "checkbox") {
      this.cancelActiveEdit();
    }
  }

  public handleGridScroll(): void {
    if (this.editingCell) {
      this.positionEditingOverlay();
    }
  }

  private disconnectOverlayResizeObserver(): void {
    if (this.#overlayResizeFrame !== null) {
      cancelAnimationFrame(this.#overlayResizeFrame);
      this.#overlayResizeFrame = null;
    }
    this.#overlayResizeObserver?.disconnect();
    this.#observedOverlayTargets.clear();
  }

  private scheduleOverlayPosition(): void {
    if (this.#overlayResizeFrame !== null) {
      cancelAnimationFrame(this.#overlayResizeFrame);
    }
    this.#overlayResizeFrame = requestAnimationFrame(() => {
      this.#overlayResizeFrame = null;
      if (this.editingCell) {
        this.positionEditingOverlay();
      }
    });
  }

  private observeOverlayGeometry(targets: Element[]): void {
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    this.#overlayResizeObserver ??= new ResizeObserver(() => {
      if (this.editingCell) {
        this.scheduleOverlayPosition();
      }
    });
    const next = new Set(targets);
    for (const existing of this.#observedOverlayTargets) {
      if (!next.has(existing)) {
        this.#overlayResizeObserver.unobserve(existing);
        this.#observedOverlayTargets.delete(existing);
      }
    }
    for (const target of next) {
      if (!this.#observedOverlayTargets.has(target)) {
        this.#overlayResizeObserver.observe(target);
        this.#observedOverlayTargets.add(target);
      }
    }
  }

  /**
   * Flips the editing hint or error overlay above the editing cell when there is
   * not enough room below it inside `.table-scroll`, and bounds its height to the
   * chosen side when a narrow column wraps a long message (#1197).
   */
  private positionEditingOverlay(): void {
    const scrollContainer = this.getScrollContainer();
    const cell = this.cellElementForLocation(this.editingCell);
    const overlay = cell?.querySelector<HTMLElement>(".cell-editor-error, .cell-editor-hint") ?? null;
    if (!scrollContainer || !cell || !overlay) {
      this.disconnectOverlayResizeObserver();
      return;
    }

    this.observeOverlayGeometry([scrollContainer, cell, overlay]);

    const scrollerRect = scrollContainer.getBoundingClientRect();
    const viewportTop = scrollerRect.top + scrollContainer.clientTop;
    const viewportBottom = viewportTop + scrollContainer.clientHeight;
    const cellRect = cell.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const borderBlock = overlay.offsetHeight - overlay.clientHeight;
    const naturalHeight = Math.max(overlayRect.height, overlay.scrollHeight + borderBlock);
    const overlap =
      overlay.dataset.placement === "above"
        ? Math.max(0, overlayRect.bottom - cellRect.top)
        : Math.max(0, cellRect.bottom - overlayRect.top);
    const roomBelow = viewportBottom - cellRect.bottom + overlap;
    const roomAbove = cellRect.top + overlap - viewportTop;
    const placeAbove = roomBelow < naturalHeight && roomAbove > roomBelow;
    const available = placeAbove ? roomAbove : roomBelow;

    if (placeAbove) {
      overlay.dataset.placement = "above";
    } else {
      delete overlay.dataset.placement;
    }

    if (naturalHeight > available && available > 0) {
      overlay.style.maxBlockSize = `${Math.floor(available)}px`;
    } else {
      overlay.style.maxBlockSize = "";
    }
  }

  private scheduleEditorRestore(sessionId: number | null, forceFocus = false, attempt = 0): void {
    if (!sessionId) {
      return;
    }
    Updates.enqueue(() => {
      if (this.#editingSession?.id === sessionId) {
        this.positionEditingOverlay();
      }
    });
    if (this.#editorRestoreFrame !== null) {
      cancelAnimationFrame(this.#editorRestoreFrame);
    }
    this.#editorRestoreFrame = requestAnimationFrame(() => {
      this.#editorRestoreFrame = null;
      if (this.#editingSession?.id !== sessionId) {
        return;
      }
      this.positionEditingOverlay();
      const editor = this.getActiveEditorElement();
      if (!editor) {
        if (this.#presentationRetainingSessionId === sessionId && attempt < 3) {
          this.scheduleEditorRestore(sessionId, forceFocus, attempt + 1);
          return;
        }
        if (this.#presentationRetainingSessionId === sessionId) {
          this.cancelActiveEdit();
        }
        return;
      }
      if (editor === this.#editingEditorElement) {
        // FAST may move the same editor node while rebinding rows. Firefox
        // and WebKit drop focus on that move without replacing the element.
        if (forceFocus || this.#presentationRetainingSessionId === sessionId) {
          editor?.focus?.({ preventScroll: true });
        }
        if (this.#presentationRetainingSessionId === sessionId && attempt < 3) {
          this.scheduleEditorRestore(sessionId, forceFocus, attempt + 1);
          return;
        }
        this.#presentationRetainingSessionId = null;
        return;
      }
      seedEditorValue(editor, this.editingValue);
      this.restoreEditorSelection(editor, sessionId);
      this.#editingEditorElement = editor;
      if (this.#presentationRetainingSessionId === sessionId && attempt < 3) {
        this.scheduleEditorRestore(sessionId, true, attempt + 1);
        return;
      }
      this.#presentationRetainingSessionId = null;
    });
  }

  private captureActiveEditorSelection(): void {
    const sessionId = this.#editingSession?.id;
    const editor = this.getActiveEditorElement();
    if (sessionId && editor) {
      this.captureEditorSelection(editor, sessionId);
    }
  }

  private captureEditorSelection(editor: VioletCellEditorLike, sessionId: number): void {
    if (editor.selectionStart === null || editor.selectionStart === undefined) {
      return;
    }
    this.#pendingEditorSelection = {
      sessionId,
      start: editor.selectionStart,
      end: editor.selectionEnd ?? editor.selectionStart,
      direction: editor.selectionDirection ?? undefined,
    };
  }

  private restoreEditorSelection(editor: VioletCellEditorLike | null, sessionId: number): void {
    if (!editor) {
      return;
    }
    const selection = this.#pendingEditorSelection;
    editor.focus?.({ preventScroll: true });
    if (selection?.sessionId === sessionId && editor.setSelectionRange) {
      editor.setSelectionRange(selection.start, selection.end, selection.direction);
      this.#pendingEditorSelection = null;
      return;
    }
    focusEditorAtEnd(editor);
  }

  private refocusActiveEditor(): void {
    this.scheduleEditorRestore(this.#editingSession?.id ?? null, true);
  }

  private isTargetWithinEditingOwnership(target: EventTarget | null): boolean {
    const editor = this.getActiveEditorElement();
    if (!editor || !(target instanceof Node)) {
      return false;
    }
    if (editor.contains(target) || editor.shadowRoot?.contains(target)) {
      return true;
    }
    const element = target instanceof HTMLElement ? target : target.parentElement;
    const widget = element?.closest<HTMLElement>("[data-cell-widget]") ?? null;
    if (!widget) {
      return false;
    }
    const cell = widget.closest<HTMLTableCellElement>("td[data-row-id][data-column-id]");
    return Boolean(
      cell &&
        this.editingCell &&
        cell.dataset.rowId === this.editingCell.rowId &&
        cell.dataset.columnId === this.editingCell.columnId,
    );
    }

    private ensureActiveCellVisible(): void {
        if (!this.activeCell) {
            return;
        }

    const rowIndex = this.#rowIndexById.get(this.activeCell.rowId);
    if (rowIndex === undefined) {
            return;
        }

        if (this.virtualize) {
            this.#rowVirtualizer.scrollToIndex(rowIndex, { align: "auto" });
        }

        requestAnimationFrame(() => {
            const activeCell = this.getActiveCellElement();
      const scrollContainer = this.getScrollContainer();
      if (!activeCell || !scrollContainer) {
        return;
      }

      const cellRect = activeCell.getBoundingClientRect();
      const scrollRect = scrollContainer.getBoundingClientRect();
      if (cellRect.left < scrollRect.left) {
        scrollContainer.scrollLeft += cellRect.left - scrollRect.left;
      } else if (cellRect.right > scrollRect.right) {
        scrollContainer.scrollLeft += cellRect.right - scrollRect.right;
      }

      if (!this.virtualize) {
        if (cellRect.top < scrollRect.top) {
          scrollContainer.scrollTop += cellRect.top - scrollRect.top;
        } else if (cellRect.bottom > scrollRect.bottom) {
          scrollContainer.scrollTop += cellRect.bottom - scrollRect.bottom;
        }
      }
        });
    }

    private cellTextAt(location: VioletDataGridCellLocation): string {
    return this.presentedCellAt(location)?.text ?? "";
    }

    private createCellSelection(
        anchor: VioletDataGridCellLocation,
    focus: VioletDataGridCellLocation,
    ): VioletDataGridCellRange | null {
        return createNavigationCellSelection(anchor, focus) as VioletDataGridCellRange | null;
    }

  private isValidCellLocation(
    location: VioletDataGridCellLocation | null,
  ): location is VioletDataGridCellLocation {
    return Boolean(
      location &&
        this.#rowIndexById.has(location.rowId) &&
        this.#columnIndexById.has(location.columnId),
    );
    }

  private normalizedCellSelection(): {
              rowStart: number;
              rowEnd: number;
              columnStart: number;
              columnEnd: number;
  } | null {
    return this.boundsForRange(this.cellSelection);
    }

  private visualSelectionBounds(): {
              rowStart: number;
              rowEnd: number;
              columnStart: number;
              columnEnd: number;
  } | null {
    return this.fillPreview
      ? this.boundsForRange(this.fillPreview)
      : this.normalizedCellSelection();
    }

    private selectedCellLocations(): VioletDataGridCellLocation[] {
        return selectedLocations(
            this.presentedRows,
            this.presentedColumns,
            this.normalizedCellSelection(),
      this.activeCell,
        ) as VioletDataGridCellLocation[];
    }

    private copyTextForLocations(locations: VioletDataGridCellLocation[]): string {
        return copyTextForSelection({
            selection: this.normalizedCellSelection(),
            locations,
            rows: this.presentedRows,
            columns: this.presentedColumns,
      getCellText: (location) => this.cellTextAt(location as VioletDataGridCellLocation),
        });
    }

    private copyDetailForCurrentSelection(): VioletDataGridCopyDetail | null {
        if (this.focusedSelectionRowId !== null) {
            return null;
        }
        const cells = this.selectedCellLocations();

        if (!cells.length) {
            return null;
        }

        return {
            cells,
            text: this.copyTextForLocations(cells),
        };
    }

    private pasteDetailForText(text: string): VioletDataGridPasteDetail | null {
        const normalizedText = this.normalizePastedText(text);
        if (!normalizedText) {
            return null;
        }

        const origin = this.pasteOriginLocation();
        if (!origin) {
            return null;
        }

        const changes = this.pasteChangesForText(origin, normalizedText);
        if (!changes.length) {
            return null;
        }

        return {
            origin,
            text: normalizedText,
            changes,
        };
    }

    private normalizePastedText(text: string): string {
        return normalizeGridPastedText(text);
    }

    private pasteOriginLocation(): VioletDataGridCellLocation | null {
        if (this.focusedSelectionRowId !== null) {
            return null;
        }
        return resolvePasteOriginLocation({
            selection: this.normalizedCellSelection(),
            rows: this.presentedRows,
            columns: this.presentedColumns,
            activeCell: this.activeCell,
        }) as VioletDataGridCellLocation | null;
    }

    private pasteChangesForText(
        origin: VioletDataGridCellLocation,
    text: string,
    ): VioletDataGridChangeDetail[] {
        const originIndices = this.cellIndicesFor(origin);
        if (!originIndices) {
            return [];
        }

        return buildPasteChanges({
            text,
            originIndices,
            selection: this.normalizedCellSelection(),
            selectedLocations: this.selectedCellLocations(),
            rows: this.presentedRows,
            columns: this.presentedColumns,
      normalizeValue: (cell, value) =>
        this.normalizedEditingValue(cell as VioletPresentedCell, value),
        }) as VioletDataGridChangeDetail[];
    }

    private currentFillSourceRange(): VioletDataGridCellRange | null {
        if (this.focusedSelectionRowId !== null) {
            return null;
        }
        const selection = this.normalizedCellSelection();
        if (selection) {
            return this.rangeFromBounds(selection);
        }

        return this.activeCell ? { anchor: this.activeCell, focus: this.activeCell } : null;
    }

    private hasEditableCellsInRange(range: VioletDataGridCellRange | null): boolean {
        return hasEditableCellsInBounds(this.presentedRows, this.boundsForRange(range));
    }

    public shouldShowFillHandleForCell(rowId: string, columnId: string): boolean {
        if (this.focusMode !== "cell") {
            return false;
        }

        const range = this.currentFillSourceRange();
    if (!range) {
            return false;
        }

        const bounds = this.visualSelectionBounds() ?? this.boundsForRange(range);
        const location = bounds ? this.locationForIndices(bounds.rowEnd, bounds.columnEnd) : null;
    if (!location || location.rowId !== rowId || location.columnId !== columnId) {
      return false;
    }

    return this.hasEditableCellsInRange(range);
  }

  private currentFillSourceBounds(): {
              rowStart: number;
              rowEnd: number;
              columnStart: number;
              columnEnd: number;
  } | null {
    return this.currentFillSourceRange()
      ? this.boundsForRange(this.currentFillSourceRange())
      : null;
    }

  private boundsForRange(range: VioletDataGridCellRange | null): {
              rowStart: number;
              rowEnd: number;
              columnStart: number;
              columnEnd: number;
  } | null {
    if (!range) {
      return null;
          }

    const anchor = this.cellIndicesFor(range.anchor);
    const focus = this.cellIndicesFor(range.focus);
    if (!anchor || !focus) {
      return null;
    }

    return {
      rowStart: Math.min(anchor.rowIndex, focus.rowIndex),
      rowEnd: Math.max(anchor.rowIndex, focus.rowIndex),
      columnStart: Math.min(anchor.columnIndex, focus.columnIndex),
      columnEnd: Math.max(anchor.columnIndex, focus.columnIndex),
    };
    }

    private rangeFromBounds(bounds: {
        rowStart: number;
        rowEnd: number;
        columnStart: number;
        columnEnd: number;
    }): VioletDataGridCellRange | null {
    return selectionRangeFromBounds(
      this.presentedRows,
      this.presentedColumns,
      bounds,
    ) as VioletDataGridCellRange | null;
    }

  private locationForIndices(
    rowIndex: number,
    columnIndex: number,
  ): VioletDataGridCellLocation | null {
        return selectionLocationForIndices(
            this.presentedRows,
            this.presentedColumns,
            rowIndex,
      columnIndex,
        ) as VioletDataGridCellLocation | null;
    }

    private beginFillDrag(event: PointerEvent): void {
        const sourceRange = this.currentFillSourceRange();
        if (!sourceRange || !this.hasEditableCellsInRange(sourceRange)) {
            return;
        }

        const session = startFillDragSession(event.pointerId, sourceRange);
        if (!session) {
            return;
        }

        const scrollContainer = this.getScrollContainer();
        this.#fillSession = session;
        this.fillPreview = null;
        this.focusActiveCell({ preventScroll: true });
        try {
            scrollContainer?.setPointerCapture(event.pointerId);
        } catch {
            // Synthetic Storybook pointer events do not always create a capturable pointer.
        }
        event.preventDefault();
    }

    private handleFillPointerMove(event: PointerEvent): void {
        const sourceRange = this.#fillSession.sourceRange;
        if (!sourceRange) {
            return;
        }

        const sourceBounds = this.boundsForRange(sourceRange);
        const location = this.fillTargetLocationForPoint(event.clientX, event.clientY, sourceBounds);
        this.fillPreview = location ? this.fillPreviewRangeForLocation(location, sourceRange) : null;
    }

    private handleFillPointerUp(): void {
        const detail = this.fillDetailForPreview();
        const previewRange = detail?.target ?? this.fillPreview;

        if (detail) {
            this.$emit("cell-fill", detail);
        }

        this.endFillDrag(true);

        if (!previewRange) {
            return;
        }

        this.cellSelection = this.createCellSelection(previewRange.anchor, previewRange.focus);
    }

    private endFillDrag(suppressNextClick: boolean): void {
        const scrollContainer = this.getScrollContainer();

        if (
            scrollContainer &&
            this.#fillSession.pointerId !== null &&
            scrollContainer.hasPointerCapture?.(this.#fillSession.pointerId)
        ) {
            try {
                scrollContainer.releasePointerCapture(this.#fillSession.pointerId);
            } catch {
                // Ignore release failures for synthetic pointer events.
            }
        }

        this.#suppressNextGridClick = suppressNextClick;
        this.#fillSession = clearedFillSession();
        this.fillPreview = null;
    }

    private fillPreviewRangeForLocation(
        location: VioletDataGridCellLocation,
    sourceRange: VioletDataGridCellRange,
    ): VioletDataGridCellRange | null {
        const sourceBounds = this.boundsForRange(sourceRange);
        const targetIndices = this.cellIndicesFor(location);
        if (!sourceBounds || !targetIndices) {
            return null;
        }

        const expandedBounds = {
            rowStart: Math.min(sourceBounds.rowStart, targetIndices.rowIndex),
            rowEnd: Math.max(sourceBounds.rowEnd, targetIndices.rowIndex),
            columnStart: Math.min(sourceBounds.columnStart, targetIndices.columnIndex),
            columnEnd: Math.max(sourceBounds.columnEnd, targetIndices.columnIndex),
        };
        const clampedBounds = this.clampFillBoundsToEditableTargets(expandedBounds, sourceBounds);

        if (
            clampedBounds.rowStart === sourceBounds.rowStart &&
            clampedBounds.rowEnd === sourceBounds.rowEnd &&
            clampedBounds.columnStart === sourceBounds.columnStart &&
            clampedBounds.columnEnd === sourceBounds.columnEnd
        ) {
            return null;
        }

        return this.rangeFromBounds(clampedBounds);
    }

    private clampFillBoundsToEditableTargets(
        expandedBounds: {
            rowStart: number;
            rowEnd: number;
            columnStart: number;
            columnEnd: number;
        },
        sourceBounds: {
            rowStart: number;
            rowEnd: number;
            columnStart: number;
            columnEnd: number;
    },
    ): {
        rowStart: number;
        rowEnd: number;
        columnStart: number;
        columnEnd: number;
    } {
        return clampEditableFillBounds(this.presentedRows, expandedBounds, sourceBounds);
    }

    private fillTargetLocationForPoint(
        clientX: number,
        clientY: number,
    sourceBounds: {
                  rowStart: number;
                  rowEnd: number;
                  columnStart: number;
                  columnEnd: number;
    } | null,
    ): VioletDataGridCellLocation | null {
        const direct = this.locationFromPointerEventLike(clientX, clientY);
        if (direct && (!sourceBounds || !this.locationWithinBounds(direct, sourceBounds))) {
            return direct;
        }

    const preferredAxis = sourceBounds
      ? this.fillPreferredAxisForPoint(clientX, clientY, sourceBounds)
      : null;

        if (preferredAxis) {
      const axisAlignedLocation = this.nearestLocationForPoint(clientX, clientY, (location) => {
                if (sourceBounds && this.locationWithinBounds(location, sourceBounds)) {
                    return false;
                }

                const indices = this.cellIndicesFor(location);
                if (!indices || !sourceBounds) {
                    return true;
                }

                if (preferredAxis === "horizontal") {
                    return (
                        indices.rowIndex >= sourceBounds.rowStart && indices.rowIndex <= sourceBounds.rowEnd
                    );
                }

                return (
                    indices.columnIndex >= sourceBounds.columnStart &&
                    indices.columnIndex <= sourceBounds.columnEnd
                );
            });

            if (axisAlignedLocation) {
                return axisAlignedLocation;
            }
        }

    return this.nearestLocationForPoint(clientX, clientY, (location) =>
      sourceBounds ? !this.locationWithinBounds(location, sourceBounds) : true,
        );
    }

    private fillPreferredAxisForPoint(
        clientX: number,
        clientY: number,
        sourceBounds: {
            rowStart: number;
            rowEnd: number;
            columnStart: number;
            columnEnd: number;
    },
    ): "horizontal" | "vertical" | null {
        return preferredAxisForPoint(clientX, clientY, this.rectForBounds(sourceBounds));
    }

    private rectForBounds(bounds: {
        rowStart: number;
        rowEnd: number;
        columnStart: number;
        columnEnd: number;
    }): DOMRect | null {
        const start = this.locationForIndices(bounds.rowStart, bounds.columnStart);
        const end = this.locationForIndices(bounds.rowEnd, bounds.columnEnd);
        const startCell = this.cellElementForLocation(start);
        const endCell = this.cellElementForLocation(end);
        return rectFromCellPair(startCell, endCell);
    }

    private fillDetailForPreview(): VioletDataGridFillDetail | null {
        const source = this.#fillSession.sourceRange;
        const target = this.fillPreview;
        if (!source || !target) {
            return null;
        }

        return this.fillDetailFor(source, target);
    }

    private fillDetailFor(
        source: VioletDataGridCellRange,
        target: VioletDataGridCellRange,
    ): VioletDataGridFillDetail | null {

        const sourceBounds = this.boundsForRange(source);
        const targetBounds = this.boundsForRange(target);
        if (!sourceBounds || !targetBounds) {
            return null;
        }

        const changes = buildFillChanges({
            rows: this.presentedRows,
            columns: this.presentedColumns,
            sourceBounds,
            targetBounds,
      normalizeValue: (cell, value) =>
        this.normalizedEditingValue(cell as VioletPresentedCell, value),
        }) as VioletDataGridChangeDetail[];

        if (!changes.length) {
            return null;
        }

        return {
            source,
            target,
            changes,
        };
    }

    private presentedCellAt(location: VioletDataGridCellLocation | null): VioletPresentedCell | null {
        if (!location) {
            return null;
        }

    const rowIndex = this.#rowIndexById.get(location.rowId);
    const columnIndex = this.#columnIndexById.get(location.columnId);
    if (rowIndex === undefined || columnIndex === undefined) {
      return null;
    }

    return this.presentedRows[rowIndex]?.cells[columnIndex] ?? null;
    }

    private editStringForCell(cell: VioletPresentedCell): string {
        return editStringForRawValue(cell.rawValue);
    }

    private normalizedEditingValue(cell: VioletPresentedCell, value: unknown): unknown {
        return normalizeEditingValue(cell, value);
    }

    private booleanCellValue(value: unknown): boolean {
        return normalizeBooleanCellValue(value);
    }

    private nextTabCellLocation(
        current: VioletDataGridCellLocation,
    direction: -1 | 1,
    ): VioletDataGridCellLocation | null {
    return nextTabLocation(
      this.presentedRows,
      this.presentedColumns,
      current,
      direction,
    ) as VioletDataGridCellLocation | null;
    }

  private cellIndicesFor(
    location: VioletDataGridCellLocation,
  ): { rowIndex: number; columnIndex: number } | null {
    const rowIndex = this.#rowIndexById.get(location.rowId);
    const columnIndex = this.#columnIndexById.get(location.columnId);
    return rowIndex === undefined || columnIndex === undefined ? null : { rowIndex, columnIndex };
    }

    private isEditingCell(rowId: string, columnId: string): boolean {
        return this.editingCell?.rowId === rowId && this.editingCell?.columnId === columnId;
    }

    private isEditorElement(target: EventTarget | null): target is VioletCellEditorLike {
        return isGridEditorElement(target);
    }

    private editorValueFromTarget(target: VioletCellEditorLike): string {
        return editorStringValue(target);
    }

    private isInteractiveCellWidgetTarget(target: EventTarget | null): boolean {
        return isGridInteractiveCellWidgetTarget(target);
    }

    private commitCheckboxCellToggle(location: VioletDataGridCellLocation, checked: boolean): void {
        const cell = this.presentedCellAt(location);
        if (!cell?.editable || cell.editor !== "checkbox") {
            return;
        }

        this.$emit("cell-change", {
            rowId: location.rowId,
            columnId: location.columnId,
            value: this.normalizedEditingValue(cell, checked),
        } satisfies VioletDataGridChangeDetail);
    }

    private isFillHandleTarget(target: EventTarget | null): boolean {
        return isGridFillHandleTarget(target);
    }

    private closestFromEventPath<T extends HTMLElement>(event: Event, selector: string): T | null {
        return eventClosestFromEventPath<T>(event, selector);
    }

    private isEditorEvent(event: Event): boolean {
        return this.closestFromEventPath<HTMLElement>(event, ".cell-editor") !== null;
    }

    private isInteractiveCellWidgetEvent(event: Event): boolean {
        return event.composedPath().some((target) => isGridInteractiveCellWidgetTarget(target));
    }

    private isFillHandleEvent(event: Event): boolean {
        return this.closestFromEventPath<HTMLElement>(event, '[data-fill-handle="true"]') !== null;
    }

    public isActiveCell(rowId: string, columnId: string): boolean {
        return (
            !this.focusedSelectionRowId &&
            this.activeCell?.rowId === rowId &&
            this.activeCell?.columnId === columnId
        );
    }

    private locationFromTarget(target: EventTarget | null): VioletDataGridCellLocation | null {
        const cell = this.cellElementFromTarget(target);
        return cell ? this.locationFromCellElement(cell) : null;
    }

    private locationFromEvent(event: Event): VioletDataGridCellLocation | null {
        const cell = cellElementFromEvent(event);
        return cell ? this.locationFromCellElement(cell) : null;
    }

    private cellElementFromTarget(target: EventTarget | null): HTMLTableCellElement | null {
        return eventCellElementFromTarget(target);
    }

    private locationFromPointerEvent(event: PointerEvent): VioletDataGridCellLocation | null {
        const fromPoint = this.locationFromPointerEventLike(event.clientX, event.clientY);
        if (fromPoint) {
            return fromPoint;
        }

        const fromTarget = this.locationFromTarget(event.target);
        if (fromTarget) {
            return fromTarget;
        }

        return this.nearestLocationForPoint(event.clientX, event.clientY);
    }

    private locationFromMouseEvent(event: MouseEvent): VioletDataGridCellLocation | null {
        const fromPoint = this.locationFromPointerEventLike(event.clientX, event.clientY);
        if (fromPoint) {
            return fromPoint;
        }

        return this.nearestLocationForPoint(event.clientX, event.clientY);
    }

  private locationFromPointerEventLike(
    clientX: number,
    clientY: number,
  ): VioletDataGridCellLocation | null {
        const elementAtPoint = this.shadowRoot?.elementFromPoint(clientX, clientY);
        return this.locationFromTarget(elementAtPoint ?? null);
    }

    private nearestLocationForPoint(
        clientX: number,
        clientY: number,
    predicate?: (location: VioletDataGridCellLocation) => boolean,
    ): VioletDataGridCellLocation | null {
        const cells = Array.from(
      this.shadowRoot?.querySelectorAll("td[data-row-id][data-column-id]") ?? [],
        ) as HTMLTableCellElement[];
        return nearestGeometryLocationForPoint({
            cells,
            clientX,
            clientY,
            predicate,
        }) as VioletDataGridCellLocation | null;
    }

    private locationWithinBounds(
        location: VioletDataGridCellLocation,
        bounds: {
            rowStart: number;
            rowEnd: number;
            columnStart: number;
            columnEnd: number;
    },
    ): boolean {
    const rowIndex = this.#rowIndexById.get(location.rowId);
    const columnIndex = this.#columnIndexById.get(location.columnId);
    return (
      rowIndex !== undefined &&
      columnIndex !== undefined &&
      rowIndex >= bounds.rowStart &&
      rowIndex <= bounds.rowEnd &&
      columnIndex >= bounds.columnStart &&
      columnIndex <= bounds.columnEnd
    );
    }

    private locationFromCellElement(cell: HTMLTableCellElement): VioletDataGridCellLocation | null {
        return geometryLocationFromCellElement(cell) as VioletDataGridCellLocation | null;
    }

  private cellElementForLocation(
    location: VioletDataGridCellLocation | null,
  ): HTMLTableCellElement | null {
        if (!location) {
            return null;
        }

        const rowId = CSS.escape(location.rowId);
        const columnId = CSS.escape(location.columnId);
        return this.shadowRoot?.querySelector(
      `td[data-row-id="${rowId}"][data-column-id="${columnId}"]`,
        ) as HTMLTableCellElement | null;
    }

    private endPointerSelection(suppressNextClick: boolean): void {
        const scrollContainer = this.getScrollContainer();
        const session = this.#pointerSelectionSession;

        if (
            scrollContainer &&
            session.pointerId !== null &&
            scrollContainer.hasPointerCapture?.(session.pointerId)
        ) {
            try {
                scrollContainer.releasePointerCapture(session.pointerId);
            } catch {
                // Ignore release failures for synthetic pointer events.
            }
        }

        this.#suppressNextGridClick = pointerSelectionSuppressesNextClick(session, suppressNextClick);
        this.#pointerSelectionSession = clearedPointerSelectionSession();
    }

    public cellIdFor(rowId: string, columnId: string): string {
        return `${this.localName}-cell-${this.instanceId}-${this.sanitizeForId(rowId)}-${this.sanitizeForId(columnId)}`;
    }

  public cellEditorErrorIdFor(rowId: string, columnId: string): string {
    return `${this.cellIdFor(rowId, columnId)}-edit-error`;
  }

  public cellEditorHintIdFor(rowId: string, columnId: string): string {
    return `${this.cellIdFor(rowId, columnId)}-edit-hint`;
  }

  /** A column's trimmed `editorHint` or `describe` text for a row; never part of the serialized value. */
  private columnAccessoryText(
    columnId: string,
    rowData: unknown,
    key: "editorHint" | "describe",
  ): string {
    const column = this.presentedColumns[this.#columnIndexById.get(columnId) ?? -1]?.source;
    if (!column || rowData === undefined) {
      return "";
    }
    const text = column[key]?.(rowData);
    return typeof text === "string" ? text.trim() : "";
  }

    private getActiveCellElement(): HTMLTableCellElement | null {
        if (!this.activeCell) {
            return null;
        }

        return this.shadowRoot?.getElementById(
      this.cellIdFor(this.activeCell.rowId, this.activeCell.columnId),
        ) as HTMLTableCellElement | null;
    }

    private selectionCellElementForRow(rowId: string | null): HTMLTableCellElement | null {
        if (!rowId) {
            return null;
        }

        return (
            this.shadowRoot?.querySelector<HTMLTableCellElement>(
                `td.selection-cell[data-selection-row-id="${CSS.escape(rowId)}"]`,
            ) ?? null
        );
    }

    private getActiveGridCellElement(): HTMLTableCellElement | null {
        if (this.focusedSelectionRowId) {
            return this.selectionCellElementForRow(this.focusedSelectionRowId);
        }

        return this.getActiveCellElement();
    }

    private parkFocusOnScrollContainer(): void {
        const scrollContainer = this.getScrollContainer();
        if (!scrollContainer) {
            return;
        }
        this.#parkingFocusOnScrollContainer = true;
        try {
            scrollContainer.focus({ preventScroll: true });
        } finally {
            this.#parkingFocusOnScrollContainer = false;
        }
    }

    private focusActiveCell(options: { preventScroll?: boolean } = {}): boolean {
        const preventScroll = options.preventScroll ?? true;
        const revision = ++this.#pendingCellFocusRevision;
        const cell = this.getActiveGridCellElement();
        if (cell) {
            this.#pendingGridFocus = false;
            cell.focus({ preventScroll });
            // Capture generation after `cell.focus()` so our own synchronous `focusin` does not
            // make the post-update re-check treat our own focus move as an outside departure.
            const focusGeneration = this.#focusGeneration;
            // Re-apply focus after FAST's `Updates` microtask in case `renderedRows.splice`
            // replaced the `<tr>`/`<td>` DOM nodes right after this synchronous call.
            Updates.enqueue(() => {
                if (
                    revision !== this.#pendingCellFocusRevision ||
                    !this.$fastController.isConnected ||
                    this.editingCell ||
                    this.#focusGeneration !== focusGeneration
                ) {
                    return;
                }
                const current = this.getActiveGridCellElement();
                const shadowActive = this.shadowRoot?.activeElement;
                if (
                    shadowActive?.isConnected &&
                    (!this.isGridCellElement(shadowActive) || shadowActive === current)
                ) {
                    return;
                }
                if (current && shadowActive !== current) {
                    const documentActive = this.ownerDocument.activeElement;
                    if (
                        !documentActive ||
                        documentActive === this ||
                        documentActive === this.ownerDocument.body
                    ) {
                        current.focus({ preventScroll });
                    }
                }
            });
            return true;
        }

        if (this.focusMode === "cell" && this.rovingCellTarget()) {
            this.#pendingGridFocus = true;
            this.ensureRovingRowVisible();
            if (this.shadowRoot?.activeElement !== this.getScrollContainer()) {
                this.parkFocusOnScrollContainer();
            }
        }
        return false;
    }

    private ensureRovingRowVisible(): void {
        if (this.focusedSelectionRowId) {
            const rowIndex = this.#rowIndexById.get(this.focusedSelectionRowId);
            if (rowIndex === undefined) {
                return;
            }
            if (this.virtualize) {
                this.#rowVirtualizer.scrollToIndex(rowIndex, { align: "auto" });
            }
            requestAnimationFrame(() => {
                scrollCellIntoScrollContainer(
                    this.selectionCellElementForRow(this.focusedSelectionRowId),
                    this.getScrollContainer(),
                    this.virtualize,
                );
            });
            return;
        }

        this.ensureActiveCellVisible();
    }

    private isGridCellElement(element: Element | null | undefined): element is HTMLTableCellElement {
        return isGridCellElementNode(element);
    }

    private getActiveEditorElement(): VioletCellEditorLike | null {
        if (!this.editingCell) {
            return null;
        }

        const rowId = CSS.escape(this.editingCell.rowId);
        const columnId = CSS.escape(this.editingCell.columnId);
        return this.shadowRoot?.querySelector(
      `.cell-editor[data-row-id="${rowId}"][data-column-id="${columnId}"]`,
        ) as VioletCellEditorLike | null;
    }

    /**
     * Encodes a row or column id into an id-safe token. Every character outside
     * [A-Za-z0-9] (including "_" and "-") becomes `_<hex>_`, so the mapping is
     * injective and a "-" delimiter between encoded parts is unambiguous.
     */
    private sanitizeForId(value: string): string {
        return Array.from(value, (character) =>
            /[a-zA-Z0-9]/.test(character) ? character : `_${character.codePointAt(0)?.toString(16)}_`,
        ).join("");
    }

    private syncHostStates(): void {
        this.toggleState("busy", this.busy);
        this.toggleState("sticky-header", this.stickyHeader);
        this.toggleState("virtualize", this.virtualize);
    this.toggleState("empty", !(this.presentedRows?.length ?? 0));
        this.#internals.ariaBusy = this.busy ? "true" : "false";
    }

  private syncRenderedRows(): void {
    if (!Array.isArray(this.presentedRows) || !Array.isArray(this.presentedColumns)) {
      return;
    }

    const focusedSelectionControl = this.focusedSelectionControl();
    const hadGridCellFocus = this.isGridCellElement(this.shadowRoot?.activeElement);
    const focusGenerationBeforeRender = this.#focusGeneration;
        const virtualItems = this.virtualize ? this.#rowVirtualizer.getVirtualItems() : [];
        const totalSize = this.virtualize ? this.#rowVirtualizer.getTotalSize() : 0;
        const nextState = computeRenderedRows({
            virtualize: this.virtualize,
            rows: this.presentedRows,
            estimatedRowHeight: this.estimatedRowHeight,
            virtualItems,
            totalSize,
        });

    const nextRowIndices = new Set(nextState.renderedRows.map((rendered) => rendered.item.index));
    const presentationRevisionBeforeRecycle = this.#presentationRevision;
    this.recycleFocusedRowIfNeeded(nextRowIndices);
    if (this.#presentationRevision !== presentationRevisionBeforeRecycle) {
      // Committing the recycled editor emits `cell-change`; a handler that replaced
      // `rows` re-entered here, so `nextState` is stale. Recompute from the new rows.
      this.syncRenderedRows();
      return;
    }

    const snapshot = this.interactionSnapshot();

    this.virtualTotalSize = totalSize;
    const canReuseRenderedRows =
      this.#renderedPresentationRevision === this.#presentationRevision &&
      this.#renderedInteractionRevision === this.#interactionRevision;
    const previousRowsByIndex = canReuseRenderedRows
      ? new Map(this.renderedRows.map((rendered) => [rendered.item.index, rendered]))
      : new Map<number, VioletRenderedRow>();
    const nextRenderedRows = nextState.renderedRows.map((rendered) => {
      const row = this.withInteractionState(
        rendered.row as VioletPresentedRow,
        rendered.item.index,
        snapshot,
      );
      const previous = previousRowsByIndex.get(rendered.item.index);
      if (previous?.row === row) {
        previous.item = rendered.item;
        return previous;
      }

      return {
        item: rendered.item,
        row,
      } satisfies VioletRenderedRow;
    });
    const didSpliceRenderedRows =
      nextRenderedRows.length !== this.renderedRows.length ||
      nextRenderedRows.some((rendered, index) => rendered !== this.renderedRows[index]);
    if (didSpliceRenderedRows) {
      this.renderedRows.splice(0, this.renderedRows.length, ...nextRenderedRows);
    }
    this.#renderedPresentationRevision = this.#presentationRevision;
    this.#renderedInteractionRevision = this.#interactionRevision;
    if (this.focusMode === "cell") {
      const renderedRowIds = new Set(nextState.renderedRows.map((rendered) => rendered.row.id));
      for (const rowId of this.#decoratedRowCache.keys()) {
        if (!renderedRowIds.has(rowId)) {
          this.#decoratedRowCache.delete(rowId);
        }
      }
    } else {
      this.#decoratedRowCache.clear();
    }
        this.virtualPaddingStart = nextState.virtualPaddingStart;
        this.virtualPaddingEnd = nextState.virtualPaddingEnd;
    const rovingTarget = this.rovingCellTarget();
    this.rovingCellMounted = Boolean(
      rovingTarget && nextRenderedRows.some((rendered) => rendered.row.id === rovingTarget.rowId),
    );
    const mountedRowIds = new Set(nextRenderedRows.map((rendered) => rendered.row.id));
    this.rowModeMountedRowId =
      this.rowModeFocusRowId && mountedRowIds.has(this.rowModeFocusRowId)
        ? this.rowModeFocusRowId
        : (nextRenderedRows[0]?.row.id ?? null);
    this.scheduleRenderedRowMeasurement();
    this.restoreSelectionControlFocus(focusedSelectionControl);
    this.recheckCellFocusAfterRender(
      hadGridCellFocus,
      focusGenerationBeforeRender,
      didSpliceRenderedRows,
    );
    this.recheckRowModeFocusAfterRender();
    Updates.enqueue(() => this.syncCustomCellWidgetTabIndexes());
  }

  private recheckRowModeFocusAfterRender(): void {
    const pending = this.#pendingRowModeFocus;
    if (!pending || this.focusMode !== "row") {
      return;
    }

    const revision = ++this.#pendingRowModeFocusRevision;
    Updates.enqueue(() => {
      if (
        revision !== this.#pendingRowModeFocusRevision ||
        !this.$fastController.isConnected ||
        this.focusMode !== "row"
      ) {
        return;
      }

      const current = this.#pendingRowModeFocus;
      if (!current) {
        return;
      }

      if (this.#focusGeneration !== current.focusGeneration) {
        this.#pendingRowModeFocus = null;
        return;
      }

      if (!isDocumentFocusAvailableForGrid(this, this.ownerDocument)) {
        this.#pendingRowModeFocus = null;
        return;
      }

      if (this.focusRowModeBodyControl(current.rowId, current.columnId, { preventScroll: false })) {
        this.#pendingRowModeFocus = null;
      }
    });
  }

  private recheckCellFocusAfterRender(hadGridCellFocus: boolean, focusGeneration: number, didSpliceRenderedRows: boolean): void {
    if (
      this.focusMode !== "cell" ||
      (!hadGridCellFocus && !didSpliceRenderedRows && !this.#pendingGridFocus && !this.#pendingCellFocusRecovery)
    ) {
      return;
    }

    const pending = mergePendingCellFocusRecovery(this.#pendingCellFocusRecovery, hadGridCellFocus, focusGeneration);
    this.#pendingCellFocusRecovery = pending;

    const revision = ++this.#cellFocusRecoveryRevision;
    Updates.enqueue(() => {
      if (revision !== this.#cellFocusRecoveryRevision) {
        return;
      }
      this.#pendingCellFocusRecovery = null;
      if (!this.$fastController.isConnected || this.editingCell) {
        return;
      }

      if (this.#pendingGridFocus) {
        const cell = this.getActiveGridCellElement();
        if (cell) {
          this.#pendingGridFocus = false;
          if (isDocumentFocusAvailableForGrid(this, this.ownerDocument) || Boolean(this.shadowRoot?.activeElement)) {
            cell.focus({ preventScroll: true });
          }
        }
        return;
      }

      recoverGridCellFocusAfterRender({
        grid: this,
        ownerDocument: this.ownerDocument,
        shadowRoot: this.shadowRoot,
        pending,
        focusGeneration: this.#focusGeneration,
        gridCellFocusGeneration: this.#gridCellFocusGeneration,
        activeCell: this.getActiveGridCellElement(),
        parkFocusOnScrollContainer: () => this.parkFocusOnScrollContainer(),
      });
    });
  }

  private focusedSelectionControl(): VioletFocusedSelectionControl | null {
    return findFocusedSelectionControl(this.shadowRoot, this.#focusGeneration);
  }

  private selectionControlRowId(element: Element | null): string | undefined {
    return selectionControlRowIdFromElement(element);
  }

  private restoreSelectionControlFocus(focused: VioletFocusedSelectionControl | null): void {
    if (!focused) return;
    const revision = ++this.#selectionControlFocusRevision;
    Updates.enqueue(() => {
      if (revision !== this.#selectionControlFocusRevision) return;
      if (!this.$fastController.isConnected) return;
      const shadowActive = this.shadowRoot?.activeElement;
      if (shadowActive && shadowActive !== focused.element) return;
      const documentActive = this.ownerDocument.activeElement;
      if (
        !shadowActive &&
        documentActive &&
        documentActive !== this.ownerDocument.body &&
        documentActive !== this
      )
        return;
      if (
        shadowActive === focused.element &&
        this.selectionControlRowId(shadowActive) === focused.rowId
      )
        return;
      if (this.#focusGeneration !== focused.focusGeneration) return;
      const replacement = Array.from(
        this.shadowRoot?.querySelectorAll<HTMLElement>(focused.selector) ?? [],
      ).find((control) => this.selectionControlRowId(control) === focused.rowId);
      replacement?.focus({ preventScroll: true });
    });
  }

  readonly #handleFocusIntent = (event: Event): void => {
    this.#focusGeneration += 1;
    if (event.type === "focusin" && this.isGridCellElement(this.shadowRoot?.activeElement)) {
      this.#gridCellFocusGeneration = this.#focusGeneration;
    }
  };

  private interactionSnapshot(): VioletInteractionSnapshot {
    return {
      selectionBounds: this.visualSelectionBounds(),
      fillPreviewBounds: this.fillPreview ? this.boundsForRange(this.fillPreview) : null,
      fillSourceBounds: this.#fillSession.sourceRange
        ? this.boundsForRange(this.#fillSession.sourceRange)
        : this.currentFillSourceBounds(),
    };
  }

  private scheduleRenderedRowMeasurement(): void {
    if (!this.virtualize || !this.$fastController.isConnected) {
      return;
    }

    if (this.#rowMeasurementFrame !== null) {
      cancelAnimationFrame(this.#rowMeasurementFrame);
    }

    this.#rowMeasurementFrame = requestAnimationFrame(() => {
      this.#rowMeasurementFrame = null;
      if (!this.$fastController.isConnected) {
        return;
      }

      this.#rowVirtualizer.measureElement(null);
      const rows = this.shadowRoot?.querySelectorAll<HTMLTableRowElement>("tbody tr[data-index]");
      rows?.forEach((row) => {
        this.#rowVirtualizer.measureElement(row);
      });
    });
  }

  private recycleFocusedRowIfNeeded(nextRowIndices: Set<number>): void {
    if (
      !this.virtualize ||
      this.#editorRecycleInProgress ||
      (nextRowIndices.size === 0 && this.presentedRows.length > 0)
    ) {
      return;
    }

    const editingRowIndex = this.editingCell
      ? this.#rowIndexById.get(this.editingCell.rowId)
      : undefined;
    const activeElement = this.shadowRoot?.activeElement as HTMLElement | null;
    const focusedRow = activeElement?.closest?.("tr[data-row-index]") as HTMLTableRowElement | null;
    const focusedRowIndex = focusedRow
      ? Number.parseInt(focusedRow.dataset.rowIndex ?? "", 10)
      : Number.NaN;
    let shouldRestoreGridFocus =
      Number.isFinite(focusedRowIndex) && !nextRowIndices.has(focusedRowIndex);

    if (editingRowIndex !== undefined && !nextRowIndices.has(editingRowIndex)) {
      this.#editorRecycleInProgress = true;
      const editingLocation = this.editingCell;
      const editingCell = editingLocation ? this.presentedCellAt(editingLocation) : null;
      const editingSessionId = this.#editingSession?.id;
      const committed = this.commitEditingCell();
      if (!committed && editingSessionId && this.#editingSession?.id === editingSessionId) {
        const columnLabel = editingCell?.columnLabel ?? editingLocation?.columnId ?? "cell";
        this.editAnnouncement = `Unsaved invalid edit in ${columnLabel} was cancelled because its row left the visible grid.`;
        this.cancelActiveEdit();
      }
      this.#editorRecycleInProgress = false;
      shouldRestoreGridFocus = true;
    }

    if (!shouldRestoreGridFocus) {
      return;
    }

    if (this.#editorRecycleFocusFrame !== null) {
      cancelAnimationFrame(this.#editorRecycleFocusFrame);
    }
    const focusGeneration = this.#focusGeneration;
    this.#editorRecycleFocusFrame = requestAnimationFrame(() => {
      this.#editorRecycleFocusFrame = null;
      if (
        !this.$fastController.isConnected ||
        this.editingCell ||
        this.#focusGeneration !== focusGeneration
      ) {
        return;
      }
      const documentActive = this.ownerDocument.activeElement;
      if (
        documentActive &&
        documentActive !== this &&
        documentActive !== this.ownerDocument.body
      ) {
        return;
      }
      const activeCell = this.getActiveGridCellElement();
      if (activeCell) {
        activeCell.focus({ preventScroll: true });
      } else {
        this.parkFocusOnScrollContainer();
      }
    });
    }

    private scheduleVirtualizerUpdate(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        if (this.#virtualizerFrame !== null) {
            cancelAnimationFrame(this.#virtualizerFrame);
        }

        this.#virtualizerFrame = requestAnimationFrame(() => {
            this.#virtualizerFrame = null;
            this.#rowVirtualizer.setOptions({
                ...this.#rowVirtualizer.options,
                ...buildVirtualizerUpdateOptions({
                    rows: this.presentedRows,
                    estimatedRowHeight: this.estimatedRowHeight,
                    overscanCount: this.overscanCount,
                    virtualize: this.virtualize,
                }),
            });
            this.#rowVirtualizer._willUpdate();
            this.#rowVirtualizer.measure();
            this.syncRenderedRows();
        });
    }

    private getScrollContainer(): HTMLDivElement | null {
        return this.shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;
    }

  private rowHeightForDensity(density: VioletDataGridDensity): number {
    switch (density) {
      case "compact":
        return 24;
      case "comfortable":
        return 44;
      default:
        return 32;
    }
  }

    private toggleState(name: string, enabled: boolean): void {
        if (enabled) {
            this.#internals.states.add(name);
            return;
        }

        this.#internals.states.delete(name);
    }

    private mergePartNames(basePart: string, extraPart?: string): string {
        return extraPart ? `${basePart} ${extraPart}` : basePart;
    }
}

let violetDataGridInstanceCount = 0;

attr({ attribute: "selection-mode" })(VioletDataGrid.prototype, "selectionMode");
attr({ attribute: "selection-label" })(VioletDataGrid.prototype, "selectionLabel");
attr({ attribute: "sticky-header", mode: "boolean" })(VioletDataGrid.prototype, "stickyHeader");
attr({ mode: "boolean" })(VioletDataGrid.prototype, "busy");
attr({ mode: "boolean" })(VioletDataGrid.prototype, "virtualize");
attr({ attribute: "show-filter", mode: "boolean" })(VioletDataGrid.prototype, "showFilter");
attr(VioletDataGrid.prototype, "density");
attr({ attribute: "focus-mode" })(VioletDataGrid.prototype, "focusMode");
attr({ attribute: "sort-mode" })(VioletDataGrid.prototype, "sortMode");
observable(VioletDataGrid.prototype, "columns");
observable(VioletDataGrid.prototype, "columnWidths");
observable(VioletDataGrid.prototype, "rows");
observable(VioletDataGrid.prototype, "sort");
observable(VioletDataGrid.prototype, "filterState");
observable(VioletDataGrid.prototype, "selectedRowIds");
observable(VioletDataGrid.prototype, "presentedColumns");
observable(VioletDataGrid.prototype, "presentedRows");
observable(VioletDataGrid.prototype, "renderedRows");
observable(VioletDataGrid.prototype, "activeCell");
observable(VioletDataGrid.prototype, "cellSelection");
observable(VioletDataGrid.prototype, "editingCell");
observable(VioletDataGrid.prototype, "editingValue");
observable(VioletDataGrid.prototype, "editingError");
observable(VioletDataGrid.prototype, "editAnnouncement");
observable(VioletDataGrid.prototype, "fillPreview");
observable(VioletDataGrid.prototype, "fillAnnouncement");
observable(VioletDataGrid.prototype, "estimatedRowHeight");
observable(VioletDataGrid.prototype, "overscanCount");
observable(VioletDataGrid.prototype, "virtualPaddingStart");
observable(VioletDataGrid.prototype, "virtualPaddingEnd");
observable(VioletDataGrid.prototype, "virtualTotalSize");
observable(VioletDataGrid.prototype, "hasToolbarSlotContent");
observable(VioletDataGrid.prototype, "headerFocusColumnId");
observable(VioletDataGrid.prototype, "headerFocusSelection");
observable(VioletDataGrid.prototype, "hostAriaLabel");
observable(VioletDataGrid.prototype, "focusedSelectionRowId");
observable(VioletDataGrid.prototype, "rowModeFocusRowId");
observable(VioletDataGrid.prototype, "rowModeFocusColumnId");
observable(VioletDataGrid.prototype, "rowModeMountedRowId");
observable(VioletDataGrid.prototype, "rovingCellMounted");

/** The FAST definition of `<violet-data-grid>`; `defineVioletDataGrid` in `./violet-data-grid.define` registers it. */
export const violetDataGridDefinition = {
  name: "violet-data-grid",
  template,
  styles,
  shadowOptions: {
    delegatesFocus: true,
  },
} satisfies PartialFASTElementDefinition;
