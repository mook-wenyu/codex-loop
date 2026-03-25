import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

import { execa } from 'execa';

import type {
  CodexExecutor,
  CodexExecutionRequest,
  CodexExecutionResult
} from '../../application/types.js';
import {
  buildCodexCommand,
  type CodexCommandBuilderOptions
} from './codex-command.js';
import {
  decodeCodexEventChunk,
  flushCodexEventCarry
} from './codex-event-stream.js';

export interface ExecaCodexExecutorOptions
  extends CodexCommandBuilderOptions {
  readonly environment?: NodeJS.ProcessEnv;
}

export class ExecaCodexExecutor implements CodexExecutor {
  private readonly options: ExecaCodexExecutorOptions;

  constructor(options: ExecaCodexExecutorOptions) {
    this.options = options;
  }

  async execute(
    request: CodexExecutionRequest
  ): Promise<CodexExecutionResult> {
    const command = buildCodexCommand(this.options, request);
    const environment = normalizeEnvironment(this.options.environment);
    const eventStream = createWriteStream(request.eventLogPath, {
      flags: 'a',
      encoding: 'utf8'
    });
    const runnerLogStream = createWriteStream(request.runnerLogPath, {
      flags: 'a',
      encoding: 'utf8'
    });

    let latestSessionId: string | null = null;
    let carry = '';

    try {
      const subprocess = execa(command.command, command.args, {
        cwd: request.workdir,
        input: command.input,
        reject: false,
        ...(environment === undefined ? {} : { env: environment })
      });

      subprocess.stdout?.on('data', (chunk: Buffer | string) => {
        const text =
          typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        eventStream.write(text);
        const decodedChunk = decodeCodexEventChunk(carry, text);
        carry = decodedChunk.carry;

        for (const event of decodedChunk.events) {
          if (event.sessionId !== undefined) {
            latestSessionId = event.sessionId;
          }

          request.onEvent?.(event);
        }
      });

      subprocess.stderr?.on('data', (chunk: Buffer | string) => {
        runnerLogStream.write(chunk);
      });

      const result = await subprocess;
      for (const event of flushCodexEventCarry(carry)) {
        if (event.sessionId !== undefined) {
          latestSessionId = event.sessionId;
        }

        request.onEvent?.(event);
      }

      return {
        exitCode: result.exitCode ?? 1,
        discoveredSessionId: latestSessionId
      };
    } catch (error) {
      if (isCommandMissingError(error)) {
        throw new Error(`未找到 Codex 可执行文件：${this.options.codexBin}`);
      }

      throw error;
    } finally {
      await Promise.all([
        closeWriteStream(eventStream),
        closeWriteStream(runnerLogStream)
      ]);
    }
  }
}

async function closeWriteStream(
  stream: NodeJS.WritableStream & { end: () => void }
): Promise<void> {
  stream.end();
  await once(stream, 'finish');
}

function isCommandMissingError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function normalizeEnvironment(
  environment: NodeJS.ProcessEnv | undefined
): Record<string, string> | undefined {
  if (environment === undefined) {
    return undefined;
  }

  const normalizedEntries = Object.entries(environment).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  );

  return Object.fromEntries(normalizedEntries);
}
