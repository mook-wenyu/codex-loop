#!/usr/bin/env node

import { MaxAttemptsExceededError } from './application/supervisor.js';
import { runCli } from './cli-app.js';

async function main(): Promise<void> {
  try {
    const exitCode = await runCli();
    process.exitCode = exitCode;
  } catch (error) {
    if (error instanceof MaxAttemptsExceededError) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }

    const message =
      error instanceof Error ? error.message : '出现未知错误。';
    console.error(message);
    process.exitCode = 1;
  }
}

await main();
