/**
 * Walks up through shadow boundaries to find the nearest enclosing `<dialog>` or `<violet-dialog>`.
 */
export function findEnclosingDialog(element: Element): HTMLElement | null {
  let current: Node | null = element.parentNode;
  while (current) {
    if (current instanceof Element) {
      if (
        current instanceof HTMLElement &&
        (current.localName === "dialog" || current.localName === "violet-dialog")
      ) {
        return current;
      }
      current = current.parentNode;
    } else if (current instanceof ShadowRoot) {
      current = current.host;
    } else {
      break;
    }
  }
  return null;
}

/**
 * Reports whether an enclosing `<dialog>` or `<violet-dialog>` is currently open.
 */
export function isDialogOpen(dialog: HTMLElement): boolean {
  if (dialog instanceof HTMLDialogElement) {
    return dialog.open;
  }
  const inner = dialog.shadowRoot?.querySelector("dialog");
  if (inner instanceof HTMLDialogElement) {
    return inner.open;
  }
  return dialog.hasAttribute("open");
}

/**
 * Promotes a `popover="manual"` panel into the top layer. When `repromote` is true and the panel
 * is already open, hides and re-shows it so it stacks above an enclosing modal dialog that entered
 * the top layer after it.
 */
export function showManualPopover(panel: HTMLElement, repromote = false): void {
  panel.hidden = false;
  if (!panel.isConnected || typeof panel.showPopover !== "function") {
    return;
  }
  if (panel.matches(":popover-open")) {
    if (!repromote) {
      return;
    }
    panel.hidePopover();
  }
  panel.showPopover();
}

export function hideManualPopover(panel: HTMLElement): void {
  if (typeof panel.hidePopover === "function" && panel.matches(":popover-open")) {
    panel.hidePopover();
  }
  panel.hidden = true;
}

/**
 * Watches an enclosing `<dialog>` or `<violet-dialog>` for open/close transitions so an open
 * manual popover stays hidden while its dialog is closed and is promoted above the modal dialog
 * once that dialog opens.
 */
export function observeEnclosingDialog(
  dialog: HTMLElement,
  onStateChange: (open: boolean) => void,
): () => void {
  let lastOpen = isDialogOpen(dialog);
  const notify = (): void => {
    const nextOpen = isDialogOpen(dialog);
    if (nextOpen !== lastOpen) {
      lastOpen = nextOpen;
      onStateChange(nextOpen);
    }
  };

  const observer = new MutationObserver(notify);
  observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
  const inner = dialog.shadowRoot?.querySelector("dialog");
  if (inner instanceof HTMLDialogElement) {
    observer.observe(inner, { attributes: true, attributeFilter: ["open"] });
  }

  const onOpenChange = (event: Event): void => {
    if (event.target === dialog) {
      // violet-dialog fires open-change synchronously after showModal() / close().
      // Always re-sync on open so a late-upgraded <violet-dialog open> never covers the panel.
      const nextOpen = isDialogOpen(dialog);
      lastOpen = nextOpen;
      onStateChange(nextOpen);
    }
  };
  dialog.addEventListener("open-change", onOpenChange);

  return () => {
    observer.disconnect();
    dialog.removeEventListener("open-change", onOpenChange);
  };
}
