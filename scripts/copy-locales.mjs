import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const srcDir = join(process.cwd(), 'src', 'locales');
const dstDir = join(process.cwd(), 'dist', 'locales');

if (!existsSync(srcDir)) {
  // Nothing to copy; allow builds in minimal setups.
  process.exit(0);
}

await mkdir(dstDir, { recursive: true });
await cp(srcDir, dstDir, { recursive: true, force: true });
