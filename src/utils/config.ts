import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';

export const CONFIG_DIR = join(homedir(), '.coder-link');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.yaml');
export const LEGACY_CONFIG_DIR = join(homedir(), '.chelper');
export const LEGACY_CONFIG_FILE = join(LEGACY_CONFIG_DIR, 'config.yaml');

export type Plan = 'glm_coding_plan_global' | 'glm_coding_plan_china' | 'kimi' | 'openrouter' | 'nvidia';

export const KIMI_LIKE_PLANS: ReadonlySet<string> = new Set(['kimi', 'openrouter', 'nvidia']);

export function isKimiLikePlan(plan: string | undefined): plan is 'kimi' | 'openrouter' | 'nvidia' {
  return !!plan && KIMI_LIKE_PLANS.has(plan);
}

export interface ProviderConfig {
  api_key?: string;
  base_url?: string;
  model?: string;
  provider_id?: string;
  max_context_size?: number;
}

export interface Config {
  lang: 'zh_CN' | 'en_US';
  plan?: Plan;
  last_used_tool?: string;
  // Legacy (migrated on load)
  api_key?: string;

  // Tool-specific settings (separate from provider API keys)
  tools?: {
    factory_droid?: {
      factory_api_key?: string;
    };
  };

  // Provider profiles
  providers?: {
    glm?: {
      global?: {
        api_key?: string;
      };
      china?: {
        api_key?: string;
      };
    };
    kimi?: ProviderConfig;
    openrouter?: ProviderConfig;
    nvidia?: ProviderConfig;
  };
}

/** @deprecated Use Plan type directly */
export type KimiSource = 'moonshot' | 'openrouter' | 'nvidia' | 'custom';

export interface ProviderSettings {
  baseUrl: string;
  model?: string;
  providerId?: string;
  source: string;
  maxContextSize?: number;
}

/** @deprecated Use ProviderSettings instead */
export type KimiToolSettings = ProviderSettings;

export class ConfigManager {
  private static instance: ConfigManager | null = null;
  config: Config;
  private configFilePath: string;

  public get configPath(): string {
    return this.configFilePath;
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private constructor() {
    const { config, filePath, loadedFromLegacy } = this.loadWithPath();
    this.config = config || { lang: 'en_US' };
    this.configFilePath = filePath;

    this.migrateLegacyAuth();
    this.migrateLegacyKimiModelIds();
    this.migrateLegacyFactoryDroidApiKey();

    // If we loaded from legacy path, write through to the new location (best-effort).
    if (loadedFromLegacy) {
      this.migrateLegacyConfigPath();
    }
  }

  private migrateLegacyConfigPath(): void {
    try {
      // Only migrate if the new config doesn't already exist.
      if (existsSync(CONFIG_FILE)) {
        this.configFilePath = CONFIG_FILE;
        return;
      }

      // Ensure new dir exists, then write current in-memory config to new location.
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
      }
      const content = yaml.dump(this.config, { lineWidth: 120, noRefs: true });
      writeFileSync(CONFIG_FILE, content, 'utf-8');
      this.configFilePath = CONFIG_FILE;
    } catch {
      // best-effort only
    }
  }

