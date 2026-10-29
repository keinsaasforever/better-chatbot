# Boot diagnostics

The temporary boot trace distinguishes redirects, full document reloads,
React remounts, subtree remounts, speculative requests, and back/forward cache
restores.

## Enable it

Set `BOOT_DIAGNOSTICS=1` for the deployment and redeploy. Filter the Vercel
runtime logs for `[boot]`.

Remove or unset the variable after the trace is captured. When disabled, the
middleware does not create diagnostic IDs or logs, the client detector is not
rendered, and the beacon endpoint returns `404`.

## Correlation fields

- `visitId` groups document requests within a 30-minute browser visit,
  including redirect hops.
- `documentId` identifies one top-level HTML document request.
- `tabId` identifies the browser tab once client JavaScript runs.
- `documentSequence` increments when that tab creates another JavaScript
  document.
- `elapsedMs` is the event time relative to the start of its document.

Paths and referrers exclude query strings. Diagnostic IDs are random and are
not authentication credentials.

## Events

- `[boot] document`: middleware saw a top-level document request. `outcome`
  reports `next` or `redirect`, and `location` reports the redirect target.
- `[boot] server-render`: `/` or `/sign-in` rendered for that document.
- `[boot] client` with `event: "client-boot"`: JavaScript started. Important
  fields include `navigationType`, `redirectCount`, `documentSequence`,
  `documentReferrer`, service-worker timing, and cache transfer size.
- `react-mount` / `react-unmount`: the root detector mounted or unmounted. This
  detector is a sibling *above* every provider, so these counters say nothing
  about the app subtree.
- `shell-mount` / `shell-unmount`: the same, measured from *inside* the provider
  tree. `firstContentfulPaint` and the `serverBody*` fields ride along.
- `chatbot-mount` / `chatbot-unmount`: the chat subtree mounted or unmounted.
- `error` / `unhandledrejection`: a client failure occurred before a possible
  recovery navigation.
- `beforeunload` / `pagehide`: the current document is leaving.
- `pageshow` with `persisted: true`: the page returned from the browser's
  back/forward cache; this is not a reload.
- `anchor-click` / `popstate`: a user or history navigation preceded the load.

## Read the sequence

### Expected unauthenticated redirect

The two document requests share a `visitId` but have different `documentId`
values:

1. `document` for `/`, `outcome: "redirect"`, `location: "/sign-in"`
2. `document` for `/sign-in`, `outcome: "next"`
3. `server-render` for `/sign-in`
4. `client-boot` for the second document

This is an intentional redirect, not an unexplained reload.

### Genuine full reload

The same `visitId` and `tabId` show a second `documentId`, with
`documentSequence` increasing. A `pagehide` or `beforeunload` normally appears
before the second `client-boot`.

- Second `navigationType: "reload"`: an actual reload.
- Second `navigationType: "navigate"` with the previous page as referrer: a
  hard navigation rather than the browser reload command.
- `error` or `unhandledrejection` immediately before `pagehide`: likely
  framework recovery after a chunk, hydration, or runtime failure.
- No client event for one of two server documents: the extra request was
  probably speculative or discarded before JavaScript ran.

### Blank server HTML / client-only first paint

Not every "double load" is a reload or a remount. If a provider withholds its
children until a client effect runs, the server sends an empty `<body>`, the
browser paints nothing, and the whole tree mounts after hydration. Users see the
app appear in two stages; the document and mount counters look perfectly normal.

Read it off `client-boot` and `shell-mount`:

- `serverBodyChildCount` near zero (only the theme bootstrap script) and
  `serverBodyTextLength` at `0`: the app was not in the server render. These are
  captured before React hydrates, so they describe the server's markup exactly.
- `firstContentfulPaint` at or after the first `shell-mount` `elapsedMs`: nothing
  was painted until JavaScript ran.
- One `documentId`, `react-mount: 1`, no `pagehide`: confirms it is neither a
  reload nor a remount.

This was the actual cause of the long-running double load: `ThemeStyleProvider`
returned `null` until a `useLayoutEffect` set a `mounted` flag, which excluded
every route from server rendering. `theme-provider.test.tsx` now guards it.

### React or chat-only remount

If `documentId` stays unchanged:

- `react-mount` reaches 2: the client root remounted.
- Root mount remains 1 but `chatbot-mount` repeats: only the chat subtree
  remounted.

### Back/forward cache

`pageshow` with `persisted: true` and no new `document` event is a cache restore,
not a network load.
