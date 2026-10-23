import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

if (process.argv.includes('--no-db')) {
  process.env.CHAT_DISABLED = 'true';
}

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

const serverEntry = fileURLToPath(new URL('../artifacts/api-server/dist/index.mjs', import.meta.url));
const start = spawn(process.execPath, ['--enable-source-maps', serverEntry], {
  stdio: 'inherit',
  env: process.env,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => start.kill(signal));
}

start.on('error', (error) => {
  console.error('Failed to start server:', error);
  process.exitCode = 1;
});

start.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