  private migrateLegacyFactoryDroidApiKey(): void {
    try {
      const configAny = this.config as any;

      const toolsAny: any = (configAny.tools && typeof configAny.tools === 'object') ? configAny.tools : undefined;
      const factoryUnderscore: any = toolsAny?.factory_droid && typeof toolsAny.factory_droid === 'object' ? toolsAny.factory_droid : undefined;
      const factoryDashed: any = toolsAny?.['factory-droid'] && typeof toolsAny['factory-droid'] === 'object' ? toolsAny['factory-droid'] : undefined;

      const candidates: Array<{ value: unknown; deletePath?: () => void }> = [
        { value: factoryUnderscore?.factory_api_key },
        { value: factoryUnderscore?.api_key, deletePath: () => { delete factoryUnderscore.api_key; } },
        { value: factoryUnderscore?.apiKey, deletePath: () => { delete factoryUnderscore.apiKey; } },
        { value: factoryDashed?.factory_api_key, deletePath: () => { delete factoryDashed.factory_api_key; } },
        { value: factoryDashed?.api_key, deletePath: () => { delete factoryDashed.api_key; } },
        { value: toolsAny?.factory_api_key, deletePath: () => { delete toolsAny.factory_api_key; } },
        { value: configAny?.factory_api_key, deletePath: () => { delete configAny.factory_api_key; } }
      ];

      let normalized: string | undefined;
      let deleteFn: (() => void) | undefined;
      for (const c of candidates) {
        if (typeof c.value !== 'string') continue;
        const trimmed = c.value.trim();
        if (!trimmed) continue;
        normalized = trimmed;
        deleteFn = c.deletePath;
        break;
      }

      if (!normalized) return;

      // Ensure tree exists
      this.config.tools = this.config.tools && typeof this.config.tools === 'object' ? this.config.tools : {};
      (this.config.tools as any).factory_droid = (this.config.tools as any).factory_droid && typeof (this.config.tools as any).factory_droid === 'object' ? (this.config.tools as any).factory_droid : {};

      const current = this.getFactoryApiKey();
      if (!current) {
        (this.config.tools as any).factory_droid.factory_api_key = normalized;
      }

      // Remove the legacy key field we sourced from (best-effort)
      if (deleteFn) deleteFn();

      // If dashed container is now empty, clean it up
      if (toolsAny?.['factory-droid'] && typeof toolsAny['factory-droid'] === 'object') {
        const keys = Object.keys(toolsAny['factory-droid']);
        if (keys.length === 0) delete toolsAny['factory-droid'];
      }

      this.save();
    } catch {
      // best-effort only
    }
  }

  private migrateLegacyAuth(): void {
    try {
      this.config.providers = this.config.providers && typeof this.config.providers === 'object' ? this.config.providers : {};

      // --- Migrate old source-based kimi config to top-level providers ---
      const kimiAny = this.config.providers.kimi as any;
      if (kimiAny && typeof kimiAny === 'object' && kimiAny.source) {
        const oldSource: string = kimiAny.source;
        const oldKeys: Record<string, string> = (kimiAny.api_keys && typeof kimiAny.api_keys === 'object') ? kimiAny.api_keys : {};
        const oldBaseUrl: string | undefined = kimiAny.base_url;
        const oldModels: any = kimiAny.models;
        const oldDefaultModel: string | undefined = oldModels?.default;
        const oldProviderId: string | undefined = kimiAny.provider_id;

        // Migrate to the appropriate top-level provider
        const targetPlan = (oldSource === 'openrouter' || oldSource === 'nvidia') ? oldSource : 'kimi';
        const targetProvider = (this.config.providers as any)[targetPlan] || {};

        // Migrate API key
        if (!targetProvider.api_key && oldKeys[oldSource]) {
          targetProvider.api_key = oldKeys[oldSource];
        }
        // Migrate base_url
        if (!targetProvider.base_url && oldBaseUrl) {
          targetProvider.base_url = oldBaseUrl;
        }
        // Migrate model
        if (!targetProvider.model && oldDefaultModel) {
          targetProvider.model = oldDefaultModel;
        }
        // Migrate provider_id
        if (!targetProvider.provider_id && oldProviderId) {
          targetProvider.provider_id = oldProviderId;
        }

        (this.config.providers as any)[targetPlan] = targetProvider;

        // Also migrate keys for other sources into their own providers
        for (const [src, key] of Object.entries(oldKeys)) {
          if (!key || src === oldSource) continue;
          const provName = (src === 'openrouter' || src === 'nvidia') ? src : 'kimi';
          const prov = (this.config.providers as any)[provName] || {};
          if (!prov.api_key) prov.api_key = key;
          (this.config.providers as any)[provName] = prov;
        }

        // Update plan if it was set to 'kimi' but source was openrouter/nvidia
        if (this.config.plan === 'kimi' && (oldSource === 'openrouter' || oldSource === 'nvidia')) {
          this.config.plan = oldSource as Plan;
        }

        // Clean up old fields from kimi provider
        delete kimiAny.source;
        delete kimiAny.api_keys;
        delete kimiAny.models;

        // If kimi was the moonshot source, ensure api_key is set from old moonshot key
        if (oldSource === 'moonshot' && !kimiAny.api_key && oldKeys.moonshot) {
          kimiAny.api_key = oldKeys.moonshot;
        }
        if (!kimiAny.model && oldDefaultModel && oldSource === 'moonshot') {
          kimiAny.model = oldDefaultModel;
        }

        this.save();
      }

      // --- Migrate legacy top-level api_key ---
      const legacyKey = typeof this.config.api_key === 'string' ? this.config.api_key.trim() : '';
      const legacyPlan = this.config.plan;
      if (!legacyKey || !legacyPlan) return;

      if (legacyPlan === 'glm_coding_plan_global') {
        this.config.providers.glm = this.config.providers.glm && typeof this.config.providers.glm === 'object' ? this.config.providers.glm : {};
        this.config.providers.glm.global = this.config.providers.glm.global && typeof this.config.providers.glm.global === 'object' ? this.config.providers.glm.global : {};
        if (!this.config.providers.glm.global.api_key) {
          this.config.providers.glm.global.api_key = legacyKey;
        }
      } else if (legacyPlan === 'glm_coding_plan_china') {
        this.config.providers.glm = this.config.providers.glm && typeof this.config.providers.glm === 'object' ? this.config.providers.glm : {};
        this.config.providers.glm.china = this.config.providers.glm.china && typeof this.config.providers.glm.china === 'object' ? this.config.providers.glm.china : {};
        if (!this.config.providers.glm.china.api_key) {
          this.config.providers.glm.china.api_key = legacyKey;
        }
      } else if (isKimiLikePlan(legacyPlan)) {
        const prov = (this.config.providers as any)[legacyPlan] || {};
        if (!prov.api_key) prov.api_key = legacyKey;
        (this.config.providers as any)[legacyPlan] = prov;
      }

      // Remove legacy key to avoid confusion
      delete this.config.api_key;
      this.save();
    } catch (error) {
      console.warn('Failed to migrate legacy auth config:', error);
    }
  }

