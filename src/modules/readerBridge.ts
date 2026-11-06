import { getPref, setPref } from "../utils/prefs";

export type AnnotationToolType =
  | "highlight"
  | "underline"
  | "note"
  | "image"
  | "text"
  | "ink"
  | "eraser"
  | "pointer"
  | "hand";

export type ReaderAnnotation = {
  id?: string;
  type: string;
  color?: string;
  comment?: string;
  text?: string;
  position?: {
    pageIndex: number;
    rects?: number[][];
    paths?: number[][];
    fontSize?: number;
    rotation?: number;
    width?: number;
  };
  [key: string]: unknown;
};

export type InternalReader = {
  setTool?: (params: Record<string, unknown>) => void;
  toggleTool?: (type: string) => void;
  /** Prefer over setTool({type}) from chrome — avoids Xray writes onto content tool objects. */
  _updateState?: (state: Record<string, unknown>) => void;
  setSelectedAnnotations?: (ids: string[]) => void;
  addAnnotation?: (annotation: ReaderAnnotation, select?: boolean) => unknown;
  _annotationManager?: {
    addAnnotation?: (annotation: ReaderAnnotation) => unknown;
  };
  _state?: {
    tool?: { type?: string; color?: string; size?: number };
    selectedAnnotationIDs?: string[];
    annotations?: ReaderAnnotation[];
  };
  _tools?: Record<string, { type: string; color?: string; size?: number }>;
  _primaryView?: {
    _pages?: Array<{ constructor: { prototype: Record<string, unknown> } }>;
    [key: string]: unknown;
  };
  _lastView?: {
    focus?: () => void;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ReaderInstance = {
  _internalReader?: InternalReader;
  _iframeWindow?: Window;
  _iframe?: HTMLIFrameElement;
  itemID?: number;
  _item?: Zotero.Item;
  [key: string]: unknown;
};

const TEXT_FONT_MIN = 4;
const TEXT_FONT_MAX = 192;

export function clampTextFontSize(size: number): number {
  if (!Number.isFinite(size)) {
    return 10;
  }
  return Math.min(TEXT_FONT_MAX, Math.max(TEXT_FONT_MIN, Math.round(size)));
}

export function getActiveReader(): ReaderInstance | null {
  try {
    const win = Zotero.getMainWindow();
    if (!win?.Zotero_Tabs) {
      return null;
    }
    const reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID) as unknown as
      | ReaderInstance
      | undefined;
    if (!reader) {
      return null;
    }
    if (reader._internalReader || reader._iframeWindow) {
      return reader;
    }
    return null;
  } catch (e) {
    ztoolkit.log("getActiveReader failed", e);
    return null;
  }
}

export function getInternalReader(
  reader?: ReaderInstance | null,
): InternalReader | null {
  const active = reader ?? getActiveReader();
  return active?._internalReader || null;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  // Zotero chrome/sandbox may not define global Element; duck-type instead of
  // `instanceof Element` (which also fails across iframe realms).
  if (!target || typeof target !== "object") {
    return false;
  }
  const el = target as {
    nodeType?: number;
    closest?: (selector: string) => unknown;
    isContentEditable?: boolean;
    classList?: { contains: (token: string) => boolean };
    tagName?: string;
  };
  if (el.nodeType !== 1) {
    return false;
  }
  const tag = (el.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (el.closest?.("input, textarea, select, [contenteditable='true']")) {
    return true;
  }
  if (el.isContentEditable) {
    return true;
  }
  if (el.classList?.contains("textAnnotation")) {
    return true;
  }
  if (el.closest?.(".textAnnotation")) {
    return true;
  }
  return false;
}

export function isTextAnnotationEditorFocused(
  reader?: ReaderInstance | null,
): boolean {
  const active = reader ?? getActiveReader();
  const doc = active?._iframeWindow?.document;
  const focused = doc?.activeElement as HTMLElement | null;
  if (!focused) {
    return false;
  }
  return (
    focused.classList?.contains("textAnnotation") ||
    !!focused.closest?.(".textAnnotation") ||
    focused.isContentEditable
  );
}

export function getSelectedAnnotations(
  reader?: ReaderInstance | null,
): ReaderAnnotation[] {
  const ir = getInternalReader(reader);
  const ids = ir?._state?.selectedAnnotationIDs || [];
  const annotations = ir?._state?.annotations || [];
  return annotations.filter((a) => a.id && ids.includes(a.id));
}

export function applyTextStyleToTool(ir: InternalReader): void {
  const size = clampTextFontSize(Number(getPref("text.fontSize")));
  const color = String(getPref("text.color") || "#000000");
  if (ir._tools?.text) {
    ir._tools.text.size = size;
    ir._tools.text.color = color;
  }
}

/**
 * Activate a tool and leave it on (unlike toggleTool, which turns it off if
 * already active). Uses the reader's own `_tools[type]` object via `_updateState`
 * so we never assign a chrome-compartment `{ type }` onto a content tool (that
 * triggers "Security wrapper denied access to property type").
 */
function activateToolSticky(ir: InternalReader, type: AnnotationToolType): boolean {
  const toolRef = ir._tools?.[type];
  if (toolRef && typeof ir._updateState === "function") {
    ir._updateState({ tool: toolRef });
    ir.setSelectedAnnotations?.([]);
    return true;
  }
  // Fallback: toggle on; if that toggled off an already-active tool, toggle again.
  if (!ir.toggleTool) {
    return false;
  }
  ir.toggleTool(type);
  const current = ir._state?.tool?.type;
  if (current !== type) {
    ir.toggleTool(type);
  }
  return true;
}

export function setAnnotationTool(
  type: AnnotationToolType,
  options: { toggle?: boolean } = {},
): boolean {
  const ir = getInternalReader();
  if (!ir?.setTool && !ir?.toggleTool && !ir?._updateState) {
    return false;
  }

  if (type === "text") {
    applyTextStyleToTool(ir);
  }

  try {
    if (options.toggle && ir.toggleTool) {
      ir.toggleTool(type);
      if (type === "text" && ir._state?.tool?.type === "text") {
        // Mutate the live content tool in place (same compartment refs).
        applyTextStyleToTool(ir);
        const textTool = ir._tools?.text;
        if (textTool && ir._updateState) {
          ir._updateState({ tool: textTool });
        }
      }
      return true;
    }

    // Sticky / explicit activate — do not use setTool({ type }) from chrome.
    if (type === "text") {
      applyTextStyleToTool(ir);
    }
    return activateToolSticky(ir, type);
  } catch (e) {
    ztoolkit.log("setAnnotationTool failed", type, e);
    return false;
  }
}

export function setTextStyle(style: {
  size?: number;
  color?: string;
}): boolean {
  const ir = getInternalReader();
  if (!ir) {
    return false;
  }

  if (style.size !== undefined) {
    const size = clampTextFontSize(style.size);
    setPref("text.fontSize", size);
  }
  if (style.color !== undefined) {
    setPref("text.color", style.color);
  }

  applyTextStyleToTool(ir);

  try {
    const textTool = ir._tools?.text;
    if (ir._state?.tool?.type === "text" && textTool && ir._updateState) {
      ir._updateState({ tool: textTool });
    }
    return true;
  } catch (e) {
    ztoolkit.log("setTextStyle failed", e);
    return false;
  }
}

export function syncTextStyleFromReader(reader?: ReaderInstance | null): void {
  const ir = getInternalReader(reader);
  const tool = ir?._state?.tool;
  if (tool?.type !== "text") {
    return;
  }
  if (typeof tool.size === "number") {
    setPref("text.fontSize", clampTextFontSize(tool.size));
  }
  if (typeof tool.color === "string" && tool.color) {
    setPref("text.color", tool.color);
  }
}

export function addReaderAnnotation(
  annotation: ReaderAnnotation,
  reader?: ReaderInstance | null,
): unknown {
  const ir = getInternalReader(reader);
  if (!ir) {
    return null;
  }
  try {
    if (typeof ir.addAnnotation === "function") {
      return ir.addAnnotation(annotation, true);
    }
    if (typeof ir._annotationManager?.addAnnotation === "function") {
      return ir._annotationManager.addAnnotation(annotation);
    }
  } catch (e) {
    ztoolkit.log("addReaderAnnotation failed", e);
  }
  return null;
}

export async function waitForInternalReader(
  reader: ReaderInstance,
  timeoutMs = 15000,
): Promise<InternalReader | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (reader._internalReader?.setTool) {
      return reader._internalReader;
    }
    await Zotero.Promise.delay(100);
  }
  return reader._internalReader || null;
}
