import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import * as TOML from '@iarna/toml';

import { logger } from '../utils/logger.js';
import type { Plan } from '../utils/config.js';
import type { MCPService } from './tool-manager.js';
import type { ProviderOptions } from './tool-manager.js';
import {
  getAllPlans,
  getBaseUrl,
  getDefaultModel,
  getProviderShortName,
  detectPlanFromUrl,
} from './provider-registry.js';

type AnyRecord = Record<string, any>;

const OPENAI_ENV_KEY = 'OPENAI_API_KEY';
const MANAGED_PROVIDER_PREFIX = 'CoderLink_';

export class CodexManager {
  static instance: CodexManager | null = null;
  private configPath: string;

  constructor() {
    // Codex config: ~/.codex/config.toml
    this.configPath = join(homedir(), '.codex', 'config.toml');
  }

  static getInstance(): CodexManager {
    if (!CodexManager.instance) {
      CodexManager.instance = new CodexManager();
    }
    return CodexManager.instance;
  }

  private ensureConfigDir(): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private readConfig(): AnyRecord {
    if (!existsSync(this.configPath)) return {};
    const content = readFileSync(this.configPath, 'utf-8');
    if (!content.trim()) return {};
    try {
      const parsed = TOML.parse(content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Config root must be an object');
      }
      return parsed as AnyRecord;
    } catch (error) {
      logger.logError('CodexManager.readConfig', error);
      throw new Error(`Failed to parse Codex config at ${this.configPath}`);
    }
  }

  private writeConfig(config: AnyRecord): void {
    try {
      this.ensureConfigDir();
      const content = TOML.stringify(config as any);
      writeFileSync(this.configPath, content, 'utf-8');
    } catch (error) {
      logger.logError('CodexManager.writeConfig', error);
      throw new Error(`Failed to write Codex config at ${this.configPath}`);
    }
  }

  private getManagedProviderId(plan: Plan): string {
    // Use short names from registry for consistency
    const shortName = getProviderShortName(plan);
    // Match Alibaba docs naming for better familiarity.
    if (plan === 'alibaba') return 'Model_Studio_Coding_Plan';
    if (plan === 'alibaba_api') return 'DashScope_API_Singapore';
    return `${MANAGED_PROVIDER_PREFIX}${shortName}`;
  }

  private getManagedProviderIds(): string[] {
    const plans = getAllPlans();
    return [
      ...plans.map((plan) => this.getManagedProviderId(plan)),
      'CoderLink_Managed',
    ];
  }

  private detectPlanFromBaseUrl(baseUrl?: string): Plan | null {
    return detectPlanFromUrl(baseUrl || '');
  }

  private getSelectedProvider(config: AnyRecord): { id: string; provider: AnyRecord } | null {
    const providers = config?.model_providers;
    if (!providers || typeof providers !== 'object') return null;

    const selectedId = typeof config.model_provider === 'string' ? config.model_provider : '';
    const selected = selectedId ? providers[selectedId] : undefined;
    if (selected && typeof selected === 'object') {
      return { id: selectedId, provider: selected as AnyRecord };
    }

    for (const [id, value] of Object.entries(providers)) {
      if (value && typeof value === 'object') {
        return { id, provider: value as AnyRecord };
      }
    }

    return null;
  }

