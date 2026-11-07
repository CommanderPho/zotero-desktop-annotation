import { getPref } from "../utils/prefs";
import { ReaderAnnotation } from "./readerBridge";

export const PASTE_OFFSET = 12;

export function resolveTextAnnotationColor(source: ReaderAnnotation): string {
  return (
    (typeof source.color === "string" && source.color) ||
    String(getPref("text.color") || "#000000")
  );
}

export function offsetAnnotationPosition(
  position: NonNullable<ReaderAnnotation["position"]>,
  offset: number,
): NonNullable<ReaderAnnotation["position"]> {
  const next = JSON.parse(JSON.stringify(position)) as NonNullable<
    ReaderAnnotation["position"]
  >;
  if (!offset) {
    return next;
  }
  if (next.rects) {
    next.rects = next.rects.map((rect) => [
      rect[0] + offset,
      rect[1] - offset,
      rect[2] + offset,
      rect[3] - offset,
    ]);
  }
  if (next.paths) {
    next.paths = next.paths.map((path) =>
      path.map((value, index) =>
        index % 2 === 0 ? value + offset : value - offset,
      ),
    );
  }
  return next;
}

export function buildDuplicatedTextAnnotation(
  source: ReaderAnnotation,
  options: { offset?: number } = {},
): ReaderAnnotation | null {
  const sourcePosition = source.position;
  if (!sourcePosition) {
    return null;
  }
  // Keep this a plain chrome-side data object. Do not call reader
  // getAnnotationMeta(position) — content cannot read chrome pageIndex (Xray).
  const offset = options.offset ?? PASTE_OFFSET;
  const position = offsetAnnotationPosition(sourcePosition, offset);

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
    color: resolveTextAnnotationColor(source),
    comment: source.comment ?? source.text ?? "",
    position,
    sortIndex,
    pageLabel,
  };
}
