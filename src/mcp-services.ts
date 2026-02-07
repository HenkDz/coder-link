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
    args: ['--silent', '--silent', '-y', '@modelcontextprotocol/server-github'],
    requiresAuth: true,
    envTemplate: {
      glm_coding_plan_global: { GITHUB_TOKEN: '' },
      glm_coding_plan_china: { GITHUB_TOKEN: '' },
      kimi: { GITHUB_TOKEN: '' }
    }
  }
];
