import { readFile } from 'node:fs/promises';

import { renderAiHelpText, renderHelpText } from './help-documents.js';

export { renderAiHelpText, renderHelpText };

export function isHelpRequest(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

export function isAiHelpRequest(argv: string[]): boolean {
  return argv.includes('-ai') || argv.includes('--ai-help');
}

export function isVersionRequest(argv: string[]): boolean {
  return argv.includes('--version') || argv.includes('-V');
}

export async function readPackageVersion(): Promise<string> {
  const packageJsonUrl = new URL('../../package.json', import.meta.url);
  const content = await readFile(packageJsonUrl, 'utf8');
  const packageJson = JSON.parse(content) as { version?: string };

  if (packageJson.version === undefined) {
    throw new Error('package.json 缺少 version 字段。');
  }

  return packageJson.version;
}
