import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';

export const CONFIG_DIR = join(homedir(), '.coder-link');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.yaml');
export const LEGACY_CONFIG_DIR = join(homedir(), '.chelper');
export const LEGACY_CONFIG_FILE = join(LEGACY_CONFIG_DIR, 'config.yaml');

export type Plan =
  | 'glm_coding_plan_global'
  | 'glm_coding_plan_china'
  | 'kimi'
  | 'openrouter'
  | 'nvidia'
  | 'lmstudio'
  | 'alibaba'
  | 'alibaba_api';
export type ToolId =
  | 'claude-code'
  | 'opencode'
  | 'crush'
  | 'factory-droid'
  | 'kimi'
  | 'amp'
  | 'pi'
  | 'codex';

export const ALL_PROVIDER_PLANS: Plan[] = [
  'glm_coding_plan_global',
  'glm_coding_plan_china',
  'kimi',
  'openrouter',
  'nvidia',
  'lmstudio',
  'alibaba',
  'alibaba_api',
];

export const ALL_TOOL_IDS: ToolId[] = [
  'claude-code',
  'opencode',
  'crush',
  'factory-droid',
  'kimi',
  'amp',
  'pi',
  'codex',
];

export const KIMI_LIKE_PLANS: ReadonlySet<string> = new Set([
  'kimi',
  'openrouter',
  'nvidia',
  'lmstudio',
  'alibaba',
  'alibaba_api',
]);

export type OpenAICompatiblePlan = Exclude<Plan, 'glm_coding_plan_global' | 'glm_coding_plan_china'>;

export function isKimiLikePlan(plan: string | undefined): plan is OpenAICompatiblePlan {
  return !!plan && KIMI_LIKE_PLANS.has(plan);
}

export interface ProviderConfig {
  api_key?: string;
  base_url?: string;
  anthropic_base_url?: string;
  model?: string;
  anthropic_model?: string;
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

  features?: {
    enabled_providers?: Plan[];
    enabled_tools?: ToolId[];
  };

  // Provider profiles
  providers?: {
    glm?: {
      global?: ProviderConfig;
      china?: ProviderConfig;
    };
    kimi?: ProviderConfig;
    openrouter?: ProviderConfig;
    nvidia?: ProviderConfig;
    lmstudio?: ProviderConfig;
    alibaba?: ProviderConfig;
    alibaba_api?: ProviderConfig;
  };
}

/** @deprecated Use Plan type directly */
export type KimiSource = 'moonshot' | 'openrouter' | 'nvidia' | 'custom';

export interface ProviderSettings {
  baseUrl: string;
  anthropicBaseUrl?: string;
  model?: string;
  anthropicModel?: string;
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
    this.migrateAlibabaProfiles();

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

