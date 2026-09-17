/** The only CSS that leaves the shadow root: layout tweaks on X's own page. */
export const PAGE_CSS = `
body.xl-hide-sidebar [data-testid="sidebarColumn"] { display: none !important; }
body.xl-hide-dm [data-testid="DMDrawer"] { display: none !important; }
body.xl-open main[role="main"] { margin-right: 0; }
`;

export function ensurePageStyles(doc: Document = document): void {
  if (doc.getElementById("x-lytics-page-css")) return;
  const style = doc.createElement("style");
  style.id = "x-lytics-page-css";
  style.textContent = PAGE_CSS;
  doc.head.appendChild(style);
}

export function applyBodyClasses(doc: Document, flags: { open: boolean; hideSidebar: boolean; hideDm: boolean }): void {
  doc.body.classList.toggle("xl-open", flags.open);
  doc.body.classList.toggle("xl-hide-sidebar", flags.open && flags.hideSidebar);
  doc.body.classList.toggle("xl-hide-dm", flags.open && flags.hideDm);
}
