import { join } from 'path';
import { homedir } from 'os';
import { MCPService } from './tool-manager.js';
import type { ProviderOptions } from './tool-manager.js';
import { readJsonConfig, writeJsonConfig } from './config-io.js';

// ============================================================================
// Provider Configuration Map - Single source of truth for all provider metadata
// ============================================================================

interface ProtocolUrls {
  anthropic?: string;
  openai: string;
}

interface ProviderMetadata {
  /** Human-readable display name */
  displayName: string;
  /** Default model for this provider */
  defaultModel: string;
  /** URL configuration - either a single URL object or protocol-specific URLs */
  urls: ProtocolUrls;
  /** Whether this provider only supports OpenAI protocol (no Anthropic) */
  openaiOnly?: boolean;
  /** URL patterns used to detect this provider from a baseUrl */
  detectionPatterns: string[];
  /** Third-party source names that route through this provider */
  sourceNames?: Record<string, string>;
  /** Function to calculate max output tokens based on model */
  getMaxOutputTokens?: (model: string) => number;
  /** Default context size */
  defaultContextSize?: number;
}

const DEFAULT_MAX_TOKENS = 131072;
const DEFAULT_CONTEXT_SIZE = 262144;

/**
 * Centralized provider configuration.
 * All provider-specific data lives here - no more scattered if-else chains!
 */
