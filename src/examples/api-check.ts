import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { VERSION, METHODS } from '../shared/lesson.js';
const sdkDirectory = path.dirname(
  fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk')),
);
const pkg = JSON.parse(await readFile(path.join(sdkDirectory, 'package.json'), 'utf8'));
if (pkg.version !== VERSION) throw new Error('Unexpected SDK version.');
const declarations = await readFile(path.join(sdkDirectory, 'sdk.d.ts'), 'utf8');
for (const name of [
  'setModel',
  'setMcpServers',
  'mcpServerStatus',
  'supportedAgents',
  'reloadPlugins',
  'getContextUsage',
  'close',
]) {
  if (!declarations.includes(`${name}(`)) throw new Error(`Missing declaration: ${name}`);
}
if (/\bgetUsage\s*\(/.test(declarations))
  throw new Error('Recheck the documented usage mapping for this package.');
console.log(`Verified installed SDK ${pkg.version}; no getUsage() method.`);
console.table(METHODS.map(({ name, kind }) => ({ name, kind })));
