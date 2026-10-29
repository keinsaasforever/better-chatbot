## Social Login Setup (Google & GitHub, English)

### Get your Google credentials

To use Google as a social provider, you need to get your Google credentials. You can get them by creating a new project in the [Google Cloud Console](https://console.cloud.google.com/apis/dashboard).

- In the Google Cloud Console, go to **APIs & Services > Credentials**.
- Click **Create Credentials** and select **OAuth client ID**.
- Choose **Web application** as the application type.
- In **Authorized redirect URIs**, set:
  - For local development: `http://localhost:3000/api/auth/callback/google`
  - For production: your deployed application's URL, e.g. `https://example.com/api/auth/callback/google`
- If you change the base path of your authentication routes, update the redirect URL accordingly.
- After creation, copy your **Client ID** and **Client Secret** and add them to your `.env` file:
  ```
  GOOGLE_CLIENT_ID=your_client_id
  GOOGLE_CLIENT_SECRET=your_client_secret
  ```

### Get your GitHub credentials

To use GitHub sign in, you need a client ID and client secret. You can get them from the [GitHub Developer Portal](https://github.com/settings/developers).

- For local development, set the redirect URL to:
  - `http://localhost:3000/api/auth/callback/github`
- For production, set it to your deployed application's URL, e.g.:
  - `https://your-domain.com/api/auth/callback/github`
- If you change the base path of your authentication routes, make sure to update the redirect URL accordingly.
- **Important:** You MUST include the `user:email` scope in your GitHub app to ensure the application can access the user's email address.
- Add your credentials to your `.env` file:
  ```
  GITHUB_CLIENT_ID=your_client_id
  GITHUB_CLIENT_SECRET=your_client_secret
  ```

### Get your Microsoft credentials

To use Microsoft as a social provider, you need to get your Microsoft credentials. You can get them by creating a new app in the [Microsoft Azure Portal](https://portal.azure.com/).

- In the Microsoft Azure Portal, go to **Azure Active Directory > App registrations**.
- Click **New registration**.
- Choose **Web** as the application type.
- In **Redirect URIs**, set:
  - For local development: `http://localhost:3000/api/auth/callback/microsoft`
  - For production: your deployed application's URL, e.g. `https://example.com/api/auth/callback/microsoft`
- If you change the base path of your authentication routes, update the redirect URL accordingly.
- Add your credentials to your `.env` file:

  ```text
  MICROSOFT_CLIENT_ID=your_client_id
  MICROSOFT_CLIENT_SECRET=your_client_secret
  MICROSOFT_TENANT_ID=your_tenant_id # Optional
  ```

## Environment Variable Check

Make sure your `.env` file contains the following variables:

```text
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
# Set to 1 to force account selection
GOOGLE_FORCE_ACCOUNT_SELECTION=1

GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# Microsoft
MICROSOFT_CLIENT_ID=your_microsoft_client_id
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
# Optional Tenant Id
MICROSOFT_TENANT_ID=your_microsoft_tenant_id
# Set to 1 to force account selection
MICROSOFT_FORCE_ACCOUNT_SELECTION=1


```

## Additional Configuration Options

### Authentication Settings

```text
# Disable email/password sign-in (optional)
DISABLE_EMAIL_SIGN_IN=1

# Disable new user sign-ups (optional)
DISABLE_SIGN_UP=1
```

### Base URL Configuration

For OAuth to work correctly, you must set the `BETTER_AUTH_URL` environment variable to match how you access the application:

```text
# For local development with HTTPS
BETTER_AUTH_URL=https://localhost:3000

# For local development with HTTP (default)
BETTER_AUTH_URL=http://localhost:3000

# For production
BETTER_AUTH_URL=https://yourdomain.com
```

**Important:** If you're using HTTPS locally (e.g., via a reverse proxy or custom SSL setup), make sure to set `BETTER_AUTH_URL=https://localhost:3000` to ensure OAuth callbacks work correctly.

## Desktop app (Electron)

Providers refuse OAuth inside embedded web views. Google returns
`403 disallowed_useragent` ("This browser or app may not be secure") as soon as
the consent screen loads in an Electron window, and the callback never fires.
The desktop app therefore never loads a provider itself:

1. Clicking a provider inside the app opens the web app's sign-in page in the
   user's default browser with `callbackUrl=/desktop/auth/complete?state=<nonce>`.
2. The browser completes the normal flow above, so the OAuth redirect URI stays
   `https://<domain>/api/auth/callback/<provider>`. **No extra redirect URI is
   needed for the desktop app.**
3. `/desktop/auth/complete` (session required) mints a one-time token via the
   Better Auth `oneTimeToken` plugin (`lib/auth/auth-instance.ts`: 5-minute
   expiry, hashed at rest, server-minted only) and opens
   `keinsaas://auth/callback?token=…&state=…`.
4. The desktop main process checks the nonce, calls
   `POST /api/auth/one-time-token/verify`, and the session cookie lands in the
   app. See `apps/desktop/README.md` for the Electron side and how to test it.

The browser and the app share one Better Auth session; signing out in the
browser signs the app out as well.

## Done

You can now sign in to better-chatbot using your Google, GitHub or Microsoft account. Restart the application to apply the changes.
