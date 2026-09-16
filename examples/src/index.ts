// The landing page. The demo list is globbed from the HTML files next to it, so
// a new page appears here the moment it exists — no list to edit, matching the
// build entries, which are globbed too (vite.config.ts).
import { listPages } from "./pages.js";

// Eager and raw: the pages are read at build time as text, and `listPages` pulls
// the title and summary out of each one. Nothing of a demo's code is loaded here.
const sources = import.meta.glob("../*.html", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

const list = document.getElementById("demos")!;
list.replaceChildren(
  ...listPages(sources).map((page) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "demo";
    link.href = page.href;

    const renderer = document.createElement("div");
    renderer.className = "renderer";
    renderer.textContent = page.renderer;

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = page.title;

    const summary = document.createElement("div");
    summary.className = "summary";
    summary.textContent = page.summary;

    link.append(renderer, name, summary);
    item.append(link);
    return item;
  }),
);
