import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import type { Plan } from '../utils/config.js';
import { MCPService } from './tool-manager.js';
import type { ProviderOptions } from './tool-manager.js';
import { readJsonConfig, writeJsonConfig } from './config-io.js';
import {
  getBaseUrl,
  getDefaultModel,
  getProviderDisplayName,
  detectPlanFromUrl,
  supportsProtocol,
  supportsThinking,
} from './provider-registry.js';

/**
 * Claude Code Manager
 * 
 * Claude Code requires an Anthropic-compatible API that uses:
 * - POST to /v1/messages endpoint
 * - Anthropic request/response format (not OpenAI)
 * 
 * Claude Code constructs API URLs by appending /v1/messages to ANTHROPIC_BASE_URL.
 * So the base URL should NOT include /v1 or the messages path.
 * 
 * Model Configuration (via environment variables):
 * - ANTHROPIC_DEFAULT_OPUS_MODEL: Model for opus tier
 * - ANTHROPIC_DEFAULT_SONNET_MODEL: Model for sonnet tier (default)
 * - ANTHROPIC_DEFAULT_HAIKU_MODEL: Model for haiku tier / background tasks
 * - CLAUDE_CODE_SUBAGENT_MODEL: Model for subagents
 * 
 * Supported providers:
 * - GLM Coding Plan (Global): https://api.z.ai/api/anthropic → calls /api/anthropic/v1/messages
 * - GLM Coding Plan (China): https://open.bigmodel.cn/api/anthropic → calls /api/anthropic/v1/messages
 * - OpenRouter: https://openrouter.ai/api → calls /api/v1/messages (OpenRouter supports Anthropic format)
 * - Alibaba Coding Plan: https://coding-intl.dashscope.aliyuncs.com/apps/anthropic → calls /apps/anthropic/v1/messages
 * - LM Studio: http://localhost:1234 → calls /v1/messages (LM Studio 0.4.1+ supports Anthropic format)
 * - ZenMux: https://zenmux.ai/api/anthropic → calls /api/anthropic/v1/messages (ZenMux supports Anthropic format)
 * 
 * NOT supported (OpenAI-compatible only, no /v1/messages endpoint):
 * - Kimi/Moonshot: Only provides /v1/chat/completions
 * - NVIDIA NIM: Only provides /v1/chat/completions
 */

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

  private getSettings() {
    return readJsonConfig(this.settingsPath, 'ClaudeCodeManager.settings');
  }

  private saveSettings(config: any) {
    writeJsonConfig(this.settingsPath, config, 'ClaudeCodeManager.settings', 2);
  }

  private getMCPConfig() {
    return readJsonConfig(this.mcpConfigPath, 'ClaudeCodeManager.mcp');
  }

  private saveMCPConfig(config: any) {
    writeJsonConfig(this.mcpConfigPath, config, 'ClaudeCodeManager.mcp', 2);
  }

  async loadConfig(plan: string, apiKey: string, options?: ProviderOptions): Promise<void> {
    // 1. Ensure onboarding completed
    this.ensureOnboardingCompleted();
    // 2. Clean up shell environmental variables
    this.cleanupShellEnvVars();
    // 3. Load configurations to settings.json
    const currentSettings = this.getSettings();
    const currentEnv = currentSettings.env || {};
    const {
      ANTHROPIC_API_KEY: _legacyApiKey,
      ANTHROPIC_AUTH_TOKEN: _legacyAuthToken,
      ...cleanedEnv
    } = currentEnv;

    const planKey = plan as Plan;
    const preferredModel = options?.anthropicModel?.trim() || options?.model?.trim();

    // Claude Code requires Anthropic-compatible API (POST /v1/messages endpoint)
    // Check if this provider supports Anthropic protocol
    if (!supportsProtocol(planKey, 'anthropic')) {
      const providerName = getProviderDisplayName(planKey);
      throw new Error(
        `Claude Code requires an Anthropic-compatible API (/v1/messages). ` +
        `${providerName} only provides OpenAI-compatible API (/v1/chat/completions). ` +
        `Use a different tool (like OpenCode, Crush, or Pi) for ${providerName}, or use GLM Coding Plan with Claude Code.`
      );
    }

    // Get base URL from registry or options
    const baseUrl = options?.anthropicBaseUrl?.trim() || 
                    options?.baseUrl?.trim() || 
                    getBaseUrl(planKey, 'anthropic');

    // Get default model from registry or use preferred model
    const defaultModel = preferredModel || getDefaultModel(planKey);
    
    // Set up models for all three tiers (opus, sonnet, haiku)
    // For OpenRouter, keep haiku as a known Anthropic model for background tasks
    // For GLM providers, use glm-4.7-flash for haiku (faster for background tasks)
    const getHaikuModel = () => {
      if (planKey === 'openrouter') return 'anthropic/claude-haiku-4.6';
      if (planKey === 'glm_coding_plan_global' || planKey === 'glm_coding_plan_china') return 'glm-4.7-flash';
      return defaultModel;
    };
    const defaultModels = {
      opus: defaultModel,
      sonnet: defaultModel,
      haiku: getHaikuModel()
    };

    // GLM and ZenMux providers use ANTHROPIC_AUTH_TOKEN, others use ANTHROPIC_API_KEY
    const isGLMProvider = planKey === 'glm_coding_plan_global' || planKey === 'glm_coding_plan_china';
    const isZenMuxProvider = planKey === 'zenmux';
    const authKeyEnv = (isGLMProvider || isZenMuxProvider) ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY';

    const newConfig = {
      ...currentSettings,
      env: {
        ...cleanedEnv,
        // GLM/ZenMux use AUTH_TOKEN, other providers use API_KEY
        [authKeyEnv]: apiKey,
        // Explicitly clear ANTHROPIC_API_KEY to avoid conflicts (per ZenMux docs)
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_BASE_URL: baseUrl,
        // Model configuration - set all three tiers
        ANTHROPIC_DEFAULT_OPUS_MODEL: defaultModels.opus,
        ANTHROPIC_DEFAULT_SONNET_MODEL: defaultModels.sonnet,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: defaultModels.haiku,
        // Subagents use sonnet by default
        CLAUDE_CODE_SUBAGENT_MODEL: defaultModels.sonnet,
        API_TIMEOUT_MS: '3000000',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
      }
    };

    this.saveSettings(newConfig);
  }

  async unloadConfig(): Promise<void> {
    const currentSettings = this.getSettings();
    if (!currentSettings.env) {
      return;
    }
    // Remove all Claude Code related environment variables
    const { 
      ANTHROPIC_API_KEY: _0,
      ANTHROPIC_AUTH_TOKEN: _1, 
      ANTHROPIC_BASE_URL: _2, 
      API_TIMEOUT_MS: _3, 
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: _4,
      ANTHROPIC_DEFAULT_OPUS_MODEL: _5,
      ANTHROPIC_DEFAULT_SONNET_MODEL: _6,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: _7,
      CLAUDE_CODE_SUBAGENT_MODEL: _8,
      ...otherEnv 
    } = currentSettings.env;
    const newSettings = {
      ...currentSettings,
      env: otherEnv
    };
    // If env is empty object, delete the field
    if (newSettings.env && Object.keys(newSettings.env).length === 0) {
      delete newSettings.env;
    }
    this.saveSettings(newSettings);
  }

  async detectCurrentConfig(): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    try {
      const settings = this.getSettings();
      const env = settings.env;
      if (!env) {
        return { plan: null, apiKey: null };
      }
      const apiKey = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN;
      if (!apiKey) {
        return { plan: null, apiKey: null };
      }

      const baseUrl = env.ANTHROPIC_BASE_URL;
      const plan = detectPlanFromUrl(baseUrl);
      
      // Return the sonnet model as the primary model (used for display)
      // Claude Code uses sonnet as the default
      const model = env.ANTHROPIC_DEFAULT_SONNET_MODEL;
      
      return { plan, apiKey, model };
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
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_BASE_URL) {
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
      // 移除 ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN 相关行
      const linesToRemove = [
        /^\s*export\s+ANTHROPIC_BASE_URL=.*$/gm,
        /^\s*export\s+ANTHROPIC_API_KEY=.*$/gm,
        /^\s*export\s+ANTHROPIC_AUTH_TOKEN=.*$/gm,
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

        for (const [key, value] of Object.entries(env)) {
          if (value !== '' || !process.env[key]) continue;
          env[key] = process.env[key] as string;
        }

        // Add API key if required
        if (mcp.requiresAuth && apiKey) {
          env[mcp.authEnvVar || 'Z_AI_API_KEY'] = apiKey;
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
