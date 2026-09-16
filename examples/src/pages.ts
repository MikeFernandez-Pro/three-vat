// The demo index, derived rather than maintained: every `*.html` beside the
// landing page *is* a demo, so adding one is adding a file. The landing page
// feeds this the result of an `import.meta.glob`, and `vite.config.ts` globs
// the same files for its build entries — neither has a list to forget.
//
// Pure string work, deliberately: no DOM, no fs, no three.js, so the rule
// "a page is named `<renderer>_<demo>.html`" is asserted in a test rather than
// eyeballed in a browser.

/** One demo, as the landing page renders it. */
export interface Page {
  /** Relative to the landing page, so the whole app can live under a subpath. */
  href: string;
  /** `webgl_crowd.html` → `WebGL`. The prefix is load-bearing (ADR-0011). */
  renderer: string;
  title: string;
  summary: string;
}

const RENDERERS: Record<string, string> = {
  webgl: "WebGL",
  webgpu: "WebGPU",
};

function tagText(html: string, tag: string): string {
  return new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(html)?.[1]?.trim() ?? "";
}

function metaContent(html: string, name: string): string {
  return (
    new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`, "i").exec(html)?.[1]?.trim() ?? ""
  );
}

/**
 * Turn globbed HTML sources — `{ path: rawHtml }` — into the demo list.
 *
 * The title shown is the part after the em dash in `<title>` ("three-vat —
 * WebGL robot crowd" → "robot crowd"): the renderer is already its own column,
 * and repeating it in every row reads as noise. A page with no `<title>` still
 * lists, named by its file, so a half-written demo is visible rather than
 * silently missing.
 */
export function listPages(files: Record<string, string>): Page[] {
  return Object.entries(files)
    .map(([path, html]) => {
      const href = path.split("/").pop()!;
      const [prefix, ...rest] = href.replace(/\.html$/, "").split("_");
      return { href, prefix: prefix ?? "", slug: rest.join(" "), html };
    })
    .filter((f) => f.href !== "index.html")
    .sort((a, b) => a.href.localeCompare(b.href))
    .map(({ href, prefix, slug, html }) => ({
      href,
      renderer: RENDERERS[prefix] ?? prefix,
      title: tagText(html, "title").split("—").pop()?.trim().replace(/^WebGPU |^WebGL /, "") || slug,
      summary: metaContent(html, "description"),
    }));
}
