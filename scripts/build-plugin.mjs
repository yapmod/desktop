import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, process.argv[2] ?? 'plugin/dist');
const builder = path.join(root, 'node_modules/@yapmod/builder');
const { bin } = JSON.parse(await readFile(path.join(builder, 'package.json'), 'utf8'));
const expression = path.join(output, 'plugin.js');
execFileSync(process.execPath, [
  path.join(builder, bin.yapmod), 'build', '--entry', 'plugin/src/index.tsx', '--outfile', expression,
], { cwd: root, stdio: 'inherit' });

const source = await readFile(expression, 'utf8');
const manifest = JSON.parse(await readFile(path.join(root, 'plugin/manifest.json'), 'utf8'));
// The SDK resolves shared imports through the lexical yapmod argument.
// The v1 desktop loader calls this registration function for bundled and signed updates.
const registration = `(function registerDesktopPlugin(client, bridge) {
  if (!client.registerClientPlugin({
    id: "client:yapmod-desktop",
    manifest: ${JSON.stringify(manifest)},
    defaultEnabled: true,
    setup(yapmod) {
      const createPlugin = ${source}
      return createPlugin(yapmod, bridge);
    }
  })) throw new Error("The client could not register Yapmod Desktop.");
})\n`;
await writeFile(path.join(output, 'desktop-plugins.js'), registration);
