import type { CodexExecutionRequest } from '../../application/types.js';

export interface CodexCommandBuilderOptions {
  readonly codexBin: string;
  readonly model?: string;
  readonly fullAuto: boolean;
  readonly dangerouslyBypass: boolean;
  readonly skipGitRepoCheck: boolean;
}

export interface BuiltCodexCommand {
  readonly command: string;
  readonly args: string[];
  readonly input: string;
}

export function buildCodexCommand(
  options: CodexCommandBuilderOptions,
  request: CodexExecutionRequest
): BuiltCodexCommand {
  const args =
    request.mode === 'initial'
      ? ['exec']
      : ['exec', 'resume'];

  args.push('--json', '-o', request.outputLastMessagePath);

  if (options.dangerouslyBypass) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else if (options.fullAuto) {
    args.push('--full-auto');
  }

  if (options.skipGitRepoCheck) {
    args.push('--skip-git-repo-check');
  }

  if (options.model !== undefined) {
    args.push('-m', options.model);
  }

  if (request.mode === 'resume') {
    if (request.sessionId !== undefined) {
      args.push(request.sessionId);
    } else {
      args.push('--last');
    }
  }

  args.push('-');

  return {
    command: options.codexBin,
    args,
    input: request.prompt
  };
}
