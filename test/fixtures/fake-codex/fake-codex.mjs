#!/usr/bin/env node

import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const scenarioPath = process.env.FAKE_CODEX_SCENARIO_PATH;
const stateDir = process.env.FAKE_CODEX_STATE_DIR;

if (!scenarioPath || !stateDir) {
  console.error('缺少假 Codex 所需环境变量。');
  process.exit(90);
}

if (process.argv.includes('--version')) {
  console.log('codex-cli fake-1.0.0');
  process.exit(0);
}

const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
const runtimeStatePath = join(stateDir, 'runtime-state.json');
const invocationsPath = join(stateDir, 'invocations.ndjson');
const runtimeState = await loadRuntimeState(runtimeStatePath);
const invocation = await parseInvocation(process.argv.slice(2));
const step = scenario.steps?.[runtimeState.nextStepIndex];

if (!step) {
  console.error(`场景步骤不足，当前请求索引=${runtimeState.nextStepIndex}`);
  process.exit(91);
}

validateInvocation(step.expected, invocation, runtimeState);
validateGoalAssertions(scenario.goal, invocation);

const lastMessage = step.response.completionProtocol
  ? createCompletionMessage(invocation.prompt)
  : (step.response.lastMessage ?? '');
const nextRuntimeState = {
  nextStepIndex: runtimeState.nextStepIndex + 1,
  latestSessionId:
    step.response.sessionId ??
    step.response.recordedSessionId ??
    runtimeState.latestSessionId
};

await mkdir(dirname(invocation.outputPath), { recursive: true });
await writeFile(invocation.outputPath, lastMessage, 'utf8');
await appendFile(
  invocationsPath,
  `${JSON.stringify({
    stepIndex: runtimeState.nextStepIndex,
    ...invocation
  })}\n`,
  'utf8'
);
await writeFile(
  runtimeStatePath,
  JSON.stringify(nextRuntimeState, null, 2),
  'utf8'
);

if (step.response.sessionId) {
  process.stdout.write(
    `${JSON.stringify({
      type: 'session.started',
      session_id: step.response.sessionId
    })}\n`
  );
} else {
  process.stdout.write(`${JSON.stringify({ type: 'message' })}\n`);
}

process.exit(step.response.exitCode ?? 0);

async function parseInvocation(argv) {
  if (argv[0] !== 'exec') {
    throw new Error(`假 Codex 仅支持 exec 子命令，收到：${argv[0] ?? '<empty>'}`);
  }

  let index = 1;
  let mode = 'initial';
  let outputPath;
  let sessionId;
  let usesLast = false;
  let hasConfigOverride = false;

  if (argv[index] === 'resume') {
    mode = 'resume';
    index += 1;
  }

  while (index < argv.length) {
    const token = argv[index];

    if (token === '--json') {
      index += 1;
      continue;
    }

    if (token === '-o') {
      outputPath = argv[index + 1];
      index += 2;
      continue;
    }

    if (token === '-m') {
      index += 2;
      continue;
    }

    if (token === '--full-auto' ||
        token === '--dangerously-bypass-approvals-and-sandbox' ||
        token === '--skip-git-repo-check') {
      index += 1;
      continue;
    }

    if (token === '--config') {
      hasConfigOverride = true;
      index += 2;
      continue;
    }

    if (token === '--last') {
      usesLast = true;
      index += 1;
      continue;
    }

    if (token === '-') {
      index += 1;
      break;
    }

    if (token.startsWith('-')) {
      throw new Error(`遇到未识别参数：${token}`);
    }

    sessionId = token;
    index += 1;
  }

  if (!outputPath) {
    throw new Error('缺少 -o 输出路径。');
  }

  const prompt = await readStdin();

  return {
    mode,
    sessionId,
    usesLast,
    outputPath,
    prompt,
    args: argv,
    cwd: process.cwd(),
    hasConfigOverride
  };
}

function validateInvocation(expected, invocation, runtimeState) {
  if (expected.mode !== invocation.mode) {
    throw new Error(`期望 mode=${expected.mode}，实际=${invocation.mode}`);
  }

  if (expected.resumeTarget === 'session') {
    if (invocation.sessionId !== expected.sessionId) {
      throw new Error(
        `期望 resume sessionId=${expected.sessionId}，实际=${invocation.sessionId ?? '<empty>'}`
      );
    }
  }

  if (expected.resumeTarget === 'last') {
    if (!invocation.usesLast) {
      throw new Error('期望使用 --last 恢复，但未收到 --last。');
    }

    if (!runtimeState.latestSessionId && expected.mode === 'resume') {
      throw new Error('期望 --last 恢复，但 runtimeState 中没有 latestSessionId。');
    }
  }

  for (const needle of expected.promptIncludes ?? []) {
    if (!invocation.prompt.includes(needle)) {
      throw new Error(`prompt 中缺少预期内容：${needle}`);
    }
  }

  if (invocation.hasConfigOverride) {
    throw new Error('当前测试要求 CLI 不显式覆盖 Codex 默认 config.toml。');
  }
}

function validateGoalAssertions(goal, invocation) {
  if (!goal) {
    return;
  }

  const requiredNeedles =
    invocation.mode === 'initial'
      ? (goal.initialPromptIncludes ?? [])
      : (goal.resumePromptIncludes ?? []);

  for (const needle of requiredNeedles) {
    if (!invocation.prompt.includes(needle)) {
      throw new Error(`goal contract 断言失败，prompt 中缺少：${needle}`);
    }
  }
}

function createCompletionMessage(prompt) {
  const match = prompt.match(/nonce `([^`]+)`; line 2 = `([^`]+)`\./);

  if (!match) {
    throw new Error('无法从 prompt 中提取完成协议。');
  }

  const [, nonce, confirmText] = match;
  const doneToken = nonce.split('-').reverse().join('-');

  return `${doneToken}\n${confirmText}`;
}

async function loadRuntimeState(runtimeStatePath) {
  try {
    await stat(runtimeStatePath);
  } catch (error) {
    if (isFileMissingError(error)) {
      return {
        nextStepIndex: 0,
        latestSessionId: null
      };
    }

    throw error;
  }

  return JSON.parse(await readFile(runtimeStatePath, 'utf8'));
}

async function readStdin() {
  let content = '';

  for await (const chunk of process.stdin) {
    content += chunk;
  }

  return content;
}

function isFileMissingError(error) {
  return Boolean(error && typeof error === 'object' && error.code === 'ENOENT');
}
