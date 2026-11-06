import { getPref } from "../utils/prefs";
import {
  AnnotationToolType,
  getActiveReader,
  isEditableTarget,
  setAnnotationTool,
} from "./readerBridge";

const TOOL_HOTKEYS: Record<string, AnnotationToolType> = {
  t: "text",
  b: "image",
  f: "ink",
  n: "note",
  u: "underline",
  i: "highlight",
  e: "eraser",
};

const attachedWindows = new WeakSet<Window>();
/** Keys that activated the text tool and are still physically held down. */
const heldToolKeys = new Set<string>();

function handleToolHotkey(event: KeyboardEvent): void {
  if (!getPref("enableHotkeys")) {
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }

  const key = event.key.toLowerCase();

  // Swallow held text-tool key (including repeats into a new annotation editor)
  // until the user releases it.
  if (heldToolKeys.has(key)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (event.repeat) {
    return;
  }
  if (isEditableTarget(event.target)) {
    return;
  }

  const tool = TOOL_HOTKEYS[key];
  if (!tool) {
    return;
  }

  const reader = getActiveReader();
  if (!reader) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  setAnnotationTool(tool, { toggle: true });
  if (tool === "text") {
    heldToolKeys.add(key);
  }
}

function handleToolHotkeyUp(event: KeyboardEvent): void {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }
  heldToolKeys.delete(event.key.toLowerCase());
}

export function registerHotkeys(): void {
  ztoolkit.Keyboard.register((ev) => {
    handleToolHotkey(ev);
  });
  // Clear hold-gate if keyup lands on the main window instead of the reader iframe.
  const mainWin = Zotero.getMainWindow();
  if (mainWin && !attachedWindows.has(mainWin)) {
    attachedWindows.add(mainWin);
    mainWin.addEventListener("keyup", handleToolHotkeyUp, true);
  }
}

export function attachReaderHotkeys(win: Window): void {
  if (attachedWindows.has(win)) {
    return;
  }
  attachedWindows.add(win);
  win.addEventListener("keydown", handleToolHotkey, true);
  win.addEventListener("keyup", handleToolHotkeyUp, true);
}

export function ensureReaderHotkeys(): void {
  const reader = getActiveReader();
  const iframeWin = reader?._iframeWindow;
  if (iframeWin) {
    attachReaderHotkeys(iframeWin);
  }
}

export { TOOL_HOTKEYS };
