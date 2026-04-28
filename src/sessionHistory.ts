import * as vscode from 'vscode';

import type { PlanningAssumption, PlanningQuestion } from './aiClient';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const SESSIONS_DIRECTORY = '.ai-sessions';
const SESSION_FILE_LIMIT = 50;
const SESSION_TITLE_LIMIT = 30;
const GITIGNORE_ENTRY = '.ai-sessions/';

export type AgentSessionMessageRole = 'user' | 'agent';
export type AgentSessionMessageType = 'text' | 'planning' | 'result' | 'status' | 'error';

export interface AgentSessionChoice {
  questionId: string;
  topic: string;
  choiceType: 'A' | 'B' | 'C' | 'D' | 'custom';
  selectedLabel: string;
  userChoice: string;
}

export interface AgentSessionPlanningPayload {
  summary: string;
  assumptions: string[];
  assumption_log?: PlanningAssumption[];
  questions: PlanningQuestion[];
  userChoices: AgentSessionChoice[];
}

export interface AgentSessionResultPayload {
  currentWork: string;
  summary: string;
  generatedFiles: Array<{ path: string; description: string }>;
  runInstructions: string[];
  guidePath: string;
  verificationSummary: string;
  verificationResults: Array<{
    label: string;
    command: string;
    available?: boolean;
    ok: boolean;
    timedOut: boolean;
    exitCode: number | null;
    output: string;
    status?: string;
  }>;
  autoRepairApplied: boolean;
  repairFailureMessage: string;
  manualVerificationAvailable: boolean;
}

export interface AgentSessionStatusPayload {
  phaseLabel: string;
}

export interface AgentSessionMessage {
  requestId?: string;
  role: AgentSessionMessageRole;
  type: AgentSessionMessageType;
  content: string;
  timestamp: string;
  planning?: AgentSessionPlanningPayload;
  result?: AgentSessionResultPayload;
  status?: AgentSessionStatusPayload;
}

export interface PersistedAgentSession {
  fileName: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  messages: AgentSessionMessage[];
}

export interface AgentSessionSummary {
  id: string;
  title: string;
  startedAt: string;
  updatedAt: string;
}

export class SessionHistoryService {
  public constructor(private readonly getWorkspaceRootUri: () => vscode.Uri | undefined) {}

  public createSession(firstRequest: string): PersistedAgentSession {
    const now = new Date().toISOString();
    return {
      fileName: '',
      title: buildSessionTitle(firstRequest),
      startedAt: now,
      updatedAt: now,
      messages: []
    };
  }

  public async saveSession(session: PersistedAgentSession): Promise<PersistedAgentSession | undefined> {
    const sessionsDir = await this.ensureSessionsDirectory();
    if (!sessionsDir) {
      return undefined;
    }

    const nextSession: PersistedAgentSession = {
      ...session,
      fileName: session.fileName || (await this.ensureUniqueFileName(sessionsDir, session.startedAt, session.title)),
      updatedAt: new Date().toISOString(),
      messages: session.messages.map((message) => ({
        ...message,
        planning: message.planning
          ? {
              summary: message.planning.summary,
              assumptions: [...message.planning.assumptions],
              assumption_log: message.planning.assumption_log?.map((assumption) => ({
                ...assumption,
                risk_categories: [...assumption.risk_categories]
              })),
              questions: message.planning.questions.map((question) => ({
                ...question,
                options: question.options.map((option) => ({
                  ...option,
                  pros: [...option.pros],
                  cons: [...option.cons]
                })),
                optionA: {
                  ...question.optionA,
                  pros: [...question.optionA.pros],
                  cons: [...question.optionA.cons]
                },
                optionB: {
                  ...question.optionB,
                  pros: [...question.optionB.pros],
                  cons: [...question.optionB.cons]
                }
              })),
              userChoices: message.planning.userChoices.map((choice) => ({ ...choice }))
            }
          : undefined,
        result: message.result
          ? {
              currentWork: message.result.currentWork,
              summary: message.result.summary,
              generatedFiles: message.result.generatedFiles.map((file) => ({ ...file })),
              runInstructions: [...message.result.runInstructions],
              guidePath: message.result.guidePath,
              verificationSummary: message.result.verificationSummary,
              verificationResults: message.result.verificationResults.map((result) => ({ ...result })),
              autoRepairApplied: message.result.autoRepairApplied,
              repairFailureMessage: message.result.repairFailureMessage,
              manualVerificationAvailable: message.result.manualVerificationAvailable
            }
          : undefined,
        status: message.status ? { ...message.status } : undefined
      }))
    };

    const targetUri = vscode.Uri.joinPath(sessionsDir, nextSession.fileName);
    await vscode.workspace.fs.writeFile(targetUri, textEncoder.encode(JSON.stringify(nextSession, null, 2)));
    await this.pruneSessions(sessionsDir);
    return nextSession;
  }

