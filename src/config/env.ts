export function parseBooleanEnvValue(
  value: string | undefined,
  fallback: boolean
): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`无效的布尔环境变量值：${value}`);
}

export function parseIntegerEnvValue(
  value: string | undefined
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`无效的整数环境变量值：${value}`);
  }

  return Number.parseInt(value, 10);
}
