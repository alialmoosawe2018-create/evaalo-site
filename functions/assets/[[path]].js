/**
 * Returns a real 404 for a missing file under /assets/.
 *
 * The SPA fallback in `public/_redirects` (`/* /index.html 200`) matches any path
 * that is not a file on disk, asset paths included. A deploy replaces every
 * content-hashed filename, so a tab holding the previous index.html can ask for a
 * chunk that no longer exists and be handed index.html at status 200 instead. The
 * browser then refuses the stylesheet on MIME grounds and the page renders
 * unstyled, while the `/assets/*` rule in `public/_headers` tells every cache in
 * the path — the browser's and Cloudflare's edge — to keep that HTML under the
 * asset's URL for a year. One badly timed request poisons the URL for everyone
 * behind that cache.
 *
 * `_redirects` cannot express this: rewrites to a non-200 status are not
 * supported, so the fallback cannot be made to skip asset paths. Hence a function,
 * which runs ahead of asset serving and can inspect what the fallback produced.
 *
 * Successful responses are returned untouched so they keep the headers Pages
 * attached from `_headers`, and every failure path answers 404 rather than
 * throwing, because a throw here would take down asset serving for the whole site.
 */
const NOT_FOUND_HEADERS = {
  'content-type': 'text/plain; charset=utf-8',
  // Never let a 404 occupy the slot of an asset that a later deploy restores.
  'cache-control': 'no-store',
};

function notFound() {
  return new Response('Not found\n', { status: 404, headers: NOT_FOUND_HEADERS });
}

export async function onRequest(context) {
  let response;
  try {
    response = await context.next();
  } catch {
    return notFound();
  }

  // Nothing Vite emits under /assets/ is HTML, so HTML here is the SPA fallback
  // answering for a file that is not there.
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) return notFound();

  return response;
}
