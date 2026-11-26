export type OverlayPlacement = "above" | "below" | "before" | "after";
export type OverlayAlign = "center" | "start";

export type LazyFallbackOptionsTuple = readonly [
  placement: string | undefined,
  defaultPlacement: OverlayPlacement,
  align: OverlayAlign,
  gapRaw: string,
  gapElement: HTMLElement,
  gapFallback: number,
];

type PositioningModule = typeof import("./overlay-positioning");
let positioningModule: PositioningModule | null = null;
let positioningPromise: Promise<PositioningModule> | null = null;

function loadPositioning(): Promise<PositioningModule> {
  if (!positioningPromise) {
    positioningPromise = import("./overlay-positioning").then((mod) => {
      positioningModule = mod;
      return mod;
    });
  }
  return positioningPromise;
}

/**
 * Generates a unique CSS dashed-ident anchor name for a component instance.
 */
export function createAnchorName(prefix: string, id: number): string {
  return `--${prefix}-anchor-${id}`;
}

/**
 * Returns true when the browser supports CSS Anchor Positioning (`anchor-name`, `position-area`,
 * and `position-try-fallbacks`) as used by Violet overlay components.
 */
export function supportsCssAnchorPositioning(): boolean {
  return Boolean(
    typeof CSS !== "undefined" &&
      CSS.supports?.(
        "(anchor-name: --a) and (position-area: block-end center) and (position-try-fallbacks: flip-block)",
      ),
  );
}

/**
 * Binds one unique CSS anchor name to the internal shadow-DOM anchor and pairs the floating
 * surface to it with `position-anchor`. External light-DOM triggers are left untouched because
 * CSS `anchor-name` is tree-scoped across shadow boundaries and external anchoring uses the JS
 * geometry fallback.
 */
export function bindOverlayAnchor(
  internalAnchor: HTMLElement | null,
  externalAnchor: HTMLElement | null,
  floating: HTMLElement | null,
  anchorName: string,
): void {
  if (externalAnchor) {
    internalAnchor?.style.removeProperty("anchor-name");
    floating?.style.removeProperty("position-anchor");
    return;
  }

  internalAnchor?.style.setProperty("anchor-name", anchorName);
  floating?.style.setProperty("position-anchor", anchorName);
}

/**
 * Thin facade over `FallbackPositionController` that keeps the JS geometry fallback out of the
 * static bundle on browsers with native CSS Anchor Positioning. The fallback module is imported
 * lazily only when CSS Anchor Positioning is unsupported or an external anchor forces JS layout.
 */
export class LazyFallbackPositionController {
  #controller: InstanceType<PositioningModule["FallbackPositionController"]> | null = null;
  #generation = 0;

  public start(
    getAnchor: () => HTMLElement | null,
    getFloating: () => HTMLElement | null,
    getOptions: () => LazyFallbackOptionsTuple,
    force = false,
  ): void {
    const generation = ++this.#generation;
    if (!force && supportsCssAnchorPositioning()) {
      this.#controller?.stop(getFloating());
      return;
    }

    const startWith = (mod: PositioningModule) => {
      if (generation !== this.#generation) {
        return;
      }
      this.#controller = mod.startLazyFallback(
        this.#controller,
        getAnchor,
        getFloating,
        getOptions,
        force,
      );
    };

    if (positioningModule) {
      startWith(positioningModule);
      return;
    }

    void loadPositioning().then(startWith);
  }

  public update(): void {
    this.#controller?.update();
  }

  public stop(floating?: HTMLElement | null): void {
    this.#generation += 1;
    this.#controller?.stop(floating);
  }
}
