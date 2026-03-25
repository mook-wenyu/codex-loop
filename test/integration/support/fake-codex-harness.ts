import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import type { FakeCodexScenario } from './fake-codex-dsl.js';

export interface FakeCodexInvocation {
  readonly stepIndex: number;
  readonly mode: 'initial' | 'resume';
  readonly sessionId?: string;
  readonly usesLast: boolean;
  readonly outputPath: string;
  readonly prompt: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly hasConfigOverride: boolean;
}

export interface FakeCodexHarness {
  readonly rootDir: string;
  readonly repoDir: string;
  readonly runnerStateDir: string;
  readonly promptFile: string;
  readonly env: NodeJS.ProcessEnv;
  readInvocations(): Promise<FakeCodexInvocation[]>;
  readRunnerState(): Promise<Record<string, unknown>>;
  cleanup(): Promise<void>;
}

export async function createFakeCodexHarness(
  scenario: FakeCodexScenario,
  options: {
    readonly repoFiles?: Record<string, string>;
  } = {}
): Promise<FakeCodexHarness> {
  const rootDir = await mkdtemp(join(tmpdir(), 'codex-loop-int-'));
  const repoDir = join(rootDir, 'repo');
  const runnerStateDir = join(rootDir, 'runner-state');
  const promptFile = join(rootDir, 'prompt.md');
  const fakeCodexStateDir = join(rootDir, 'fake-codex-state');
  const binDir = join(rootDir, 'bin');
  const scenarioPath = join(rootDir, 'scenario.json');
  const fixtureScriptPath = join(
    process.cwd(),
    'test',
    'fixtures',
    'fake-codex',
    'fake-codex.mjs'
  );
  const shellShimPath = join(binDir, 'codex');
  const cmdShimPath = join(binDir, 'codex.cmd');
  const pathKey = detectPathKey(process.env);
  const basePath = process.env[pathKey] ?? '';
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [pathKey]: `${binDir}${delimiter}${basePath}`,
    FAKE_CODEX_SCENARIO_PATH: scenarioPath,
    FAKE_CODEX_STATE_DIR: fakeCodexStateDir
  };

  await mkdir(repoDir, { recursive: true });
  await mkdir(runnerStateDir, { recursive: true });
  await mkdir(fakeCodexStateDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await writeFile(scenarioPath, JSON.stringify(scenario, null, 2), 'utf8');
  await writeFile(
    promptFile,
    scenario.promptFileText ?? '请执行一个多阶段长任务。',
    'utf8'
  );
  await seedRepoFiles(repoDir, options.repoFiles ?? {});

  await writeFile(
    shellShimPath,
    `#!/usr/bin/env bash\nnode "${toPosixPath(fixtureScriptPath)}" "$@"\n`,
    'utf8'
  );
  await chmod(shellShimPath, 0o755);
  await writeFile(
    cmdShimPath,
    `@echo off\r\nnode "${fixtureScriptPath}" %*\r\n`,
    'utf8'
  );

  return {
    rootDir,
    repoDir,
    runnerStateDir,
    promptFile,
    env,
    async readInvocations(): Promise<FakeCodexInvocation[]> {
      const invocationsPath = join(fakeCodexStateDir, 'invocations.ndjson');

      try {
        const content = await readFile(invocationsPath, 'utf8');

        return content
          .split(/\r?\n/)
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as FakeCodexInvocation);
      } catch (error) {
        if (isFileMissingError(error)) {
          return [];
        }

        throw error;
      }
    },
    async readRunnerState(): Promise<Record<string, unknown>> {
      const statePath = join(runnerStateDir, 'state.json');
      const content = await readFile(statePath, 'utf8');

      return JSON.parse(content) as Record<string, unknown>;
    },
    async cleanup(): Promise<void> {
      await rm(rootDir, { recursive: true, force: true });
    }
  };
}

async function seedRepoFiles(
  repoDir: string,
  repoFiles: Record<string, string>
): Promise<void> {
  await Promise.all(
    Object.entries(repoFiles).map(async ([relativePath, content]) => {
      const normalizedPath = relativePath.replaceAll('/', '\\').split('\\');
      const filePath = join(repoDir, ...normalizedPath);
      const parentPath = join(repoDir, ...normalizedPath.slice(0, -1));

      if (normalizedPath.length > 1) {
        await mkdir(parentPath, { recursive: true });
      }

      await writeFile(filePath, content, 'utf8');

      if (relativePath.endsWith('gradlew')) {
        await chmod(filePath, 0o755);
      }
    })
  );
}

function detectPathKey(env: NodeJS.ProcessEnv): string {
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') {
      return key;
    }
  }

  return 'PATH';
}

function toPosixPath(path: string): string {
  return path.replaceAll('\\', '/');
}

function isFileMissingError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
