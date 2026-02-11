import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import * as TOML from '@iarna/toml';

import { logger } from '../utils/logger.js';
import type { MCPService } from './tool-manager.js';
import type { ProviderOptions } from './tool-manager.js';
import {
  getBaseUrl,
  getDefaultModel,
  detectPlanFromUrl,
} from './provider-registry.js';
import type { Plan } from '../utils/config.js';

const DEFAULT_PROVIDER_ID = 'managed:moonshot-ai';

type AnyRecord = Record<string, any>;

export class KimiManager {
  static instance: KimiManager | null = null;
  private configPath: string;

  constructor() {
    this.configPath = join(homedir(), '.kimi', 'config.toml');
  }

  static getInstance(): KimiManager {
    if (!KimiManager.instance) {
      KimiManager.instance = new KimiManager();
    }
    return KimiManager.instance;
  }

  private ensureConfigDir(): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private readConfigText(): string {
    if (!existsSync(this.configPath)) return '';
    return readFileSync(this.configPath, 'utf-8');
  }

  private readConfig(): AnyRecord {
    try {
      const text = this.readConfigText();
      if (!text.trim()) return {};
      const parsed = TOML.parse(text);
      return (parsed || {}) as AnyRecord;
    } catch (error) {
      logger.logError('KimiManager.readConfig', error);
      // If parsing fails, fail safe by not overwriting the file.
      throw new Error(`Failed to parse Kimi config at ${this.configPath}`);
    }
  }

  private writeConfig(config: AnyRecord): void {
    try {
      this.ensureConfigDir();
      const text = TOML.stringify(config as any);
      writeFileSync(this.configPath, text, 'utf-8');
    } catch (error) {
      logger.logError('KimiManager.writeConfig', error);
      throw new Error(`Failed to write Kimi config at ${this.configPath}`);
    }
  }

  private ensureMcpSilent(config: AnyRecord): boolean {
    const servers = config?.mcp?.servers;
    if (!servers || typeof servers !== 'object') return false;

    let changed = false;
    for (const value of Object.values(servers)) {
      const server = value as any;
      if (!server || typeof server !== 'object') continue;
      if (server.type !== 'stdio') continue;

      const cmd = (server.command || '').toString().toLowerCase();
      const isNpx = cmd === 'npx'
        || cmd.endsWith('npx')
        || cmd.endsWith('npx.cmd')
        || cmd.endsWith('npx.exe');
      if (!isNpx) continue;

      const args = Array.isArray(server.args) ? server.args : [];
      if (!args.includes('--silent')) {
        server.args = ['--silent', ...args];
        changed = true;
      }
    }

    return changed;
  }

  private ensureProvider(config: AnyRecord, plan: Plan, apiKey: string, options?: ProviderOptions): void {
    config.providers = config.providers && typeof config.providers === 'object' ? config.providers : {};

    const providerId = options?.providerId?.trim() || DEFAULT_PROVIDER_ID;
    const baseUrl = options?.baseUrl?.trim() || getBaseUrl(plan, 'openai');

    // Use the OpenAI-legacy provider type for all Kimi-compatible endpoints.
    // This keeps requests aligned with OpenAI chat-completions and avoids
    // sending unsupported parameters for third-party gateways.
    const providerType = 'openai_legacy';

    // Always update the provider with current values (ensures refresh works)
    config.providers[providerId] = {
      type: providerType,
      base_url: baseUrl,
      api_key: apiKey
    };
  }

  private ensureModel(config: AnyRecord, plan: Plan, options?: ProviderOptions): void {
    config.models = config.models && typeof config.models === 'object' ? config.models : {};

    const providerId = options?.providerId?.trim() || DEFAULT_PROVIDER_ID;
    const modelId = options?.model?.trim() || getDefaultModel(plan);
    const maxCtx = options?.maxContextSize || 262144;

    // Always update the model with current values (ensures refresh works)
    config.models[modelId] = {
      provider: providerId,
      model: modelId,
      max_context_size: maxCtx
    };

    config.default_model = modelId;
  }

