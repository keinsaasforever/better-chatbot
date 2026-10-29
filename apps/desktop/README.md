# Keinsaas Navigator desktop

Electron shell that loads the deployed web app (`https://app.keinsaas.com`, or
`http://localhost:3000` in development) and adds what a browser cannot: local
stdio MCP servers, native notifications, auto-updates, and a Stripe checkout
window.

```sh
pnpm --filter desktop dev        # web (SKIP_DB_MIGRATE=1) + electron
pnpm --filter desktop test       # vitest, pure modules only
pnpm --filter desktop build      # esbuild main + tsc preload → dist/
pnpm --filter desktop dist:win   # or dist:mac / dist:linux
```

## Sign-in runs in the system browser

Identity providers refuse OAuth inside embedded web views: Google answers with
`disallowed_useragent` ("This browser or app may not be secure") because the
Electron user agent identifies itself. So the app never loads a provider's
consent screen. Instead:

1. `sign-in` / `sign-up` in the renderer call `window.desktop.auth.startBrowserSignIn`.
2. `src/main/desktop-auth.ts` issues a random `state`, writes it to
   `<userData>/pending-sign-in.json` (10-minute TTL) and opens the web app's
   sign-in page in the default browser with
   `callbackUrl=/desktop/auth/complete?state=…`.
3. The browser finishes sign-in normally. `/desktop/auth/complete` mints a
   Better Auth one-time token and opens `keinsaas://auth/callback?token=…&state=…`.
4. The OS hands the URL to the app: `open-url` on macOS, `argv` through
   `second-instance` (or on cold start) on Windows and Linux. `state` is
   compared against the pending file, then the main process POSTs the token to
   `/api/auth/one-time-token/verify` from the default session so the session
   cookie lands in the app's own cookie jar, and loads the app.

The `keinsaas://` scheme is registered by `protocols` in `electron-builder.yml`
(CFBundleURLTypes on macOS, `HKCU\Software\Classes\keinsaas` from the NSIS
installer on Windows, `x-scheme-handler` on Linux). The app also holds the
single-instance lock: a protocol launch on Windows/Linux starts a second
process that forwards its argv to the running one and exits.

### Testing the handoff in development

- Windows: `electron .` registers the scheme with the script path, so the
  running dev instance receives the link through `second-instance`.
- macOS: `electron .` has no `Info.plist`, so `open-url` never fires. Use a
  packaged build (`pnpm --filter desktop dist:mac`), or simulate a cold-start
  launch on any platform by passing the link as an argument:

  ```sh
  pnpm --filter desktop build
  npx electron apps/desktop "keinsaas://auth/callback?token=<token>&state=<state>"
  ```

  The `state` must match the one written to `pending-sign-in.json` by the
  previous run.
- The web app has to run with `NO_HTTPS=1` so the localhost verify response
  can set a non-secure cookie.

Deploy order matters: ship the web change (the `/desktop/auth/complete` route
and the one-time-token plugin) before a desktop release that uses it.

## Auto-update

`src/main/auto-updater.ts` wraps electron-updater against the generic feed in
`electron-builder.yml` (DigitalOcean Spaces, `latest.yml` / `latest-mac.yml`).

- Checks for a new version at startup, whenever the window regains focus (at
  most every 30 minutes) and every hour while the app stays open.
  **Help > Check for Updates…** runs a check immediately and reports the result
  in a dialog.
- A new version downloads in the background. The web UI shows a toast with
  **Restart now**; if the user ignores it, the update installs on the next quit
  (`autoInstallOnAppQuit`).
- Every updater event is appended to `updater.log` in the app's log directory
  (`%LOCALAPPDATA%\Keinsaas Navigator\logs` on Windows,
  `~/Library/Logs/Keinsaas Navigator` on macOS), capped at 512 KB. Updater
  errors also go to desktop telemetry when `KEINSAAS_DESKTOP_TELEMETRY=1`.
- Builds packaged without `DESKTOP_UPDATE_FEED_URL` have no feed and the
  updater stays off; the log says so on startup.
- electron-updater is external and CommonJS while the main bundle is ESM, so
  `autoUpdater` is reached through `resolveAutoUpdater` (`updater-interop.ts`)
  rather than destructured off the namespace — see the comment there. The
  updater only runs in packaged builds, so nothing in `dev` or the smoke test
  exercises this path.

`release.yml` calls `desktop-release.yml` directly once release-please has
tagged, so a release ships the desktop app without anyone dispatching it. The
tag push cannot do that on its own: GitHub does not start workflows from events
made with `GITHUB_TOKEN`, which is what release-please tags with. `workflow_dispatch`
remains for rebuilding a version by hand, with `dry_run` to skip publishing.
