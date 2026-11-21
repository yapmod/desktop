import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const client = path.resolve(root, process.env.YAPMOD_CLIENT_DIR || '../client');
const bundle = path.join(client, 'apps/client/dist/yapmod-client.js');

function run(args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`pnpm ${args.join(' ')} exited with ${signal || code}.`), { signal }));
    });
  });
}

try {
  await access(path.join(client, 'apps/client/package.json')).catch(() => {
    throw new Error('Client checkout not found. Use ../client or set YAPMOD_CLIENT_DIR, then install its dependencies with pnpm install --frozen-lockfile.');
  });
  console.log(`Building the local Yapmod client in ${client}`);
  await run(['build'], client);
  await access(bundle);
  console.log(`Starting desktop with ${bundle}`);
  await run(['exec', 'tauri', 'dev', ...process.argv.slice(2)], root, {
    ...process.env, YAPMOD_DEV_CLIENT_BUNDLE: bundle,
  });
} catch (error) {
  if (error?.signal === 'SIGINT' || error?.signal === 'SIGTERM') {
    process.exitCode = error.signal === 'SIGINT' ? 130 : 143;
  } else {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