const PROVIDER_METADATA: Record<string, ProviderMetadata> = {
  kimi: {
    displayName: 'Kimi',
    defaultModel: 'moonshotai/kimi-k2.5',
    urls: { openai: 'https://api.moonshot.ai/v1' },
    detectionPatterns: ['api.moonshot.ai', 'moonshot.ai'],
    sourceNames: {
      moonshot: 'Kimi',
      openrouter: 'OpenRouter',
      nvidia: 'NVIDIA NIM',
      alibaba: 'Alibaba Coding',
      'alibaba-api-sg': 'Alibaba API (SG)',
    },
    defaultContextSize: DEFAULT_CONTEXT_SIZE,
  },

  openrouter: {
    displayName: 'OpenRouter',
    defaultModel: 'moonshotai/kimi-k2.5',
    urls: {
      anthropic: 'https://openrouter.ai/api',
      openai: 'https://openrouter.ai/api/v1',
    },
    detectionPatterns: ['openrouter.ai'],
    sourceNames: { openrouter: 'OpenRouter' },
    defaultContextSize: DEFAULT_CONTEXT_SIZE,
  },

  nvidia: {
    displayName: 'NVIDIA NIM',
    defaultModel: 'moonshotai/kimi-k2.5',
    urls: { openai: 'https://integrate.api.nvidia.com/v1' },
    detectionPatterns: ['nvidia.com', 'integrate.api.nvidia.com'],
    sourceNames: { nvidia: 'NVIDIA NIM' },
    defaultContextSize: DEFAULT_CONTEXT_SIZE,
  },

  alibaba: {
    displayName: 'Alibaba Coding',
    defaultModel: 'qwen3-coder-plus',
    urls: {
      anthropic: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
      openai: 'https://coding-intl.dashscope.aliyuncs.com/v1',
    },
    detectionPatterns: ['coding-intl.dashscope.aliyuncs.com', 'aliyuncs.com/apps/anthropic'],
    sourceNames: { alibaba: 'Alibaba Coding' },
    defaultContextSize: DEFAULT_CONTEXT_SIZE,
  },

  alibaba_api: {
    displayName: 'Alibaba API (SG)',
    defaultModel: 'qwen3-max-2026-01-23',
    urls: { openai: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
    openaiOnly: true,
    detectionPatterns: ['compatible-mode', 'dashscope-intl.aliyuncs.com'],
    sourceNames: { 'alibaba-api-sg': 'Alibaba API (SG)' },
    getMaxOutputTokens: (model: string) =>
      model.includes('qwen3-max') ? 65536 : DEFAULT_MAX_TOKENS,
    defaultContextSize: DEFAULT_CONTEXT_SIZE,
  },

  glm_coding_plan_global: {
    displayName: 'GLM Coding Plan Global',
    defaultModel: 'glm-4-coder',
    urls: {
      anthropic: 'https://api.z.ai/api/anthropic',
      openai: 'https://api.z.ai/api/coding/paas/v4',
    },
    detectionPatterns: ['api.z.ai', 'z.ai/api'],
    defaultContextSize: DEFAULT_CONTEXT_SIZE,
  },

  glm_coding_plan_china: {
    displayName: 'GLM Coding Plan China',
    defaultModel: 'glm-4-coder',
    urls: {
      anthropic: 'https://open.bigmodel.cn/api/anthropic',
      openai: 'https://open.bigmodel.cn/api/coding/paas/v4',
    },
    detectionPatterns: ['open.bigmodel.cn', 'bigmodel.cn/api'],
    defaultContextSize: DEFAULT_CONTEXT_SIZE,
  },
};

/** Providers that support third-party sources (kimi can be accessed through openrouter, nvidia, etc.) */
const THIRD_PARTY_SOURCE_PROVIDERS = new Set(['kimi', 'openrouter', 'nvidia', 'alibaba', 'alibaba_api']);

/** Providers that only support OpenAI protocol */
const OPENAI_ONLY_PROVIDERS = new Set(['kimi', 'nvidia', 'alibaba_api']);

// ============================================================================
// Helper Functions
// ============================================================================

/** Get provider metadata by plan name */
function getProviderMetadata(plan: string): ProviderMetadata | undefined {
  return PROVIDER_METADATA[plan];
}

/** Get the appropriate base URL for a provider and protocol */
function getProviderBaseUrl(
  provider: ProviderMetadata,
  protocol: 'anthropic' | 'openai'
): string {
  return protocol === 'anthropic' && provider.urls.anthropic
    ? provider.urls.anthropic
    : provider.urls.openai;
}

/** Check if a provider should have an Anthropic protocol entry */
function supportsAnthropicProtocol(plan: string): boolean {
  return !OPENAI_ONLY_PROVIDERS.has(plan);
}

/** Get the default model for a provider */
function getDefaultModel(plan: string): string {
  const provider = getProviderMetadata(plan);
  return provider?.defaultModel ?? 'glm-4-coder';
}

/** Extract display name from source or provider */
function getSourceDisplayName(plan: string, source?: string): string {
  const provider = getProviderMetadata(plan);
  if (!provider?.sourceNames) return provider?.displayName ?? 'Unknown';

  const normalizedSource = (source ?? '').toLowerCase().trim();
  return provider.sourceNames[normalizedSource] ?? provider.displayName;
}

/** Detect plan from base URL using patterns */
function detectPlanFromBaseUrl(baseUrl: string): string | null {
  for (const [plan, metadata] of Object.entries(PROVIDER_METADATA)) {
    if (metadata.detectionPatterns.some((pattern) => baseUrl.includes(pattern))) {
      return plan;
    }
  }
  // Fallback: if no pattern matches but URL exists, assume kimi (moonshot API compatible)
  return baseUrl ? 'kimi' : null;
}

/** Get max output tokens for a model */
function getMaxOutputTokens(plan: string, model: string): number {
  const provider = getProviderMetadata(plan);
  if (provider?.getMaxOutputTokens) {
    return provider.getMaxOutputTokens(model);
  }
  return model.includes('qwen3-max') ? 65536 : DEFAULT_MAX_TOKENS;
}

/** Get max context size for a provider */
function getMaxContextSize(plan: string): number {
  return getProviderMetadata(plan)?.defaultContextSize ?? DEFAULT_CONTEXT_SIZE;
}

/** Check if a display name suggests "reasoning/thinking" capability */
function supportsThinking(plan: string, source?: string): boolean {
  // Only native Moonshot API (kimi without source or with moonshot source) supports extended thinking
  if (plan !== 'kimi') return false;
  const normalizedSource = (source ?? '').toLowerCase().trim();
  return normalizedSource === '' || normalizedSource === 'moonshot';
}

// ============================================================================
// Main Class
// ============================================================================

export class FactoryDroidManager {
  static instance: FactoryDroidManager | null = null;
  private configPath: string;
  private mcpConfigPath: string;

  constructor() {
    this.configPath = join(homedir(), '.factory', 'settings.json');
    this.mcpConfigPath = join(homedir(), '.factory', 'mcp.json');
  }

  static getInstance(): FactoryDroidManager {
    if (!FactoryDroidManager.instance) {
      FactoryDroidManager.instance = new FactoryDroidManager();
    }
    return FactoryDroidManager.instance;
  }

  // --------------------------------------------------------------------------
  // Config I/O
  // --------------------------------------------------------------------------

  private getConfig() {
    return readJsonConfig(this.configPath, 'FactoryDroidManager.config');
  }

  private saveConfig(config: any) {
    writeJsonConfig(this.configPath, config, 'FactoryDroidManager.config', 2);
  }

  private getMCPConfig() {
    return readJsonConfig(this.mcpConfigPath, 'FactoryDroidManager.mcp');
  }

  private saveMCPConfig(config: any) {
    writeJsonConfig(this.mcpConfigPath, config, 'FactoryDroidManager.mcp', 2);
  }

  // --------------------------------------------------------------------------
  // Base URL Resolution
  // --------------------------------------------------------------------------

  private getBaseUrl(
    plan: string,
    protocol: 'anthropic' | 'openai',
    options?: ProviderOptions
  ): string {
    // Priority 1: Protocol-specific custom URL (for anthropic)
    if (protocol === 'anthropic' && options?.anthropicBaseUrl?.trim()) {
      return options.anthropicBaseUrl.trim();
    }

    // Priority 2: Generic custom base URL
    if (options?.baseUrl?.trim()) {
      return options.baseUrl.trim();
    }

    // Priority 3: Lookup from centralized provider configuration
    const provider = getProviderMetadata(plan);
    if (provider) {
      return getProviderBaseUrl(provider, protocol);
    }

    return '';
  }

  // --------------------------------------------------------------------------
  // Display Name Generation
  // --------------------------------------------------------------------------

  private getDisplayName(
    plan: string,
    protocol: 'anthropic' | 'openai',
    options?: ProviderOptions
  ): string {
    const targetModel = options?.model?.trim() || getDefaultModel(plan);
    const modelName = this.extractModelName(targetModel);
    const protocolName = protocol === 'anthropic' ? 'Anthropic' : 'OpenAI';

    // For providers with third-party sources, use the source name
    if (THIRD_PARTY_SOURCE_PROVIDERS.has(plan)) {
      const providerName = getSourceDisplayName(plan, options?.source);
      return `${providerName} - ${modelName} [${protocolName}]`;
    }

    // For standard GLM plans
    const provider = getProviderMetadata(plan);
    const planName = provider?.displayName ?? 'Unknown Plan';
    return `${planName} - ${modelName} [${protocolName}]`;
  }

  private toCustomModelId(displayName: string, index: number): string {
    const slug = displayName.trim().replace(/\s/g, '-');
    return `custom:${slug}-${index}`;
  }

  private extractModelName(modelId: string): string {
    const parts = modelId.split('/');
    return parts.length > 1 ? parts[parts.length - 1] : modelId;
  }

  // --------------------------------------------------------------------------
  // Config Loading
  // --------------------------------------------------------------------------

  async loadConfig(
    plan: string,
    apiKey: string,
    options?: ProviderOptions
  ): Promise<void> {
    const currentConfig = this.getConfig();
    const targetModel = options?.model?.trim() || getDefaultModel(plan);

    // Calculate base URL (with fallback)
    const baseUrl =
      options?.baseUrl?.trim() ??
      (plan === 'kimi'
        ? 'https://api.moonshot.ai/v1'
        : this.getBaseUrl(plan, 'openai', options));

    // Filter out old configurations
    const displayNameFilters = Object.values(PROVIDER_METADATA).map((p) => p.displayName);
    const existingModels = (currentConfig.customModels || []).filter((m: any) =>
      displayNameFilters.every((filter) => !m.displayName?.includes(filter))
    );

    // Handle OpenAI-only providers (kimi, alibaba_api)
    if (OPENAI_ONLY_PROVIDERS.has(plan)) {
      await this.loadOpenAIOnlyProvider(
        currentConfig,
        existingModels,
        plan,
        apiKey,
        targetModel,
        baseUrl,
        options
      );
      return;
    }

    // Handle dual-protocol providers
    await this.loadDualProtocolProvider(
      currentConfig,
      existingModels,
      plan,
      apiKey,
      targetModel,
      options
    );
  }

  private async loadOpenAIOnlyProvider(
    currentConfig: any,
    existingModels: any[],
    plan: string,
    apiKey: string,
    targetModel: string,
    baseUrl: string,
    options?: ProviderOptions
  ): Promise<void> {
    const displayName = this.getDisplayName(plan, 'openai', options);
    const modelName = this.extractModelName(targetModel);
    const maxOutputTokens = getMaxOutputTokens(plan, targetModel);
    const maxContextSize = options?.maxContextSize ?? getMaxContextSize(plan);

    const openaiModel: Record<string, any> = {
      displayName,
      name: modelName,
      model: targetModel,
      baseUrl,
      apiKey,
      provider: 'generic-chat-completion-api',
      maxOutputTokens,
      maxContextSize,
    };

    // Disable thinking for non-native sources
    if (!supportsThinking(plan, options?.source)) {
      openaiModel.thinking = false;
      openaiModel.reasoning = false;
    }

    const customModels = [...existingModels, openaiModel];
    const modelIndex = customModels.length - 1;

    const newConfig = {
      ...currentConfig,
      model: 'custom-model',
      cloudSessionSync: false,
      sessionDefaultSettings: {
        ...(currentConfig.sessionDefaultSettings || {}),
        model: this.toCustomModelId(openaiModel.displayName, modelIndex),
      },
      customModels,
    };

    this.saveConfig(newConfig);
  }

  private async loadDualProtocolProvider(
    currentConfig: any,
    existingModels: any[],
    plan: string,
    apiKey: string,
    targetModel: string,
    options?: ProviderOptions
  ): Promise<void> {
    const maxOutputTokens = getMaxOutputTokens(plan, targetModel);
    const modelName = this.extractModelName(targetModel);

    // Create Anthropic protocol configuration
    const anthropicModel = {
      displayName: this.getDisplayName(plan, 'anthropic', options),
      name: modelName,
      model: targetModel,
      baseUrl: this.getBaseUrl(plan, 'anthropic', options),
      apiKey,
      provider: 'anthropic',
      maxOutputTokens,
    };

    // Create OpenAI Chat Completion protocol configuration
    const openaiModel = {
      displayName: this.getDisplayName(plan, 'openai', options),
      name: modelName,
      model: targetModel,
      baseUrl: this.getBaseUrl(plan, 'openai', options),
      apiKey,
      provider: 'generic-chat-completion-api',
      maxOutputTokens,
    };

    const customModels = [...existingModels, anthropicModel, openaiModel];
    const openaiModelIndex = customModels.length - 1;

    const newConfig = {
      ...currentConfig,
      model: 'custom-model',
      cloudSessionSync: false,
      sessionDefaultSettings: {
        ...(currentConfig.sessionDefaultSettings || {}),
        model: this.toCustomModelId(openaiModel.displayName, openaiModelIndex),
      },
      customModels,
    };

    this.saveConfig(newConfig);
  }

  // --------------------------------------------------------------------------
  // Config Unloading
  // --------------------------------------------------------------------------

  async unloadConfig(): Promise<void> {
    const currentConfig = this.getConfig();

    if (currentConfig.customModels) {
      const displayNameFilters = Object.values(PROVIDER_METADATA).map((p) => p.displayName);
      currentConfig.customModels = currentConfig.customModels.filter((m: any) =>
        displayNameFilters.every((filter) => !m.displayName?.includes(filter))
      );

      if (currentConfig.customModels.length === 0) {
        delete currentConfig.customModels;
      }
    }

    this.saveConfig(currentConfig);
  }

  // --------------------------------------------------------------------------
  // Config Detection
  // --------------------------------------------------------------------------

  async detectCurrentConfig(): Promise<{
    plan: string | null;
    apiKey: string | null;
    model?: string;
  }> {
    try {
      const config = this.getConfig();

      if (!config.customModels?.length) {
        return { plan: null, apiKey: null };
      }

      // Find managed configurations by display name patterns
      const displayNameFilters = Object.values(PROVIDER_METADATA).map((p) => p.displayName);
      const managedModel = config.customModels.find((m: any) =>
        displayNameFilters.some((filter) => m.displayName?.includes(filter))
      );

      if (!managedModel) {
        return { plan: null, apiKey: null };
      }

      const plan = detectPlanFromBaseUrl(managedModel.baseUrl);

      return {
        plan,
        apiKey: managedModel.apiKey ?? null,
        model: managedModel.model,
      };
    } catch {
      return { plan: null, apiKey: null };
    }
  }

  // --------------------------------------------------------------------------
  // MCP Management
  // --------------------------------------------------------------------------

  isMCPInstalled(mcpId: string): boolean {
    try {
      const config = this.getMCPConfig();
      return mcpId in (config.mcpServers ?? {});
    } catch {
      return false;
    }
  }

  async installMCP(mcp: MCPService, apiKey: string, plan: string): Promise<void> {
    const config = this.getMCPConfig();
    config.mcpServers ??= {};

    let mcpConfig: any;

    if (mcp.protocol === 'stdio') {
      mcpConfig = this.buildStdioMCPConfig(mcp, apiKey, plan);
    } else if (mcp.protocol === 'sse' || mcp.protocol === 'streamable-http') {
      mcpConfig = this.buildHttpMCPConfig(mcp, apiKey, plan);
    } else {
      throw new Error(`Unsupported protocol: ${mcp.protocol}`);
    }

    config.mcpServers[mcp.id] = mcpConfig;
    this.saveMCPConfig(config);
  }

  private buildStdioMCPConfig(
    mcp: MCPService,
    apiKey: string,
    plan: string
  ): Record<string, any> {
    // Build environment variables
    const env = this.buildMCPConfigEnv(mcp, plan);

    // Add API key if required
    if (mcp.requiresAuth && apiKey) {
      env[mcp.authEnvVar || 'Z_AI_API_KEY'] = apiKey;
    }

    return {
      type: 'stdio',
      command: mcp.command || 'npx',
      args:
        mcp.command === 'npx' && !mcp.args?.includes('--silent')
          ? ['--silent', ...(mcp.args || [])]
          : mcp.args || [],
      env,
      disabled: false,
    };
  }

  private buildMCPConfigEnv(mcp: MCPService, plan: string): Record<string, string> {
    let env: Record<string, string> = {};

    if (mcp.envTemplate && plan) {
      env = { ...(mcp.envTemplate[plan] || {}) };
    } else if (mcp.env) {
      env = { ...mcp.env };
    }

    // Fill in environment variables from process.env if needed
    for (const [key, value] of Object.entries(env)) {
      if (value === '' && process.env[key]) {
        env[key] = process.env[key] as string;
      }
    }

    return env;
  }

  private buildHttpMCPConfig(mcp: MCPService, apiKey: string, plan: string): Record<string, any> {
    const url = mcp.urlTemplate?.[plan] ?? mcp.url;
    if (!url) {
      throw new Error(`MCP ${mcp.id} missing url or urlTemplate`);
    }

    const headers: Record<string, string> = { ...(mcp.headers || {}) };

    // Add API key to headers if required
    if (mcp.requiresAuth && apiKey) {
      const headerName = mcp.authHeader || 'Authorization';
      const authScheme = mcp.authScheme || 'Bearer';
      headers[headerName] = authScheme === 'Bearer' ? `Bearer ${apiKey}` : apiKey;
    }

    return {
      type: 'http',
      url,
      headers,
      disabled: false,
    };
  }

  async uninstallMCP(mcpId: string): Promise<void> {
    const config = this.getMCPConfig();
    delete config.mcpServers?.[mcpId];
    this.saveMCPConfig(config);
  }

  getInstalledMCPs(): string[] {
    try {
      const config = this.getMCPConfig();
      return Object.keys(config.mcpServers ?? {});
    } catch {
      return [];
    }
  }

  getMCPStatus(mcpServices: MCPService[]): Map<string, boolean> {
    return new Map(mcpServices.map((mcp) => [mcp.id, this.isMCPInstalled(mcp.id)]));
  }

  getOtherMCPs(builtinIds: string[]): Array<{ id: string; config: any }> {
    try {
      const config = this.getMCPConfig();
      const mcpServers = config.mcpServers ?? {};

      return Object.entries(mcpServers)
        .filter(([id]) => !builtinIds.includes(id))
        .map(([id, mcpConfig]) => ({ id, config: mcpConfig }));
    } catch {
      return [];
    }
  }

  getAllMCPServers(): Record<string, any> {
    try {
      const config = this.getMCPConfig();
      return config.mcpServers ?? {};
    } catch {
      return {};
    }
  }
}

export const factoryDroidManager = FactoryDroidManager.getInstance();
