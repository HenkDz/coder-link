import type { Plan } from '../utils/config.js';

export interface MCPService {
  id: string;
  name: string;
  description?: string;
  protocol: 'stdio' | 'sse' | 'streamable-http';

  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  envTemplate?: Record<string, Record<string, string>>;

  // sse/http
  url?: string;
  urlTemplate?: Record<string, string>;
  headers?: Record<string, string>;

  // Auth behavior:
  // - requiresAuth=true means "inject provider API key"
  // - stdio: provider key is written to authEnvVar (default: Z_AI_API_KEY)
  // - http/sse: provider key is written to authHeader (default: Authorization as Bearer token)
  requiresAuth?: boolean;
  authEnvVar?: string;
  authHeader?: string;
  authScheme?: 'Bearer' | 'raw';
}

export interface ProviderOptions {
  baseUrl?: string;
  anthropicBaseUrl?: string;
  model?: string;
  anthropicModel?: string;
  providerId?: string;
  source?: string;
  maxContextSize?: number;
}

export type ToolName = 'claude-code' | 'opencode' | 'crush' | 'factory-droid' | 'kimi' | 'amp' | 'pi';

const TOOL_NAMES: ToolName[] = ['claude-code', 'opencode', 'crush', 'factory-droid', 'kimi', 'amp', 'pi'];

const ALL_PLANS: Plan[] = [
  'glm_coding_plan_global',
  'glm_coding_plan_china',
  'kimi',
  'openrouter',
  'nvidia',
  'lmstudio',
  'alibaba',
];

export interface ToolCapabilities {
  supportsProviderConfig: boolean;
  supportsMcp: boolean;
  supportsModelSelection: boolean;
  supportedPlans: Plan[];
  notes?: string;
}

export interface ToolAdapter {
  detectCurrentConfig(): Promise<{ plan: string | null; apiKey: string | null; model?: string }>;
  loadConfig(plan: string, apiKey: string, options?: ProviderOptions): Promise<void>;
  unloadConfig(): Promise<void>;
  isMCPInstalled(mcpId: string): boolean;
  installMCP(mcp: MCPService, apiKey: string, plan: string): Promise<void>;
  uninstallMCP(mcpId: string): Promise<void>;
  getInstalledMCPs(): string[];
  getMCPStatus(mcpServices: MCPService[]): Map<string, boolean>;
  getOtherMCPs(builtinIds: string[]): Array<{ id: string; config: unknown }>;
  getAllMCPServers(): Record<string, unknown>;
}

export class ToolManager {
  static instance: ToolManager | null = null;
  private managers: Map<ToolName, ToolAdapter> = new Map();

  private static readonly CAPABILITIES: Record<ToolName, ToolCapabilities> = {
    'claude-code': {
      supportsProviderConfig: true,
      supportsMcp: true,
      supportsModelSelection: true,
      supportedPlans: ['glm_coding_plan_global', 'glm_coding_plan_china', 'openrouter', 'lmstudio', 'alibaba'],
      notes: 'Requires Anthropic-compatible endpoints.',
    },
    opencode: {
      supportsProviderConfig: true,
      supportsMcp: true,
      supportsModelSelection: true,
      supportedPlans: ALL_PLANS,
    },
    crush: {
      supportsProviderConfig: true,
      supportsMcp: true,
      supportsModelSelection: false,
      supportedPlans: ALL_PLANS,
      notes: 'Model switching is not persisted in Crush provider config.',
    },
    'factory-droid': {
      supportsProviderConfig: true,
      supportsMcp: true,
      supportsModelSelection: true,
      supportedPlans: ALL_PLANS,
    },
    kimi: {
      supportsProviderConfig: true,
      supportsMcp: true,
      supportsModelSelection: true,
      supportedPlans: ALL_PLANS,
    },
    amp: {
      supportsProviderConfig: false,
      supportsMcp: false,
      supportsModelSelection: false,
      supportedPlans: [],
      notes: 'Launch-only integration for now.',
    },
    pi: {
      supportsProviderConfig: true,
      supportsMcp: false,
      supportsModelSelection: true,
      supportedPlans: ALL_PLANS,
      notes: 'MCP is not supported by Pi configuration.',
    },
  };

  private readonly managerLoaders: Record<ToolName, () => Promise<ToolAdapter>> = {
    'claude-code': async () => (await import('./claude-code-manager.js')).claudeCodeManager as ToolAdapter,
    opencode: async () => (await import('./opencode-manager.js')).openCodeManager as ToolAdapter,
    crush: async () => (await import('./crush-manager.js')).crushManager as ToolAdapter,
    'factory-droid': async () => (await import('./factory-droid-manager.js')).factoryDroidManager as ToolAdapter,
    kimi: async () => (await import('./kimi-manager.js')).kimiManager as ToolAdapter,
    amp: async () => (await import('./amp-manager.js')).ampManager as ToolAdapter,
    pi: async () => (await import('./pi-manager.js')).piManager as ToolAdapter,
  };

  constructor() {
    // Lazy-load managers on first use.
  }

  static getInstance(): ToolManager {
    if (!ToolManager.instance) {
      ToolManager.instance = new ToolManager();
    }
    return ToolManager.instance;
  }

  isSupportedTool(tool: string): tool is ToolName {
    return TOOL_NAMES.includes(tool as ToolName);
  }

  getSupportedTools(): ToolName[] {
    return [...TOOL_NAMES];
  }

