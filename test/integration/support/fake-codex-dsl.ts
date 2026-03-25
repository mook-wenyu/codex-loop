export interface FakeCodexGoalAssertions {
  readonly initialPromptIncludes?: readonly string[];
  readonly resumePromptIncludes?: readonly string[];
}

export interface FakeCodexScenario {
  readonly goal?: FakeCodexGoalAssertions;
  readonly promptFileText?: string;
  readonly steps: readonly FakeCodexStep[];
}

export interface FakeCodexStep {
  readonly expected: {
    readonly mode: 'initial' | 'resume';
    readonly resumeTarget?: 'session' | 'last';
    readonly sessionId?: string;
    readonly promptIncludes?: readonly string[];
  };
  readonly response: {
    readonly exitCode?: number;
    readonly lastMessage?: string;
    readonly completionProtocol?: boolean;
    readonly sessionId?: string;
    readonly recordedSessionId?: string;
  };
}

export function defineFakeCodexScenario(
  scenario: FakeCodexScenario
): FakeCodexScenario {
  return scenario;
}

export function goalContract(
  assertions: FakeCodexGoalAssertions
): FakeCodexGoalAssertions {
  return assertions;
}

export function initialStep(
  response: FakeCodexStep['response'],
  promptIncludes?: readonly string[]
): FakeCodexStep {
  return {
    expected: {
      mode: 'initial',
      ...(promptIncludes === undefined ? {} : { promptIncludes })
    },
    response
  };
}

export function resumeWithSessionStep(
  sessionId: string,
  response: FakeCodexStep['response'],
  promptIncludes?: readonly string[]
): FakeCodexStep {
  return {
    expected: {
      mode: 'resume',
      resumeTarget: 'session',
      sessionId,
      ...(promptIncludes === undefined ? {} : { promptIncludes })
    },
    response
  };
}

export function resumeWithLastStep(
  response: FakeCodexStep['response'],
  promptIncludes?: readonly string[]
): FakeCodexStep {
  return {
    expected: {
      mode: 'resume',
      resumeTarget: 'last',
      ...(promptIncludes === undefined ? {} : { promptIncludes })
    },
    response
  };
}

export function incompleteResponse(input: {
  readonly exitCode?: number;
  readonly lastMessage: string;
  readonly sessionId?: string;
  readonly recordedSessionId?: string;
}): FakeCodexStep['response'] {
  return {
    lastMessage: input.lastMessage,
    ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(input.recordedSessionId === undefined
      ? {}
      : { recordedSessionId: input.recordedSessionId })
  };
}

export function recordSessionOnly(input: {
  readonly recordedSessionId: string;
  readonly lastMessage: string;
  readonly exitCode?: number;
}): FakeCodexStep['response'] {
  return incompleteResponse({
    recordedSessionId: input.recordedSessionId,
    lastMessage: input.lastMessage,
    ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode })
  });
}

export function completeFromProtocol(input: {
  readonly exitCode?: number;
  readonly sessionId?: string;
} = {}): FakeCodexStep['response'] {
  return {
    completionProtocol: true,
    ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId })
  };
}
