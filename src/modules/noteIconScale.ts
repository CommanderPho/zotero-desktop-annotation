import { getPref } from "../utils/prefs";
import {
  getActiveReader,
  getInternalReader,
  ReaderInstance,
  waitForInternalReader,
} from "./readerBridge";

const PATCH_FLAG = "__zdaNoteIconPatch";

type PageProto = {
  [PATCH_FLAG]?: boolean;
  _pushNote?: (items: Array<Record<string, unknown>>, annotation: unknown) => void;
  [key: string]: unknown;
};

function getScale(): number {
  const percent = Number(getPref("noteIconScalePercent"));
  if (!Number.isFinite(percent)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0.35, percent / 100));
}

function patchPagePrototype(proto: PageProto): boolean {
  if (!proto || typeof proto._pushNote !== "function") {
    return false;
  }
  if (proto[PATCH_FLAG]) {
    return true;
  }

  const original = proto._pushNote;
  proto._pushNote = function patchedPushNote(
    this: unknown,
    items: Array<Record<string, unknown>>,
    annotation: unknown,
  ) {
    const before = items.length;
    original!.call(this, items, annotation);
    const scale = getScale();
    if (scale >= 0.999) {
      return;
    }
    for (let i = before; i < items.length; i++) {
      const item = items[i];
      if (item?.kind === "noteIcon" && typeof item.scale === "number") {
        item.scale = Number(item.scale) * scale;
      }
    }
  };
  proto[PATCH_FLAG] = true;
  return true;
}

function collectPagePrototypes(reader: ReaderInstance): PageProto[] {
  const ir = getInternalReader(reader);
  const pages =
    (ir?._primaryView?._pages as Array<{
      constructor?: { prototype?: PageProto };
    }>) || [];
  const protos: PageProto[] = [];
  const seen = new Set<PageProto>();

  for (const page of pages) {
    const proto = page?.constructor?.prototype;
    if (proto && !seen.has(proto)) {
      seen.add(proto);
      protos.push(proto);
    }
  }

  // Also try secondary view if present.
  const secondary = (ir as { _secondaryView?: { _pages?: unknown[] } })
    ?._secondaryView?._pages as
    | Array<{ constructor?: { prototype?: PageProto } }>
    | undefined;
  for (const page of secondary || []) {
    const proto = page?.constructor?.prototype;
    if (proto && !seen.has(proto)) {
      seen.add(proto);
      protos.push(proto);
    }
  }

  return protos;
}

function requestRedraw(reader: ReaderInstance): void {
  try {
    const ir = getInternalReader(reader) as {
      _primaryView?: { _render?: () => void; refresh?: () => void };
      setAnnotations?: (annotations: unknown[]) => void;
      _state?: { annotations?: unknown[] };
    } | null;
    if (!ir) {
      return;
    }
    if (typeof ir._primaryView?._render === "function") {
      ir._primaryView._render();
      return;
    }
    if (typeof ir.setAnnotations === "function" && ir._state?.annotations) {
      ir.setAnnotations([...ir._state.annotations]);
    }
  } catch (e) {
    ztoolkit.log("note icon redraw failed", e);
  }
}

export function applyNoteIconScale(reader?: ReaderInstance | null): void {
  const active = reader ?? getActiveReader();
  if (!active) {
    return;
  }
  try {
    const protos = collectPagePrototypes(active);
    let patched = false;
    for (const proto of protos) {
      patched = patchPagePrototype(proto) || patched;
    }
    if (patched) {
      requestRedraw(active);
    }
  } catch (e) {
    ztoolkit.log("applyNoteIconScale failed", e);
  }
}

export async function ensureNoteIconScale(
  reader?: ReaderInstance | null,
): Promise<void> {
  const active = reader ?? getActiveReader();
  if (!active) {
    return;
  }
  await waitForInternalReader(active);
  applyNoteIconScale(active);

  // Pages may mount lazily while scrolling; re-check a few times.
  for (const delay of [500, 1500, 3000]) {
    Zotero.Promise.delay(delay).then(() => {
      if (!addon.data.alive) {
        return;
      }
      applyNoteIconScale(active);
    });
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function registerNoteIconScale(): void {
  if (pollTimer) {
    return;
  }
  // Lightweight poll to catch newly opened readers / newly created page classes.
  pollTimer = setInterval(() => {
    if (!addon.data.alive) {
      return;
    }
    applyNoteIconScale();
  }, 4000);
}

export function unregisterNoteIconScale(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
