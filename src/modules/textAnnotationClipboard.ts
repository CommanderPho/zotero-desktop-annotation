import { getPref } from "../utils/prefs";
import {
  addReaderAnnotation,
  getActiveReader,
  getSelectedAnnotations,
  isEditableTarget,
  isTextAnnotationEditorFocused,
  ReaderAnnotation,
  ReaderInstance,
} from "./readerBridge";

const CLIPBOARD_MIME = "application/x-zotero-desktop-annotation+json";
const PASTE_OFFSET = 12;

type ClipboardPayload = {
  version: 1;
  annotation: ReaderAnnotation;
};

let memoryClipboard: ClipboardPayload | null = null;
let lastPasteAt = 0;
const attachedWindows = new WeakSet<Window>();

function resolvePasteColor(source: ReaderAnnotation): string {
  return (
    (typeof source.color === "string" && source.color) ||
    String(getPref("text.color") || "#000000")
  );
}

function buildDuplicatedTextAnnotation(
  source: ReaderAnnotation,
): ReaderAnnotation | null {
  const sourcePosition = source.position;
  if (!sourcePosition) {
    return null;
  }
  // Keep this a plain chrome-side data object. Do not call reader
  // getAnnotationMeta(position) — content cannot read chrome pageIndex (Xray).
  const position = offsetPosition(sourcePosition);

  let sortIndex =
    typeof source.sortIndex === "string" && source.sortIndex
      ? source.sortIndex
      : "";
  if (!sortIndex) {
    // Last-resort: page-based index so AnnotationManager accepts the create
    const page = Number.isFinite(position.pageIndex) ? position.pageIndex : 0;
    sortIndex = `${String(page).padStart(5, "0")}|000000|00000`;
  }

  const pageLabel =
    typeof source.pageLabel === "string" ? source.pageLabel : "";

  return {
    type: "text",
    color: resolvePasteColor(source),
    comment: source.comment ?? source.text ?? "",
    position,
    sortIndex,
    pageLabel,
  };
}

function buildPayload(annotation: ReaderAnnotation): ClipboardPayload {
  return {
    version: 1,
    annotation: {
      type: annotation.type,
      color: resolvePasteColor(annotation),
      comment: annotation.comment,
      text: annotation.text,
      sortIndex:
        typeof annotation.sortIndex === "string"
          ? annotation.sortIndex
          : undefined,
      pageLabel:
        typeof annotation.pageLabel === "string"
          ? annotation.pageLabel
          : undefined,
      position: annotation.position
        ? JSON.parse(JSON.stringify(annotation.position))
        : undefined,
    },
  };
}

function offsetPosition(
  position: NonNullable<ReaderAnnotation["position"]>,
): NonNullable<ReaderAnnotation["position"]> {
  const next = JSON.parse(JSON.stringify(position)) as NonNullable<
    ReaderAnnotation["position"]
  >;
  if (next.rects) {
    next.rects = next.rects.map((rect) => [
      rect[0] + PASTE_OFFSET,
      rect[1] - PASTE_OFFSET,
      rect[2] + PASTE_OFFSET,
      rect[3] - PASTE_OFFSET,
    ]);
  }
  if (next.paths) {
    next.paths = next.paths.map((path) =>
      path.map((value, index) =>
        index % 2 === 0 ? value + PASTE_OFFSET : value - PASTE_OFFSET,
      ),
    );
  }
  return next;
}

function getSelectedTextAnnotation(
  reader?: ReaderInstance | null,
): ReaderAnnotation | null {
  const selected = getSelectedAnnotations(reader).filter(
    (a) => a.type === "text",
  );
  return selected[0] || null;
}

