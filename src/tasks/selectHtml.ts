// Reads a src/ui Select out of server-rendered HTML. Its closed control shows the chosen label and carries every
// option's label, unseen, to size itself as a native select is sized; a test that read a native <select>'s <option>
// markup reads these instead. The open list is Base UI's and is proved on a real DOM (src/ui/ui.dom.test.tsx).
const text = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

/** The Select named `label` in `html`: the label it shows and the labels it offers, in order; null when there is none. */
export function selectIn(html: string, label: string): { chosen: string; offered: string[] } | null {
  const at = html.indexOf(`aria-label="${label.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;")}"`);
  if (at < 0) return null;
  const rest = html.slice(at);
  const m = /^[^>]*class="[^"]*\bui-select\b[^"]*"[^>]*><span class="ui-select-box"><span class="ui-select-value">([\s\S]*?)<\/span><span class="ui-select-sizer" aria-hidden="true">((?:<span>[\s\S]*?<\/span>)*)<\/span><\/span>/.exec(rest);
  if (!m) return null;
  return { chosen: text(m[1]), offered: [...m[2].matchAll(/<span>([\s\S]*?)<\/span>/g)].map((x) => text(x[1])) };
}
