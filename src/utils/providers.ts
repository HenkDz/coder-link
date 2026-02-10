import type { Plan } from './config.js';

export type ProviderProtocol = 'openai' | 'anthropic';

export interface ProviderChoice {
  name: string;
  value: Plan;
}

export const PROVIDER_CHOICES: ProviderChoice[] = [
  { name: 'GLM Coding Plan (Global)', value: 'glm_coding_plan_global' },
  { name: 'GLM Coding Plan (China)', value: 'glm_coding_plan_china' },
  { name: 'Kimi (Moonshot)', value: 'kimi' },
  { name: 'OpenRouter', value: 'openrouter' },
  { name: 'NVIDIA NIM', value: 'nvidia' },
  { name: 'Alibaba Cloud (DashScope)', value: 'alibaba' },
  { name: 'LM Studio (Local)', value: 'lmstudio' },
];

export const PROVIDER_PLAN_VALUES: Plan[] = PROVIDER_CHOICES.map((c) => c.value);

export const PROVIDER_PROTOCOLS: Record<Plan, { openai: boolean; anthropic: boolean }> = {
  glm_coding_plan_global: { openai: true, anthropic: true },
  glm_coding_plan_china: { openai: true, anthropic: true },
  kimi: { openai: true, anthropic: false },
  openrouter: { openai: true, anthropic: true },
  nvidia: { openai: true, anthropic: false },
  lmstudio: { openai: true, anthropic: true },
  alibaba: { openai: true, anthropic: true },
};

const ANTHROPIC_BASE_DEFAULTS: Partial<Record<Plan, string>> = {
  glm_coding_plan_global: 'https://api.z.ai/api/anthropic',
  glm_coding_plan_china: 'https://open.bigmodel.cn/api/anthropic',
  openrouter: 'https://openrouter.ai/api',
  lmstudio: 'http://localhost:1234',
  alibaba: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
};

const ANTHROPIC_MODEL_DEFAULTS: Partial<Record<Plan, string>> = {
  glm_coding_plan_global: 'glm-4.7',
  glm_coding_plan_china: 'glm-4.7',
  openrouter: 'anthropic/claude-sonnet-4.6',
  lmstudio: 'local-model',
  alibaba: 'qwen3-coder-plus',
};

export const COMMON_MODELS: Record<Plan, string[]> = {
  kimi: ['moonshot-ai/kimi-k2.5', 'moonshot-ai/kimi-k2-thinking'],
  openrouter: ['openrouter/pony-alpha', 'anthropic/claude-opus-4.6', 'qwen/qwen3-coder-next'],
  nvidia: ['moonshotai/kimi-k2.5', 'deepseek-ai/deepseek-v3.2', 'meta/llama-3.3-70b-instruct', 'meta/llama-4-maverick-17b-128e-instruct', 'qwen/qwen3-coder-480b-a35b-instruct', 'z-ai/glm4.7', 'nvidia/llama-3.3-nemotron-super-49b-v1.5'],
  alibaba: ['qwen3-coder-plus', 'qwen3-max', 'qwen3-max-preview', 'qwen-plus', 'qwen-flash', 'qwen-turbo', 'qwen3-coder-flash'],
  lmstudio: ['lmstudio-community', 'deepseek-coder-v3', 'codellama/13b', 'mistral-7b-instruct', 'qwen2.5-coder-7b'],
  glm_coding_plan_global: ['glm-4.7', 'glm-4-coder', 'glm-4-plus', 'glm-4-air', 'glm-4-flash'],
  glm_coding_plan_china: ['glm-4.7', 'glm-4-coder', 'glm-4-plus', 'glm-4-air', 'glm-4-flash'],
};

export function suggestedContextSize(plan: Plan): number {
  if (plan === 'nvidia') return 4096;
  if (plan === 'openrouter') return 16384;
  if (plan.startsWith('glm')) return 128000;
  return 262144;
}

export function supportsOpenAIProtocol(plan: Plan): boolean {
  return PROVIDER_PROTOCOLS[plan].openai;
}

export function supportsAnthropicProtocol(plan: Plan): boolean {
  return PROVIDER_PROTOCOLS[plan].anthropic;
}

export function getSupportedProtocols(plan: Plan): ProviderProtocol[] {
  const support = PROVIDER_PROTOCOLS[plan];
  const protocols: ProviderProtocol[] = [];
  if (support.openai) protocols.push('openai');
  if (support.anthropic) protocols.push('anthropic');
  return protocols;
}

export function protocolLabel(protocol: ProviderProtocol): string {
  return protocol === 'openai' ? 'OpenAI-compatible' : 'Anthropic-compatible';
}

export function providerProtocolSummary(plan: Plan): string {
  const protocols = getSupportedProtocols(plan).map(protocolLabel);
  return protocols.join(' + ');
}

export function getDefaultAnthropicModel(plan: Plan): string | undefined {
  return ANTHROPIC_MODEL_DEFAULTS[plan];
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/g, '');
}

export function resolveAnthropicBaseUrl(plan: Plan, openAiBaseUrl?: string): string | undefined {
  if (!supportsAnthropicProtocol(plan)) return undefined;
  const fallback = ANTHROPIC_BASE_DEFAULTS[plan];
  const base = openAiBaseUrl?.trim();
  if (!base) return fallback;

  const normalized = trimTrailingSlash(base);
  const lower = normalized.toLowerCase();

  if (plan === 'glm_coding_plan_global') {
    if (lower.endsWith('/api/anthropic')) return normalized;
    if (lower.endsWith('/api/coding/paas/v4')) return normalized.replace(/\/api\/coding\/paas\/v4$/i, '/api/anthropic');
    return fallback;
  }

  if (plan === 'glm_coding_plan_china') {
    if (lower.endsWith('/api/anthropic')) return normalized;
    if (lower.endsWith('/api/coding/paas/v4')) return normalized.replace(/\/api\/coding\/paas\/v4$/i, '/api/anthropic');
    return fallback;
  }

  if (plan === 'openrouter') {
    if (lower.endsWith('/api/v1')) return normalized.replace(/\/api\/v1$/i, '/api');
    if (lower.endsWith('/v1')) return normalized.replace(/\/v1$/i, '');
    if (lower.endsWith('/api')) return normalized;
    return lower.includes('openrouter.ai') ? `${normalized}/api` : normalized;
  }

  if (plan === 'lmstudio') {
    return lower.endsWith('/v1') ? normalized.replace(/\/v1$/i, '') : normalized;
  }

  if (plan === 'alibaba') {
    if (lower.includes('/apps/anthropic')) return normalized;
    if (lower.includes('/compatible-mode/v1')) return normalized.replace(/\/compatible-mode\/v1$/i, '/apps/anthropic');
    return fallback;
  }

  return fallback;
}

