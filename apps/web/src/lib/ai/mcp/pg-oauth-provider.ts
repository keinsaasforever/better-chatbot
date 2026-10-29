import "server-only";

import {
  OAuthClientProvider,
  OAuthDiscoveryState,
  UnauthorizedError,
  registerClient,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { McpOAuthSession } from "app-types/mcp";
import { ConsolaInstance } from "consola";
import { colorize } from "consola/utils";
import { MCP_OAUTH_FALLBACK_SCOPE } from "lib/const";
import { pgMcpOAuthRepository } from "lib/db/pg/repositories/mcp-oauth-repository.pg";
import globalLogger from "lib/logger";
import { generateUUID } from "lib/utils";
import { isAccessTokenExpired, mergeOAuthTokens } from "./oauth-token-utils";

/**
 * PostgreSQL-based OAuth client provider for MCP servers
 * Manages OAuth authentication state and tokens with multi-instance support
 */
export class PgOAuthClientProvider implements OAuthClientProvider {
  private currentOAuthState: string = "";
  private cachedAuthData: McpOAuthSession | undefined;
  private logger: ConsolaInstance;
  private initialized = false;
  private refreshLockRelease?: () => Promise<void>;
  private refreshLockTimer?: ReturnType<typeof setTimeout>;
  private useFallbackScope = false;

  constructor(
    private config: {
      name: string;
      mcpServerId: string;
      serverUrl: string;
      _clientMetadata: OAuthClientMetadata;
      onRedirectToAuthorization: (authUrl: URL) => Promise<void>;
      state?: string;
    },
    private repository = pgMcpOAuthRepository,
  ) {
    this.logger = globalLogger.withDefaults({
      message: colorize(
        "dim",
        `[MCP OAuth Provider ${this.config.name}-${generateUUID().slice(0, 4)}] `,
      ),
    });
  }

  private async initializeOAuth() {
    if (this.initialized) return;
    // 0. If a constructor state was provided (callback/hand-off), adopt it first
    if (this.config.state) {
      const session = await this.repository.getSessionByState(
        this.config.state,
      );
      if (session && session.mcpServerId === this.config.mcpServerId) {
        this.currentOAuthState = session.state || "";
        this.cachedAuthData = session;
        this.initialized = true;
        this.logger.info("Adopted OAuth session from provided state");
        return;
      }
    }
    // 1. Check for authenticated session first
    const authenticated = await this.repository.getAuthenticatedSession(
      this.config.mcpServerId,
    );
    if (authenticated) {
      this.currentOAuthState = authenticated.state || "";
      this.cachedAuthData = authenticated;
      this.initialized = true;
      this.logger.info("Using existing authenticated session");
      return;
    }

    // 2. Always create a new in-progress session when not authenticated
    this.currentOAuthState = generateUUID();
    this.cachedAuthData = await this.repository.createSession(
      this.config.mcpServerId,
      {
        state: this.currentOAuthState,
        serverUrl: this.config.serverUrl,
      },
    );
    this.initialized = true;
    this.logger.info("Created new OAuth session");
  }

  private async getAuthData() {
    await this.initializeOAuth();
    return this.cachedAuthData;
  }

  private async reloadAuthData() {
    await this.initializeOAuth();
    if (!this.currentOAuthState) return this.cachedAuthData;

    this.cachedAuthData = await this.repository.getSessionByState(
      this.currentOAuthState,
    );
    return this.cachedAuthData;
  }

  private async releaseRefreshSerialization() {
    if (this.refreshLockTimer) {
      clearTimeout(this.refreshLockTimer);
      this.refreshLockTimer = undefined;
    }

    const release = this.refreshLockRelease;
    this.refreshLockRelease = undefined;
    await release?.();
  }

  async abortPendingRefresh(): Promise<void> {
    await this.releaseRefreshSerialization();
  }

  private async updateAuthData(data: Partial<McpOAuthSession>) {
    // clientInformation() resets state on a redirect-URI mismatch; start a
    // fresh session instead of failing the re-registration that follows.
    await this.initializeOAuth();
    if (!this.currentOAuthState) {
      throw new Error("OAuth not initialized");
    }

    this.cachedAuthData = await this.repository.updateSessionByState(
      this.currentOAuthState,
      data,
    );
    return this.cachedAuthData;
  }

  get redirectUrl(): string {
    return this.config._clientMetadata.redirect_uris[0];
  }

  get clientMetadata(): OAuthClientMetadata {
    if (!this.useFallbackScope) return this.config._clientMetadata;
    return { ...this.config._clientMetadata, scope: MCP_OAUTH_FALLBACK_SCOPE };
  }

  /**
   * Called by the SDK after discovery and before it registers a client. Some
   * authorization servers (Clerk) reject the non-standard `mcp:tools` scope.
   * Drop it when the server's metadata does not list it, and register here
   * (instead of letting the SDK do it) so a rejected registration is retried
   * once with the fallback scope. The SDK then finds the stored client and
   * skips its own registration.
   */
  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    const metadata = state.authorizationServerMetadata;
    const supported = metadata?.scopes_supported;
    if (supported && !supported.includes("mcp:tools")) {
      this.useFallbackScope = true;
    }

    if (await this.clientInformation()) return;

    let info: OAuthClientInformationFull;
    try {
      info = await registerClient(state.authorizationServerUrl, {
        metadata,
        clientMetadata: this.clientMetadata,
      });
    } catch (error) {
      if (this.useFallbackScope) throw error;
      this.logger.warn(
        `Client registration failed; retrying without mcp:tools: ${error}`,
      );
      this.useFallbackScope = true;
      try {
        info = await registerClient(state.authorizationServerUrl, {
          metadata,
          clientMetadata: this.clientMetadata,
        });
      } catch {
        this.useFallbackScope = false;
        throw error;
      }
    }

    // Persist the scope the client was registered with so later requests
    // (other instances, the OAuth callback) keep requesting only that.
    await this.saveClientInformation({
      ...info,
      scope: info.scope ?? this.clientMetadata.scope,
    });
  }

  state(): string {
    return this.currentOAuthState;
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const authData = await this.getAuthData();
    if (authData?.clientInfo) {
      // Redirect-URI mismatch (e.g. a domain move leaves a stored registration
      // pointing at the old callback) makes the whole registration dead. Drop
      // the session even when it still has tokens, release any refresh lock,
      // and reset state so the next connect dynamically re-registers under the
      // current domain and shows "Authorizing" — one click recovers it.
      // `redirect_uris` may be empty/undefined on a malformed record; treat a
      // missing entry as a mismatch rather than crashing.
      if (authData.clientInfo.redirect_uris?.[0] !== this.redirectUrl) {
        if (authData.state) {
          await this.repository.deleteByState(authData.state);
        }
        this.cachedAuthData = undefined;
        this.initialized = false;
        this.currentOAuthState = "";
        await this.releaseRefreshSerialization();
        return undefined;
      }
      // Registered without mcp:tools (fallback path, possibly on another
      // instance): don't ask the authorization server for it now.
      const registeredScope = authData.clientInfo.scope?.split(" ");
      if (registeredScope && !registeredScope.includes("mcp:tools")) {
        this.useFallbackScope = true;
      }
      return authData.clientInfo;
    }

    return undefined;
  }

  async saveClientInformation(
    clientCredentials: OAuthClientInformationFull,
  ): Promise<void> {
    await this.updateAuthData({
      clientInfo: clientCredentials,
    });

    this.logger.debug(`OAuth client credentials stored successfully`);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    let authData = await this.reloadAuthData();
    if (!authData?.tokens) return undefined;

    if (isAccessTokenExpired(authData.tokens) && !this.refreshLockRelease) {
      const release = await this.repository.acquireRefreshLock(
        this.config.mcpServerId,
      );
      this.refreshLockRelease = release;
      this.refreshLockTimer = setTimeout(() => {
        this.logger.warn("OAuth refresh lock timed out; releasing it");
        void this.releaseRefreshSerialization();
      }, 30_000);

      // A different Navigator instance may have refreshed the token while this
      // provider waited for the advisory lock. Always re-read after acquiring.
      authData = await this.reloadAuthData();
      if (authData?.tokens && !isAccessTokenExpired(authData.tokens)) {
        await this.releaseRefreshSerialization();
      }
    }

    return authData?.tokens ?? undefined;
  }

  async saveTokens(accessTokens: OAuthTokens): Promise<void> {
    try {
      const current = await this.reloadAuthData();
      const tokens = mergeOAuthTokens(current?.tokens, accessTokens);

      this.cachedAuthData = await this.repository.saveTokensAndCleanup(
        this.currentOAuthState,
        this.config.mcpServerId,
        { tokens },
      );

      this.logger.info(`OAuth tokens stored successfully`);
    } finally {
      await this.releaseRefreshSerialization();
    }
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    authorizationUrl.searchParams.set("state", this.state());
    await this.config.onRedirectToAuthorization(authorizationUrl);
  }

  async saveCodeVerifier(pkceVerifier: string): Promise<void> {
    await this.updateAuthData({
      codeVerifier: pkceVerifier,
    });
  }

  async codeVerifier(): Promise<string> {
    const authData = await this.getAuthData();
    if (!authData?.codeVerifier) {
      throw new UnauthorizedError("OAuth code verifier not found");
    }
    return authData.codeVerifier;
  }

  /**
   * Adopt the given OAuth state by loading its session from DB.
   * Useful when the callback is handled by a different instance.
   */
  async adoptState(state: string): Promise<void> {
    if (!state) return;
    const session = await this.repository.getSessionByState(state);
    if (!session) return;
    if (session.mcpServerId !== this.config.mcpServerId) {
      this.logger.warn(
        `Attempted to adopt state for different server (${session.mcpServerId}), ignoring`,
      );
      return;
    }
    this.currentOAuthState = state;
    this.cachedAuthData = session;
    this.initialized = true;
    this.logger.info(`Adopted OAuth state for callback reconciliation`);
  }

  async invalidateCredentials(
    invalidationScope: "all" | "client" | "tokens" | "verifier",
  ): Promise<void> {
    try {
      switch (invalidationScope) {
        case "all":
          try {
            await this.repository.deleteByState(this.currentOAuthState);
            this.cachedAuthData = undefined;
            this.initialized = false;
            this.currentOAuthState = "";
            this.logger.info(`OAuth credentials invalidated`);
          } finally {
            await this.releaseRefreshSerialization();
          }
          break;
        case "tokens":
          try {
            this.cachedAuthData = await this.repository.clearTokens(
              this.currentOAuthState,
            );
            this.logger.info(`OAuth tokens invalidated`);
          } finally {
            await this.releaseRefreshSerialization();
          }
          break;
      }
    } catch (error) {
      this.logger.error(`Failed to invalidate OAuth credentials: ${error}`);
      throw error;
    }
  }
}