  getCapabilities(tool: string): ToolCapabilities {
    const toolName = this.assertTool(tool);
    const caps = ToolManager.CAPABILITIES[toolName];
    return {
      ...caps,
      supportedPlans: [...caps.supportedPlans],
    };
  }

  isPlanSupported(tool: string, plan: string): boolean {
    const caps = this.getCapabilities(tool);
    return caps.supportedPlans.includes(plan as Plan);
  }

  private assertTool(tool: string): ToolName {
    if (!this.isSupportedTool(tool)) {
      throw new Error(`Unsupported tool: ${tool}`);
    }
    return tool;
  }

  private async getManager(tool: string): Promise<ToolAdapter> {
    const toolName = this.assertTool(tool);
    if (this.managers.has(toolName)) {
      return this.managers.get(toolName)!;
    }

    const manager = await this.managerLoaders[toolName]();
    this.managers.set(toolName, manager);
    return manager;
  }

  async isConfigured(tool: string): Promise<boolean> {
    const caps = this.getCapabilities(tool);
    if (!caps.supportsProviderConfig) return false;
    const manager = await this.getManager(tool);
    const { plan, apiKey } = await manager.detectCurrentConfig();
    return !!(plan && apiKey);
  }

  async loadConfig(tool: string, plan: string, apiKey: string, overrides?: Partial<ProviderOptions>): Promise<void> {
    const caps = this.getCapabilities(tool);
    if (!caps.supportsProviderConfig) {
      throw new Error(`${tool} does not support managed provider configuration`);
    }
    if (!this.isPlanSupported(tool, plan)) {
      throw new Error(`${tool} does not support provider plan: ${plan}`);
    }

    const manager = await this.getManager(tool);
    const { configManager } = await import('../utils/config.js');
    const settings = configManager.getProviderSettings(plan);
    const options: ProviderOptions = {
      baseUrl: settings.baseUrl,
      anthropicBaseUrl: settings.anthropicBaseUrl,
      model: settings.model,
      anthropicModel: settings.anthropicModel,
      providerId: settings.providerId,
      source: settings.source,
      maxContextSize: settings.maxContextSize,
      ...overrides,
    };
    if (overrides?.model?.trim()) {
      options.anthropicModel = overrides.model.trim();
    }

    await manager.loadConfig(plan, apiKey, options);
  }

  async unloadConfig(tool: string): Promise<void> {
    const caps = this.getCapabilities(tool);
    if (!caps.supportsProviderConfig) {
      throw new Error(`${tool} does not support managed provider configuration`);
    }
    const manager = await this.getManager(tool);
    await manager.unloadConfig();
  }

  async installTool(tool: string): Promise<void> {
    this.assertTool(tool);
    console.log(`Installing ${tool}... (not implemented)`);
  }

  async uninstallTool(tool: string): Promise<void> {
    const caps = this.getCapabilities(tool);
    if (!caps.supportsProviderConfig) return;
    await this.unloadConfig(tool);
  }

  async isMCPInstalled(tool: string, mcpId: string): Promise<boolean> {
    const caps = this.getCapabilities(tool);
    if (!caps.supportsMcp) return false;
    const manager = await this.getManager(tool);
    return manager.isMCPInstalled(mcpId);
  }

  async installMCP(tool: string, mcp: MCPService, apiKey: string, plan: string): Promise<void> {
    const caps = this.getCapabilities(tool);
    if (!caps.supportsMcp) {
      throw new Error(`${tool} does not support MCP configuration`);
    }
    const manager = await this.getManager(tool);
    await manager.installMCP(mcp, apiKey, plan);
  }

  async uninstallMCP(tool: string, mcpId: string): Promise<void> {
    const caps = this.getCapabilities(tool);
    if (!caps.supportsMcp) {
      throw new Error(`${tool} does not support MCP configuration`);
    }
    const manager = await this.getManager(tool);
    await manager.uninstallMCP(mcpId);
  }

  async getInstalledMCPs(tool: string): Promise<string[]> {
    const caps = this.getCapabilities(tool);
    if (!caps.supportsMcp) return [];
    const manager = await this.getManager(tool);
    return manager.getInstalledMCPs();
  }

  async getMCPStatus(tool: string, mcpServices: MCPService[]): Promise<Map<string, boolean>> {
    const caps = this.getCapabilities(tool);
    if (!caps.supportsMcp) return new Map();
    const manager = await this.getManager(tool);
    return manager.getMCPStatus(mcpServices);
  }

  async getOtherMCPs(tool: string, builtinIds: string[]): Promise<Array<{ id: string; config: unknown }>> {
    const caps = this.getCapabilities(tool);
    if (!caps.supportsMcp) return [];
    const manager = await this.getManager(tool);
    return manager.getOtherMCPs(builtinIds);
  }

  async getAllMCPServers(tool: string): Promise<Record<string, unknown>> {
    const caps = this.getCapabilities(tool);
    if (!caps.supportsMcp) return {};
    const manager = await this.getManager(tool);
    return manager.getAllMCPServers();
  }

  async detectCurrentConfig(tool: string): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    const caps = this.getCapabilities(tool);
    if (!caps.supportsProviderConfig) return { plan: null, apiKey: null };
    const manager = await this.getManager(tool);
    return manager.detectCurrentConfig();
  }
}

export const toolManager = ToolManager.getInstance();
