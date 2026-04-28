import type { MCPService } from './lib/tool-manager.js';
import type { Plan } from './utils/config.js';
import { getAllPlans } from './lib/provider-registry.js';

const ALL_PLANS = getAllPlans();

function envForAllPlans(env: Record<string, string>): Record<Plan, Record<string, string>> {
  return Object.fromEntries(ALL_PLANS.map((plan) => [plan, { ...env }])) as Record<Plan, Record<string, string>>;
}

function zAiUrlTemplate(path: string): Record<Plan, string> {
  return Object.fromEntries(
    ALL_PLANS.map((plan) => [
      plan,
      plan === 'glm_coding_plan_china'
        ? `https://open.bigmodel.cn/api/mcp/${path}/mcp`
        : `https://api.z.ai/api/mcp/${path}/mcp`,
    ])
  ) as Record<Plan, string>;
}

export const BUILTIN_MCP_SERVICES: MCPService[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'File system operations',
    protocol: 'stdio',
    command: 'npx',
    args: ['--silent', '-y', '@modelcontextprotocol/server-filesystem', '/'],
    requiresAuth: false
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub integration',
    protocol: 'stdio',
    command: 'npx',
    args: ['--silent', '-y', '@modelcontextprotocol/server-github'],
    // GitHub token should come from GITHUB_TOKEN in your environment
    // (we intentionally do not inject provider API keys into GitHub MCP).
    requiresAuth: false,
    envTemplate: envForAllPlans({ GITHUB_TOKEN: '' })
  },
  {
    id: 'coolify-mcp',
    name: 'Coolify',
    description: 'Coolify server management (requires COOLIFY_BASE_URL and COOLIFY_TOKEN env vars)',
    protocol: 'stdio',
    command: 'npx',
    args: ['-y', 'coolify-mcp-server'],
    // Coolify credentials should come from environment variables
    // Set COOLIFY_BASE_URL and COOLIFY_TOKEN before installing
    requiresAuth: false,
    envTemplate: envForAllPlans({ COOLIFY_BASE_URL: '', COOLIFY_TOKEN: '' })
  },
  // Z AI MCP Servers (GLM API)
  {
    id: 'zai-mcp-server',
    name: 'Z AI MCP Server',
    description: 'Z AI unified MCP server with multiple tools',
    protocol: 'stdio',
    command: 'npx',
    args: ['-y', '@z_ai/mcp-server'],
    requiresAuth: true,
    authPlan: 'glm_coding_plan_global',
    envTemplate: {
      glm_coding_plan_global: { Z_AI_MODE: 'ZAI', Z_AI_API_KEY: '' },
      glm_coding_plan_china: { Z_AI_MODE: 'ZAI', Z_AI_API_KEY: '' }
    }
  },
  {
    id: 'web-search-prime',
    name: 'Web Search Prime',
    description: 'Z AI web search service',
    protocol: 'streamable-http',
    authPlan: 'glm_coding_plan_global',
    authScheme: 'raw',
    urlTemplate: zAiUrlTemplate('web_search_prime'),
    requiresAuth: true
  },
  {
    id: 'web-reader',
    name: 'Web Reader',
    description: 'Z AI web content reader service',
    protocol: 'streamable-http',
    authPlan: 'glm_coding_plan_global',
    urlTemplate: zAiUrlTemplate('web_reader'),
    requiresAuth: true
  },
  {
    id: 'zread',
    name: 'Z Read',
    description: 'Z AI reading assistant service',
    protocol: 'streamable-http',
    authPlan: 'glm_coding_plan_global',
    urlTemplate: zAiUrlTemplate('zread'),
    requiresAuth: true
  }
];
