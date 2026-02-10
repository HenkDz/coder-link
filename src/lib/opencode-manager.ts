import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { MCPService } from './tool-manager.js';
import type { ProviderOptions } from './tool-manager.js';
import { readJsonConfig, writeJsonConfig } from './config-io.js';

export class OpenCodeManager {
  static instance: OpenCodeManager | null = null;
  private configPath: string;

  constructor() {
    // OpenCode 配置文件路径: ~/.config/opencode/opencode.json
    this.configPath = join(homedir(), '.config', 'opencode', 'opencode.json');
  }

  static getInstance(): OpenCodeManager {
    if (!OpenCodeManager.instance) {
      OpenCodeManager.instance = new OpenCodeManager();
    }
    return OpenCodeManager.instance;
  }

  private getConfig() {
    return readJsonConfig(this.configPath, 'OpenCodeManager');
  }

  private saveConfig(config: any) {
    writeJsonConfig(this.configPath, config, 'OpenCodeManager', 4);
  }

  private getProviderName(plan: string): string {
    // GLM providers use special provider IDs
    if (plan === 'glm_coding_plan_global') return 'zai-coding-plan';
    if (plan === 'glm_coding_plan_china') return 'zhipuai-coding-plan';
    // Kimi uses moonshot-ai-coding provider
    if (plan === 'kimi') return 'moonshot-ai-coding';
    // OpenRouter, NVIDIA, LM Studio and other OpenAI-compatible providers use their plan name as provider ID
    return plan;
  }

  private isCustomProvider(plan: string): boolean {
    // Custom providers (OpenAI-compatible) need full configuration with npm, name, options, models
    // This includes NVIDIA, OpenRouter, LM Studio - any provider using @ai-sdk/openai-compatible
    return plan === 'nvidia' || plan === 'openrouter' || plan === 'lmstudio';
  }

  private getProviderDisplayName(plan: string): string {
    const names: Record<string, string> = {
      nvidia: 'NVIDIA NIM',
      openrouter: 'OpenRouter',
      lmstudio: 'LM Studio (local)',
      kimi: 'Moonshot AI'
    };
    return names[plan] || 'Custom Provider';
  }

  private getDefaultBaseUrl(plan: string): string {
    const urls: Record<string, string> = {
      nvidia: 'https://integrate.api.nvidia.com/v1',
      openrouter: 'https://openrouter.ai/api/v1',
      lmstudio: 'http://localhost:1234/v1'
    };
    return urls[plan] || 'http://localhost:1234/v1';
  }

  private getDefaultModel(plan: string): string {
    const models: Record<string, string> = {
      nvidia: 'moonshotai/kimi-k2.5',
      openrouter: 'kimi-k2.5',
      lmstudio: 'lmstudio-community'
    };
    return models[plan] || 'default-model';
  }

