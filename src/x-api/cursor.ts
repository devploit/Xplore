type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** Finds the bottom cursor of any timeline response by its `cursorType`, never by position. */
export function bottomCursor(body: unknown): string | undefined {
  let found: string | undefined;
  const visit = (node: unknown, depth: number): void => {
    if (found || depth > 64) return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    if (!isRec(node)) return;
    if (node.cursorType === "Bottom" && typeof node.value === "string" && node.value) {
      found = node.value;
      return;
    }
    for (const v of Object.values(node)) visit(v, depth + 1);
  };
  visit(body, 0);
  return found;
}
