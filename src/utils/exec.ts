import { spawnSync, spawn } from 'child_process';

export function commandExists(command: string): boolean {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });
  if (result.status === 0) return true;

  // Fallback: some tools are available via shell aliases/shims and won't show up in where/which.
  const shell = process.platform === 'win32';
  const probe1 = spawnSync(command, ['--version'], { stdio: 'ignore', shell });
  if (probe1.status === 0) return true;
  const probe2 = spawnSync(command, ['-v'], { stdio: 'ignore', shell });
  return probe2.status === 0;
}

export async function runInteractive(command: string, args: string[] = []): Promise<number> {
  return await new Promise<number>((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}

export async function runInteractiveWithEnv(
  command: string,
  args: string[] = [],
  envOverrides: Record<string, string | undefined> = {}
): Promise<number> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (typeof value === 'string' && value.length > 0) env[key] = value;
    else delete env[key];
  }

  return await new Promise<number>((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env
    });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}