  async detectCurrentConfig(): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    try {
      if (!existsSync(this.configPath)) return { plan: null, apiKey: null };
      const config = this.readConfig();
      const selected = this.getSelectedProvider(config);
      if (!selected) return { plan: null, apiKey: null };

      const baseUrl = typeof selected.provider.base_url === 'string' ? selected.provider.base_url : undefined;
      let plan = this.detectPlanFromBaseUrl(baseUrl);
      if (!plan && selected.id === 'Model_Studio_Coding_Plan') {
        plan = 'alibaba';
      } else if (!plan && selected.id === 'DashScope_API_Singapore') {
        plan = 'alibaba_api';
      }

      const envKeyRaw = typeof selected.provider.env_key === 'string' ? selected.provider.env_key : OPENAI_ENV_KEY;
      const envKey = envKeyRaw.trim() || OPENAI_ENV_KEY;
      let apiKey = process.env[envKey]?.trim() || null;

      if (!apiKey && plan) {
        const { configManager } = await import('../utils/config.js');
        apiKey = configManager.getApiKeyFor(plan) || null;
        if (!apiKey && plan === 'lmstudio') {
          apiKey = 'lmstudio';
        }
      }

      const model = typeof config.model === 'string' ? config.model : undefined;
      return { plan, apiKey, model };
    } catch (error) {
      logger.logError('CodexManager.detectCurrentConfig', error);
      return { plan: null, apiKey: null };
    }
  }

  async loadConfig(planInput: string, apiKey: string, options?: ProviderOptions): Promise<void> {
    const plan = planInput as Plan;
    const allPlans = getAllPlans();
    if (!allPlans.includes(plan)) {
      throw new Error(`Unsupported provider plan for Codex: ${planInput}`);
    }
    if (!apiKey?.trim() && plan !== 'lmstudio') {
      throw new Error('API key cannot be empty');
    }

    const config = this.readConfig();
    const providers = config.model_providers && typeof config.model_providers === 'object'
      ? { ...config.model_providers }
      : {};

    const managedIds = new Set(this.getManagedProviderIds());
    for (const id of Object.keys(providers)) {
      if (managedIds.has(id)) {
        delete providers[id];
      }
    }

    const providerId = this.getManagedProviderId(plan);
    const baseUrl = options?.baseUrl?.trim() || getBaseUrl(plan, 'openai');
    const model = options?.model?.trim() || getDefaultModel(plan);

    providers[providerId] = {
      name: getProviderShortName(plan),
      base_url: baseUrl,
      env_key: OPENAI_ENV_KEY,
      wire_api: 'chat',
    };

    const newConfig: AnyRecord = {
      ...config,
      model_provider: providerId,
      model,
      model_providers: providers,
    };

    this.writeConfig(newConfig);
  }

  async unloadConfig(): Promise<void> {
    if (!existsSync(this.configPath)) return;
    const config = this.readConfig();
    const providers = config.model_providers && typeof config.model_providers === 'object'
      ? { ...config.model_providers }
      : {};

    const managedIds = new Set(this.getManagedProviderIds());
    let changed = false;

    for (const id of Object.keys(providers)) {
      if (managedIds.has(id)) {
        delete providers[id];
        changed = true;
      }
    }

    const currentProviderId = typeof config.model_provider === 'string' ? config.model_provider : '';
    if (currentProviderId && managedIds.has(currentProviderId)) {
      const remainingProviderIds = Object.keys(providers);
      if (remainingProviderIds.length > 0) {
        config.model_provider = remainingProviderIds[0];
      } else {
        delete config.model_provider;
        delete config.model;
      }
      changed = true;
    }

    if (Object.keys(providers).length > 0) {
      config.model_providers = providers;
    } else {
      delete config.model_providers;
    }

    if (changed) {
      this.writeConfig(config);
    }
  }

  isMCPInstalled(_mcpId: string): boolean {
    return false;
  }

  async installMCP(_mcp: MCPService, _apiKey: string, _plan: string): Promise<void> {
    throw new Error('Codex does not support MCP configuration via coder-link');
  }

  async uninstallMCP(_mcpId: string): Promise<void> {
    throw new Error('Codex does not support MCP configuration via coder-link');
  }

  getInstalledMCPs(): string[] {
    return [];
  }

  getMCPStatus(_mcpServices: MCPService[]): Map<string, boolean> {
    return new Map();
  }

  getOtherMCPs(_builtinIds: string[]): Array<{ id: string; config: any }> {
    return [];
  }

  getAllMCPServers(): Record<string, any> {
    return {};
  }
}

export const codexManager = CodexManager.getInstance();

