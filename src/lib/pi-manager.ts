import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

import { logger } from '../utils/logger.js';
import type { MCPService } from './tool-manager.js';
import type { ProviderOptions } from './tool-manager.js';

const PI_PROVIDER_ID = 'moonshot';

type AnyRecord = Record<string, any>;

export class PiManager {
  static instance: PiManager | null = null;
  private configPath: string;

  constructor() {
    // Per pi docs: custom providers/models are configured via ~/.pi/agent/models.json
    this.configPath = join(homedir(), '.pi', 'agent', 'models.json');
  }

  static getInstance(): PiManager {
    if (!PiManager.instance) {
      PiManager.instance = new PiManager();
    }
    return PiManager.instance;
  }

  private ensureDir(): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private readConfig(): AnyRecord {
    try {
      if (!existsSync(this.configPath)) return {};
      const text = readFileSync(this.configPath, 'utf-8');
      if (!text.trim()) return {};
      return JSON.parse(text) as AnyRecord;
    } catch (error) {
      logger.logError('PiManager.readConfig', error);
      throw new Error(`Failed to parse Pi models config at ${this.configPath}`);
    }
  }

  private writeConfig(config: AnyRecord): void {
    try {
      this.ensureDir();
      writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      logger.logError('PiManager.writeConfig', error);
      throw new Error(`Failed to write Pi models config at ${this.configPath}`);
    }
  }

  async detectCurrentConfig(): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    try {
      if (!existsSync(this.configPath)) return { plan: null, apiKey: null };
      const config = this.readConfig();
      const provider = config?.providers?.[PI_PROVIDER_ID];
      const apiKey = provider?.apiKey;
      const baseUrl = provider?.baseUrl;
      const models = provider?.models;
      let model: string | undefined = undefined;

      // Extract first model id if available
      if (Array.isArray(models) && models.length > 0 && models[0]?.id) {
        model = models[0].id;
      }

      if (typeof apiKey === 'string' && apiKey.trim()) {
        // Detect plan from base_url
        let plan = 'kimi';
        if (typeof baseUrl === 'string') {
          if (baseUrl.includes('openrouter.ai')) {
            plan = 'openrouter';
          } else if (baseUrl.includes('nvidia.com')) {
            plan = 'nvidia';
          }
        }
        return { plan, apiKey: apiKey.trim(), model };
      }
      return { plan: null, apiKey: null };
    } catch (error) {
      logger.logError('PiManager.detectCurrentConfig', error);
      return { plan: null, apiKey: null };
    }
  }

  async loadConfig(plan: string, apiKey: string, options?: ProviderOptions): Promise<void> {
    if (!apiKey || !apiKey.trim()) {
      throw new Error('API key cannot be empty');
    }

    const baseUrl = options?.baseUrl?.trim() || 'https://api.moonshot.ai/v1';
    const modelId = options?.model?.trim() || 'moonshot-ai/kimi-k2.5';

    const source = (options?.source || '').toString().trim().toLowerCase();
    // Pi supported APIs: openai-completions/openai-responses/anthropic-messages/google-generative-ai.
    // Despite the name, `openai-completions` maps to OpenAI *Chat Completions* (POST /chat/completions).
    const apiMode = 'openai-completions';

    // Only the native Moonshot API supports Kimi's extended-thinking / reasoning mode.
    const supportsReasoning = (source === '' || source === 'moonshot');

    const modelName = (() => {
      if (source === 'nvidia') return 'Kimi K2.5 (NVIDIA)';
      if (source === 'openrouter') return 'Kimi K2.5 (OpenRouter)';
      if (source === 'glm-global') return 'GLM (Global)';
      if (source === 'glm-china') return 'GLM (China)';
      if (source === 'custom') return 'Custom Model';
      return 'Kimi K2.5';
    })();

    const config = this.readConfig();
    config.providers = config.providers && typeof config.providers === 'object' ? config.providers : {};

    const existing = (config.providers[PI_PROVIDER_ID] && typeof config.providers[PI_PROVIDER_ID] === 'object')
      ? config.providers[PI_PROVIDER_ID]
      : {};

    const existingModels: any[] = Array.isArray(existing.models) ? existing.models : [];
    const models = (() => {
      // Preserve extra metadata if present, but ensure the configured model id is applied.
      if (existingModels.length === 0) {
        return [
          {
            id: modelId,
            name: modelName,
            reasoning: supportsReasoning,
            input: ['text'],
            contextWindow: 262144,
            maxTokens: 262144,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
          }
        ];
      }

      const hasExact = existingModels.some((m) => m && typeof m === 'object' && m.id === modelId);
      if (hasExact) {
        // Ensure reasoning flag is updated even when the model already exists
        return existingModels.map((m: any) => {
          if (m && typeof m === 'object' && m.id === modelId) {
            return { ...m, reasoning: supportsReasoning };
          }
          return m;
        });
      }

      // If there is at least one model already, rewrite the first entry to match the configured model.
      const [first, ...rest] = existingModels;
      const firstObj = (first && typeof first === 'object') ? first : {};
      const rewrittenFirst = {
        ...firstObj,
        id: modelId,
        name: typeof firstObj.name === 'string' && firstObj.name.trim() ? firstObj.name : modelName,
        reasoning: supportsReasoning
      };
      return [rewrittenFirst, ...rest];
    })();

    config.providers[PI_PROVIDER_ID] = {
      ...existing,
      baseUrl,
      api: apiMode,
      apiKey: apiKey.trim(),
      authHeader: true,
      models
    };

    this.writeConfig(config);
  }

  async unloadConfig(): Promise<void> {
    if (!existsSync(this.configPath)) return;
    const config = this.readConfig();
    if (!config?.providers?.[PI_PROVIDER_ID]) return;

    const provider = config.providers[PI_PROVIDER_ID];
    if (provider && typeof provider === 'object') {
      provider.apiKey = '';
      config.providers[PI_PROVIDER_ID] = provider;
      this.writeConfig(config);
    }
  }

  isMCPInstalled(_mcpId: string): boolean {
    return false;
  }

  async installMCP(_mcp: MCPService, _apiKey: string, _plan: string): Promise<void> {
    throw new Error('Pi does not support MCP configuration via coder-link');
  }

  async uninstallMCP(_mcpId: string): Promise<void> {
    throw new Error('Pi does not support MCP configuration via coder-link');
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

export const piManager = PiManager.getInstance();
