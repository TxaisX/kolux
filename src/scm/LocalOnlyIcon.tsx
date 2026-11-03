// T-654 (DT-C89): the drawing and the words of the "local only" icon, kept apart from the badge's
// tiny shell (LocalOnlyBadge.tsx) so the sidebar's first load does not carry them: they load the
// first time a repository without a remote is shown.
export const LOCAL_ONLY_TEXT = "Local only: this repository has no remote, so Kolux commits here but never pushes";

/** A cloud with a stroke through it, in the current text colour. */
export const LocalOnlyGlyph = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M4.5 11.75h6.9a2.6 2.6 0 0 0 .5-5.15 3.7 3.7 0 0 0-7.2-.4 2.8 2.8 0 0 0-.2 5.55Z" />
    <path d="M2.5 2.5l11 11" />
  </svg>
);

/** The icon on its own: no text, a tooltip and an accessible name, and it never grows the row. */
export default function LocalOnlyIcon() {
  return (
    <span role="img" data-local-only title={LOCAL_ONLY_TEXT} aria-label={LOCAL_ONLY_TEXT} style={{ display: "inline-flex", flex: "none", alignItems: "center", opacity: 0.7 }}>
      <LocalOnlyGlyph />
    </span>
  );
}
