import * as readline from 'node:readline';
import { Writable } from 'node:stream';

import type {
  ProgressEvent,
  ProgressReporter
} from '../../application/progress.js';

const SPINNER_FRAMES = ['-', '\\', '|', '/'] as const;
const DEFAULT_TICK_MS = 120;

interface ProgressSnapshot {
  readonly startedAt: number;
  readonly stateDir?: string;
  readonly workdir?: string;
  readonly attempt?: number;
  readonly mode?: 'initial' | 'resume';
  readonly eventType?: string;
  readonly sessionId?: string;
  readonly waitDeadlineAt?: number;
  readonly lastExitCode?: number;
  readonly lastFailureKind?: ProgressEvent extends {
    readonly type: 'attempt-finished';
    readonly failureKind?: infer T;
  }
    ? T
    : never;
  readonly phase:
    | 'idle'
    | 'running'
    | 'waiting'
    | 'completed'
    | 'failed';
  readonly finalAttempt?: number;
  readonly maxAttempts?: number;
}

export interface ProgressStream extends Writable {
  readonly isTTY?: boolean;
  readonly columns?: number;
}

export interface CreateCliProgressReporterOptions {
  readonly stream?: ProgressStream;
  readonly now?: () => Date;
  readonly tickMs?: number;
  readonly format?: 'text' | 'json';
}

export function createCliProgressReporter(
  options: CreateCliProgressReporterOptions = {}
): ProgressReporter {
  const stream = options.stream ?? (process.stderr as ProgressStream);
  const now = options.now ?? (() => new Date());
  const format = options.format ?? 'text';

  if (format === 'json') {
    return new JsonLineProgressReporter(stream, now);
  }

  if (stream.isTTY) {
    return new TtyProgressReporter(
      stream,
      now,
      options.tickMs ?? DEFAULT_TICK_MS
    );
  }

  return new LineProgressReporter(stream, now);
}

class LineProgressReporter implements ProgressReporter {
  private readonly stream: ProgressStream;
  private readonly now: () => Date;

  constructor(stream: ProgressStream, now: () => Date) {
    this.stream = stream;
    this.now = now;
  }

  report(event: ProgressEvent): void {
    switch (event.type) {
      case 'run-started':
        this.writeLine(`状态目录：${event.stateDir}`);
        this.writeLine(`工作目录：${event.workdir}`);
        return;
      case 'attempt-started':
        this.writeLine(`第 ${event.attempt} 轮开始（${event.mode}）`);
        return;
      case 'attempt-finished':
        this.writeLine(formatAttemptFinishedLine(event));
        return;
      case 'sleep-started':
        this.writeLine(`等待 ${event.seconds} 秒后继续续跑`);
        return;
      case 'run-completed':
        this.writeLine(`任务完成：共执行 ${event.attempt} 轮`);
        return;
      case 'max-attempts-exceeded':
        this.writeLine(
          `达到最大尝试次数：${event.maxAttempts}（已执行 ${event.attempt} 轮）`
        );
        return;
      default:
        return;
    }
  }

  close(): void {
    this.now();
  }

  private writeLine(line: string): void {
    this.stream.write(`${line}\n`);
  }
}

class JsonLineProgressReporter implements ProgressReporter {
  private readonly stream: ProgressStream;
  private readonly now: () => Date;

  constructor(stream: ProgressStream, now: () => Date) {
    this.stream = stream;
    this.now = now;
  }

  report(event: ProgressEvent): void {
    const payload = {
      timestamp: this.now().toISOString(),
      ...event,
      message: formatProgressEventMessage(event)
    };

    this.stream.write(`${JSON.stringify(payload)}\n`);
  }

  close(): void {
    this.now();
  }
}

class TtyProgressReporter implements ProgressReporter {
  private readonly stream: ProgressStream;
  private readonly now: () => Date;
  private readonly timer: NodeJS.Timeout;
  private readonly snapshot: ProgressSnapshot = {
    phase: 'idle',
    startedAt: 0
  };
  private frameIndex = 0;
  private closed = false;
  private transientVisible = false;

  constructor(
    stream: ProgressStream,
    now: () => Date,
    tickMs: number
  ) {
    this.stream = stream;
    this.now = now;
    this.timer = setInterval(() => {
      this.render();
    }, tickMs);
    this.timer.unref();
  }

  report(event: ProgressEvent): void {
    const now = this.now().getTime();

    switch (event.type) {
      case 'run-started':
        Object.assign(this.snapshot, {
          phase: 'idle',
          startedAt: now,
          stateDir: event.stateDir,
          workdir: event.workdir
        });
        this.writePersistentLine(`状态目录：${event.stateDir}`);
        this.writePersistentLine(`工作目录：${event.workdir}`);
        break;
      case 'attempt-started':
        Object.assign(this.snapshot, {
          phase: 'running',
          attempt: event.attempt,
          mode: event.mode,
          waitDeadlineAt: undefined
        });
        break;
      case 'codex-event':
        Object.assign(this.snapshot, {
          eventType: event.eventType,
          ...(event.sessionId === undefined
            ? {}
            : { sessionId: event.sessionId })
        });
        break;
      case 'attempt-finished':
        Object.assign(this.snapshot, {
          lastExitCode: event.exitCode,
          ...(event.failureKind === undefined
            ? { lastFailureKind: undefined }
            : { lastFailureKind: event.failureKind })
        });
        break;
      case 'sleep-started':
        Object.assign(this.snapshot, {
          phase: 'waiting',
          waitDeadlineAt: now + event.seconds * 1000
        });
        break;
      case 'run-completed':
        Object.assign(this.snapshot, {
          phase: 'completed',
          finalAttempt: event.attempt
        });
        this.finish();
        return;
      case 'max-attempts-exceeded':
        Object.assign(this.snapshot, {
          phase: 'failed',
          finalAttempt: event.attempt,
          maxAttempts: event.maxAttempts
        });
        this.finish();
        return;
    }

    this.render();
  }

