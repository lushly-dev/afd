import {
  bindOverlayAnchor,
  createAnchorName,
  type LazyFallbackOptionsTuple,
  type OverlayAlign,
  type OverlayPlacement,
  supportsCssAnchorPositioning,
} from "./overlay-anchor";

export { createAnchorName, type OverlayAlign, type OverlayPlacement, supportsCssAnchorPositioning };

/**
 * Removes an anchor name only if the element still holds this component's name.
 */
export function clearAnchorName(element: HTMLElement | null, anchorName: string): void {
  if (element && element.style.getPropertyValue("anchor-name").trim() === anchorName) {
    element.style.removeProperty("anchor-name");
  }
}

/**
 * Binds one unique CSS anchor name to the internal shadow-DOM anchor and pairs the floating
 * surface to it with `position-anchor`, leaving external light-DOM triggers untouched.
 */
export function syncAnchorNames(options: {
  internalAnchor: HTMLElement | null;
  externalAnchor: HTMLElement | null;
  floating: HTMLElement | null;
  anchorName: string;
}): void {
  bindOverlayAnchor(
    options.internalAnchor,
    options.externalAnchor,
    options.floating,
    options.anchorName,
  );
}

export interface OverlayPositionOptions {
  placement?: OverlayPlacement;
  align?: OverlayAlign;
  gap?: number;
  margin?: number;
}

export interface ComputedOverlayPosition {
  top: number;
  left: number;
  placement: OverlayPlacement;
}

/**
 * Resolves a pre-read CSS length string (such as `"0.5rem"`, `".5rem"`, `"12px"`, `"1in"`, or
 * `"calc(0.5rem + 2px)"`) into CSS pixels, preserving explicit zero values.
 */
export function resolveCssLengthPx(rawValue: string, element: HTMLElement, fallbackPx = 8): number {
  const raw = rawValue.trim();
  if (!raw) {
    return fallbackPx;
  }
  if (raw === "0") {
    return 0;
  }
  const pxMatch = /^(-?(?:\d+\.?\d*|\.\d+))px$/i.exec(raw);
  if (pxMatch) {
    return Number.parseFloat(pxMatch[1]);
  }
  if (element.isConnected) {
    const doc = element.ownerDocument;
    const probe = doc.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    probe.style.width = "0";
    probe.style.height = "0";
    probe.style.left = raw;
    if (probe.style.left) {
      const container = element.shadowRoot ?? element;
      container.append(probe);
      const resolved = Number.parseFloat(getComputedStyle(probe).left);
      probe.remove();
      if (Number.isFinite(resolved)) {
        return resolved;
      }
    }
    return fallbackPx;
  }
  const unitMatch = /^(-?(?:\d+\.?\d*|\.\d+))(rem|em|in|cm|mm|pt|pc)$/i.exec(raw);
  if (unitMatch) {
    const value = Number.parseFloat(unitMatch[1]);
    const unit = unitMatch[2].toLowerCase();
    if (unit === "rem") {
      const rootFontSize =
        Number.parseFloat(getComputedStyle(element.ownerDocument.documentElement).fontSize) || 16;
      return value * rootFontSize;
    }
    if (unit === "em") {
      const elFontSize = Number.parseFloat(getComputedStyle(element).fontSize) || 16;
      return value * elFontSize;
    }
    const absolutePx: Record<string, number> = {
      in: 96,
      cm: 96 / 2.54,
      mm: 96 / 25.4,
      pt: 96 / 72,
      pc: 16,
    };
    return value * (absolutePx[unit] ?? 1);
  }
  return fallbackPx;
}

export function normalizePlacement(
  value: string | null | undefined,
  fallback: OverlayPlacement = "below",
): OverlayPlacement {
  if (value === "above" || value === "below" || value === "before" || value === "after") {
    return value;
  }
  return fallback;
}

/**
 * Computes viewport-clamped `position: fixed` coordinates for a floating overlay
 * relative to an anchor, flipping to the opposite side when overflowing the viewport.
 */
export function computeFallbackPosition(
  anchorRect: Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width" | "height">,
  floatingRect: Pick<DOMRect, "width" | "height">,
  viewport: { width: number; height: number },
  options: OverlayPositionOptions = {},
): ComputedOverlayPosition {
  const gap = options.gap ?? 8;
  const margin = options.margin ?? 8;
  const align = options.align ?? "center";
  let placement: OverlayPlacement = options.placement ?? "below";

  const placeFor = (side: OverlayPlacement): { top: number; left: number } => {
    if (side === "above") {
      const left =
        align === "start"
          ? anchorRect.left
          : anchorRect.left + (anchorRect.width - floatingRect.width) / 2;
      return { top: anchorRect.top - floatingRect.height - gap, left };
    }
    if (side === "below") {
      const left =
        align === "start"
          ? anchorRect.left
          : anchorRect.left + (anchorRect.width - floatingRect.width) / 2;
      return { top: anchorRect.bottom + gap, left };
    }
    if (side === "before") {
      const top =
        align === "start"
          ? anchorRect.top
          : anchorRect.top + (anchorRect.height - floatingRect.height) / 2;
      return { top, left: anchorRect.left - floatingRect.width - gap };
    }
    const top =
      align === "start"
        ? anchorRect.top
        : anchorRect.top + (anchorRect.height - floatingRect.height) / 2;
    return { top, left: anchorRect.right + gap };
  };

  let coords = placeFor(placement);

  if (placement === "below" && coords.top + floatingRect.height > viewport.height - margin) {
    const flipped = placeFor("above");
    if (
      flipped.top >= margin ||
      flipped.top > viewport.height - (coords.top + floatingRect.height)
    ) {
      placement = "above";
      coords = flipped;
    }
  } else if (placement === "above" && coords.top < margin) {
    const flipped = placeFor("below");
    if (
      flipped.top + floatingRect.height <= viewport.height - margin ||
      viewport.height - (flipped.top + floatingRect.height) > coords.top
    ) {
      placement = "below";
      coords = flipped;
    }
  } else if (placement === "after" && coords.left + floatingRect.width > viewport.width - margin) {
    const flipped = placeFor("before");
    if (
      flipped.left >= margin ||
      flipped.left > viewport.width - (coords.left + floatingRect.width)
    ) {
      placement = "before";
      coords = flipped;
    }
  } else if (placement === "before" && coords.left < margin) {
    const flipped = placeFor("after");
    if (
      flipped.left + floatingRect.width <= viewport.width - margin ||
      viewport.width - (flipped.left + floatingRect.width) > coords.left
    ) {
      placement = "after";
      coords = flipped;
    }
  }

  if (align === "start" && (placement === "below" || placement === "above")) {
    if (coords.left + floatingRect.width > viewport.width - margin) {
      coords.left = anchorRect.right - floatingRect.width;
    }
  }

  const maxLeft = Math.max(margin, viewport.width - floatingRect.width - margin);
  const maxTop = Math.max(margin, viewport.height - floatingRect.height - margin);
  const left = Math.min(Math.max(coords.left, margin), maxLeft);
  const top = Math.min(Math.max(coords.top, margin), maxTop);

  return { top, left, placement };
}

