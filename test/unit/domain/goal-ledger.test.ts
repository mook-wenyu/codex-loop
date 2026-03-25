import { describe, expect, it } from 'vitest';

import {
  createEmptyGoalLedger,
  renderGoalLedgerBlock,
  updateGoalLedger
} from '../../../src/domain/goal-ledger.js';

describe('goal-ledger', () => {
  it('在没有历史账本时会渲染空的 Goal Ledger 区块', () => {
    const block = renderGoalLedgerBlock(undefined);

    expect(block).toContain('Goal ledger');
    expect(block).toContain('Completed items:');
    expect(block).toContain('- none');
  });

  it('会从 checklist、分节列表和失败上下文中提取结构化账本', () => {
    const ledger = updateGoalLedger({
      previous: createEmptyGoalLedger(),
      assistantMessage: [
        '- [x] 已完成验证策略重构',
        '- [ ] 继续补齐集成测试',
        '阻塞项：',
        '- Windows 下路径断言仍需确认'
      ].join('\n'),
      completionSatisfied: false,
      failureKind: 'execution-failed',
      failureSummary: 'Previous attempt exited with code 17 before satisfying the completion protocol.'
    });

    expect(ledger.completedItems).toEqual(['已完成验证策略重构']);
    expect(ledger.pendingItems).toContain('继续补齐集成测试');
    expect(ledger.blockedItems).toEqual([
      'Windows 下路径断言仍需确认',
      '上一轮执行异常退出，需要从当前仓库状态继续恢复。'
    ]);
    expect(ledger.evidenceSummary[0]).toContain('已完成验证策略重构');
    expect(ledger.evidenceSummary[1]).toContain('Previous attempt exited with code 17');
  });
});
