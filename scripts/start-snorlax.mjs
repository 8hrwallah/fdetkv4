import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = process.env.PORT || '5000';
process.env.PORT = port;

const pnpmRunner = fileURLToPath(new URL('./run-pnpm.mjs', import.meta.url));
const build = spawnSync(process.execPath, [pnpmRunner, 'run', 'build:snorlax'], {
  stdio: 'inherit',
  env: process.env,
});

if (build.error) {
  console.error('Failed to run build:', build.error);
  process.exit(1);
}

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const start = spawnSync(process.execPath, [pnpmRunner, '--filter', '@workspace/api-server', 'run', 'start'], {
  stdio: 'inherit',
  env: process.env,
});

if (start.error) {
  console.error('Failed to start server:', start.error);
  process.exit(1);
}

process.exit(start.status ?? 0);
