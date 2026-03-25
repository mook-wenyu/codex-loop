import { describe, expect, it } from 'vitest';

import {
  parseBooleanEnvValue,
  parseIntegerEnvValue
} from '../../../src/config/env.js';

describe('env parsers', () => {
  it('能解析布尔环境变量并在缺失时回退默认值', () => {
    expect(parseBooleanEnvValue(undefined, true)).toBe(true);
    expect(parseBooleanEnvValue('true', false)).toBe(true);
    expect(parseBooleanEnvValue('OFF', true)).toBe(false);
  });

  it('会拒绝非法布尔环境变量', () => {
    expect(() => parseBooleanEnvValue('maybe', true)).toThrow(
      /无效的布尔环境变量值/
    );
  });

  it('能解析整数环境变量', () => {
    expect(parseIntegerEnvValue(undefined)).toBeUndefined();
    expect(parseIntegerEnvValue('12')).toBe(12);
  });

  it('会拒绝非法整数环境变量', () => {
    expect(() => parseIntegerEnvValue('12.5')).toThrow(
      /无效的整数环境变量值/
    );
  });
});