  public async listSessions(): Promise<AgentSessionSummary[]> {
    const sessionsDir = this.getSessionsDirectoryUri();
    if (!sessionsDir) {
      return [];
    }

    let entries: Array<[string, vscode.FileType]>;
    try {
      entries = await vscode.workspace.fs.readDirectory(sessionsDir);
    } catch {
      return [];
    }

    const sessions = await Promise.all(
      entries
        .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
        .map(async ([name]) => this.loadSession(name))
    );

    return sessions
      .filter((session): session is PersistedAgentSession => Boolean(session))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session) => ({
        id: session.fileName,
        title: session.title,
        startedAt: session.startedAt,
        updatedAt: session.updatedAt
      }));
  }

  public async loadSession(id: string): Promise<PersistedAgentSession | undefined> {
    const sessionsDir = this.getSessionsDirectoryUri();
    if (!sessionsDir) {
      return undefined;
    }

    const targetUri = vscode.Uri.joinPath(sessionsDir, id);
    try {
      const raw = textDecoder.decode(await vscode.workspace.fs.readFile(targetUri));
      const parsed = JSON.parse(raw) as Partial<PersistedAgentSession>;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.messages)) {
        return undefined;
      }

      return {
        fileName: typeof parsed.fileName === 'string' && parsed.fileName.trim() ? parsed.fileName : id,
        title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : '세션',
        startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date(0).toISOString(),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date(0).toISOString(),
        messages: parsed.messages.map(normalizeSessionMessage).filter((message): message is AgentSessionMessage => Boolean(message))
      };
    } catch {
      return undefined;
    }
  }

  public async loadLatestTodaySession(): Promise<PersistedAgentSession | undefined> {
    const sessions = await this.listSessions();
    const today = formatLocalDayKey(new Date());
    const latestToday = sessions.find((session) => formatLocalDayKey(new Date(session.startedAt)) === today);
    if (!latestToday) {
      return undefined;
    }
    return this.loadSession(latestToday.id);
  }

  public async loadLatestSession(): Promise<PersistedAgentSession | undefined> {
    const sessions = await this.listSessions();
    const latest = sessions[0];
    if (!latest) {
      return undefined;
    }
    return this.loadSession(latest.id);
  }

  public buildResumeContext(session: PersistedAgentSession): string {
    const lastUserRequest = [...session.messages]
      .reverse()
      .find((message) => message.role === 'user' && message.type === 'text')
      ?.content.trim();

    const lastPlanning = [...session.messages]
      .reverse()
      .find((message) => message.type === 'planning')
      ?.planning;

    const decisionSummary = lastPlanning && lastPlanning.userChoices.length > 0
      ? lastPlanning.userChoices.map((choice) => `${choice.topic}: ${choice.selectedLabel}`).join(', ')
      : '확정된 판단 없음';

    const lastResult = [...session.messages]
      .reverse()
      .find((message) => message.type === 'result')
      ?.result;
    const lastError = [...session.messages]
      .reverse()
      .find((message) => message.type === 'error')
      ?.content.trim();

    const buildSummary = lastResult
      ? [lastResult.generatedFiles.length > 0 ? `${lastResult.generatedFiles.length}개 파일 생성` : '', lastResult.verificationSummary]
          .filter(Boolean)
          .join(', ')
      : lastError || '아직 구현 결과 없음';

    return `이전 세션 요약: ${lastUserRequest || session.title} → ${decisionSummary} → ${buildSummary}`;
  }

  private getSessionsDirectoryUri(): vscode.Uri | undefined {
    const workspaceRoot = this.getWorkspaceRootUri();
    return workspaceRoot ? vscode.Uri.joinPath(workspaceRoot, SESSIONS_DIRECTORY) : undefined;
  }

  private async ensureSessionsDirectory(): Promise<vscode.Uri | undefined> {
    const workspaceRoot = this.getWorkspaceRootUri();
    if (!workspaceRoot) {
      return undefined;
    }

    const sessionsDir = vscode.Uri.joinPath(workspaceRoot, SESSIONS_DIRECTORY);
    await vscode.workspace.fs.createDirectory(sessionsDir);
    await this.ensureGitignoreEntry(workspaceRoot);
    return sessionsDir;
  }

  private async ensureGitignoreEntry(workspaceRoot: vscode.Uri): Promise<void> {
    const gitignoreUri = vscode.Uri.joinPath(workspaceRoot, '.gitignore');
    let existing = '';

    try {
      existing = textDecoder.decode(await vscode.workspace.fs.readFile(gitignoreUri));
    } catch {
      existing = '';
    }

    const normalizedLines = existing.split(/\r?\n/).map((line) => line.trim());
    if (normalizedLines.includes(GITIGNORE_ENTRY)) {
      return;
    }

    const nextContent = existing.trim().length > 0
      ? `${existing.trimEnd()}\n${GITIGNORE_ENTRY}\n`
      : `${GITIGNORE_ENTRY}\n`;
    await vscode.workspace.fs.writeFile(gitignoreUri, textEncoder.encode(nextContent));
  }

  private async ensureUniqueFileName(
    sessionsDir: vscode.Uri,
    startedAt: string,
    title: string
  ): Promise<string> {
    const baseName = `${formatFileTimestamp(new Date(startedAt))}-${sanitizeFileFragment(title)}`;
    let index = 0;

    while (true) {
      const candidate = `${baseName}${index === 0 ? '' : `-${index + 1}`}.json`;
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(sessionsDir, candidate));
        index += 1;
      } catch {
        return candidate;
      }
    }
  }

  private async pruneSessions(sessionsDir: vscode.Uri): Promise<void> {
    const summaries = await this.listSessions();
    if (summaries.length <= SESSION_FILE_LIMIT) {
      return;
    }

    const staleSessions = summaries.slice(SESSION_FILE_LIMIT);
    await Promise.all(
      staleSessions.map((session) =>
        vscode.workspace.fs.delete(vscode.Uri.joinPath(sessionsDir, session.id), { useTrash: false })
      )
    );
  }
}

