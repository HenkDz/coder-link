import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Branded ASCII art ──────────────────────────────────────────────────
const LOGO_LINES = [
  ' ██████╗  ██████╗ ██████╗ ███████╗██████╗ ██╗     ██╗███╗   ██╗██╗  ██╗',
  '██╔════╝ ██╔═══██╗██╔══██╗██╔════╝██╔══██╗██║     ██║████╗  ██║██║ ██╔╝',
  '██║      ██║   ██║██║  ██║█████╗  ██████╔╝██║     ██║██╔██╗ ██║█████╔╝ ',
  '██║      ██║   ██║██║  ██║██╔══╝  ██╔══██╗██║     ██║██║╚██╗██║██╔═██╗ ',
  '╚██████╗ ╚██████╔╝██████╔╝███████╗██║  ██║███████╗██║██║ ╚████║██║  ██╗',
  ' ╚═════╝  ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝',
];

const TAGLINE = 'CoderLink: Connect coding tools to any model/provider';

function getVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    for (const rel of ['../../package.json', '../../../package.json']) {
      const pkgPath = resolve(__dirname, rel);
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        return pkg.version || '0.0.0';
      }
    }
  } catch {
    // ignore
  }
  return '0.0.0';
}

// Minimal ANSI-strip for centering calculations
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function center(text: string, cols: number): string {
  const len = stripAnsi(text).length;
  const pad = Math.max(0, Math.floor((cols - len) / 2));
  return ' '.repeat(pad) + text;
}

// ── Public API ─────────────────────────────────────────────────────────
/**
 * Render the branded splash screen with gradient ASCII art.
 */
export function printSplash(): void {
  const cols = process.stdout.columns || 80;
  const gradient = [
    chalk.hex('#00DFFF'),
    chalk.hex('#00C8FF'),
    chalk.hex('#00B0FF'),
    chalk.hex('#0098FF'),
    chalk.hex('#0080FF'),
    chalk.hex('#0068FF'),
  ];

  console.log();
  for (let i = 0; i < LOGO_LINES.length; i++) {
    const color = gradient[i % gradient.length];
    console.log(center(color(LOGO_LINES[i]), cols));
  }
  const ver = `v${getVersion()}`;
  const tagline = chalk.white(TAGLINE) + ' ' + chalk.gray(ver);
  console.log();
  console.log(center(tagline, cols));
  const sepLen = Math.min(cols - 4, 60);
  console.log(center(chalk.gray('─'.repeat(sepLen)), cols));
  console.log();
}

/**
 * Compact header for sub-menus.
 */
export function printHeader(title: string): void {
  const cols = process.stdout.columns || 80;
  const sepLen = Math.min(cols - 4, 60);
  console.log(center(chalk.gray('─'.repeat(sepLen)), cols));
  console.log(center(chalk.cyanBright.bold(title), cols));
  console.log(center(chalk.gray('─'.repeat(sepLen)), cols));
  console.log();
}

/**
 * Truncate text to fit terminal width
 */
export function truncateForTerminal(text: string, maxWidth?: number): string {
  const width = maxWidth || process.stdout.columns || 80;
  if (text.length <= width) return text;
  return text.slice(0, width - 4) + '...';
}

/**
 * Status bar showing current provider + key state.
 * Includes config path and navigation hints.
 */
export function printStatusBar(plan: string | undefined, apiKey: string | undefined, extra?: string): void {
  const provider = plan ? planLabelColored(plan) : chalk.yellow('○ Not configured');
  const keyStatus = apiKey?.trim() ? chalk.green('● Active') : chalk.gray('○ Missing');
  const keyDisplay = apiKey?.trim() ? chalk.cyan(`${apiKey.trim().slice(0, 4)}****`) : chalk.gray('N/A');
  
  const parts = [
    `${chalk.gray('Provider:')} ${provider}`,
    `${chalk.gray('Key:')} ${keyStatus} ${chalk.gray('(')}${keyDisplay}${chalk.gray(')')}`,
  ];
  if (extra) parts.push(extra);
  console.log(`  ${parts.join(` ${chalk.gray('│')} `)}`);
  console.log();
}

/**
 * Print navigation hints at the bottom of menus
 */
export function printNavigationHints(): void {
  console.log(chalk.gray('  Ctrl+C: Quit  │  ↑↓: Navigate  │  Enter: Select'));
  console.log();
}

/**
 * Print config path hint
 */
export function printConfigPathHint(path: string): void {
  console.log(chalk.gray(`  Config: ${path}`));
  console.log();
}

const PLAN_LABELS: Record<string, string> = {
  glm_coding_plan_global: 'GLM Global',
  glm_coding_plan_china: 'GLM China',
  kimi: 'Kimi',
  openrouter: 'OpenRouter',
  nvidia: 'NVIDIA',
  lmstudio: 'LM Studio',
  alibaba: 'Alibaba Coding',
  alibaba_api: 'Alibaba API (Singapore)',
  zenmux: 'ZenMux',
  xiaomi: 'Xiaomi SGP',
};

const PLAN_COLORS: Record<string, (s: string) => string> = {
  glm_coding_plan_global: chalk.green,
  glm_coding_plan_china: chalk.green,
  kimi: chalk.hex('#00DFFF'),
  openrouter: chalk.hex('#B388FF'),
  nvidia: chalk.hex('#76B900'),
  lmstudio: chalk.hex('#6AB0FF'),
  alibaba: chalk.hex('#FF6A00'),
  alibaba_api: chalk.hex('#FF8C42'),
  zenmux: chalk.hex('#FF69B4'),
  xiaomi: chalk.hex('#FF6900'),
};

export function planLabelColored(plan: string): string {
  const label = PLAN_LABELS[plan] || plan;
  const colorFn = PLAN_COLORS[plan] || chalk.white;
  return colorFn(label);
}

export function planLabel(plan: string | undefined): string {
  if (!plan) return 'Not set';
  return PLAN_LABELS[plan] || plan;
}

export function maskApiKey(apiKey: string | undefined): string {
  if (!apiKey) return 'Not set';
  const trimmed = apiKey.trim();
  if (!trimmed) return 'Not set';
  return `${trimmed.slice(0, 4)}****`;
}

const TOOL_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  opencode: 'OpenCode',
  crush: 'Crush',
  'factory-droid': 'Factory Droid',
  ob1: 'OB1 CLI',
  kimi: 'Kimi (native)',
  amp: 'AMP Code',
  pi: 'Pi CLI',
  codex: 'Codex CLI',
  mastra: 'Mastra Code',
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] || tool;
}

/**
 * Standardized status indicator.
 * ● = configured/active, ○ = not configured, ◐ = partial
 */
export function statusIndicator(configured: boolean): string {
  return configured ? chalk.green('●') : chalk.gray('○');
}