  private migrateLegacyKimiModelIds(): void {
    try {
      // Migrate moonshot-ai/ prefixed model IDs to moonshotai/ for openrouter and nvidia providers
      for (const providerKey of ['openrouter', 'nvidia'] as const) {
        const prov = this.config.providers?.[providerKey];
        if (!prov || typeof prov.model !== 'string') continue;
        if (prov.model.startsWith('moonshot-ai/')) {
          prov.model = `moonshotai/${prov.model.slice('moonshot-ai/'.length)}`;
          this.save();
        }
      }
    } catch {
      // best-effort only
    }
  }

  private ensureDir() {
    const dir = dirname(this.configFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private loadWithPath(): { config: Config | null; filePath: string; loadedFromLegacy: boolean } {
    const candidates: Array<{ path: string; legacy: boolean }> = [
      { path: CONFIG_FILE, legacy: false },
      { path: LEGACY_CONFIG_FILE, legacy: true },
    ];

    for (const c of candidates) {
      try {
        if (!existsSync(c.path)) continue;
        const content = readFileSync(c.path, 'utf-8');
        const doc = yaml.load(content);
        if (doc && typeof doc === 'object') {
          return { config: doc as Config, filePath: c.path, loadedFromLegacy: c.legacy };
        }
        return { config: this.parseYaml(content) as Config, filePath: c.path, loadedFromLegacy: c.legacy };
      } catch (error) {
        console.warn('Failed to load config:', error);
        // try next candidate
      }
    }

    return { config: null, filePath: CONFIG_FILE, loadedFromLegacy: false };
  }

  save() {
    try {
      this.ensureDir();
      const content = yaml.dump(this.config, { lineWidth: 120, noRefs: true });
      writeFileSync(this.configFilePath, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save config: ${error}`);
    }
  }

  getLang(): 'zh_CN' | 'en_US' {
    return this.config.lang;
  }

  setLang(lang: 'zh_CN' | 'en_US') {
    this.config.lang = lang;
    this.save();
  }

  getLastUsedTool(): string | undefined {
    return this.config.last_used_tool;
  }

  setLastUsedTool(tool: string) {
    this.config.last_used_tool = tool;
    this.save();
  }

  getAuth(): { plan: string | undefined; apiKey: string | undefined } {
    const plan = this.config.plan;
    if (!plan) return { plan: undefined, apiKey: undefined };

    if (plan === 'glm_coding_plan_global') {
      const apiKey = this.config.providers?.glm?.global?.api_key;
      return { plan, apiKey };
    }
    if (plan === 'glm_coding_plan_china') {
      const apiKey = this.config.providers?.glm?.china?.api_key;
      return { plan, apiKey };
    }

    // kimi, openrouter, nvidia
    if (isKimiLikePlan(plan)) {
      const prov = this.config.providers?.[plan];
      return { plan, apiKey: prov?.api_key };
    }

    return { plan, apiKey: undefined };
  }

  setAuth(plan: Plan, apiKey: string) {
    this.config.plan = plan;
    this.config.providers = this.config.providers && typeof this.config.providers === 'object' ? this.config.providers : {};

    if (plan === 'glm_coding_plan_global') {
      this.config.providers.glm = this.config.providers.glm && typeof this.config.providers.glm === 'object' ? this.config.providers.glm : {};
      this.config.providers.glm.global = this.config.providers.glm.global && typeof this.config.providers.glm.global === 'object' ? this.config.providers.glm.global : {};
      this.config.providers.glm.global.api_key = apiKey;
    } else if (plan === 'glm_coding_plan_china') {
      this.config.providers.glm = this.config.providers.glm && typeof this.config.providers.glm === 'object' ? this.config.providers.glm : {};
      this.config.providers.glm.china = this.config.providers.glm.china && typeof this.config.providers.glm.china === 'object' ? this.config.providers.glm.china : {};
      this.config.providers.glm.china.api_key = apiKey;
    } else if (isKimiLikePlan(plan)) {
      const existing = (this.config.providers[plan] && typeof this.config.providers[plan] === 'object') ? this.config.providers[plan]! : {};
      this.config.providers[plan] = { ...existing, api_key: apiKey };
    }

    // ensure we don't keep legacy key around
    delete this.config.api_key;
    this.save();
  }

  getApiKeyFor(plan: Plan): string | undefined {
    if (plan === 'glm_coding_plan_global') return this.config.providers?.glm?.global?.api_key;
    if (plan === 'glm_coding_plan_china') return this.config.providers?.glm?.china?.api_key;
    if (isKimiLikePlan(plan)) return this.config.providers?.[plan]?.api_key;
    return undefined;
  }

  setApiKeyFor(plan: Plan, apiKey: string): void {
    this.config.providers = this.config.providers && typeof this.config.providers === 'object' ? this.config.providers : {};
    if (plan === 'glm_coding_plan_global') {
      this.config.providers.glm = this.config.providers.glm && typeof this.config.providers.glm === 'object' ? this.config.providers.glm : {};
      this.config.providers.glm.global = this.config.providers.glm.global && typeof this.config.providers.glm.global === 'object' ? this.config.providers.glm.global : {};
      this.config.providers.glm.global.api_key = apiKey;
    } else if (plan === 'glm_coding_plan_china') {
      this.config.providers.glm = this.config.providers.glm && typeof this.config.providers.glm === 'object' ? this.config.providers.glm : {};
      this.config.providers.glm.china = this.config.providers.glm.china && typeof this.config.providers.glm.china === 'object' ? this.config.providers.glm.china : {};
      this.config.providers.glm.china.api_key = apiKey;
    } else if (isKimiLikePlan(plan)) {
      const existing = (this.config.providers[plan] && typeof this.config.providers[plan] === 'object') ? this.config.providers[plan]! : {};
      this.config.providers[plan] = { ...existing, api_key: apiKey };
    }
    delete this.config.api_key;
    this.save();
  }

  private static readonly PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string; source: string; maxContextSize?: number }> = {
    kimi: { baseUrl: 'https://api.moonshot.ai/v1', model: 'moonshot-ai/kimi-k2.5', source: 'moonshot', maxContextSize: 262144 },
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'moonshotai/kimi-k2.5', source: 'openrouter', maxContextSize: 16384 },
    nvidia: { baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'moonshotai/kimi-k2.5', source: 'nvidia', maxContextSize: 4096 }
  };

  /**
   * Get settings for any kimi-like provider (kimi, openrouter, nvidia).
   * Falls back to the currently active plan if no plan argument is given.
   */
  getProviderSettings(plan?: string): ProviderSettings {
    const activePlan = plan || this.config.plan || 'kimi';
    const defaults = ConfigManager.PROVIDER_DEFAULTS[activePlan] || ConfigManager.PROVIDER_DEFAULTS.kimi;

    if (isKimiLikePlan(activePlan)) {
      const prov = this.config.providers?.[activePlan];
      return {
        baseUrl: (prov?.base_url ?? defaults.baseUrl).trim(),
        model: prov?.model || defaults.model,
        providerId: prov?.provider_id || undefined,
        source: defaults.source,
        maxContextSize: prov?.max_context_size ?? defaults.maxContextSize,
      };
    }

    return { baseUrl: defaults.baseUrl, model: defaults.model, source: defaults.source };
  }

  /** @deprecated Use getProviderSettings instead */
  getKimiSettings(tool?: string): ProviderSettings {
    return this.getProviderSettings(this.config.plan || 'kimi');
  }

  setProviderProfile(plan: 'kimi' | 'openrouter' | 'nvidia', profile: { base_url?: string; model?: string; provider_id?: string; max_context_size?: number }): void {
    this.config.providers = this.config.providers && typeof this.config.providers === 'object' ? this.config.providers : {};
    const existing = (this.config.providers[plan] && typeof this.config.providers[plan] === 'object') ? this.config.providers[plan]! : {};
    this.config.providers[plan] = {
      ...existing,
      ...profile
    };
    this.save();
  }

  /** @deprecated Use setProviderProfile instead */
  setKimiProfile(profile: { source?: KimiSource; base_url?: string; models?: any; provider_id?: string }): void {
    const plan = (profile.source === 'openrouter' || profile.source === 'nvidia') ? profile.source : 'kimi';
    this.setProviderProfile(plan as any, {
      base_url: profile.base_url,
      model: profile.models?.default,
      provider_id: profile.provider_id
    });
  }

  getFactoryApiKey(): string | undefined {
    const key = this.config.tools?.factory_droid?.factory_api_key;
    if (typeof key !== 'string') return undefined;
    const trimmed = key.trim();
    return trimmed ? trimmed : undefined;
  }

  setFactoryApiKey(apiKey: string | undefined): void {
    const trimmed = typeof apiKey === 'string' ? apiKey.trim() : '';

    this.config.tools = this.config.tools && typeof this.config.tools === 'object' ? this.config.tools : {};
    this.config.tools.factory_droid = this.config.tools.factory_droid && typeof this.config.tools.factory_droid === 'object' ? this.config.tools.factory_droid : {};

    if (!trimmed) {
      delete this.config.tools.factory_droid.factory_api_key;
    } else {
      this.config.tools.factory_droid.factory_api_key = trimmed;
    }

    this.save();
  }

  revokeAuth() {
    delete this.config.plan;
    delete this.config.api_key;

    if (this.config.providers?.glm?.global) delete this.config.providers.glm.global.api_key;
    if (this.config.providers?.glm?.china) delete this.config.providers.glm.china.api_key;
    if (this.config.providers?.kimi) delete this.config.providers.kimi.api_key;
    if (this.config.providers?.openrouter) delete this.config.providers.openrouter.api_key;
    if (this.config.providers?.nvidia) delete this.config.providers.nvidia.api_key;
    this.save();
  }

  private parseYaml(content: string): any {
    // Simple YAML parser for our limited use case
    const result: any = {};
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...valueParts] = trimmed.split(':');
      if (key && valueParts.length > 0) {
        const value = valueParts.join(':').trim();
        if (value === 'null' || value === '') {
          result[key.trim()] = null;
        } else if (value === 'true') {
          result[key.trim()] = true;
        } else if (value === 'false') {
          result[key.trim()] = false;
        } else if (!isNaN(Number(value))) {
          result[key.trim()] = Number(value);
        } else {
          result[key.trim()] = value.replace(/^["']|["']$/g, '');
        }
      }
    }
    return result;
  }

  private toYaml(obj: any, indent = 0): string {
    const lines: string[] = [];
    const spaces = '  '.repeat(indent);

    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        lines.push(`${spaces}${key}: null`);
      } else if (typeof value === 'boolean') {
        lines.push(`${spaces}${key}: ${value}`);
      } else if (typeof value === 'number') {
        lines.push(`${spaces}${key}: ${value}`);
      } else if (typeof value === 'string') {
        lines.push(`${spaces}${key}: "${value}"`);
      } else if (Array.isArray(value)) {
        lines.push(`${spaces}${key}:`);
        for (const item of value) {
          lines.push(`${spaces}  - ${item}`);
        }
      } else if (typeof value === 'object') {
        lines.push(`${spaces}${key}:`);
        lines.push(this.toYaml(value, indent + 1));
      }
    }

    return lines.join('\n');
  }
}

export const configManager = ConfigManager.getInstance();