/**
 * Applies JS fallback coordinates to a floating element anchored to `anchor`.
 */
export function positionFloatingFallback(
  anchor: HTMLElement,
  floating: HTMLElement,
  options: OverlayPositionOptions = {},
): ComputedOverlayPosition {
  const anchorRect = anchor.getBoundingClientRect();
  const floatingRect = floating.getBoundingClientRect();
  const result = computeFallbackPosition(
    anchorRect,
    floatingRect,
    { width: window.innerWidth, height: window.innerHeight },
    options,
  );

  // Reset CSS anchor properties and directional margins so @supports anchor rules do not
  // collide with or double-gap the explicit fixed coordinates (e.g. external anchors on Chromium).
  floating.style.position = "fixed";
  floating.style.inset = "auto";
  floating.style.margin = "0";
  floating.style.setProperty("position-area", "none");
  floating.style.setProperty("position-try-fallbacks", "none");
  floating.style.top = `${result.top}px`;
  floating.style.left = `${result.left}px`;
  return result;
}

/**
 * Clears inline fallback positioning properties so native CSS anchor positioning applies cleanly.
 */
export function clearFallbackPosition(floating: HTMLElement | null): void {
  if (!floating) {
    return;
  }
  floating.style.removeProperty("position");
  floating.style.removeProperty("top");
  floating.style.removeProperty("left");
  floating.style.removeProperty("inset");
  floating.style.removeProperty("margin");
  floating.style.removeProperty("position-area");
  floating.style.removeProperty("position-try-fallbacks");
}

/**
 * Keeps a floating overlay positioned in browsers without CSS Anchor Positioning,
 * repositioning on scroll and resize while open.
 */
export class FallbackPositionController {
  #active = false;
  #rafId = 0;
  #getAnchor: (() => HTMLElement | null) | null = null;
  #getFloating: (() => HTMLElement | null) | null = null;
  #getOptions: (() => OverlayPositionOptions) | null = null;

  public start(
    getAnchor: () => HTMLElement | null,
    getFloating: () => HTMLElement | null,
    getOptions: () => OverlayPositionOptions,
    forceFallback = false,
  ): void {
    this.stop();

    if (!forceFallback && supportsCssAnchorPositioning()) {
      clearFallbackPosition(getFloating());
      return;
    }

    this.#active = true;
    this.#getAnchor = getAnchor;
    this.#getFloating = getFloating;
    this.#getOptions = getOptions;

    this.update();
    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = 0;
      if (this.#active) {
        this.update();
      }
    });

    window.addEventListener("scroll", this.#handleReposition, true);
    window.addEventListener("resize", this.#handleReposition);
  }

  public update(): void {
    if (!this.#active || !this.#getAnchor || !this.#getFloating || !this.#getOptions) {
      return;
    }

    const anchor = this.#getAnchor();
    const floating = this.#getFloating();
    if (!anchor || !floating) {
      return;
    }

    positionFloatingFallback(anchor, floating, this.#getOptions());
  }

  public stop(floating?: HTMLElement | null): void {
    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = 0;
    }
    if (this.#active) {
      window.removeEventListener("scroll", this.#handleReposition, true);
      window.removeEventListener("resize", this.#handleReposition);
      this.#active = false;
    }
    const target = floating ?? this.#getFloating?.() ?? null;
    clearFallbackPosition(target);
    this.#getAnchor = null;
    this.#getFloating = null;
    this.#getOptions = null;
  }

  #handleReposition = (): void => {
    this.update();
  };
}

export function startLazyFallback(
  existing: FallbackPositionController | null,
  getAnchor: () => HTMLElement | null,
  getFloating: () => HTMLElement | null,
  getOptions: () => LazyFallbackOptionsTuple,
  force: boolean,
): FallbackPositionController {
  const controller = existing ?? new FallbackPositionController();
  controller.start(
    getAnchor,
    getFloating,
    () => {
      const [placement, defaultPlacement, align, gapRaw, gapElement, gapFallback] = getOptions();
      return {
        placement: normalizePlacement(placement, defaultPlacement),
        align,
        gap: resolveCssLengthPx(gapRaw, gapElement, gapFallback),
      };
    },
    force,
  );
  return controller;
}
