import { describe, expect, it } from 'vitest';

import { createGoalContract } from '../../../src/domain/goal-contract.js';
import { renderGoalLedgerBlock } from '../../../src/domain/goal-ledger.js';

describe('createGoalContract', () => {
  it('会基于原始 prompt 构建稳定的 goal contract', () => {
    const contract = createGoalContract('请完成最终目标，不要停留在阶段目标。');

    expect(contract.originalPrompt).toBe('请完成最终目标，不要停留在阶段目标。');
    expect(contract.promptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(contract.renderBlock()).toContain('Original user request');
    expect(contract.renderBlock()).toContain('请完成最终目标');
    expect(contract.renderBlock()).toContain(contract.promptSha256);
  });

  it('会在 resume prompt 中同时携带原始目标与最小 Goal Ledger', () => {
    const contract = createGoalContract('请继续完成最终目标。');
    const ledgerBlock = renderGoalLedgerBlock({
      completedItems: ['已补齐验证策略单测'],
      pendingItems: ['继续修复 fail-open 缺口'],
      blockedItems: ['npm test 仍有失败'],
      evidenceSummary: ['Command: npm test']
    });

    const prompt = contract.buildResumePrompt(
      '继续当前任务，不要重启。',
      'completion protocol',
      ledgerBlock
    );

    expect(prompt).toContain('The original user request below remains authoritative');
    expect(prompt).toContain('Goal ledger');
    expect(prompt).toContain('继续修复 fail-open 缺口');
    expect(prompt).toContain(contract.promptSha256);
  });
});
