import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { MCPService } from './tool-manager.js';
import type { ProviderOptions } from './tool-manager.js';

export class ClaudeCodeManager {
  static instance: ClaudeCodeManager | null = null;
  private settingsPath: string;
  private mcpConfigPath: string;

  constructor() {
    // Claude Code 配置文件路径（跨平台支持）
    // - macOS/Linux: ~/.claude/settings.json 和 ~/.claude.json
    // - Windows: %USERPROFILE%\.claude\settings.json 和 %USERPROFILE%\.claude.json
    this.settingsPath = join(homedir(), '.claude', 'settings.json');
    this.mcpConfigPath = join(homedir(), '.claude.json');
  }

  static getInstance(): ClaudeCodeManager {
    if (!ClaudeCodeManager.instance) {
      ClaudeCodeManager.instance = new ClaudeCodeManager();
    }
    return ClaudeCodeManager.instance;
  }

  private ensureConfigDir(filePath: string) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private getSettings() {
    try {
      if (existsSync(this.settingsPath)) {
        const content = readFileSync(this.settingsPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn('Failed to read Claude Code settings:', error);
      logger.logError('ClaudeCodeManager.getSettings', error);
    }
    return {};
  }

  private saveSettings(config: any) {
    try {
      this.ensureConfigDir(this.settingsPath);
      writeFileSync(this.settingsPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save Claude Code settings: ${error}`);
    }
  }

  private getMCPConfig() {
    try {
      if (existsSync(this.mcpConfigPath)) {
        const content = readFileSync(this.mcpConfigPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn('Failed to read Claude Code MCP config:', error);
      logger.logError('ClaudeCodeManager.getMCPConfig', error);
    }
    return {};
  }

  private saveMCPConfig(config: any) {
    try {
      this.ensureConfigDir(this.mcpConfigPath);
      writeFileSync(this.mcpConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save Claude Code MCP config: ${error}`);
    }
  }

  async loadConfig(plan: string, apiKey: string, options?: ProviderOptions): Promise<void> {
    // 1. 确保 .claude.json 中有 hasCompletedOnboarding: true
    this.ensureOnboardingCompleted();
    // 2. 清理 shell rc 文件中的 ANTHROPIC_API_KEY 和 ANTHROPIC_BASE_URL
    this.cleanupShellEnvVars();
    // 3. 加载配置到 settings.json
    const currentSettings = this.getSettings();
    // 从 env 中移除 ANTHROPIC_API_KEY（如果存在），统一使用 ANTHROPIC_AUTH_TOKEN
    const currentEnv = currentSettings.env || {};
    const { ANTHROPIC_API_KEY: _, ...cleanedEnv } = currentEnv;

    let glmConfig: any;
    if (plan === 'kimi') {
      const source = (options?.source || '').toString().trim().toLowerCase();
      const baseUrl = options?.baseUrl?.trim() || 'https://api.moonshot.ai/v1';

      if (source === 'nvidia' || baseUrl.includes('integrate.api.nvidia.com')) {
        throw new Error(
          'Claude Code expects an Anthropic-compatible API (e.g., /v1/messages). NVIDIA NIM for Kimi is OpenAI chat-completions (POST /v1/chat/completions), so this combination is not supported.'
        );
      }
      glmConfig = {
        ...currentSettings,
        env: {
          ...cleanedEnv,
          ANTHROPIC_AUTH_TOKEN: apiKey,
          ANTHROPIC_BASE_URL: baseUrl,
          API_TIMEOUT_MS: '3000000',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1
        }
      };
    } else {
      glmConfig = {
        ...currentSettings,
        env: {
          ...cleanedEnv,
          ANTHROPIC_AUTH_TOKEN: apiKey,
          ANTHROPIC_BASE_URL: plan === 'glm_coding_plan_global' ? 'https://api.z.ai/api/anthropic' : 'https://open.bigmodel.cn/api/anthropic',
          API_TIMEOUT_MS: '3000000',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1
        }
      };
    }

    this.saveSettings(glmConfig);
  }

  async unloadConfig(): Promise<void> {
    const currentSettings = this.getSettings();
    if (!currentSettings.env) {
      return;
    }
    // 删除 GLM Coding Plan 和 Kimi 相关的环境变量
    const { ANTHROPIC_AUTH_TOKEN: _1, ANTHROPIC_BASE_URL: _2, API_TIMEOUT_MS: _3, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: _4, ...otherEnv } = currentSettings.env;
    const newSettings = {
      ...currentSettings,
      env: otherEnv
    };
    // 如果 env 为空对象，则删除 env 字段
    if (newSettings.env && Object.keys(newSettings.env).length === 0) {
      delete newSettings.env;
    }
    this.saveSettings(newSettings);
  }

  async detectCurrentConfig(): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    try {
      const settings = this.getSettings();
      if (!settings.env || !settings.env.ANTHROPIC_AUTH_TOKEN) {
        return { plan: null, apiKey: null };
      }
      const apiKey = settings.env.ANTHROPIC_AUTH_TOKEN;
      const baseUrl = settings.env.ANTHROPIC_BASE_URL;
      let plan: string | null = null;
      if (baseUrl === 'https://api.z.ai/api/anthropic') {
        plan = 'glm_coding_plan_global';
      } else if (baseUrl === 'https://open.bigmodel.cn/api/anthropic') {
        plan = 'glm_coding_plan_china';
      } else if (baseUrl?.includes('openrouter.ai')) {
        plan = 'openrouter';
      } else if (baseUrl?.includes('nvidia.com')) {
        plan = 'nvidia';
      } else if (baseUrl) {
        // Treat any other configured base URL as a user-configured Kimi/custom endpoint.
        plan = 'kimi';
      }
      // Claude Code doesn't store model in settings, it's configured at runtime
      return { plan, apiKey, model: undefined };
    } catch {
      return { plan: null, apiKey: null };
    }
  }

  private ensureOnboardingCompleted() {
    try {
      const mcpConfig = this.getMCPConfig();
      if (!mcpConfig.hasCompletedOnboarding) {
        this.saveMCPConfig({ ...mcpConfig, hasCompletedOnboarding: true });
      }
    } catch (error) {
      console.warn('Failed to ensure onboarding completed:', error);
      logger.logError('ClaudeCodeManager.ensureOnboardingCompleted', error);
    }
  }

  private cleanupShellEnvVars() {
    // 检查当前环境变量是否有这些值
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_BASE_URL) {
      return;
    }
    try {
      // 根据操作系统和 shell 类型确定 rc 文件路径
      const rcFile = this.getShellRcFilePath();
      if (!rcFile || !existsSync(rcFile)) {
        return;
      }
      let content = readFileSync(rcFile, 'utf-8');
      const originalContent = content;
      // 移除 ANTHROPIC_BASE_URL 和 ANTHROPIC_API_KEY 相关行
      const linesToRemove = [
        /^\s*export\s+ANTHROPIC_BASE_URL=.*$/gm,
        /^\s*export\s+ANTHROPIC_API_KEY=.*$/gm,
        /^\s*#\s*Claude Code environment variables\s*$/gm
      ];
      for (const pattern of linesToRemove) {
        content = content.replace(pattern, '');
      }
      // 如果内容有变化，写回文件
      if (content !== originalContent) {
        writeFileSync(rcFile, content, 'utf-8');
        console.log(`Cleaned up ANTHROPIC_* environment variables from ${rcFile}`);
      }
    } catch (error) {
      console.warn('Failed to cleanup shell environment variables:', error);
      logger.logError('ClaudeCodeManager.cleanupShellEnvVars', error);
    }
  }

