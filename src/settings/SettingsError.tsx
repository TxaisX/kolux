/** T-752 (DT-C188): a Settings page's error line. A failed save keeps the controls and says the change could
 * not be saved, and why (T-757 asked for that context on Notifications; it holds on every page). A first
 * read that failed leaves the page without controls, so it says the settings could not be read and offers
 * Try again. */
export function SettingsError({ error, loaded, onRetry }: { error: string | null; loaded: boolean; onRetry: () => void }) {
  if (!error) return null;
  return (
    <p className="conn-detail warn" role="alert">
      {loaded ? `The change could not be saved: ${error}` : `The settings could not be read: ${error}`}
      {!loaded && (
        <>
          {" "}
          <button className="btn" onClick={onRetry}>
            Try again
          </button>
        </>
      )}
    </p>
  );
}