function normalizeSessionMessage(value: unknown): AgentSessionMessage | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const role = record.role === 'user' || record.role === 'agent' ? record.role : undefined;
  const type = isMessageType(record.type) ? record.type : undefined;
  const timestamp = typeof record.timestamp === 'string' ? record.timestamp : new Date(0).toISOString();
  if (!role || !type) {
    return undefined;
  }

  return {
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    role,
    type,
    content: typeof record.content === 'string' ? record.content : '',
    timestamp,
    planning: normalizePlanningPayload(record.planning),
    result: normalizeResultPayload(record.result),
    status: normalizeStatusPayload(record.status)
  };
}

function normalizePlanningPayload(value: unknown): AgentSessionPlanningPayload | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.summary !== 'string' || !Array.isArray(record.assumptions) || !Array.isArray(record.questions)) {
    return undefined;
  }

  const questions = record.questions.filter(isPlanningQuestion).map((question) => ({
    ...question,
    options: (Array.isArray(question.options) ? question.options : [question.optionA, question.optionB].filter(isDecisionOption)).map((option) => ({
      ...option,
      pros: [...option.pros],
      cons: [...option.cons]
    })),
    optionA: {
      ...question.optionA,
      pros: [...question.optionA.pros],
      cons: [...question.optionA.cons]
    },
    optionB: {
      ...question.optionB,
      pros: [...question.optionB.pros],
      cons: [...question.optionB.cons]
    }
  }));
  const userChoices = Array.isArray(record.userChoices)
    ? record.userChoices
        .filter((choice): choice is AgentSessionChoice => isAgentSessionChoice(choice))
        .map((choice) => ({ ...choice }))
    : [];

  return {
    summary: record.summary,
    assumptions: record.assumptions.filter((item): item is string => typeof item === 'string'),
    assumption_log: Array.isArray(record.assumption_log)
      ? record.assumption_log.filter(isPlanningAssumption).map((assumption) => ({
          ...assumption,
          risk_categories: [...assumption.risk_categories]
        }))
      : undefined,
    questions,
    userChoices
  };
}