function copySelectedTextAnnotation(
  event: ClipboardEvent,
  reader: ReaderInstance,
): boolean {
  if (isTextAnnotationEditorFocused(reader)) {
    return false;
  }
  const annotation = getSelectedTextAnnotation(reader);
  if (!annotation) {
    return false;
  }

  const payload = buildPayload(annotation);
  memoryClipboard = payload;

  try {
    event.clipboardData?.setData(CLIPBOARD_MIME, JSON.stringify(payload));
    const plain =
      annotation.comment ||
      annotation.text ||
      (typeof annotation.comment === "string" ? annotation.comment : "");
    if (plain) {
      event.clipboardData?.setData("text/plain", String(plain));
    }
  } catch (e) {
    ztoolkit.log("clipboard setData failed; using memory clipboard", e);
  }

  event.preventDefault();
  event.stopPropagation();
  return true;
}

function readPayload(event: ClipboardEvent): ClipboardPayload | null {
  try {
    const raw = event.clipboardData?.getData(CLIPBOARD_MIME);
    if (raw) {
      const parsed = JSON.parse(raw) as ClipboardPayload;
      if (parsed?.version === 1 && parsed.annotation?.type === "text") {
        return parsed;
      }
    }
  } catch (e) {
    ztoolkit.log("clipboard getData failed", e);
  }
  if (memoryClipboard?.annotation?.type === "text") {
    return memoryClipboard;
  }
  return null;
}

function pasteTextAnnotation(
  event: ClipboardEvent,
  reader: ReaderInstance,
): boolean {
  if (isTextAnnotationEditorFocused(reader)) {
    return false;
  }
  if (isEditableTarget(event.target)) {
    return false;
  }

  const payload = readPayload(event);
  if (!payload?.annotation?.position) {
    return false;
  }

  const annotation = buildDuplicatedTextAnnotation(payload.annotation);
  if (!annotation) {
    return false;
  }

  const created = addReaderAnnotation(annotation, reader);
  if (!created) {
    return false;
  }

  lastPasteAt = Date.now();
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function onCopy(event: ClipboardEvent): void {
  const reader = getActiveReader();
  if (!reader) {
    return;
  }
  copySelectedTextAnnotation(event, reader);
}

function onPaste(event: ClipboardEvent): void {
  const reader = getActiveReader();
  if (!reader) {
    return;
  }
  pasteTextAnnotation(event, reader);
}

function onKeyDown(event: KeyboardEvent): void {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod || event.altKey) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key !== "c" && key !== "v") {
    return;
  }

  const reader = getActiveReader();
  if (!reader) {
    return;
  }

  // Native copy/paste events will fire for clipboardData; for some reader
  // paths only keydown arrives, so handle paste from memory on keydown too.
  if (key === "c") {
    if (isTextAnnotationEditorFocused(reader)) {
      return;
    }
    const annotation = getSelectedTextAnnotation(reader);
    if (!annotation) {
      return;
    }
    memoryClipboard = buildPayload(annotation);
    // Let the copy event populate system clipboard when available.
    return;
  }

  if (key === "v") {
    if (isTextAnnotationEditorFocused(reader) || isEditableTarget(event.target)) {
      return;
    }
    if (!memoryClipboard?.annotation?.position) {
      return;
    }
    // Avoid duplicating when a native paste event will also fire.
    if (Date.now() - lastPasteAt < 250) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const annotation = buildDuplicatedTextAnnotation(memoryClipboard.annotation);
    if (annotation && addReaderAnnotation(annotation, reader)) {
      lastPasteAt = Date.now();
      event.preventDefault();
      event.stopPropagation();
    }
  }
}

export function attachClipboardHandlers(win: Window): void {
  if (attachedWindows.has(win)) {
    return;
  }
  attachedWindows.add(win);
  win.addEventListener("copy", onCopy, true);
  win.addEventListener("paste", onPaste, true);
  win.addEventListener("keydown", onKeyDown, true);
}

export function ensureClipboardHandlers(): void {
  const reader = getActiveReader();
  if (reader?._iframeWindow) {
    attachClipboardHandlers(reader._iframeWindow);
  }
  // Also listen on main windows so shortcuts still work when focus is outside
  // the iframe chrome but a reader tab is selected.
  for (const win of Zotero.getMainWindows()) {
    attachClipboardHandlers(win);
  }
}

export function registerTextAnnotationClipboard(): void {
  ensureClipboardHandlers();
}
