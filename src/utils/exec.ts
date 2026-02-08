import { spawnSync, spawn } from 'child_process';

function restoreTtyAfterChild(): void {
  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.resume();
    }
  } catch {
    // ignore
  }
}

function detachStdinListenersForChild(): {
  restore: () => void;
} {
  // Snapshot and remove every listener that could consume stdin bytes
  // before the child process sees them.
  const saved: { event: string; fn: Function }[] = [];
  for (const event of ['data', 'keypress', 'readable']) {
    for (const fn of process.stdin.listeners(event)) {
      saved.push({ event, fn: fn as Function });
      process.stdin.removeListener(event, fn as any);
    }
  }

  // Exit raw mode so the child gets normal cooked input.
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch { /* */ }

  // CRITICAL: **pause** stdin so Node's internal reader thread stops
  // consuming console input.  Without this the child never receives
  // keystrokes because the parent's libuv loop eats them first.
  process.stdin.pause();

  const restore = () => {
    // Put stdin back into the state Inquirer expects.
    try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch { /* */ }
    process.stdin.resume();

    // Reattach saved listeners (skip duplicates).
    for (const { event, fn } of saved) {
      if (!process.stdin.listeners(event).includes(fn as any)) {
        process.stdin.on(event, fn as any);
      }
    }
  };

  return { restore };
}

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
    const stdin = detachStdinListenersForChild();
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => {
      stdin.restore();
      resolve(code ?? 0);
    });
    child.on('error', () => {
      stdin.restore();
      resolve(1);
    });
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
    const stdin = detachStdinListenersForChild();
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env
    });
    child.on('exit', (code) => {
      stdin.restore();
      resolve(code ?? 0);
    });
    child.on('error', () => {
      stdin.restore();
      resolve(1);
    });
  });
}

export function runInNewTerminal(
  command: string,
  args: string[] = [],
  envOverrides: Record<string, string | undefined> = {}
): boolean {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (typeof value === 'string' && value.length > 0) env[key] = value;
    else delete env[key];
  }

  if (process.platform !== 'win32') {
    // Best-effort; currently only implemented for Windows.
    return false;
  }

  try {
    // Prefer Windows Terminal (new tab) when available.
    if (commandExists('wt')) {
      const child = spawn('wt', ['-w', '0', 'nt', '--', command, ...args], {
        detached: true,
        stdio: 'ignore',
        env,
      });
      child.unref();
      return true;
    }
  } catch {
    // ignore and fall back
  }

  try {
    // Fallback: open a new console window via cmd.exe `start`.
    // Note: `start` requires a window title argument; we pass an empty string.
    const child = spawn('cmd.exe', ['/c', 'start', '""', command, ...args], {
      detached: true,
      stdio: 'ignore',
      env,
      windowsHide: false,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
