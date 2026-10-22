import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const pnpmEntrypoint = process.env.npm_execpath;
const isWindows = process.platform === 'win32';
const isJavaScriptEntrypoint = pnpmEntrypoint && /\.(?:cjs|mjs|js)$/i.test(pnpmEntrypoint);
const command = isJavaScriptEntrypoint
  ? process.execPath
  : pnpmEntrypoint || (isWindows ? 'pnpm.cmd' : 'pnpm');
const commandArgs = isJavaScriptEntrypoint ? [pnpmEntrypoint, ...args] : args;

const result = spawnSync(command, commandArgs, {
  stdio: 'inherit',
  env: process.env,
  shell: isWindows && (!pnpmEntrypoint || /\.(?:cmd|bat)$/i.test(pnpmEntrypoint)),
});

if (result.error) {
  console.error('Failed to run pnpm:', result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);