function normalizeResultPayload(value: unknown): AgentSessionResultPayload | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.generatedFiles)
    || !Array.isArray(record.runInstructions)
    || typeof record.currentWork !== 'string'
    || typeof record.summary !== 'string'
    || typeof record.guidePath !== 'string'
    || typeof record.verificationSummary !== 'string'
    || !Array.isArray(record.verificationResults)
    || typeof record.autoRepairApplied !== 'boolean'
    || typeof record.repairFailureMessage !== 'string'
    || typeof record.manualVerificationAvailable !== 'boolean'
  ) {
    return undefined;
  }

  return {
    currentWork: record.currentWork,
    summary: record.summary,
    generatedFiles: record.generatedFiles
      .filter(
        (file): file is { path: string; description: string } =>
          Boolean(file)
          && typeof file === 'object'
          && typeof (file as { path?: unknown }).path === 'string'
          && typeof (file as { description?: unknown }).description === 'string'
      )
      .map((file) => ({ ...file })),
    runInstructions: record.runInstructions.filter((item): item is string => typeof item === 'string'),
    guidePath: record.guidePath,
    verificationSummary: record.verificationSummary,
    verificationResults: record.verificationResults
      .filter(
        (result): result is {
          label: string;
          command: string;
          available?: boolean;
          ok: boolean;
          timedOut: boolean;
          exitCode: number | null;
          output: string;
          status?: string;
        } =>
          Boolean(result)
          && typeof result === 'object'
          && typeof (result as { label?: unknown }).label === 'string'
          && typeof (result as { command?: unknown }).command === 'string'
          && typeof (result as { ok?: unknown }).ok === 'boolean'
          && typeof (result as { timedOut?: unknown }).timedOut === 'boolean'
          && (typeof (result as { exitCode?: unknown }).exitCode === 'number'
            || (result as { exitCode?: unknown }).exitCode === null)
          && typeof (result as { output?: unknown }).output === 'string'
      )
      .map((result) => ({ ...result })),
    autoRepairApplied: record.autoRepairApplied,
    repairFailureMessage: record.repairFailureMessage,
    manualVerificationAvailable: record.manualVerificationAvailable
  };
}

function normalizeStatusPayload(value: unknown): AgentSessionStatusPayload | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.phaseLabel !== 'string') {
    return undefined;
  }

  return { phaseLabel: record.phaseLabel };
}

function isPlanningQuestion(value: unknown): value is PlanningQuestion {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  const hasOptions = Array.isArray(record.options) && record.options.every((item) => isDecisionOption(item));
  const hasLegacyOptions = isDecisionOption(record.optionA) && isDecisionOption(record.optionB);
  return typeof record.id === 'string'
    && (record.impact === 'HIGH' || record.impact === 'MEDIUM' || record.impact === 'LOW')
    && typeof record.topic === 'string'
    && typeof record.question === 'string'
    && (hasOptions || hasLegacyOptions)
    && (record.human_review_level === undefined
      || record.human_review_level === 'REVIEW_REQUIRED'
      || record.human_review_level === 'REVIEW_RECOMMENDED'
      || record.human_review_level === 'AUTO_WITH_LOG')
    && (record.review_categories === undefined || Array.isArray(record.review_categories))
    && (record.related_files === undefined || Array.isArray(record.related_files))
    && (record.target_files === undefined || Array.isArray(record.target_files))
    && (record.can_auto_apply === undefined || typeof record.can_auto_apply === 'boolean')
    && typeof record.reason === 'string'
    && typeof record.default_if_skipped === 'string'
    && typeof record.risk_if_wrong === 'string'
    && Array.isArray(record.risk_categories)
    && record.risk_categories.every((item) => typeof item === 'string');
}

function isPlanningAssumption(value: unknown): value is PlanningAssumption {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.topic === 'string'
    && typeof record.default_value === 'string'
    && typeof record.reason === 'string'
    && (record.human_review_level === undefined
      || record.human_review_level === 'REVIEW_REQUIRED'
      || record.human_review_level === 'REVIEW_RECOMMENDED'
      || record.human_review_level === 'AUTO_WITH_LOG')
    && (record.review_categories === undefined || Array.isArray(record.review_categories))
    && Array.isArray(record.risk_categories)
    && record.risk_categories.every((item) => typeof item === 'string')
    && (record.related_files === undefined || Array.isArray(record.related_files))
    && (record.can_auto_apply === undefined || typeof record.can_auto_apply === 'boolean')
    && typeof record.source === 'string';
}

function isDecisionOption(value: unknown): value is PlanningQuestion['optionA'] {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.label === 'string'
    && Array.isArray(record.pros)
    && record.pros.every((item) => typeof item === 'string')
    && Array.isArray(record.cons)
    && record.cons.every((item) => typeof item === 'string');
}

function isAgentSessionChoice(value: unknown): value is AgentSessionChoice {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.questionId === 'string'
    && typeof record.topic === 'string'
    && (record.choiceType === 'A' || record.choiceType === 'B' || record.choiceType === 'C' || record.choiceType === 'D' || record.choiceType === 'custom')
    && typeof record.selectedLabel === 'string'
    && typeof record.userChoice === 'string';
}

function isMessageType(value: unknown): value is AgentSessionMessageType {
  return value === 'text' || value === 'planning' || value === 'result' || value === 'status' || value === 'error';
}

function buildSessionTitle(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.slice(0, SESSION_TITLE_LIMIT) || '새 세션';
}

function sanitizeFileFragment(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return sanitized || 'session';
}

function formatFileTimestamp(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-')
    + '-'
    + [pad(date.getHours()), pad(date.getMinutes())].join('-');
}

function formatLocalDayKey(date: Date): string {
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
