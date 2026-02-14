import type { MCPService } from './lib/tool-manager.js';

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
    envTemplate: {
      glm_coding_plan_global: { GITHUB_TOKEN: '' },
      glm_coding_plan_china: { GITHUB_TOKEN: '' },
      kimi: { GITHUB_TOKEN: '' },
      openrouter: { GITHUB_TOKEN: '' },
      nvidia: { GITHUB_TOKEN: '' },
      lmstudio: { GITHUB_TOKEN: '' },
      alibaba: { GITHUB_TOKEN: '' },
      alibaba_api: { GITHUB_TOKEN: '' }
    }
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
    envTemplate: {
      glm_coding_plan_global: { COOLIFY_BASE_URL: '', COOLIFY_TOKEN: '' },
      glm_coding_plan_china: { COOLIFY_BASE_URL: '', COOLIFY_TOKEN: '' },
      kimi: { COOLIFY_BASE_URL: '', COOLIFY_TOKEN: '' },
      openrouter: { COOLIFY_BASE_URL: '', COOLIFY_TOKEN: '' },
      nvidia: { COOLIFY_BASE_URL: '', COOLIFY_TOKEN: '' },
      lmstudio: { COOLIFY_BASE_URL: '', COOLIFY_TOKEN: '' },
      alibaba: { COOLIFY_BASE_URL: '', COOLIFY_TOKEN: '' },
      alibaba_api: { COOLIFY_BASE_URL: '', COOLIFY_TOKEN: '' }
    }
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
    urlTemplate: {
      glm_coding_plan_global: 'https://api.z.ai/api/mcp/web_search_prime/mcp',
      glm_coding_plan_china: 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp'
    },
    requiresAuth: true
  },
  {
    id: 'web-reader',
    name: 'Web Reader',
    description: 'Z AI web content reader service',
    protocol: 'streamable-http',
    urlTemplate: {
      glm_coding_plan_global: 'https://api.z.ai/api/mcp/web_reader/mcp',
      glm_coding_plan_china: 'https://open.bigmodel.cn/api/mcp/web_reader/mcp'
    },
    requiresAuth: true
  },
  {
    id: 'zread',
    name: 'Z Read',
    description: 'Z AI reading assistant service',
    protocol: 'streamable-http',
    urlTemplate: {
      glm_coding_plan_global: 'https://api.z.ai/api/mcp/zread/mcp',
      glm_coding_plan_china: 'https://open.bigmodel.cn/api/mcp/zread/mcp'
    },
    requiresAuth: true
  }
];
