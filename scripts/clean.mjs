import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const distDir = join(process.cwd(), 'dist');

try {
  await rm(distDir, { recursive: true, force: true });
} catch {
  // ignore
}
