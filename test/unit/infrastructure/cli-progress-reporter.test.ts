import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { ProgressEvent } from '../../../src/application/progress.js';
import {
  createCliProgressReporter,
  type ProgressStream
} from '../../../src/infrastructure/progress/cli-progress-reporter.js';

class MemoryProgressStream
  extends Writable
  implements ProgressStream
{
  readonly chunks: string[] = [];
  readonly isTTY: boolean;
  readonly columns: number;

  constructor(options: {
    readonly isTTY: boolean;
    readonly columns?: number;
  }) {
    super();
    this.isTTY = options.isTTY;
    this.columns = options.columns ?? 120;
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.chunks.push(
      typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    );
    callback();
  }

  text(): string {
    return this.chunks.join('');
  }
}

function emit(
  reporter: ReturnType<typeof createCliProgressReporter>,
  events: readonly ProgressEvent[]
): void {
  for (const event of events) {
    reporter.report(event);
  }
}

describe('createCliProgressReporter', () => {
  it('在非 TTY 环境下输出可读的阶段进度日志', () => {
    const stream = new MemoryProgressStream({ isTTY: false });
    const reporter = createCliProgressReporter({
      stream,
      now: constantClock('2026-03-25T12:00:00.000Z')
    });

    emit(reporter, [
      {
        type: 'run-started',
        initialMode: 'initial',
        stateDir: '/state',
        workdir: '/repo'
      },
      {
        type: 'attempt-started',
        attempt: 1,
        mode: 'initial'
      },
      {
        type: 'attempt-finished',
        attempt: 1,
        mode: 'initial',
        exitCode: 0,
        completionRequested: false,
        completed: false,
        failureKind: 'completion-missing'
      },
      {
        type: 'sleep-started',
        attempt: 1,
        seconds: 3
      },
      {
        type: 'attempt-started',
        attempt: 2,
        mode: 'resume'
      },
      {
        type: 'attempt-finished',
        attempt: 2,
        mode: 'resume',
        exitCode: 0,
        completionRequested: true,
        completed: false,
        failureKind: 'completion-review-required'
      },
      {
        type: 'run-completed',
        attempt: 3
      }
    ]);

    reporter.close();

    const output = stream.text();

    expect(output).toContain('状态目录：/state');
    expect(output).toContain('第 1 轮开始（initial）');
    expect(output).toContain('第 1 轮结束：exitCode=0，未触发完成协议');
    expect(output).toContain('等待 3 秒后继续续跑');
    expect(output).toContain('第 2 轮结束：exitCode=0，进入完成审查轮次');
    expect(output).toContain('任务完成：共执行 3 轮');
  });

  it('会覆盖非 TTY 场景下的失败、完成申请拒绝与最大尝试次数日志', () => {
    const stream = new MemoryProgressStream({ isTTY: false });
    const reporter = createCliProgressReporter({
      stream,
      now: constantClock('2026-03-25T12:00:00.000Z')
    });

    emit(reporter, [
      {
        type: 'attempt-finished',
        attempt: 4,
        mode: 'resume',
        exitCode: 17,
        completionRequested: false,
        completed: false,
        failureKind: 'execution-failed'
      },
      {
        type: 'attempt-finished',
        attempt: 5,
        mode: 'resume',
        exitCode: 0,
        completionRequested: true,
        completed: false,
        failureKind: 'completion-missing'
      },
      {
        type: 'attempt-finished',
        attempt: 6,
        mode: 'resume',
        exitCode: 0,
        completionRequested: true,
        completed: true
      },
      {
        type: 'codex-event',
        attempt: 6,
        eventType: 'message.delta'
      },
      {
        type: 'max-attempts-exceeded',
        attempt: 6,
        maxAttempts: 6
      }
    ]);

    reporter.close();

    const output = stream.text();

    expect(output).toContain('第 4 轮结束：exitCode=17，执行失败，准备续跑');
    expect(output).toContain('第 5 轮结束：exitCode=0，完成申请未通过');
    expect(output).toContain('第 6 轮结束：exitCode=0，已确认完成');
    expect(output).toContain('达到最大尝试次数：6（已执行 6 轮）');
    expect(output).not.toContain('message.delta');
  });

  it('在 TTY 环境下会渲染实时状态行并在关闭时清理', () => {
    vi.useFakeTimers();

    const stream = new MemoryProgressStream({ isTTY: true });
    let currentTime = Date.parse('2026-03-25T12:00:00.000Z');
    const reporter = createCliProgressReporter({
      stream,
      now: () => new Date(currentTime),
      tickMs: 100
    });

    emit(reporter, [
      {
        type: 'run-started',
        initialMode: 'initial',
        stateDir: '/state',
        workdir: '/repo'
      },
      {
        type: 'attempt-started',
        attempt: 1,
        mode: 'initial'
      },
      {
        type: 'codex-event',
        attempt: 1,
        eventType: 'session.started',
        sessionId: '11111111-1111-1111-1111-111111111111'
      }
    ]);

    currentTime += 1500;
    vi.advanceTimersByTime(200);

    reporter.close();
    vi.useRealTimers();

    const output = stream.text();

    expect(output).toContain('状态目录：/state');
    expect(output).toContain('第 1 轮 initial');
    expect(output).toContain('session.started');
    expect(output).toContain('11111111');
  });

  it('在 TTY 环境下会渲染空闲态、等待态和最终完成态', () => {
    vi.useFakeTimers();

    const stream = new MemoryProgressStream({ isTTY: true });
    let currentTime = Date.parse('2026-03-25T12:00:00.000Z');
    const reporter = createCliProgressReporter({
      stream,
      now: () => new Date(currentTime),
      tickMs: 100
    });

    reporter.report({
      type: 'run-started',
      initialMode: 'initial',
      stateDir: '/state',
      workdir: '/repo'
    });
    vi.advanceTimersByTime(100);
    currentTime += 100;

    reporter.report({
      type: 'attempt-started',
      attempt: 1,
      mode: 'initial'
    });
    reporter.report({
      type: 'sleep-started',
      attempt: 1,
      seconds: 3
    });
    vi.advanceTimersByTime(100);
    currentTime += 100;

    reporter.report({
      type: 'attempt-finished',
      attempt: 1,
      mode: 'initial',
      exitCode: 0,
      completionRequested: false,
      completed: false
    });
    reporter.report({
      type: 'run-completed',
      attempt: 1
    });

    vi.useRealTimers();

    const output = stream.text();

    expect(output).toContain('准备启动守护循环');
    expect(output).toContain('等待 00:03 后续跑');
    expect(output).toContain('[ok] 任务完成，共执行 1 轮');
  });

  it('在 TTY 环境下会渲染最大尝试次数失败态，并允许重复关闭', () => {
    vi.useFakeTimers();

    const stream = new MemoryProgressStream({ isTTY: true });
    const reporter = createCliProgressReporter({
      stream,
      now: constantClock('2026-03-25T12:00:00.000Z'),
      tickMs: 100
    });

    reporter.report({
      type: 'run-started',
      initialMode: 'resume',
      stateDir: '/state',
      workdir: '/repo'
    });
    reporter.report({
      type: 'max-attempts-exceeded',
      attempt: 5,
      maxAttempts: 5
    });
    reporter.close();
    reporter.close();

    vi.useRealTimers();

    expect(stream.text()).toContain('[x] 达到最大尝试次数 5');
  });

  it('在 json 模式下会输出机器可读的 JSONL 进度事件', () => {
    const stream = new MemoryProgressStream({ isTTY: false });
    const reporter = createCliProgressReporter({
      stream,
      now: constantClock('2026-03-25T12:00:00.000Z'),
      format: 'json'
    });

    emit(reporter, [
      {
        type: 'run-started',
        initialMode: 'initial',
        stateDir: '/state',
        workdir: '/repo'
      },
      {
        type: 'attempt-started',
        attempt: 1,
        mode: 'initial'
      },
      {
        type: 'attempt-finished',
        attempt: 1,
        mode: 'initial',
        exitCode: 0,
        completionRequested: false,
        completed: false,
        failureKind: 'completion-missing'
      }
    ]);

    reporter.close();

    const lines = stream
      .text()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual(
      expect.objectContaining({
        type: 'run-started',
        initialMode: 'initial',
        stateDir: '/state',
        workdir: '/repo',
        message: '状态目录：/state'
      })
    );
    expect(lines[1]).toEqual(
      expect.objectContaining({
        type: 'attempt-started',
        attempt: 1,
        mode: 'initial',
        message: '第 1 轮开始（initial）'
      })
    );
    expect(lines[2]).toEqual(
      expect.objectContaining({
        type: 'attempt-finished',
        attempt: 1,
        mode: 'initial',
        exitCode: 0,
        failureKind: 'completion-missing',
        message: '第 1 轮结束：exitCode=0，未触发完成协议'
      })
    );
  });
});

function constantClock(isoText: string): () => Date {
  return () => new Date(isoText);
}
