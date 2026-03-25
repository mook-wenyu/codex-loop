import type { FailureKind } from './failure-taxonomy.js';

export interface GoalLedgerSnapshot {
  readonly completedItems: readonly string[];
  readonly pendingItems: readonly string[];
  readonly blockedItems: readonly string[];
  readonly evidenceSummary: readonly string[];
  readonly updatedAt?: string;
}

const MAX_ITEMS_PER_SECTION = 6;

export function createEmptyGoalLedger(): GoalLedgerSnapshot {
  return {
    completedItems: [],
    pendingItems: [],
    blockedItems: [],
    evidenceSummary: []
  };
}

export function renderGoalLedgerBlock(
  ledger: GoalLedgerSnapshot | undefined
): string {
  const snapshot = ledger ?? createEmptyGoalLedger();

  return [
    'Goal ledger (derived working memory only; the original user request remains authoritative):',
    'Completed items:',
    ...renderSection(snapshot.completedItems),
    'Pending items:',
    ...renderSection(snapshot.pendingItems),
    'Blocked items:',
    ...renderSection(snapshot.blockedItems),
    'Evidence summary:',
    ...renderSection(snapshot.evidenceSummary)
  ].join('\n');
}

export function updateGoalLedger(input: {
  readonly previous?: GoalLedgerSnapshot;
  readonly assistantMessage: string | null;
  readonly completionSatisfied: boolean;
  readonly failureKind?: FailureKind;
  readonly failureSummary?: string;
}): GoalLedgerSnapshot {
  const previous = input.previous ?? createEmptyGoalLedger();
  const parsed = parseAssistantMessage(input.assistantMessage);
  const completedItems = mergeSection(
    previous.completedItems,
    parsed.completedItems
  );
  const pendingSeed = mergeSection(previous.pendingItems, parsed.pendingItems);
  const blockedSeed = mergeSection(previous.blockedItems, parsed.blockedItems);
  const evidenceSummary = mergeSection(
    previous.evidenceSummary,
    buildEvidenceEntries({
      assistantMessage: input.assistantMessage,
      ...(input.failureSummary === undefined
        ? {}
        : { failureSummary: input.failureSummary })
    })
  );

  const blockedFromFailure = buildBlockedItemsFromFailure(input.failureKind);
  const blockedItems = mergeSection(blockedSeed, blockedFromFailure).filter(
    (item) => !completedItems.includes(item)
  );

  const pendingItems =
    pendingSeed.length > 0
      ? pendingSeed.filter((item) => !completedItems.includes(item))
      : input.completionSatisfied
        ? []
        : ['继续完成原始用户请求，当前仍未满足最终完成条件。'];

  return {
    completedItems,
    pendingItems,
    blockedItems,
    evidenceSummary
  };
}

function renderSection(items: readonly string[]): string[] {
  if (items.length === 0) {
    return ['- none'];
  }

  return items.map((item, index) => `${index + 1}. ${item}`);
}

function parseAssistantMessage(message: string | null): {
  completedItems: string[];
  pendingItems: string[];
  blockedItems: string[];
} {
  if (message === null) {
    return {
      completedItems: [],
      pendingItems: [],
      blockedItems: []
    };
  }

  const completedItems: string[] = [];
  const pendingItems: string[] = [];
  const blockedItems: string[] = [];
  let currentSection: 'completed' | 'pending' | 'blocked' | undefined;

  for (const rawLine of message.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.length === 0) {
      continue;
    }

    const section = detectSection(line);

    if (section !== undefined) {
      currentSection = section;
      continue;
    }

    const checklistItem = parseChecklistItem(line);

    if (checklistItem !== undefined) {
      if (checklistItem.section === 'completed') {
        completedItems.push(checklistItem.text);
      } else {
        pendingItems.push(checklistItem.text);
      }
      continue;
    }

    const listItem = parseListItem(line);

    if (listItem !== undefined && currentSection !== undefined) {
      if (currentSection === 'completed') {
        completedItems.push(listItem);
      }

      if (currentSection === 'pending') {
        pendingItems.push(listItem);
      }

      if (currentSection === 'blocked') {
        blockedItems.push(listItem);
      }
    }
  }

  return {
    completedItems: uniqueNormalized(completedItems),
    pendingItems: uniqueNormalized(pendingItems),
    blockedItems: uniqueNormalized(blockedItems)
  };
}

function detectSection(
  line: string
): 'completed' | 'pending' | 'blocked' | undefined {
  const normalized = line
    .replace(/[：:]+$/u, '')
    .trim()
    .toLowerCase();

  if (
    normalized === '已完成' ||
    normalized === 'completed' ||
    normalized === 'done'
  ) {
    return 'completed';
  }

  if (
    normalized === '未完成' ||
    normalized === '待完成' ||
    normalized === 'pending' ||
    normalized === 'todo'
  ) {
    return 'pending';
  }

  if (
    normalized === '阻塞项' ||
    normalized === '阻塞' ||
    normalized === 'blocked' ||
    normalized === 'blockers'
  ) {
    return 'blocked';
  }

  return undefined;
}

function parseChecklistItem(
  line: string
): { section: 'completed' | 'pending'; text: string } | undefined {
  const matched = line.match(/^[-*]\s*\[(x|X| )\]\s*(.+)$/u);

  if (matched === null) {
    return undefined;
  }

  const marker = matched[1];
  const rawText = matched[2];

  if (marker === undefined || rawText === undefined) {
    return undefined;
  }

  const text = normalizeItemText(rawText);

  if (text.length === 0) {
    return undefined;
  }

  return {
    section: marker.toLowerCase() === 'x' ? 'completed' : 'pending',
    text
  };
}

function parseListItem(line: string): string | undefined {
  const matched = line.match(/^(?:[-*]|\d+\.)\s*(.+)$/u);

  if (matched === null) {
    return undefined;
  }

  const rawText = matched[1];

  if (rawText === undefined) {
    return undefined;
  }

  const text = normalizeItemText(rawText);
  return text.length === 0 ? undefined : text;
}

function buildBlockedItemsFromFailure(
  failureKind: FailureKind | undefined
): string[] {
  if (failureKind === 'completion-review-required') {
    return ['已触发完成审查轮次，下一轮必须重新核对原始目标与当前状态。'];
  }

  if (failureKind === 'execution-failed') {
    return ['上一轮执行异常退出，需要从当前仓库状态继续恢复。'];
  }

  return [];
}

function buildEvidenceEntries(input: {
  readonly assistantMessage: string | null;
  readonly failureSummary?: string;
}): string[] {
  const items: string[] = [];

  if (input.assistantMessage !== null) {
    const snippet = summarizeText(input.assistantMessage);

    if (snippet.length > 0) {
      items.push(snippet);
    }
  }

  if (input.failureSummary !== undefined) {
    const snippet = summarizeText(input.failureSummary);

    if (snippet.length > 0) {
      items.push(snippet);
    }
  }

  return uniqueNormalized(items);
}

function summarizeText(text: string): string {
  const summary = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 3)
    .join(' / ');

  return summary.slice(0, 240);
}

function mergeSection(
  existing: readonly string[],
  incoming: readonly string[]
): string[] {
  return uniqueNormalized([...existing, ...incoming]).slice(
    0,
    MAX_ITEMS_PER_SECTION
  );
}

function uniqueNormalized(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const normalized = normalizeItemText(item);

    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeItemText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}
