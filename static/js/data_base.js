/* Where the heavy tile data is served from.
 *
 * Empty string = same origin, which is how the site ships today: everything
 * under website/website/data is published with the pages.
 *
 * To move the tile data to object storage (see OPERATIONS.md section 3), upload
 * the heavy directories to the bucket, put its public URL here, and redeploy.
 * Nothing else changes: the page rebases only the heavy paths and leaves the
 * small first-paint JSON on the page's own origin.
 *
 *   window.ENSOSCOPE_DATA_BASE = "https://tiles.iadicarlo.org";
 *
 * The site itself stays at https://iadicarlo.org/ensoscope either way: this
 * hostname is only ever a fetch target, never something a visitor sees or types.
 *
 * The bucket must send CORS headers allowing the site origin, or every tile
 * fetch fails with an opaque network error rather than a useful status.
 */
window.ENSOSCOPE_DATA_BASE = "https://tiles.iadicarlo.org";

/* Bump on every DATA deploy (not on code-only changes).
 *
 * Heavy tiles are immutable for the life of a deploy, so they are fetched with
 * normal HTTP caching and served with a one-year immutable Cache-Control. That
 * is what keeps read operations near zero: without it every revisit re-fetches
 * every tile, and on metered object storage those reads are the thing that
 * actually costs money. This version string is what makes hard caching safe:
 * a rebuild changes the URL, so nobody is served a stale tile.
 */
window.ENSOSCOPE_DATA_VERSION = "20260827f";
