export const CLI_NAME = 'codex-loop';
export const PACKAGE_NAME = CLI_NAME;
export const ENV_PREFIX = 'CODEX_LOOP';
export const STATE_DIR_PREFIX = CLI_NAME;

export function envVarName(name: string): string {
  return `${ENV_PREFIX}_${name}`;
}