  private getShellRcFilePath(): string | null {
    const home = homedir();
    // Windows 不使用 rc 文件
    if (process.platform === 'win32') {
      return null;
    }
    // 获取当前 shell
    const shell = process.env.SHELL || '';
    const shellName = shell.split('/').pop() || '';
    switch (shellName) {
      case 'bash':
        return join(home, '.bashrc');
      case 'zsh':
        return join(home, '.zshrc');
      case 'fish':
        return join(home, '.config', 'fish', 'config.fish');
      default:
        return join(home, '.profile');
    }
  }

  isMCPInstalled(mcpId: string): boolean {
    try {
      const config = this.getMCPConfig();
      if (!config.mcpServers) {
        return false;
      }
      return mcpId in config.mcpServers;
    } catch {
      return false;
    }
  }

  async installMCP(mcp: MCPService, apiKey: string, plan: string): Promise<void> {
    try {
      const config = this.getMCPConfig();
      if (!config.mcpServers) {
        config.mcpServers = {};
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

        // Add API key if required
        if (mcp.requiresAuth && apiKey) {
          env.Z_AI_API_KEY = apiKey;
        }

        mcpConfig = {
          type: 'stdio',
          command: mcp.command || 'npx',
          args: mcp.args || [],
          env
        };
      } else if (mcp.protocol === 'sse' || mcp.protocol === 'streamable-http') {
        // Determine URL based on plan
        let url = '';
        if (mcp.urlTemplate && plan) {
          url = mcp.urlTemplate[plan];
        } else if (mcp.url) {
          url = mcp.url;
        } else {
          throw new Error(`MCP ${mcp.id} missing url or urlTemplate`);
        }

        mcpConfig = {
          type: mcp.protocol === 'sse' ? 'sse' : 'http',
          url: url,
          headers: {
            ...(mcp.headers || {})
          }
        };

        // Add API key to headers if required
        if (mcp.requiresAuth && apiKey) {
          mcpConfig.headers = {
            ...mcpConfig.headers,
            'Authorization': `Bearer ${apiKey}`
          };
        }
      } else {
        throw new Error(`Unsupported protocol: ${mcp.protocol}`);
      }

      config.mcpServers[mcp.id] = mcpConfig;
      this.saveMCPConfig(config);
    } catch (error) {
      throw new Error(`Failed to install MCP ${mcp.name}: ${error}`);
    }
  }

  async uninstallMCP(mcpId: string): Promise<void> {
    try {
      const config = this.getMCPConfig();
      if (!config.mcpServers) {
        return;
      }
      delete config.mcpServers[mcpId];
      this.saveMCPConfig(config);
    } catch (error) {
      throw new Error(`Failed to uninstall MCP ${mcpId}: ${error}`);
    }
  }

  getInstalledMCPs(): string[] {
    try {
      const config = this.getMCPConfig();
      if (!config.mcpServers) {
        return [];
      }
      return Object.keys(config.mcpServers);
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
      const config = this.getMCPConfig();
      if (!config.mcpServers) {
        return [];
      }
      const otherMCPs: Array<{ id: string; config: any }> = [];
      for (const [id, mcpConfig] of Object.entries(config.mcpServers)) {
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
      const config = this.getMCPConfig();
      return config.mcpServers || {};
    } catch {
      return {};
    }
  }
}

export const claudeCodeManager = ClaudeCodeManager.getInstance();
