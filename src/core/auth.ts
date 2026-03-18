/**
 * Reddit Intelligence Agent — Three-tier Reddit OAuth authentication
 *
 * Tiers:
 *   Anonymous    → 10 req/min, 15min cache TTL, www.reddit.com
 *   App-Only     → 60 req/min, 5min cache TTL, oauth.reddit.com (client_credentials)
 *   Authenticated→ 100 req/min, 5min cache TTL, oauth.reddit.com (password grant)
 */

import { homedir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';
import { z } from 'zod';
import type { AuthConfig, AuthMode } from '../types/index.js';

const TOKEN_ENDPOINT = 'https://www.reddit.com/api/v1/access_token';
const CONFIG_DIR_NAME = '.reddit-intelligence';
const AUTH_FILE_NAME = 'auth.json';
const TOKEN_BUFFER_MS = 10_000; // refresh 10s before expiry
const MAX_TOKEN_LIFETIME_S = 365 * 24 * 3600;

const OAuthResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string(),
}).passthrough();

export class RedditAuth {
  private config: AuthConfig | null = null;
  private configDir: string;
  private refreshLock: Promise<void> | null = null;

  constructor() {
    this.configDir = join(homedir(), CONFIG_DIR_NAME);
  }

  async initialize(): Promise<void> {
    const envConfig = this.loadFromEnv();
    if (envConfig) {
      this.config = envConfig;
      return;
    }

    try {
      const raw = await fs.readFile(join(this.configDir, AUTH_FILE_NAME), 'utf-8');
      const parsed = JSON.parse(raw);
      if (this.isValid(parsed)) {
        this.config = parsed;
      }
    } catch {
      // No auth configured — anonymous mode
    }
  }

  private loadFromEnv(): AuthConfig | null {
    const clientId = this.cleanEnv(process.env.REDDIT_INTEL_CLIENT_ID);
    const clientSecret = this.cleanEnv(process.env.REDDIT_INTEL_CLIENT_SECRET);
    if (!clientId || !clientSecret) return null;

    return {
      clientId,
      clientSecret,
      username: this.cleanEnv(process.env.REDDIT_INTEL_USERNAME),
      password: this.cleanEnv(process.env.REDDIT_INTEL_PASSWORD),
      userAgent: this.cleanEnv(process.env.REDDIT_INTEL_USER_AGENT) ?? 'RedditIntelligenceAgent/0.1.0',
    };
  }

  private cleanEnv(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    // Detect unresolved env templates (${VAR}, $VAR)
    if (/\$\{[^}]*\}/.test(trimmed) || /\$[A-Z_][A-Z0-9_]*/.test(trimmed)) {
      return undefined;
    }
    return trimmed;
  }

  private isValid(config: unknown): config is AuthConfig {
    if (!config || typeof config !== 'object') return false;
    const c = config as Record<string, unknown>;
    return typeof c.clientId === 'string' && c.clientId.length > 0 &&
           typeof c.clientSecret === 'string' && c.clientSecret.length > 0;
  }

  async persistConfig(config: AuthConfig): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    const filePath = join(this.configDir, AUTH_FILE_NAME);
    const safe = { ...config };
    delete safe.password; // never persist password
    await fs.writeFile(filePath, JSON.stringify(safe, null, 2), { mode: 0o600 });
    this.config = config;
  }

  async clearConfig(): Promise<void> {
    this.config = null;
    try {
      await fs.unlink(join(this.configDir, AUTH_FILE_NAME));
    } catch {
      // may not exist
    }
  }

  getMode(): AuthMode {
    if (!this.config) return 'anonymous';
    return (this.config.username && this.config.password) ? 'authenticated' : 'app-only';
  }

  getRateLimit(): number {
    switch (this.getMode()) {
      case 'authenticated': return 100;
      case 'app-only': return 60;
      default: return 10;
    }
  }

  getCacheTTL(): number {
    return this.getMode() === 'anonymous' ? 15 * 60_000 : 5 * 60_000;
  }

  isTokenExpired(): boolean {
    if (!this.config?.expiresAt || this.config.expiresAt <= 0) return true;
    return Date.now() >= this.config.expiresAt - TOKEN_BUFFER_MS;
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.config) return null;
    if (!this.config.accessToken || this.isTokenExpired()) {
      if (this.refreshLock) {
        await this.refreshLock;
      } else {
        await this.refreshToken();
      }
    }
    return this.config.accessToken ?? null;
  }

  async refreshToken(): Promise<void> {
    if (this.refreshLock) {
      await this.refreshLock;
      return;
    }
    const promise = this.doRefresh();
    this.refreshLock = promise;
    try {
      await promise;
    } finally {
      this.refreshLock = null;
    }
  }

  private async doRefresh(): Promise<void> {
    if (!this.config?.clientId || !this.config?.clientSecret) {
      throw new Error('No Reddit client credentials configured');
    }

    const basicAuth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const body = (this.config.username && this.config.password)
      ? new URLSearchParams({
          grant_type: 'password',
          username: this.config.username,
          password: this.config.password,
        })
      : new URLSearchParams({ grant_type: 'client_credentials' });

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.config.userAgent ?? 'RedditIntelligenceAgent/0.1.0',
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[auth] OAuth failed: ${res.status} — ${text.substring(0, 100)}`);
      throw new Error(`Reddit authentication failed (HTTP ${res.status}). Check your credentials.`);
    }

    const raw = await res.json();
    const data = OAuthResponseSchema.parse(raw);

    if (data.access_token.length < 10) {
      throw new Error('Invalid access token received from Reddit');
    }
    if (data.expires_in <= 0 || data.expires_in > MAX_TOKEN_LIFETIME_S) {
      throw new Error(`Unreasonable token expiration: ${data.expires_in}s`);
    }

    this.config.accessToken = data.access_token;
    this.config.expiresAt = Date.now() + data.expires_in * 1000;
    this.config.scope = data.scope;

    await this.persistConfig(this.config);
  }

  async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'User-Agent': this.config?.userAgent ?? 'RedditIntelligenceAgent/0.1.0',
      'Accept': 'application/json',
    };
    const token = await this.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  getBaseUrl(): string {
    return this.config ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
  }
}