  async loadConfig(plan: string, apiKey: string, options?: ProviderOptions): Promise<void> {
    const currentConfig = this.getConfig();
    const providerName = this.getProviderName(plan);

    // Remove old provider configuration (if exists)
    // Also exclude old model/small_model to ensure they get properly updated
    const { provider: oldProvider, model: _, small_model: __, ...restConfig } = currentConfig;
    const newProvider: Record<string, any> = {};

    // Keep other providers (if any), but remove old providers managed by this app
    // This ensures clean switching between providers
    const managedProviders = ['zhipuai-coding-plan', 'zai-coding-plan', 'moonshot-ai-coding', 'kimi-custom', 'nvidia', 'openrouter', 'lmstudio'];
    if (oldProvider) {
      for (const [key, value] of Object.entries(oldProvider)) {
        if (!managedProviders.includes(key)) {
          newProvider[key] = value;
        }
      }
    }

    const source = (options?.source || '').toString().trim().toLowerCase();
    const baseUrl = options?.baseUrl?.trim();
    const modelId = options?.model?.trim();

    // Add new provider configuration
    if (this.isCustomProvider(plan)) {
      // OpenAI-compatible providers (NVIDIA, OpenRouter, LM Studio) need full custom structure
      // See: https://opencode.ai/docs/providers/#custom-provider
      const customBaseUrl = baseUrl || this.getDefaultBaseUrl(plan);
      const customModelId = modelId || this.getDefaultModel(plan);
      
      newProvider[providerName] = {
        npm: '@ai-sdk/openai-compatible',
        name: this.getProviderDisplayName(plan),
        options: {
          apiKey: apiKey,
          baseURL: customBaseUrl
        },
        models: {
          [customModelId]: {
            name: customModelId
          }
        }
      };
    } else if (plan === 'kimi') {
      // Kimi can use either:
      // 1. Built-in moonshot-ai-coding provider (native Moonshot API)
      // 2. Custom OpenAI-compatible provider (when using OpenRouter, etc.)
      const isNativeMoonshot = !baseUrl || baseUrl === 'https://api.moonshot.ai/v1';

      if (isNativeMoonshot) {
        // Native Moonshot API supports extended thinking / reasoning mode
        const supportsThinking = (source === '' || source === 'moonshot');
        newProvider[providerName] = {
          options: {
            apiKey: apiKey,
            baseUrl: baseUrl || 'https://api.moonshot.ai/v1',
            ...(supportsThinking ? {} : { reasoning: false, thinking: false })
          }
        };
      } else {
        // Custom baseUrl detected - use OpenAI-compatible format
        // This handles OpenRouter, proxy URLs, etc.
        const customProviderName = 'kimi-custom';
        const customModelId = modelId || 'kimi-k2.5';

        newProvider[customProviderName] = {
          npm: '@ai-sdk/openai-compatible',
          name: 'Kimi (Custom Endpoint)',
          options: {
            apiKey: apiKey,
            baseURL: baseUrl
          },
          models: {
            [customModelId]: {
              name: customModelId
            }
          }
        };

        // Build final model reference for custom provider
        const customModelRef = customModelId.includes('/') ? customModelId : `${customProviderName}/${customModelId}`;

        const newConfig = {
          $schema: 'https://opencode.ai/config.json',
          ...restConfig,
          provider: newProvider,
          model: customModelRef,
          small_model: customModelRef
        };

        this.saveConfig(newConfig);
        return; // Early return since we've already saved
      }
    } else {
      // GLM Coding Plan providers
      newProvider[providerName] = {
        options: {
          apiKey: apiKey,
          ...(baseUrl ? { baseUrl } : {})
        }
      };
    }

    // Default models if not provided
    let defaultModel: string;
    if (plan === 'kimi' || plan === 'openrouter' || plan === 'nvidia') {
      defaultModel = 'kimi-k2.5';
    } else if (plan === 'lmstudio') {
      defaultModel = 'lmstudio-community';
    } else if (plan === 'glm_coding_plan_global') {
      defaultModel = 'glm-4-coder';
    } else {
      defaultModel = 'glm-4-plus';
    }
    const targetModel = modelId || defaultModel;
    
    // OpenCode model strings are typically "<provider>/<model>".
    // For custom providers, use the model ID directly if it doesn't include a slash
    const modelRef = targetModel.includes('/') ? targetModel : `${providerName}/${targetModel}`;

    const newConfig = {
      $schema: 'https://opencode.ai/config.json',
      ...restConfig,
      provider: newProvider,
      model: modelRef,
      small_model: modelRef
    };

    this.saveConfig(newConfig);
  }

