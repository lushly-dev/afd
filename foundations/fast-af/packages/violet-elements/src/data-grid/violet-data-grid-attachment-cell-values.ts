export type VioletDataGridAttachmentKind = "image" | "document";

export interface VioletDataGridAttachmentItem {
  id: string;
  label: string;
  kind?: VioletDataGridAttachmentKind;
  previewSrc?: string;
  meta?: string;
}

const ownedPreviewUrlSymbol = Symbol("ownedPreviewUrl");

type AttachmentWithOwnedPreviewUrl = VioletDataGridAttachmentItem & {
  [ownedPreviewUrlSymbol]?: string;
};

export function normalizeAttachmentItems(
  values: readonly unknown[],
): VioletDataGridAttachmentItem[] {
  const seen = new Set<string>();
  const normalized: VioletDataGridAttachmentItem[] = [];

  values.forEach((value, index) => {
    if (!value || typeof value !== "object") {
      return;
    }

    const candidate = value as Record<string, unknown>;
    const label = String(candidate.label ?? candidate.name ?? "").trim();
    if (!label) {
      return;
    }

    const id =
      String(candidate.id ?? label ?? `attachment-${index + 1}`).trim() ||
      `attachment-${index + 1}`;
    if (seen.has(id)) {
      return;
    }

    const previewSrc = typeof candidate.previewSrc === "string" ? candidate.previewSrc.trim() : "";
    const meta = typeof candidate.meta === "string" ? candidate.meta : "";
    const ownedPreviewUrl = readOwnedPreviewUrl(candidate);

    seen.add(id);
    normalized.push({
      id,
      label,
      kind: candidate.kind === "image" ? "image" : "document",
      ...(previewSrc ? { previewSrc } : {}),
      ...(meta ? { meta } : {}),
      ...(ownedPreviewUrl && ownedPreviewUrl === previewSrc
        ? { [ownedPreviewUrlSymbol]: ownedPreviewUrl }
        : {}),
    } satisfies AttachmentWithOwnedPreviewUrl);
  });

  return normalized;
}

export function parseAttachmentCellValue(value: unknown): VioletDataGridAttachmentItem[] {
  if (Array.isArray(value)) {
    return normalizeAttachmentItems(value);
  }

  if (typeof value !== "string") {
    return [];
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmedValue) as unknown;
    if (Array.isArray(parsed)) {
      return normalizeAttachmentItems(parsed);
    }
  } catch {
    // Attachment values are expected to use JSON serialization.
  }

  return [];
}

export function serializeAttachmentCellValue(values: readonly unknown[]): string {
  return JSON.stringify(
    normalizeAttachmentItems(values).map((item) => {
      if (!getOwnedAttachmentPreviewUrl(item)) {
        return item;
      }
      // Locally owned thumbnails expire on disconnect and are not durable attachment URLs.
      const { previewSrc: _previewSrc, ...durableItem } = item;
      return durableItem;
    }),
  );
}

export function attachmentItemsFromFiles(files: readonly File[]): VioletDataGridAttachmentItem[] {
  return files.map((file) => {
    const kind: VioletDataGridAttachmentKind = file.type.startsWith("image/")
      ? "image"
      : "document";
    const previewSrc = kind === "image" ? URL.createObjectURL(file) : "";

    return {
      id: `${file.name}:${file.size}:${file.lastModified}`,
      label: file.name,
      kind,
      previewSrc,
      meta: `${file.type || "File"} · ${formatFileSize(file.size)}`,
      ...(previewSrc ? { [ownedPreviewUrlSymbol]: previewSrc } : {}),
    } satisfies AttachmentWithOwnedPreviewUrl;
  });
}

export function isImageAttachment(item: VioletDataGridAttachmentItem): boolean {
  return item.kind === "image" && Boolean(item.previewSrc);
}

export function getOwnedAttachmentPreviewUrl(
  item: VioletDataGridAttachmentItem,
): string | undefined {
  return readOwnedPreviewUrl(item);
}

export function clearOwnedAttachmentPreview(item: VioletDataGridAttachmentItem): void {
  const ownedItem = item as AttachmentWithOwnedPreviewUrl;
  const url = ownedItem[ownedPreviewUrlSymbol];
  if (!url) {
    return;
  }
  if (ownedItem.previewSrc === url) {
    delete ownedItem.previewSrc;
  }
  delete ownedItem[ownedPreviewUrlSymbol];
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function readOwnedPreviewUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const ownedPreviewUrl = (value as AttachmentWithOwnedPreviewUrl)[ownedPreviewUrlSymbol];
  return typeof ownedPreviewUrl === "string" && ownedPreviewUrl.trim()
    ? ownedPreviewUrl
    : undefined;
}