  async detectCurrentConfig(): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    try {
      if (!existsSync(this.configPath)) {
        return { plan: null, apiKey: null };
      }
      const config = this.readConfig();
      const providers = (config.providers && typeof config.providers === 'object' ? config.providers : {}) as Record<string, any>;

      // Get the default model if set
      const defaultModel = typeof config.default_model === 'string' ? config.default_model : undefined;

      // Prefer the canonical managed provider id
      const managed = providers[DEFAULT_PROVIDER_ID];
      if (managed && typeof managed === 'object' && typeof managed.api_key === 'string' && managed.api_key.trim()) {
        const plan = detectPlanFromUrl(managed.base_url) || 'kimi';
        return { plan, apiKey: managed.api_key.trim(), model: defaultModel };
      }

      // Otherwise, find any provider of type 'kimi' / 'openai_legacy'
      for (const value of Object.values(providers)) {
        const provider = value as any;
        if (provider && typeof provider === 'object'
          && (provider.type === 'kimi' || provider.type === 'openai_legacy' || provider.type === 'openai')
          && typeof provider.api_key === 'string' && provider.api_key.trim()) {
          const plan = detectPlanFromUrl(provider.base_url) || 'kimi';
          return { plan, apiKey: provider.api_key.trim(), model: defaultModel };
        }
      }

      return { plan: null, apiKey: null };
    } catch (error) {
      logger.logError('KimiManager.detectCurrentConfig', error);
      return { plan: null, apiKey: null };
    }
  }

  async loadConfig(plan: string, apiKey: string, options?: ProviderOptions): Promise<void> {
    if (!apiKey || !apiKey.trim()) {
      throw new Error('API key cannot be empty');
    }

    const planKey = plan as Plan;
    const config = existsSync(this.configPath) ? this.readConfig() : {};
    this.ensureProvider(config, planKey, apiKey.trim(), options);
    this.ensureModel(config, planKey, options);
    this.ensureMcpSilent(config);

    // Ensure MCP client defaults exist but do not override user values
    config.mcp = config.mcp && typeof config.mcp === 'object' ? config.mcp : {};
    config.mcp.client = config.mcp.client && typeof config.mcp.client === 'object' ? config.mcp.client : {};
    if (typeof config.mcp.client.tool_call_timeout_ms !== 'number') {
      config.mcp.client.tool_call_timeout_ms = 60000;
    }

    this.writeConfig(config);
  }

  async unloadConfig(): Promise<void> {
    if (!existsSync(this.configPath)) return;

    const config = this.readConfig();
    if (config.providers && typeof config.providers === 'object' && config.providers[DEFAULT_PROVIDER_ID]) {
      // Avoid destructive deletes; just clear the key.
      const provider = config.providers[DEFAULT_PROVIDER_ID];
      if (provider && typeof provider === 'object') {
        provider.api_key = '';
        config.providers[DEFAULT_PROVIDER_ID] = provider;
      }
      this.writeConfig(config);
    }
  }

  isMCPInstalled(mcpId: string): boolean {
    try {
      if (!existsSync(this.configPath)) return false;
      const config = this.readConfig();
      const servers = config?.mcp?.servers;
      if (!servers || typeof servers !== 'object') return false;
      return mcpId in servers;
    } catch {
      return false;
    }
  }

  getInstalledMCPs(): string[] {
    try {
      if (!existsSync(this.configPath)) return [];
      const config = this.readConfig();
      const servers = config?.mcp?.servers;
      if (!servers || typeof servers !== 'object') return [];
      return Object.keys(servers);
    } catch {
      return [];
    }
  }

  getAllMCPServers(): Record<string, any> {
    try {
      if (!existsSync(this.configPath)) return {};
      const config = this.readConfig();
      const servers = config?.mcp?.servers;
      if (!servers || typeof servers !== 'object') return {};
      return servers;
    } catch {
      return {};
    }
  }

  getOtherMCPs(builtinIds: string[]): Array<{ id: string; config: any }> {
    const servers = this.getAllMCPServers();
    const other: Array<{ id: string; config: any }> = [];
    for (const [id, cfg] of Object.entries(servers)) {
      if (!builtinIds.includes(id)) {
        other.push({ id, config: cfg });
      }
    }
    return other;
  }

  getMCPStatus(mcpServices: MCPService[]): Map<string, boolean> {
    const status = new Map<string, boolean>();
    for (const mcp of mcpServices) {
      status.set(mcp.id, this.isMCPInstalled(mcp.id));
    }
    return status;
  }

  async installMCP(mcp: MCPService, apiKey: string, plan: string): Promise<void> {
    if (!existsSync(this.configPath)) {
      // Ensure base config exists before editing MCP servers
      await this.loadConfig('kimi', apiKey);
    }

    const config = this.readConfig();
    config.mcp = config.mcp && typeof config.mcp === 'object' ? config.mcp : {};
    config.mcp.servers = config.mcp.servers && typeof config.mcp.servers === 'object' ? config.mcp.servers : {};

    if (mcp.protocol === 'stdio') {
      let env: Record<string, string> = {};
      if (mcp.envTemplate && plan) {
        env = { ...(mcp.envTemplate[plan] || {}) };
      } else if (mcp.env) {
        env = { ...mcp.env };
      }

      for (const [key, value] of Object.entries(env)) {
        if (value !== '' || !process.env[key]) continue;
        env[key] = process.env[key] as string;
      }

      if (mcp.requiresAuth && apiKey) {
        env[mcp.authEnvVar || 'Z_AI_API_KEY'] = apiKey;
      }

      config.mcp.servers[mcp.id] = {
        type: 'stdio',
        command: mcp.command || 'npx',
        args: mcp.command === 'npx' && !mcp.args?.includes('--silent')
          ? ['--silent', ...(mcp.args || [])]
          : (mcp.args || []),
        env
      };
    } else if (mcp.protocol === 'sse' || mcp.protocol === 'streamable-http') {
      let url = '';
      if (mcp.urlTemplate && plan) {
        url = mcp.urlTemplate[plan];
      } else if (mcp.url) {
        url = mcp.url;
      }
      if (!url) {
        throw new Error(`MCP ${mcp.id} missing url or urlTemplate`);
      }

      const headers: Record<string, string> = { ...(mcp.headers || {}) };
      if (mcp.requiresAuth && apiKey) {
        const headerName = mcp.authHeader || 'Authorization';
        const authScheme = mcp.authScheme || 'Bearer';
        headers[headerName] = authScheme === 'Bearer' ? `Bearer ${apiKey}` : apiKey;
      }

      config.mcp.servers[mcp.id] = {
        type: mcp.protocol === 'sse' ? 'sse' : 'http',
        url,
        headers
      };
    } else {
      throw new Error(`Unsupported protocol: ${mcp.protocol}`);
    }

    this.writeConfig(config);
  }

  async uninstallMCP(mcpId: string): Promise<void> {
    if (!existsSync(this.configPath)) return;

    const config = this.readConfig();
    if (!config?.mcp?.servers || typeof config.mcp.servers !== 'object') {
      return;
    }

    delete config.mcp.servers[mcpId];
    this.writeConfig(config);
  }
}

export const kimiManager = KimiManager.getInstance();