  close(): void {
    if (this.closed) {
      return;
    }

    clearInterval(this.timer);
    this.clearTransientLine();
    this.closed = true;
  }

  private finish(): void {
    if (this.closed) {
      return;
    }

    clearInterval(this.timer);
    const line = buildProgressLine(this.snapshot, this.now().getTime(), 0);

    this.clearTransientLine();
    this.stream.write(`${line}\n`);
    this.closed = true;
  }

  private render(): void {
    if (this.closed) {
      return;
    }

    const line = buildProgressLine(
      this.snapshot,
      this.now().getTime(),
      this.frameIndex
    );

    this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
    readline.cursorTo(this.stream, 0);
    readline.clearLine(this.stream, 0);
    this.stream.write(line);
    this.transientVisible = true;
  }

  private clearTransientLine(): void {
    if (!this.transientVisible) {
      return;
    }

    readline.cursorTo(this.stream, 0);
    readline.clearLine(this.stream, 0);
    this.transientVisible = false;
  }

  private writePersistentLine(line: string): void {
    this.clearTransientLine();
    this.stream.write(`${line}\n`);
  }
}

function buildProgressLine(
  snapshot: ProgressSnapshot,
  now: number,
  frameIndex: number
): string {
  if (snapshot.phase === 'completed') {
    return `[ok] 任务完成，共执行 ${snapshot.finalAttempt ?? '?'} 轮，总耗时 ${formatDuration(now - snapshot.startedAt)}`;
  }

  if (snapshot.phase === 'failed') {
    return `[x] 达到最大尝试次数 ${snapshot.maxAttempts ?? '?'}，已执行 ${snapshot.finalAttempt ?? '?'} 轮，总耗时 ${formatDuration(now - snapshot.startedAt)}`;
  }

  if (snapshot.phase === 'waiting') {
    const remainingMs = Math.max(
      0,
      (snapshot.waitDeadlineAt ?? now) - now
    );

    return [
      '[...]',
      `第 ${snapshot.attempt ?? '?'} 轮已结束`,
      `等待 ${formatDuration(remainingMs)} 后续跑`,
      formatLastAttemptSuffix(snapshot)
    ]
      .filter((part) => part.length > 0)
      .join(' | ');
  }

  if (snapshot.phase === 'running') {
    return [
      `[${SPINNER_FRAMES[frameIndex]}]`,
      `第 ${snapshot.attempt ?? '?'} 轮 ${snapshot.mode ?? 'unknown'}`,
      `运行中 ${formatDuration(now - snapshot.startedAt)}`,
      ...(snapshot.eventType === undefined
        ? []
        : [`最近事件 ${snapshot.eventType}`]),
      ...(snapshot.sessionId === undefined
        ? []
        : [`会话 ${shortSessionId(snapshot.sessionId)}`])
    ].join(' | ');
  }

  return [
    '[...]',
    '准备启动守护循环',
    ...(snapshot.stateDir === undefined ? [] : [`状态目录 ${snapshot.stateDir}`])
  ].join(' | ');
}

function formatAttemptFinishedLine(
  event: Extract<ProgressEvent, { readonly type: 'attempt-finished' }>
): string {
  const reason =
    event.completed
      ? '已确认完成'
      : event.completionRequested
        ? event.failureKind === 'completion-review-required'
          ? '进入完成审查轮次'
          : '完成申请未通过'
        : event.failureKind === 'execution-failed'
          ? '执行失败，准备续跑'
          : '未触发完成协议';

  return `第 ${event.attempt} 轮结束：exitCode=${event.exitCode}，${reason}`;
}

function formatProgressEventMessage(event: ProgressEvent): string {
  switch (event.type) {
    case 'run-started':
      return `状态目录：${event.stateDir}`;
    case 'attempt-started':
      return `第 ${event.attempt} 轮开始（${event.mode}）`;
    case 'attempt-finished':
      return formatAttemptFinishedLine(event);
    case 'sleep-started':
      return `等待 ${event.seconds} 秒后继续续跑`;
    case 'run-completed':
      return `任务完成：共执行 ${event.attempt} 轮`;
    case 'max-attempts-exceeded':
      return `达到最大尝试次数：${event.maxAttempts}（已执行 ${event.attempt} 轮）`;
    case 'codex-event':
      return event.eventType === undefined
        ? `第 ${event.attempt} 轮收到 Codex 事件`
        : `第 ${event.attempt} 轮收到 Codex 事件：${event.eventType}`;
  }
}

function formatLastAttemptSuffix(snapshot: ProgressSnapshot): string {
  if (snapshot.lastExitCode === undefined) {
    return '';
  }

  return snapshot.lastFailureKind === undefined
    ? `exitCode=${snapshot.lastExitCode}`
    : `exitCode=${snapshot.lastExitCode}，原因=${snapshot.lastFailureKind}`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}