  async unloadConfig(): Promise<void> {
    const currentConfig = this.getConfig();
    // Remove provider's managed provider configurations
    if (currentConfig.provider) {
      const managedProviders = ['zhipuai-coding-plan', 'zai-coding-plan', 'moonshot-ai-coding', 'nvidia', 'openrouter', 'lmstudio'];
      for (const providerKey of managedProviders) {
        delete currentConfig.provider[providerKey];
      }
      // If provider is empty, delete provider field
      if (Object.keys(currentConfig.provider).length === 0) {
        delete currentConfig.provider;
      }
    }

    // Remove model and small_model (if they are managed providers)
    const managedProviderIds = ['coding-plan', 'moonshot-ai-coding', 'kimi-custom', 'nvidia', 'openrouter', 'lmstudio'];
    const isManagedModel = (m: string) => managedProviderIds.some(id => m.includes(id));
    if (currentConfig.model && isManagedModel(currentConfig.model)) {
      delete currentConfig.model;
    }
    if (currentConfig.small_model && isManagedModel(currentConfig.small_model)) {
      delete currentConfig.small_model;
    }

    this.saveConfig(currentConfig);
  }

  async detectCurrentConfig(): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    try {
      const config = this.getConfig();
      // Check provider configuration
      if (!config.provider) {
        return { plan: null, apiKey: null };
      }

      let plan: string | null = null;
      let apiKey: string | null = null;
      let model: string | undefined = undefined;

      if (config.provider['zai-coding-plan']) {
        plan = 'glm_coding_plan_global';
        apiKey = config.provider['zai-coding-plan'].options?.apiKey || null;
      } else if (config.provider['zhipuai-coding-plan']) {
        plan = 'glm_coding_plan_china';
        apiKey = config.provider['zhipuai-coding-plan'].options?.apiKey || null;
      } else if (config.provider['moonshot-ai-coding']) {
        // Kimi native provider
        plan = 'kimi';
        apiKey = config.provider['moonshot-ai-coding'].options?.apiKey || null;
      } else if (config.provider['kimi-custom']) {
        // Kimi custom provider (OpenRouter or other endpoints)
        plan = 'kimi';
        apiKey = config.provider['kimi-custom'].options?.apiKey || null;
        // Extract model from the models field if available
        const models = config.provider['kimi-custom'].models;
        if (models && typeof models === 'object') {
          const modelIds = Object.keys(models);
          if (modelIds.length > 0) {
            model = modelIds[0];
          }
        }
      } else if (config.provider['nvidia']) {
        // NVIDIA custom provider
        plan = 'nvidia';
        apiKey = config.provider['nvidia'].options?.apiKey || null;
        // Extract model from the models field if available
        const models = config.provider['nvidia'].models;
        if (models && typeof models === 'object') {
          const modelIds = Object.keys(models);
          if (modelIds.length > 0) {
            model = modelIds[0];
          }
        }
      } else if (config.provider['openrouter']) {
        // OpenRouter custom provider
        plan = 'openrouter';
        apiKey = config.provider['openrouter'].options?.apiKey || null;
        // Extract model from the models field if available
        const models = config.provider['openrouter'].models;
        if (models && typeof models === 'object') {
          const modelIds = Object.keys(models);
          if (modelIds.length > 0) {
            model = modelIds[0];
          }
        }
      } else if (config.provider['lmstudio']) {
        // LM Studio custom provider
        plan = 'lmstudio';
        apiKey = config.provider['lmstudio'].options?.apiKey || null;
        // Extract model from the models field if available
        const models = config.provider['lmstudio'].models;
        if (models && typeof models === 'object') {
          const modelIds = Object.keys(models);
          if (modelIds.length > 0) {
            model = modelIds[0];
          }
        }
      }

      // Extract model from config if present
      if (config.model && typeof config.model === 'string') {
        // Model format is typically "provider/model", extract the model part
        const parts = config.model.split('/');
        if (parts.length > 1) {
          model = parts.slice(1).join('/');
        } else {
          model = config.model;
        }
      }

      return { plan, apiKey, model };
    } catch {
      return { plan: null, apiKey: null };
    }
  }

  isMCPInstalled(mcpId: string): boolean {
    try {
      const config = this.getConfig();
      if (!config.mcp) {
        return false;
      }
      return mcpId in config.mcp;
    } catch {
      return false;
    }
  }

  async installMCP(mcp: MCPService, apiKey: string, plan: string): Promise<void> {
    try {
      const config = this.getConfig();
      if (!config.mcp) {
        config.mcp = {};
      }

      let mcpConfig: any;

      if (mcp.protocol === 'stdio') {
        // Determine environment variables
        let env: Record<string, string> = {};
        if (mcp.envTemplate && plan) {
          env = { ...(mcp.envTemplate[plan] || {}) };
        } else if (mcp.env) {
          env = { ...mcp.env };
        }

        // Fill empty template values from current process environment.
        for (const [key, value] of Object.entries(env)) {
          if (value !== '' || !process.env[key]) continue;
          env[key] = process.env[key] as string;
        }

        // Add API key if required
        if (mcp.requiresAuth && apiKey) {
          env[mcp.authEnvVar || 'Z_AI_API_KEY'] = apiKey;
        }

        // OpenCode uses local type and command array
        const commandArray = [mcp.command || 'npx', ...(mcp.args || [])];
        mcpConfig = {
          type: 'local',
          command: commandArray,
          environment: env
        };
      } else if (mcp.protocol === 'streamable-http') {
        // Determine URL based on plan
        let url = '';
        if (mcp.urlTemplate && plan) {
          url = mcp.urlTemplate[plan];
        } else if (mcp.url) {
          url = mcp.url;
        } else {
          throw new Error(`MCP ${mcp.id} missing url or urlTemplate`);
        }

        // OpenCode uses remote or http type
        mcpConfig = {
          type: 'remote',
          url: url,
          headers: {
            ...(mcp.headers || {})
          }
        };

        // Add API key to headers if required
        if (mcp.requiresAuth && apiKey) {
          const headerName = mcp.authHeader || 'Authorization';
          const authScheme = mcp.authScheme || 'Bearer';
          mcpConfig.headers = {
            ...mcpConfig.headers,
            [headerName]: authScheme === 'Bearer' ? `Bearer ${apiKey}` : apiKey
          };
        }
      } else {
        throw new Error(`Unsupported protocol: ${mcp.protocol}`);
      }

      config.mcp[mcp.id] = mcpConfig;
      this.saveConfig(config);
    } catch (error) {
      throw new Error(`Failed to install MCP ${mcp.name}: ${error}`);
    }
  }

  async uninstallMCP(mcpId: string): Promise<void> {
    try {
      const config = this.getConfig();
      if (!config.mcp) {
        return;
      }
      delete config.mcp[mcpId];
      this.saveConfig(config);
    } catch (error) {
      throw new Error(`Failed to uninstall MCP ${mcpId}: ${error}`);
    }
  }

  getInstalledMCPs(): string[] {
    try {
      const config = this.getConfig();
      if (!config.mcp) {
        return [];
      }
      return Object.keys(config.mcp);
    } catch {
      return [];
    }
  }

  getMCPStatus(mcpServices: MCPService[]): Map<string, boolean> {
    const status = new Map<string, boolean>();
    for (const mcp of mcpServices) {
      status.set(mcp.id, this.isMCPInstalled(mcp.id));
    }
    return status;
  }

  getOtherMCPs(builtinIds: string[]): Array<{ id: string; config: any }> {
    try {
      const config = this.getConfig();
      if (!config.mcp) {
        return [];
      }
      const otherMCPs: Array<{ id: string; config: any }> = [];
      for (const [id, mcpConfig] of Object.entries(config.mcp)) {
        if (!builtinIds.includes(id)) {
          otherMCPs.push({ id, config: mcpConfig });
        }
      }
      return otherMCPs;
    } catch {
      return [];
    }
  }

  getAllMCPServers(): Record<string, any> {
    try {
      const config = this.getConfig();
      return config.mcp || {};
    } catch {
      return {};
    }
  }
}

export const openCodeManager = OpenCodeManager.getInstance();