  private migrateAlibabaProfiles(): void {
    try {
      if (!this.config.providers || typeof this.config.providers !== 'object') return;

      const coding = this.config.providers.alibaba;
      if (!coding || typeof coding !== 'object') return;

      const key = typeof coding.api_key === 'string' ? coding.api_key.trim() : '';
      const openAiBase = typeof coding.base_url === 'string' ? coding.base_url.trim() : '';
      const lowerBase = openAiBase.toLowerCase();
      const isCodingPlanKey = key.startsWith('sk-sp-');
      const isCodingPlanBase = lowerBase.includes('coding-intl.dashscope.aliyuncs.com');
      const isApiCompatibleBase =
        lowerBase.includes('dashscope-intl.aliyuncs.com/compatible-mode/v1') ||
        lowerBase.includes('dashscope.aliyuncs.com/compatible-mode/v1');

      let changed = false;

      if (isCodingPlanKey || (!key && isCodingPlanBase)) {
        const anthropicBase = typeof coding.anthropic_base_url === 'string' ? coding.anthropic_base_url.trim() : '';
        if (!openAiBase || isApiCompatibleBase) {
          coding.base_url = 'https://coding-intl.dashscope.aliyuncs.com/v1';
          changed = true;
        }
        if (!anthropicBase || /dashscope-intl\.aliyuncs\.com\/apps\/anthropic$/i.test(anthropicBase)) {
          coding.anthropic_base_url = 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic';
          changed = true;
        }
        if (!coding.model) {
          coding.model = 'qwen3-coder-plus';
          changed = true;
        }
        if (!coding.anthropic_model) {
          coding.anthropic_model = 'qwen3-coder-plus';
          changed = true;
        }
      } else if (isApiCompatibleBase || !!key || isCodingPlanBase) {
        const apiProvider = this.config.providers.alibaba_api && typeof this.config.providers.alibaba_api === 'object'
          ? this.config.providers.alibaba_api
          : {};

        if (!apiProvider.api_key && key) apiProvider.api_key = key;
        if (!apiProvider.base_url) apiProvider.base_url = openAiBase || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
        if (!apiProvider.model) {
          const migratedModel = typeof coding.model === 'string' ? coding.model.trim() : '';
          apiProvider.model = migratedModel && migratedModel !== 'qwen3-coder-plus'
            ? migratedModel
            : 'qwen3-max-2026-01-23';
        }
        this.config.providers.alibaba_api = apiProvider;
        delete this.config.providers.alibaba;
        if (this.config.plan === 'alibaba') {
          this.config.plan = 'alibaba_api';
        }
        changed = true;
      }

      if (changed) this.save();
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
        if (doc == null) {
          return { config: null, filePath: c.path, loadedFromLegacy: c.legacy };
        }
        if (typeof doc !== 'object' || Array.isArray(doc)) {
          throw new Error(`Config root must be a YAML object: ${c.path}`);
        }
        return { config: doc as Config, filePath: c.path, loadedFromLegacy: c.legacy };
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

  getEnabledProviders(): Plan[] {
    const enabled = this.config.features?.enabled_providers;
    if (!Array.isArray(enabled) || enabled.length === 0) return [...ALL_PROVIDER_PLANS];
    const set = new Set(ALL_PROVIDER_PLANS);
    const valid = enabled.filter((p): p is Plan => typeof p === 'string' && set.has(p as Plan));
    return valid.length ? Array.from(new Set(valid)) : [...ALL_PROVIDER_PLANS];
  }

  setEnabledProviders(plans: Plan[]): void {
    const set = new Set(ALL_PROVIDER_PLANS);
    const valid = plans.filter((p): p is Plan => typeof p === 'string' && set.has(p as Plan));
    if (valid.length === 0) {
      throw new Error('At least one provider must stay enabled');
    }

    this.config.features = this.config.features && typeof this.config.features === 'object' ? this.config.features : {};
    this.config.features.enabled_providers = Array.from(new Set(valid));
    this.save();
  }

  isProviderEnabled(plan: Plan): boolean {
    return this.getEnabledProviders().includes(plan);
  }

  getEnabledTools(): ToolId[] {
    const enabled = this.config.features?.enabled_tools;
    if (!Array.isArray(enabled) || enabled.length === 0) return [...ALL_TOOL_IDS];
    const set = new Set(ALL_TOOL_IDS);
    const valid = enabled.filter((t): t is ToolId => typeof t === 'string' && set.has(t as ToolId));
    return valid.length ? Array.from(new Set(valid)) : [...ALL_TOOL_IDS];
  }

  setEnabledTools(tools: ToolId[]): void {
    const set = new Set(ALL_TOOL_IDS);
    const valid = tools.filter((t): t is ToolId => typeof t === 'string' && set.has(t as ToolId));
    if (valid.length === 0) {
      throw new Error('At least one tool must stay enabled');
    }

    this.config.features = this.config.features && typeof this.config.features === 'object' ? this.config.features : {};
    this.config.features.enabled_tools = Array.from(new Set(valid));
    this.save();
  }

  isToolEnabled(tool: ToolId): boolean {
    return this.getEnabledTools().includes(tool);
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

    // OpenAI-compatible providers (kimi/openrouter/nvidia/lmstudio/alibaba/alibaba_api)
    const prov = (this.config.providers as any)?.[plan];
    return { plan, apiKey: prov?.api_key };
  }

  setAuth(plan: Plan, apiKey: string) {
    this.config.plan = plan;
    this.setApiKeyFor(plan, apiKey);

    // ensure we don't keep legacy key around
    delete this.config.api_key;
    this.save();
  }

  getApiKeyFor(plan: Plan): string | undefined {
    if (plan === 'glm_coding_plan_global') return this.config.providers?.glm?.global?.api_key;
    if (plan === 'glm_coding_plan_china') return this.config.providers?.glm?.china?.api_key;
    return (this.config.providers as any)?.[plan]?.api_key;
  }

  setApiKeyFor(plan: Plan, apiKey: string): void {
    this.config.providers = this.config.providers && typeof this.config.providers === 'object' ? this.config.providers : {};
    if (plan === 'glm_coding_plan_global') {
      this.config.providers.glm = this.config.providers.glm && typeof this.config.providers.glm === 'object' ? this.config.providers.glm : {};
      const existing = (this.config.providers.glm.global && typeof this.config.providers.glm.global === 'object') ? this.config.providers.glm.global : {};
      this.config.providers.glm.global = { ...existing, api_key: apiKey };
    } else if (plan === 'glm_coding_plan_china') {
      this.config.providers.glm = this.config.providers.glm && typeof this.config.providers.glm === 'object' ? this.config.providers.glm : {};
      const existing = (this.config.providers.glm.china && typeof this.config.providers.glm.china === 'object') ? this.config.providers.glm.china : {};
      this.config.providers.glm.china = { ...existing, api_key: apiKey };
    } else {
      const existing = (this.config.providers[plan] && typeof this.config.providers[plan] === 'object') ? this.config.providers[plan]! : {};
      this.config.providers[plan] = { ...existing, api_key: apiKey };
    }
    delete this.config.api_key;
    this.save();
  }

  private static readonly PROVIDER_DEFAULTS: Record<
    string,
    { baseUrl: string; anthropicBaseUrl?: string; model: string; anthropicModel?: string; source: string; maxContextSize?: number }
  > = {
    kimi: { baseUrl: 'https://api.moonshot.ai/v1', model: 'moonshot-ai/kimi-k2.5', source: 'moonshot', maxContextSize: 262144 },
    openrouter: {
      baseUrl: 'https://openrouter.ai/api/v1',
      anthropicBaseUrl: 'https://openrouter.ai/api',
      model: 'moonshotai/kimi-k2.5',
      anthropicModel: 'anthropic/claude-sonnet-4.6',
      source: 'openrouter',
      maxContextSize: 16384,
    },
    nvidia: { baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'moonshotai/kimi-k2.5', source: 'nvidia', maxContextSize: 4096 },
    lmstudio: {
      baseUrl: 'http://localhost:1234/v1',
      anthropicBaseUrl: 'http://localhost:1234',
      model: 'lmstudio-community',
      anthropicModel: 'local-model',
      source: 'lmstudio',
      maxContextSize: 128000,
    },
    alibaba: {
      baseUrl: 'https://coding-intl.dashscope.aliyuncs.com/v1',
      anthropicBaseUrl: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
      model: 'qwen3-coder-plus',
      anthropicModel: 'qwen3-coder-plus',
      source: 'alibaba',
      maxContextSize: 128000,
    },
    alibaba_api: {
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      anthropicBaseUrl: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
      model: 'qwen3-max-2026-01-23',
      anthropicModel: 'qwen3-coder-plus',
      source: 'alibaba-api-sg',
      maxContextSize: 128000,
    },
    glm_coding_plan_global: {
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      anthropicBaseUrl: 'https://api.z.ai/api/anthropic',
      model: 'glm-4',
      anthropicModel: 'glm-4.7',
      source: 'glm-global',
      maxContextSize: 128000,
    },
    glm_coding_plan_china: {
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      anthropicBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
      model: 'glm-4',
      anthropicModel: 'glm-4.7',
      source: 'glm-china',
      maxContextSize: 128000,
    }
  };

  /**
   * Get settings for any provider profile.
   * Falls back to the currently active plan if no plan argument is given.
   */
  getProviderSettings(plan?: string): ProviderSettings {
    const activePlan = plan || this.config.plan || 'kimi';
    const defaults = ConfigManager.PROVIDER_DEFAULTS[activePlan] || ConfigManager.PROVIDER_DEFAULTS.kimi;

    let prov: ProviderConfig | undefined;
    if (activePlan === 'glm_coding_plan_global') {
      prov = this.config.providers?.glm?.global;
    } else if (activePlan === 'glm_coding_plan_china') {
      prov = this.config.providers?.glm?.china;
    } else {
      prov = (this.config.providers as any)?.[activePlan];
    }

    return {
      baseUrl: (prov?.base_url ?? defaults.baseUrl).trim(),
      anthropicBaseUrl: (prov?.anthropic_base_url ?? defaults.anthropicBaseUrl)?.trim(),
      model: prov?.model || defaults.model,
      anthropicModel: prov?.anthropic_model || defaults.anthropicModel,
      providerId: prov?.provider_id || undefined,
      source: defaults.source,
      maxContextSize: prov?.max_context_size ?? defaults.maxContextSize,
    };
  }

  /** @deprecated Use getProviderSettings instead */
  getKimiSettings(tool?: string): ProviderSettings {
    return this.getProviderSettings(this.config.plan || 'kimi');
  }

  setProviderProfile(
    plan: Plan,
    profile: {
      base_url?: string;
      anthropic_base_url?: string;
      model?: string;
      anthropic_model?: string;
      provider_id?: string;
      max_context_size?: number;
    }
  ): void {
    this.config.providers = this.config.providers && typeof this.config.providers === 'object' ? this.config.providers : {};
    if (plan === 'glm_coding_plan_global') {
      this.config.providers.glm = this.config.providers.glm && typeof this.config.providers.glm === 'object' ? this.config.providers.glm : {};
      const existing = (this.config.providers.glm.global && typeof this.config.providers.glm.global === 'object') ? this.config.providers.glm.global : {};
      this.config.providers.glm.global = { ...existing, ...profile };
    } else if (plan === 'glm_coding_plan_china') {
      this.config.providers.glm = this.config.providers.glm && typeof this.config.providers.glm === 'object' ? this.config.providers.glm : {};
      const existing = (this.config.providers.glm.china && typeof this.config.providers.glm.china === 'object') ? this.config.providers.glm.china : {};
      this.config.providers.glm.china = { ...existing, ...profile };
    } else {
      const existing = (this.config.providers[plan] && typeof this.config.providers[plan] === 'object') ? this.config.providers[plan]! : {};
      this.config.providers[plan] = {
        ...existing,
        ...profile
      };
    }
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
    if (this.config.providers?.lmstudio) delete this.config.providers.lmstudio.api_key;
    if (this.config.providers?.alibaba) delete this.config.providers.alibaba.api_key;
    if (this.config.providers?.alibaba_api) delete this.config.providers.alibaba_api.api_key;
    this.save();
  }

}

export const configManager = ConfigManager.getInstance();
