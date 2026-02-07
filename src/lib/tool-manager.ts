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

  requiresAuth?: boolean;
}

export interface ProviderOptions {
  baseUrl?: string;
  model?: string;
  providerId?: string;
  source?: string;
  maxContextSize?: number;
}

export class ToolManager {
  static instance: ToolManager | null = null;
  private managers: Map<string, any> = new Map();

  constructor() {
    // Initialize with lazy loading
  }

  static getInstance(): ToolManager {
    if (!ToolManager.instance) {
      ToolManager.instance = new ToolManager();
    }
    return ToolManager.instance;
  }

  private async getManager(tool: string): Promise<any> {
    if (this.managers.has(tool)) {
      return this.managers.get(tool);
    }

    let manager: any;
    switch (tool) {
      case 'claude-code':
        manager = (await import('./claude-code-manager.js')).claudeCodeManager;
        break;
      case 'opencode':
        manager = (await import('./opencode-manager.js')).openCodeManager;
        break;
      case 'crush':
        manager = (await import('./crush-manager.js')).crushManager;
        break;
      case 'factory-droid':
        manager = (await import('./factory-droid-manager.js')).factoryDroidManager;
        break;
      case 'kimi':
        manager = (await import('./kimi-manager.js')).kimiManager;
        break;
      case 'amp':
        manager = (await import('./amp-manager.js')).ampManager;
        break;
      case 'pi':
        manager = (await import('./pi-manager.js')).piManager;
        break;
      default:
        throw new Error(`Unsupported tool: ${tool}`);
    }

    this.managers.set(tool, manager);
    return manager;
  }

  getSupportedTools(): string[] {
    return ['claude-code', 'opencode', 'crush', 'factory-droid', 'kimi', 'amp', 'pi'];
  }

  async isConfigured(tool: string): Promise<boolean> {
    const manager = await this.getManager(tool);
    const { plan, apiKey } = await manager.detectCurrentConfig();
    return !!(plan && apiKey);
  }

  async loadConfig(tool: string, plan: string, apiKey: string): Promise<void> {
    const manager = await this.getManager(tool);
    if (plan === 'kimi' || plan === 'openrouter' || plan === 'nvidia') {
      const { configManager } = await import('../utils/config.js');
      const settings = configManager.getProviderSettings(plan);
      const options: ProviderOptions = {
        baseUrl: settings.baseUrl,
        model: settings.model,
        providerId: settings.providerId,
        source: settings.source,
        maxContextSize: settings.maxContextSize,
      };
      // All kimi-like providers are handled by the managers as plan 'kimi'
      await manager.loadConfig('kimi', apiKey, options);
      return;
    }

    await manager.loadConfig(plan, apiKey);
  }

  async unloadConfig(tool: string): Promise<void> {
    const manager = await this.getManager(tool);
    await manager.unloadConfig();
  }

  async installTool(tool: string): Promise<void> {
    console.log(`Installing ${tool}... (not implemented)`);
  }

  async uninstallTool(tool: string): Promise<void> {
    await this.unloadConfig(tool);
  }

  async isMCPInstalled(tool: string, mcpId: string): Promise<boolean> {
    const manager = await this.getManager(tool);
    return manager.isMCPInstalled(mcpId);
  }

  async installMCP(tool: string, mcp: MCPService, apiKey: string, plan: string): Promise<void> {
    const manager = await this.getManager(tool);
    await manager.installMCP(mcp, apiKey, plan);
  }

  async uninstallMCP(tool: string, mcpId: string): Promise<void> {
    const manager = await this.getManager(tool);
    await manager.uninstallMCP(mcpId);
  }

  async getInstalledMCPs(tool: string): Promise<string[]> {
    const manager = await this.getManager(tool);
    return manager.getInstalledMCPs();
  }

  async getMCPStatus(tool: string, mcpServices: MCPService[]): Promise<Map<string, boolean>> {
    const manager = await this.getManager(tool);
    return manager.getMCPStatus(mcpServices);
  }

  async getOtherMCPs(tool: string, builtinIds: string[]): Promise<Array<{ id: string; config: any }>> {
    const manager = await this.getManager(tool);
    return manager.getOtherMCPs(builtinIds);
  }

  async getAllMCPServers(tool: string): Promise<Record<string, any>> {
    const manager = await this.getManager(tool);
    return manager.getAllMCPServers();
  }

  async detectCurrentConfig(tool: string): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    const manager = await this.getManager(tool);
    return manager.detectCurrentConfig();
  }
}

export const toolManager = ToolManager.getInstance();
