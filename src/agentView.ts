import * as vscode from 'vscode';

import {
  AIClient,
  DecisionHistoryEntry,
  ImplementationFile,
  ImplementationResponse,
  PlanningAssumption,
  PlanningQuestion,
  PlanningResponse
} from './aiClient';
import { WorkspaceContextService } from './context/WorkspaceContextService';
import { DEMO_PLANNING_RESPONSE, DEMO_TASK, DEMO_TUTORIAL_MARKDOWN } from './demoSeed';
import { DecisionLogEntryInput, LogManager } from './logManager';
import {
  AgentSessionChoice,
  AgentSessionMessage,
  PersistedAgentSession,
  SessionHistoryService
} from './sessionHistory';
import {
  VerificationCommand,
  VerificationResult,
  VerificationService
} from './verification/VerificationService';

interface SubmitTaskMessage {
  type: 'submitTask';
  requestId: string;
  task: string;
}

interface StartImplementationAnswer {
  questionId: string;
  choiceType: 'A' | 'B' | 'C' | 'D' | 'custom';
  customChoice?: string;
}

interface StartImplementationMessage {
  type: 'startImplementation';
  requestId: string;
  answers: StartImplementationAnswer[];
}

interface UpdatePlanningAnswersMessage {
  type: 'updatePlanningAnswers';
  requestId: string;
  answers: StartImplementationAnswer[];
}

interface NewSessionMessage {
  type: 'newSession';
}

interface RunDemoSeedMessage {
  type: 'runDemoSeed';
}

interface RetryVerificationMessage {
  type: 'retryVerification';
  requestId: string;
}

type ProgressEventType =
  | 'file_start'
  | 'file_done'
  | 'file_edit'
  | 'verify_start'
  | 'verify_done'
  | 'repair_start'
  | 'log_done'
  | 'agent_updated';

interface ProgressMessage {
  type: 'progress';
  requestId: string;
  event: ProgressEventType;
  filename?: string;
  lineCount?: number;
  summary?: string;
  command?: string;
  passed?: boolean;
  output?: string;
}

interface OpenHistorySessionMessage {
  type: 'openHistorySession';
  sessionId: string;
}

interface ResumeHistorySessionMessage {
  type: 'resumeHistorySession';
  sessionId: string;
}

type AgentPhase = 'planning' | 'decision' | 'implementation' | 'verification' | 'complete';

type AgentViewMessage =
  | SubmitTaskMessage
  | UpdatePlanningAnswersMessage
  | StartImplementationMessage
  | RetryVerificationMessage
  | OpenHistorySessionMessage
  | ResumeHistorySessionMessage
  | NewSessionMessage
  | RunDemoSeedMessage
  | { type: 'ready' };

interface PendingPlanningSession {
  task: string;
  plan: PlanningResponse;
  workspaceContext: string;
}

interface WrittenImplementationFile {
  path: string;
  uri: vscode.Uri;
  overwritten: boolean;
}

interface ImplementationFileSummary {
  path: string;
  description: string;
}

const textEncoder = new TextEncoder();
const WORKSPACE_SNAPSHOT_OPTIONS = {
  maxFiles: 10,
  maxInlineFiles: 4,
  maxFileSize: 20_000,
  maxInlineCharacters: 2_500
} as const;

export class AgentViewController implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly sessions = new Map<string, PendingPlanningSession>();
  private readonly activeRequests = new Map<string, AbortController>();
  private readonly demoRequestIds = new Set<string>();
  private readonly viewDisposables: vscode.Disposable[] = [];
  private currentSession: PersistedAgentSession | undefined;
  private resumeSourceSession: PersistedAgentSession | undefined;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly aiClient: AIClient,
    private readonly logManager: LogManager,
    private readonly workspaceContextService: WorkspaceContextService,
    private readonly verificationService: VerificationService,
    private readonly sessionHistoryService: SessionHistoryService
  ) {}

  public show(): void {
    this.view?.show(false);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeViewDisposables();
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
      ]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage((message: AgentViewMessage) => {
        void this.handleMessage(message);
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!this.view) {
          return;
        }
        if (event.affectsConfiguration('debtcrasher') || event.affectsConfiguration('aiStepDev.questionFilterLevel')) {
          void this.postWorkspaceState();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        if (!this.view) {
          return;
        }
        void this.postWorkspaceState();
      }),
      webviewView.onDidDispose(() => {
        this.disposeViewDisposables();
        if (this.view === webviewView) {
          this.view = undefined;
        }
        this.abortAllRequests();
        this.sessions.clear();
        this.demoRequestIds.clear();
      })
    );
  }

  public dispose(): void {
    this.disposeViewDisposables();
    this.abortAllRequests();
    this.view = undefined;
    this.sessions.clear();
    this.demoRequestIds.clear();
  }

  private disposeViewDisposables(): void {
    while (this.viewDisposables.length > 0) {
      this.viewDisposables.pop()?.dispose();
    }
  }

  private async handleMessage(message: AgentViewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.postBootstrapState({ restoreLatestToday: true, showRestoreBanner: true });
        return;
      case 'newSession':
        this.abortAllRequests();
        this.sessions.clear();
        this.demoRequestIds.clear();
        this.currentSession = undefined;
        this.resumeSourceSession = undefined;
        await this.postBootstrapState({ restoreLatestToday: false, showRestoreBanner: false });
        return;
      case 'runDemoSeed':
        await this.handleRunDemoSeed();
        return;
      case 'submitTask':
        await this.handleSubmitTask(message);
        return;
      case 'startImplementation':
        await this.handleStartImplementation(message);
        return;
      case 'updatePlanningAnswers':
        await this.handleUpdatePlanningAnswers(message);
        return;
      case 'retryVerification':
        await this.handleRetryVerification(message);
        return;
      case 'openHistorySession':
        await this.handleOpenHistorySession(message);
        return;
      case 'resumeHistorySession':
        await this.handleResumeHistorySession(message);
        return;
      default:
        return;
    }
  }

  private async postBootstrapState(options: { restoreLatestToday: boolean; showRestoreBanner: boolean }): Promise<void> {
    const provider = await this.aiClient.getProviderSummary();
    const traceabilityMode = this.aiClient.getTraceabilityMode();
    const sessionSummaries = await this.sessionHistoryService.listSessions();
    let restoredSession: PersistedAgentSession | undefined;

    if (options.restoreLatestToday) {
      restoredSession = await this.sessionHistoryService.loadLatestTodaySession();
      if (!restoredSession) {
        restoredSession = await this.sessionHistoryService.loadLatestSession();
      }
      this.currentSession = restoredSession;
    }

    this.postMessage({
      type: 'workspaceState',
      hasWorkspace: Boolean(this.logManager.getWorkspaceRootUri()),
      provider,
      traceabilityMode,
      sessionSummaries,
      restoredSession: restoredSession ? serializePersistedSession(restoredSession) : undefined,
      restoredBanner: Boolean(restoredSession && options.showRestoreBanner)
    });
  }

  private async postWorkspaceState(): Promise<void> {
    const provider = await this.aiClient.getProviderSummary();
    const traceabilityMode = this.aiClient.getTraceabilityMode();

    this.postMessage({
      type: 'workspaceState',
      hasWorkspace: Boolean(this.logManager.getWorkspaceRootUri()),
      provider,
      traceabilityMode,
      sessionSummaries: await this.sessionHistoryService.listSessions()
    });
  }

  private async handleOpenHistorySession(message: OpenHistorySessionMessage): Promise<void> {
    const session = await this.sessionHistoryService.loadSession(message.sessionId);
    if (!session) {
      this.postError('선택한 작업 기록을 불러오지 못했습니다.');
      return;
    }

    this.postMessage({
      type: 'historySessionResponse',
      session: serializePersistedSession(session)
    });
  }

  private async handleResumeHistorySession(message: ResumeHistorySessionMessage): Promise<void> {
    const session = await this.sessionHistoryService.loadSession(message.sessionId);
    if (!session) {
      this.postError('이어서 개발할 세션을 찾지 못했습니다.');
      return;
    }

    this.abortAllRequests();
    this.sessions.clear();
    this.currentSession = undefined;
    this.resumeSourceSession = session;
    this.postMessage({
      type: 'resumePrepared',
      sessionTitle: session.title
    });
  }

  private async handleRunDemoSeed(): Promise<void> {
    const requestId = `demo-${Date.now().toString()}`;
    const plan = {
      ...DEMO_PLANNING_RESPONSE,
      questions: DEMO_PLANNING_RESPONSE.questions.map((question) => ({
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
        },
        risk_categories: [...question.risk_categories],
        related_files: [...(question.related_files ?? question.target_files ?? [])],
        target_files: [...(question.target_files ?? question.related_files ?? [])]
      })),
      assumptions: [...DEMO_PLANNING_RESPONSE.assumptions],
      assumption_log: DEMO_PLANNING_RESPONSE.assumption_log.map((assumption) => ({
        ...assumption,
        risk_categories: [...assumption.risk_categories]
      }))
    };

    this.sessions.set(requestId, {
      task: DEMO_TASK,
      plan,
      workspaceContext: 'DEMO MODE: 실제 workspace 파일을 읽거나 수정하지 않습니다.'
    });
    this.demoRequestIds.add(requestId);
    this.postPhaseUpdate(requestId, 'DEMO MODE: 실제 파일 변경 없이 Planning Gate → Decision Log → Validation → Tutorial 흐름을 보여줍니다.', 'planning');
    this.postMessage({ type: 'planningResponse', requestId, plan, demoMode: true });
  }

  private async handleSubmitTask(message: SubmitTaskMessage): Promise<void> {
    const task = message.task.trim();
    if (!task) {
      this.postError('질문이나 작업 요청을 입력해 주세요.', message.requestId);
      return;
    }

    try {
      const workspaceRoot = this.logManager.getWorkspaceRootUri();
      if (!workspaceRoot) {
        throw new Error('워크스페이스 폴더가 열려 있어야 구현 파일을 생성할 수 있습니다.');
      }

      const resumeSession = await this.resolveResumeSource(task);
      const resumeContext = resumeSession ? this.sessionHistoryService.buildResumeContext(resumeSession) : '';
      await this.ensureCurrentSession(task);
      await this.appendSessionMessage({
        requestId: message.requestId,
        role: 'user',
        type: 'text',
        content: task,
        timestamp: new Date().toISOString()
      });

      const abortController = this.beginRequest(message.requestId);
      this.postPhaseUpdate(message.requestId, '판단 목록 생성 중...', 'planning');

      const workspaceContext = await this.workspaceContextService.buildWorkspaceSnapshot(
        workspaceRoot,
        {
          ...WORKSPACE_SNAPSHOT_OPTIONS,
          task
        }
      );
      const referenceContext = await this.logManager.readProjectGuideContext();
      const patternContext = await this.logManager.readDecisionPatternContext(task);
      const decisionMemory = await this.logManager.readLogEntries();
      const plan = await this.aiClient.generatePlan(
        task,
        workspaceContext,
        referenceContext,
        patternContext,
        resumeContext,
        decisionMemory,
        abortController.signal
      );

      this.sessions.set(message.requestId, { task, plan, workspaceContext });
      this.resumeSourceSession = undefined;
      await this.appendSessionMessage({
        requestId: message.requestId,
        role: 'agent',
        type: 'planning',
        content: plan.summary || '판단 목록을 생성했습니다.',
        timestamp: new Date().toISOString(),
        planning: {
          summary: plan.summary,
          assumptions: [...plan.assumptions],
          assumption_log: plan.assumption_log.map((assumption) => ({
            ...assumption,
            risk_categories: [...assumption.risk_categories]
          })),
          questions: plan.questions.map((question) => ({
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
          userChoices: []
        }
      });
      this.postMessage({ type: 'planningResponse', requestId: message.requestId, plan });
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      this.postError(toErrorMessage(error), message.requestId);
    } finally {
      this.endRequest(message.requestId);
    }
  }
  private async handleStartImplementation(message: StartImplementationMessage): Promise<void> {
    const session = this.sessions.get(message.requestId);
    if (!session) {
      this.postError('현재 진행 중인 planning 세션을 찾지 못했습니다.', message.requestId);
      return;
    }

    const resolved = resolvePlanAnswers(session.task, session.plan.questions, message.answers, session.plan.assumption_log ?? []);
    if (!resolved) {
      this.postError('모든 질문에 답한 뒤 개발 시작을 눌러 주세요.', message.requestId);
      return;
    }

    try {
      const abortController = this.beginRequest(message.requestId);
      await this.updatePlanningMessageChoices(message.requestId, buildSessionChoices(session.plan.questions, message.answers));
      if (this.demoRequestIds.has(message.requestId)) {
        this.sessions.delete(message.requestId);
        this.demoRequestIds.delete(message.requestId);
        await this.finishDemoTask(message.requestId, resolved.history);
        return;
      }
      this.postPhaseUpdate(
        message.requestId,
        '현재 작업: 선택한 판단을 DECISIONS.md와 AGENT.md에 기록하고 구현을 시작하는 중입니다.',
        'implementation'
      );

      await this.logManager.appendDecisions(resolved.logEntries);
      this.postProgress(message.requestId, 'log_done');
      await this.logManager.syncProjectGuide(session.task);
      this.postProgress(message.requestId, 'agent_updated');

      this.sessions.delete(message.requestId);
      await this.finishTask(
        message.requestId,
        session.task,
        resolved.history,
        session.plan,
        session.workspaceContext,
        resolved.decisionIds,
        abortController.signal
      );
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      this.postError(toErrorMessage(error), message.requestId);
    } finally {
      this.endRequest(message.requestId);
    }
  }

  private async handleUpdatePlanningAnswers(message: UpdatePlanningAnswersMessage): Promise<void> {
    const session = this.sessions.get(message.requestId);
    if (!session) {
      return;
    }

    await this.updatePlanningMessageChoices(message.requestId, buildSessionChoices(session.plan.questions, message.answers));
  }

  private async finishDemoTask(requestId: string, history: DecisionHistoryEntry[]): Promise<void> {
    this.postPhaseUpdate(requestId, 'DEMO MODE: DECISIONS.md preview와 검증 결과를 표시합니다. 실제 파일은 쓰지 않습니다.', 'verification');
    this.postProgress(requestId, 'log_done');
    this.postProgress(requestId, 'verify_done', {
      passed: true,
      output: 'demo validation seed'
    });

    const verificationResults = [
      {
        label: 'typecheck',
        command: 'npm run typecheck',
        available: true,
        ok: true,
        timedOut: false,
        exitCode: 0,
        output: 'demo seed: typecheck passed',
        status: 'passed' as const
      },
      {
        label: 'build',
        command: 'npm run build',
        available: false,
        ok: false,
        timedOut: false,
        exitCode: null,
        output: 'not available',
        status: 'not_available' as const
      },
      {
        label: 'test',
        command: 'npm test',
        available: false,
        ok: false,
        timedOut: false,
        exitCode: null,
        output: 'not available',
        status: 'not_available' as const
      },
      {
        label: 'lint',
        command: 'npm run lint',
        available: false,
        ok: false,
        timedOut: false,
        exitCode: null,
        output: 'not available',
        status: 'not_available' as const
      }
    ];
    const responsePayload = {
      type: 'implementationResponse',
      requestId,
      currentWork: 'DEMO MODE: TODO 저장 기능 sample flow',
      summary: `실제 파일 변경 없이 ${history.length}개 demo 결정을 기준으로 Decision Log, Validation, Tutorial 흐름을 표시했습니다.`,
      files: [
        { path: 'DECISIONS.md (demo preview, not written)', description: '구조화된 decision entry preview' },
        { path: 'src/storage/todoStorage.ts (demo preview, not written)', description: '관련 구현 파일 예시' },
        { path: '.ai-tutorials/todo-storage-demo.md (demo preview, not written)', description: '튜토리얼 seed markdown 예시' }
      ],
      runInstructions: [
        'DEMO MODE: 실제 파일 생성/수정은 수행하지 않았습니다.',
        `Bundled tutorial seed length: ${DEMO_TUTORIAL_MARKDOWN.length} characters`
      ],
      guidePath: 'DECISIONS.md / AGENT.md (demo preview, not written)',
      verificationSummary: 'demo validation seed: typecheck passed, build/test/lint not available.',
      verificationResults: serializeVerificationResults(verificationResults),
      autoRepairApplied: false,
      repairFailureMessage: '',
      manualVerificationAvailable: false
    };
    this.postMessage(responsePayload);
  }

  private async handleRetryVerification(message: RetryVerificationMessage): Promise<void> {
    const requestKey = `retry-verification:${message.requestId}`;

    try {
      const workspaceRoot = this.logManager.getWorkspaceRootUri();
      if (!workspaceRoot) {
        throw new Error('워크스페이스 폴더가 열려 있어야 재검증을 실행할 수 있습니다.');
      }

      const abortController = this.beginRequest(requestKey);
      this.postPhaseUpdate(
        message.requestId,
        '현재 작업: 수동 수정 이후 검증 명령을 다시 실행하는 중입니다.',
        'verification'
      );

      const verificationCommands = await this.verificationService.detectCommands(workspaceRoot);
      if (verificationCommands.length === 0) {
        const retryPayload = {
          type: 'verificationRetryResult',
          requestId: message.requestId,
          verificationSummary: '자동 검증에 사용할 명령을 찾지 못했습니다.',
          verificationResults: [],
          manualVerificationAvailable: false,
          repairFailureMessage: '현재 워크스페이스에서 실행 가능한 검증 명령을 찾지 못했습니다.'
        };
        this.postMessage(retryPayload);
        await this.appendSessionMessage({
          requestId: message.requestId,
          role: 'agent',
          type: 'result',
          content: retryPayload.verificationSummary,
          timestamp: new Date().toISOString(),
          result: {
            currentWork: '재검증 결과',
            summary: retryPayload.verificationSummary,
            generatedFiles: [],
            runInstructions: [],
            guidePath: '',
            verificationSummary: retryPayload.verificationSummary,
            verificationResults: [],
            autoRepairApplied: false,
            repairFailureMessage: retryPayload.repairFailureMessage,
            manualVerificationAvailable: retryPayload.manualVerificationAvailable
          }
        });
        return;
      }

      const verificationResults = await this.runVerificationWithProgress(
        message.requestId,
        workspaceRoot,
        verificationCommands,
        abortController.signal
      );
      const failedCount = verificationResults.filter(isExecutedVerificationFailure).length;

      const retryPayload = {
        type: 'verificationRetryResult',
        requestId: message.requestId,
        verificationSummary:
          failedCount === 0
            ? '수동 수정 후 재검증을 통과했습니다.'
            : `수동 수정 후 재검증에서 ${failedCount}개 명령이 다시 실패했습니다.`,
        verificationResults: serializeVerificationResults(verificationResults),
        manualVerificationAvailable: failedCount > 0,
        repairFailureMessage:
          failedCount > 0 ? '수동 수정 이후에도 실패가 남아 있습니다. 아래 검증 출력을 확인해 주세요.' : ''
      };
      this.postMessage(retryPayload);
      await this.appendSessionMessage({
        requestId: message.requestId,
        role: 'agent',
        type: 'result',
        content: retryPayload.verificationSummary,
        timestamp: new Date().toISOString(),
        result: {
          currentWork: '재검증 결과',
          summary: retryPayload.verificationSummary,
          generatedFiles: [],
          runInstructions: [],
          guidePath: '',
          verificationSummary: retryPayload.verificationSummary,
          verificationResults: retryPayload.verificationResults,
          autoRepairApplied: false,
          repairFailureMessage: retryPayload.repairFailureMessage,
          manualVerificationAvailable: retryPayload.manualVerificationAvailable
        }
      });
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      this.postError(`재검증 중 오류: ${toErrorMessage(error)}`, message.requestId);
    } finally {
      this.endRequest(requestKey);
    }
  }

  private async finishTask(
    requestId: string,
    task: string,
    history: DecisionHistoryEntry[],
    plan: PlanningResponse,
    workspaceContext: string,
    decisionIds: string[],
    abortSignal?: AbortSignal
  ): Promise<void> {
    this.postPhaseUpdate(
      requestId,
      '현재 작업: 계획과 확정된 판단을 기준으로 실제 구현 파일을 생성하는 중입니다.',
      'implementation'
    );

    try {
      const workspaceRoot = this.logManager.getWorkspaceRootUri();
      if (!workspaceRoot) {
        throw new Error('워크스페이스 폴더가 열려 있어야 구현을 시작할 수 있습니다.');
      }

      const referenceContext = await this.logManager.readProjectGuideContext();
      let implementation = await this.aiClient.generateImplementation(
        task,
        history,
        workspaceContext,
        referenceContext,
        plan.assumptions,
        plan.summary,
        abortSignal
      );
      let files = await this.writeImplementationFiles(requestId, implementation.files, 'create');
      let fileSummaries = buildImplementationFileSummaries(implementation.files);
      const verificationCommands = await this.verificationService.detectCommands(workspaceRoot);
      let verificationResults: VerificationResult[] = [];
      let autoRepairApplied = false;
      let repairFailureMessage = '';
      let manualVerificationAvailable = false;

      if (verificationCommands.length > 0) {
        this.postPhaseUpdate(requestId, '현재 작업: 생성한 결과를 검증 명령으로 확인하는 중입니다.', 'verification');
        verificationResults = await this.runVerificationWithProgress(
          requestId,
          workspaceRoot,
          verificationCommands,
          abortSignal
        );

        if (verificationResults.some(isExecutedVerificationFailure)) {
          this.postPhaseUpdate(requestId, '현재 작업: 검증 실패를 바탕으로 자동 수정 중입니다.', 'verification');
          this.postProgress(requestId, 'repair_start');

          const repairWorkspaceContext = await this.workspaceContextService.buildWorkspaceSnapshot(workspaceRoot, {
            ...WORKSPACE_SNAPSHOT_OPTIONS,
            maxFiles: 8,
            maxInlineFiles: 4,
            maxInlineCharacters: 3_000,
            task,
            preferredPaths: files.map((file) => file.path)
          });
          const refreshedReferenceContext = await this.logManager.readProjectGuideContext();
          const repairedImplementation = await this.aiClient.repairImplementation(
            task,
            history,
            repairWorkspaceContext,
            refreshedReferenceContext,
            plan.assumptions,
            plan.summary,
            formatVerificationContext(verificationResults),
            abortSignal
          );

          if (repairedImplementation.files.length > 0) {
            const repairedFiles = await this.writeImplementationFiles(requestId, repairedImplementation.files, 'repair');
            files = mergeWrittenFiles(files, repairedFiles);
            fileSummaries = mergeImplementationFileSummaries(
              fileSummaries,
              buildImplementationFileSummaries(repairedImplementation.files)
            );
            implementation = mergeImplementationResponses(implementation, repairedImplementation);
            autoRepairApplied = true;

            this.postPhaseUpdate(
              requestId,
              '현재 작업: 자동 수정 이후 검증 명령을 다시 실행하는 중입니다.',
              'verification'
            );
            verificationResults = await this.runVerificationWithProgress(
              requestId,
              workspaceRoot,
              verificationCommands,
              abortSignal
            );
          } else {
            repairFailureMessage =
              '자동 수정이 실패를 해결하지 못했습니다. 자동 수정 응답에 변경 파일이 없어 적용할 수 없었습니다. 아래 검증 출력을 확인한 뒤 수동 수정 후 재검증해 주세요.';
            manualVerificationAvailable = true;
            this.postPhaseUpdate(
              requestId,
              '현재 작업: 자동 수정 응답에 변경 파일이 없어 수동 확인이 필요합니다.',
              'verification'
            );
          }
        }
      }

      if (verificationResults.some(isExecutedVerificationFailure)) {
        manualVerificationAvailable = true;
        if (!repairFailureMessage) {
          repairFailureMessage = autoRepairApplied
            ? '자동 수정 1회 후에도 일부 검증이 실패했습니다. 아래 검증 출력을 확인한 뒤 수동 수정 후 재검증해 주세요.'
            : '자동 검증이 실패했습니다. 아래 검증 출력을 확인한 뒤 수동 수정 후 재검증해 주세요.';
        }
      }

      await this.logManager.updateDecisionImplementationMetadata(decisionIds, {
        relatedFiles: files.map((file) => file.path),
        overwrittenFiles: files.filter((file) => file.overwritten).map((file) => file.path),
        validationResult: buildDecisionValidationResult(verificationResults, autoRepairApplied)
      });

      const guideUri = await this.logManager.syncProjectGuide(task, implementation.summary);
      this.postProgress(requestId, 'agent_updated');

      await this.openFirstGeneratedFile(files);

      const responsePayload = {
        type: 'implementationResponse',
        requestId,
        currentWork: implementation.currentWork,
        summary: implementation.summary,
        files: fileSummaries,
        runInstructions: implementation.runInstructions,
        guidePath: guideUri ? vscode.workspace.asRelativePath(guideUri, false) : '',
        verificationSummary: summarizeVerification(verificationResults, autoRepairApplied),
        verificationResults: serializeVerificationResults(verificationResults),
        autoRepairApplied,
        repairFailureMessage,
        manualVerificationAvailable
      };
      this.postMessage(responsePayload);
      await this.appendSessionMessage({
        requestId,
        role: 'agent',
        type: 'result',
        content: implementation.summary,
        timestamp: new Date().toISOString(),
        result: {
          currentWork: implementation.currentWork,
          summary: implementation.summary,
          generatedFiles: fileSummaries.map((file) => ({ ...file })),
          runInstructions: [...implementation.runInstructions],
          guidePath: guideUri ? vscode.workspace.asRelativePath(guideUri, false) : '',
          verificationSummary: responsePayload.verificationSummary,
          verificationResults: responsePayload.verificationResults.map((result) => ({ ...result })),
          autoRepairApplied,
          repairFailureMessage,
          manualVerificationAvailable
        }
      });
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      this.postError(toErrorMessage(error), requestId);
    }
  }

  private async ensureCurrentSession(firstRequest: string): Promise<void> {
    if (this.currentSession) {
      return;
    }

    this.currentSession = this.sessionHistoryService.createSession(firstRequest);
    await this.persistCurrentSession();
  }

  private async appendSessionMessage(message: AgentSessionMessage): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    this.currentSession.messages.push(message);
    await this.persistCurrentSession();
  }

  private async updatePlanningMessageChoices(requestId: string, userChoices: AgentSessionChoice[]): Promise<void> {
    if (!this.currentSession || userChoices.length === 0) {
      return;
    }

    const planningMessage = [...this.currentSession.messages]
      .reverse()
      .find((message) => message.requestId === requestId && message.type === 'planning');

    if (!planningMessage?.planning) {
      return;
    }

    planningMessage.planning = {
      ...planningMessage.planning,
      userChoices: userChoices.map((choice) => ({ ...choice }))
    };
    await this.persistCurrentSession();
  }

  private async persistCurrentSession(): Promise<void> {
    if (!this.currentSession) {
      await this.postSessionListUpdate();
      return;
    }

    const saved = await this.sessionHistoryService.saveSession(this.currentSession);
    if (saved) {
      this.currentSession = saved;
    }
    await this.postSessionListUpdate();
  }

  private async postSessionListUpdate(): Promise<void> {
    this.postMessage({
      type: 'sessionListUpdate',
      sessionSummaries: await this.sessionHistoryService.listSessions()
    });
  }

  private async resolveResumeSource(task: string): Promise<PersistedAgentSession | undefined> {
    if (this.resumeSourceSession) {
      return this.resumeSourceSession;
    }

    if (!containsResumeKeyword(task)) {
      return undefined;
    }

    if (this.currentSession && this.currentSession.messages.length > 0) {
      return this.currentSession;
    }

    return this.sessionHistoryService.loadLatestTodaySession();
  }

  private async runVerificationWithProgress(
    requestId: string,
    workspaceRoot: vscode.Uri,
    commands: VerificationCommand[],
    abortSignal?: AbortSignal
  ): Promise<VerificationResult[]> {
    const results: VerificationResult[] = [];

    for (const command of commands) {
      this.postProgress(requestId, 'verify_start', { command: command.command });
      const [result] = await this.verificationService.runCommands(workspaceRoot, [command], abortSignal);
      if (!result) {
        continue;
      }

      this.postProgress(requestId, 'verify_done', {
        passed: result.ok,
        output: result.output
      });
      results.push(result);
    }

    return results;
  }

  private beginRequest(requestId: string): AbortController {
    this.activeRequests.get(requestId)?.abort();
    const controller = new AbortController();
    this.activeRequests.set(requestId, controller);
    return controller;
  }

  private endRequest(requestId: string): void {
    this.activeRequests.delete(requestId);
  }

  private abortAllRequests(): void {
    for (const controller of this.activeRequests.values()) {
      controller.abort();
    }
    this.activeRequests.clear();
  }

  private async writeImplementationFiles(
    requestId: string,
    files: ImplementationFile[],
    mode: 'create' | 'repair'
  ): Promise<WrittenImplementationFile[]> {
    const workspaceRoot = this.logManager.getWorkspaceRootUri();
    if (!workspaceRoot) {
      throw new Error('워크스페이스 폴더가 열려 있지 않습니다.');
    }
    if (files.length === 0) {
      throw new Error('AI가 생성할 파일을 반환하지 않았습니다.');
    }

    const written: WrittenImplementationFile[] = [];

    for (const file of files) {
      const normalizedPath = normalizeRelativePath(file.path);
      if (isSensitivePath(normalizedPath)) {
        this.postPhaseUpdate(
          requestId,
          `경로 안전성 확인 필요: ${normalizedPath} 파일은 secret/credential로 보일 수 있어 사용자 확인 없이는 수정하지 않습니다.`
        );
        const confirmation = await vscode.window.showWarningMessage(
          `Debtcrasher가 민감한 파일로 보이는 '${normalizedPath}'를 수정하려고 합니다. 계속할까요?`,
          { modal: true },
          '수정 허용'
        );
        if (confirmation !== '수정 허용') {
          throw new Error(`민감한 파일 수정이 차단되었습니다: ${normalizedPath}`);
        }
      }
      const segments = normalizedPath.split('/');
      const fileName = segments.pop();
      if (!fileName) {
        throw new Error(`잘못된 파일 경로입니다: ${file.path}`);
      }

      if (segments.length > 0) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceRoot, ...segments));
      }

      const targetUri = vscode.Uri.joinPath(workspaceRoot, ...segments, fileName);
      const alreadyExists = await fileExists(targetUri);
      if (mode === 'create' && !alreadyExists) {
        this.postProgress(requestId, 'file_start', {
          filename: normalizedPath
        });
      }

      await vscode.workspace.fs.writeFile(targetUri, textEncoder.encode(file.content));

      if (mode === 'repair' || alreadyExists) {
        this.postProgress(requestId, 'file_edit', {
          filename: normalizedPath,
          summary: collapseWhitespace(file.description) || '내용을 갱신했습니다.'
        });
      } else {
        this.postProgress(requestId, 'file_done', {
          filename: normalizedPath,
          lineCount: countLines(file.content)
        });
      }
      written.push({ path: normalizedPath, uri: targetUri, overwritten: alreadyExists });
    }

    return written;
  }
  private async openFirstGeneratedFile(files: WrittenImplementationFile[]): Promise<void> {
    const firstFile = files[0];
    if (!firstFile) {
      return;
    }

    const document = await vscode.workspace.openTextDocument(firstFile.uri);
    await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
  }

  private postPhaseUpdate(requestId: string, message: string, phase?: AgentPhase): void {
    this.postMessage({ type: 'phaseUpdate', requestId, message, phase });
    if (!phase) {
      return;
    }

    void this.appendSessionMessage({
      requestId,
      role: 'agent',
      type: 'status',
      content: message,
      timestamp: new Date().toISOString(),
      status: {
        phaseLabel: toPhaseLabel(phase)
      }
    });
  }

  private postError(message: string, requestId?: string): void {
    this.postMessage({ type: 'error', requestId, message });
    void this.appendSessionMessage({
      requestId,
      role: 'agent',
      type: 'error',
      content: message,
      timestamp: new Date().toISOString()
    });
  }

  private postProgress(requestId: string, event: ProgressEventType, payload: Omit<ProgressMessage, 'type' | 'requestId' | 'event'> = {}): void {
    this.postMessage({
      type: 'progress',
      requestId,
      event,
      ...payload
    });
  }

  private postMessage(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'agent.css'));
    const codiconCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
    );
    const nonce = createNonce();
    const planeIcon = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M2 2L14 8L2 14L4.6 8L2 2Z" fill="currentColor"/></svg>`;
    const initialThreadHtml = [
      '<article class="message message-assistant">',
      '  <div class="message-role">Agent</div>',
      '  <div class="bubble system-bubble">',
      '    <p class="system-title">기본 흐름</p>',
      '    <p>먼저 planning 단계에서 필요한 판단을 한 번에 정리하고, 사용자가 그 판단을 모두 확정하면 바로 구현 단계로 넘어갑니다.</p>',
      '    <p>Debtcrasher는 고레버리지 판단을 DECISIONS.md와 AGENT.md에 남겨 이후 작업과 학습 자료로 다시 활용합니다.</p>',
      '  </div>',
      '</article>'
    ].join('');

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${codiconCssUri}">
  <link rel="stylesheet" href="${cssUri}">
  <title>Agent</title>
</head>
<body>
  <div class="app-shell">
    <header class="topbar">
      <div class="topbar-copy">
        <p class="kicker">Agent View</p>
        <h1>Development Agent</h1>
        <p id="environmentMeta" class="topbar-subtitle">환경 정보를 불러오는 중입니다.</p>
      </div>
      <div class="topbar-actions">
        <button id="demoSeedBtn" class="icon-button" title="Demo Seed" aria-label="Demo Seed"><i class="codicon codicon-beaker"></i></button>
        <button id="newSessionBtn" class="icon-button" title="새 세션" aria-label="새 세션"><i class="codicon codicon-add"></i></button>
      </div>
    </header>

    <div class="mode-toggle" role="tablist" aria-label="Agent View 모드">
      <button id="chatModeBtn" class="mode-toggle-button is-active" type="button" aria-selected="true" aria-label="새 채팅" title="새 채팅"><i class="codicon codicon-add"></i></button>
      <button id="historyModeBtn" class="mode-toggle-button" type="button" aria-selected="false" aria-label="작업 기록" title="작업 기록"><i class="codicon codicon-history"></i></button>
    </div>

    <div id="restoreBanner" class="restore-banner is-hidden" aria-live="polite">이전 세션을 불러왔습니다.</div>

    <section id="chatPane" class="pane pane-chat">
      <main id="thread" class="thread" aria-live="polite">${initialThreadHtml}</main>

      <form id="inputForm" class="composer">
        <label for="userInput" class="composer-label">개발 요청</label>
        <textarea id="userInput" class="input-box" rows="4" placeholder="예: React + Vite + TypeScript로 빠르게 프로토타입을 만들고 싶어. 구조는 단순하게 가고 구현은 바로 시작해도 돼."></textarea>
        <div class="composer-footer">
          <button type="submit" id="sendBtn" class="send-btn" title="전송">${planeIcon}</button>
        </div>
      </form>
    </section>

    <section id="historyPane" class="pane pane-history is-hidden">
      <div id="historyList" class="history-list" aria-label="작업 기록 목록"></div>
      <div id="historyDetail" class="history-detail">
        <p class="empty-line">저장된 작업 기록을 선택해 주세요.</p>
      </div>
    </section>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const INITIAL_THREAD_HTML = ${JSON.stringify(initialThreadHtml)};
    const thread = document.getElementById('thread');
    const inputForm = document.getElementById('inputForm');
    const userInput = document.getElementById('userInput');
    const demoSeedBtn = document.getElementById('demoSeedBtn');
    const newSessionBtn = document.getElementById('newSessionBtn');
    const environmentMeta = document.getElementById('environmentMeta');
    const chatModeBtn = document.getElementById('chatModeBtn');
    const historyModeBtn = document.getElementById('historyModeBtn');
    const restoreBanner = document.getElementById('restoreBanner');
    const chatPane = document.getElementById('chatPane');
    const historyPane = document.getElementById('historyPane');
    const historyList = document.getElementById('historyList');
    const historyDetail = document.getElementById('historyDetail');
    const PHASES = ['planning', 'decision', 'implementation', 'verification', 'complete'];
    const PHASE_LABELS = {
      planning: '판단 분석 중',
      decision: '판단 선택 중',
      implementation: '구현 중',
      verification: '검증 중',
      complete: '완료'
    };

    const state = {
      provider: null,
      traceabilityMode: 'basic',
      hasWorkspace: false,
      activeRequestId: '',
      activePhase: '',
      mode: 'chat',
      sessionSummaries: [],
      activeHistorySession: null,
      progressGroups: {}
    };

    userInput.focus();

    function escapeHtml(value) {
      if (!value) return '';
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatDateTime(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return '';
      }

      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return year + '-' + month + '-' + day + ' ' + hours + ':' + minutes;
    }

    function mapPhaseLabelToKey(label) {
      const match = Object.entries(PHASE_LABELS).find((entry) => entry[1] === label);
      return match ? match[0] : '';
    }

    function codicon(name) {
      return '<i class="codicon codicon-' + escapeHtml(name) + '" aria-hidden="true"></i>';
    }

    function scrollToBottom(target) {
      const container = target || thread;
      container.scrollTop = container.scrollHeight;
    }

    function setMode(mode) {
      const chatActive = mode === 'chat';
      state.mode = mode;
      chatModeBtn.classList.toggle('is-active', chatActive);
      historyModeBtn.classList.toggle('is-active', !chatActive);
      chatModeBtn.setAttribute('aria-selected', chatActive ? 'true' : 'false');
      historyModeBtn.setAttribute('aria-selected', chatActive ? 'false' : 'true');
      chatPane.classList.toggle('is-hidden', !chatActive);
      historyPane.classList.toggle('is-hidden', chatActive);
    }

    function setRestoreBanner(visible) {
      restoreBanner.classList.toggle('is-hidden', !visible);
    }

    function resetChatThread(extraMessage) {
      thread.innerHTML = INITIAL_THREAD_HTML;
      state.progressGroups = {};
      if (extraMessage) {
        appendAgentText(extraMessage, 'system-bubble');
      }
      scrollToBottom(thread);
    }

    function updateEnvironmentMeta(provider, hasWorkspace, traceabilityMode) {
      if (!provider) return;
      const modeLabel = traceabilityMode === 'strict' ? 'Strict' : 'Basic';
      environmentMeta.textContent = provider.displayName + ' ' + provider.model + ' / 워크스페이스 ' + (hasWorkspace ? '연결됨' : '없음') + ' / Mode: ' + modeLabel + ' — Strict mode is slower but provides stronger traceability checks.';
    }

    function setPhase(requestId, phase) {
      if (!requestId || !phase) return;
      state.activeRequestId = requestId;
      state.activePhase = phase;
    }

    function clearPhaseIndicator() {
      state.activeRequestId = '';
      state.activePhase = '';
    }

    function appendMessage(role, kind, html, target) {
      const msg = document.createElement('article');
      msg.className = 'message ' + kind;
      msg.innerHTML = '<div class="message-role">' + role + '</div><div class="bubble">' + html + '</div>';
      const container = target || thread;
      container.appendChild(msg);
      scrollToBottom(container);
      return msg;
    }

    function appendUserMessage(text, target) {
      appendMessage('You', 'message-user', '<p>' + escapeHtml(text).replace(/\\n/g, '<br>') + '</p>', target);
    }

    function appendAgentText(text, extraClass, target) {
      appendMessage(
        'Agent',
        'message-assistant ' + (extraClass || ''),
        '<p>' + escapeHtml(text).replace(/\\n/g, '<br>') + '</p>',
        target
      );
    }

    function appendStatusMessage(text, phase, target) {
      const phaseLabel = phase ? (PHASE_LABELS[phase] || phase) : '';
      const html = [
        phaseLabel ? '<div class="inline-status-head"><span class="inline-phase-chip">' + escapeHtml(phaseLabel) + '</span></div>' : '',
        '<p>' + escapeHtml(text).replace(/\\n/g, '<br>') + '</p>'
      ].join('');
      appendMessage('Agent', 'message-assistant status-message', html, target);
    }

    function ensureProgressGroup(requestId) {
      if (!state.progressGroups[requestId]) {
        state.progressGroups[requestId] = {
          startedAt: Date.now(),
          items: [],
          nodes: [],
          summaryNode: null
        };
      }

      return state.progressGroups[requestId];
    }

    function formatDuration(ms) {
      const seconds = Math.max(1, Math.round(ms / 1000));
      if (seconds < 60) {
        return seconds + '초';
      }

      const minutes = Math.floor(seconds / 60);
      const remain = seconds % 60;
      return remain > 0 ? minutes + '분 ' + remain + '초' : minutes + '분';
    }

    function getProgressText(message) {
      if (message.event === 'file_start') {
        return (message.filename || '파일') + ' 생성 중...';
      }
      if (message.event === 'file_done') {
        return (message.filename || '파일') + ' — ' + String(message.lineCount || 0) + '줄';
      }
      if (message.event === 'file_edit') {
        return (message.filename || '파일') + ' 수정 — ' + (message.summary || '변경 내용 반영');
      }
      if (message.event === 'verify_start') {
        return '검증 실행 중: ' + (message.command || '');
      }
      if (message.event === 'verify_done') {
        if (message.output === 'not available') {
          return '검증 명령 없음: not available';
        }
        return message.passed ? '검증 통과' : '검증 실패 — 자동 수정 시작';
      }
      if (message.event === 'repair_start') {
        return '자동 수정 중...';
      }
      if (message.event === 'log_done') {
        return 'DECISIONS.md 기록 완료';
      }
      if (message.event === 'agent_updated') {
        return 'AGENT.md 갱신 완료';
      }
      return '';
    }

    function getProgressCodicon(message) {
      if (message.event === 'file_start') return 'file';
      if (message.event === 'file_done') return 'check';
      if (message.event === 'file_edit') return 'edit';
      if (message.event === 'verify_start') return 'beaker';
      if (message.event === 'verify_done') return message.output === 'not available' ? 'circle-slash' : message.passed ? 'pass' : 'error';
      if (message.event === 'repair_start') return 'tools';
      if (message.event === 'log_done') return 'book';
      if (message.event === 'agent_updated') return 'file-symlink-file';
      return 'info';
    }

    function appendProgressBubble(message) {
      const requestId = message.requestId || 'default';
      const text = getProgressText(message);
      if (!text) {
        return;
      }

      const group = ensureProgressGroup(requestId);
      if (group.summaryNode) {
        group.summaryNode.remove();
        group.summaryNode = null;
      }

      group.items.push({
        event: message.event,
        text: text,
        filename: message.filename || '',
        passed: typeof message.passed === 'boolean' ? message.passed : null
      });

      const article = document.createElement('article');
      article.className = 'message message-assistant progress-message';
      article.setAttribute('data-progress-request-id', requestId);
      article.innerHTML = '<div class="bubble progress-bubble"><p>' + codicon(getProgressCodicon(message)) + '<span>' + escapeHtml(text) + '</span></p></div>';
      thread.appendChild(article);
      group.nodes.push(article);
      scrollToBottom(thread);
    }

    function buildProgressSummaryText(group, resultMessage) {
      const fileNames = new Set(
        group.items
          .filter((item) => item.event === 'file_start' || item.event === 'file_done' || item.event === 'file_edit')
          .map((item) => item.filename)
          .filter(Boolean)
      );
      const fileCount = fileNames.size;
      const verificationResults = resultMessage?.verificationResults || [];
      const hasFailedVerification = verificationResults.some((result) => result.available !== false && result.ok === false);
      const hasPassedVerification = verificationResults.some((result) => result.available !== false && result.ok === true);
      const verificationPassed = typeof resultMessage?.verificationSummary === 'string'
        ? resultMessage.verificationSummary.includes('통과')
        : group.items.filter((item) => item.event === 'verify_done').slice(-1)[0]?.passed === true;
      const verificationLabel = hasFailedVerification
        ? '검증 실패'
        : hasPassedVerification || verificationPassed
          ? '검증 통과'
          : '검증 없음';
      const elapsed = formatDuration(Date.now() - group.startedAt);
      return '파일 ' + fileCount + '개 생성 · ' + verificationLabel + ' · ' + elapsed;
    }

    function collapseProgressGroup(requestId, resultMessage) {
      const group = state.progressGroups[requestId];
      if (!group || !group.items.length) {
        return;
      }

      group.nodes.forEach((node) => node.remove());
      group.nodes = [];

      const details = document.createElement('details');
      details.className = 'message message-assistant progress-summary-message';
      details.setAttribute('data-progress-request-id', requestId);
      details.innerHTML = [
        '<summary class="progress-summary-toggle">' + codicon('checklist') + '<span>' + escapeHtml(buildProgressSummaryText(group, resultMessage)) + '</span></summary>',
        '<div class="progress-summary-list">',
        group.items.map((item) => '<div class="progress-summary-item">' + codicon(getProgressCodicon(item)) + '<span>' + escapeHtml(item.text) + '</span></div>').join(''),
        '</div>'
      ].join('');

      thread.appendChild(details);
      group.summaryNode = details;
      scrollToBottom(thread);
    }

    function renderVerificationHtml(message, readOnly) {
      const results = message.verificationResults || [];
      if (!results.length && !message.verificationSummary && !message.repairFailureMessage) {
        return '';
      }

      const failureHtml = message.repairFailureMessage
        ? [
            '<div class="verification-failure">',
            '  <p class="verification-failure-title">수동 확인 필요</p>',
            '  <p>' + escapeHtml(message.repairFailureMessage) + '</p>',
            '</div>'
          ].join('')
        : '';
      const resultsHtml = results.length > 0
        ? '<ul class="result-list verification-list">'
          + results.map((result) => [
              '<li class="verification-item">',
              '  <div class="verification-row">',
              '    <code>' + escapeHtml(result.command) + '</code>',
              '    <span class="verification-badge ' + (result.available === false ? 'verification-na' : result.ok ? 'verification-pass' : 'verification-fail') + '">' + (result.available === false ? 'NOT AVAILABLE' : result.ok ? 'PASS' : (result.timedOut ? 'TIMEOUT' : 'FAIL')) + '</span>',
              '  </div>',
              result.output && result.output !== 'not available'
                ? result.ok
                  ? '  <details class="verification-details"><summary>출력 보기</summary><pre class="verification-output">' + escapeHtml(result.output) + '</pre></details>'
                  : '  <pre class="verification-output verification-output-inline">' + escapeHtml(result.output) + '</pre>'
                : '',
              '</li>'
            ].join('')).join('')
          + '</ul>'
        : '';
      const retryButtonHtml = message.manualVerificationAvailable
        ? '<div class="verification-actions"><button type="button" class="secondary-button retry-verification-button button-with-icon"'
          + (readOnly ? ' disabled' : ' data-request-id="' + escapeHtml(message.requestId || '') + '"')
          + '>' + codicon('refresh') + '<span>수동 수정 후 재검증</span></button></div>'
        : '';

      return '<div class="result-block"><p class="tradeoff-title">자동 검증</p>'
        + (message.verificationSummary ? '<p class="verification-summary">' + escapeHtml(message.verificationSummary) + '</p>' : '')
        + failureHtml
        + resultsHtml
        + retryButtonHtml
        + '</div>';
    }

    function attachRetryHandlers(container) {
      container.querySelectorAll('.retry-verification-button').forEach((button) => {
        if (button.dataset.bound === 'true') {
          return;
        }

        button.dataset.bound = 'true';
        button.addEventListener('click', () => {
          const requestId = button.getAttribute('data-request-id');
          if (!requestId) {
            return;
          }

          setPhase(requestId, 'verification');
          vscode.postMessage({ type: 'retryVerification', requestId });
        });
      });
    }

    function renderOptionHtml(questionId, choice, option, isSelected) {
      return [
        '<section class="option-card' + (isSelected ? ' is-selected-card' : '') + '">',
        '  <button type="button" class="option-select' + (isSelected ? ' is-selected' : '') + '" data-question-id="' + escapeHtml(questionId) + '" data-choice-type="' + choice + '">',
        '    <span class="option-badge">Option ' + choice + '</span>',
        '    <strong>' + escapeHtml(option.label) + '</strong>',
        '  </button>',
        '  <div class="tradeoffs">',
        '    <p class="tradeoff-title">Pros</p>',
        '    <ul>' + option.pros.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul>',
        '    <p class="tradeoff-title">Cons</p>',
        '    <ul>' + option.cons.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul>',
        '  </div>',
        '</section>'
      ].join('');
    }

    function getQuestionOptions(question) {
      if (Array.isArray(question.options) && question.options.length > 0) {
        return question.options.slice(0, 4);
      }
      return [question.optionA, question.optionB].filter(Boolean);
    }

    function choiceLabel(index) {
      return ['A', 'B', 'C', 'D'][index] || 'D';
    }

    function normalizeHumanReviewLevel(value) {
      return value === 'REVIEW_REQUIRED' || value === 'REVIEW_RECOMMENDED' || value === 'AUTO_WITH_LOG'
        ? value
        : 'AUTO_WITH_LOG';
    }

    function renderReviewLevelLabel(level) {
      if (level === 'REVIEW_REQUIRED') {
        return '사용자 확인 필수';
      }
      if (level === 'REVIEW_RECOMMENDED') {
        return '검토 권장';
      }
      return '자동 처리 + 로그';
    }

    function renderQuestionMetadata(question) {
      const risks = Array.isArray(question.risk_categories) ? question.risk_categories.join(', ') : '';
      const reviewCategories = Array.isArray(question.review_categories) ? question.review_categories.join(', ') : '';
      const reviewLevel = normalizeHumanReviewLevel(question.human_review_level);
      return [
        '<div class="question-metadata">',
        '  <span class="review-badge review-' + escapeHtml(reviewLevel.toLowerCase()) + '">' + escapeHtml(renderReviewLevelLabel(reviewLevel)) + '</span>',
        question.reason ? '  <span>' + escapeHtml(question.reason) + '</span>' : '',
        question.default_if_skipped ? '  <span>Default: ' + escapeHtml(question.default_if_skipped) + '</span>' : '',
        question.risk_if_wrong ? '  <span>Risk: ' + escapeHtml(question.risk_if_wrong) + '</span>' : '',
        reviewCategories ? '  <span>Review Categories: ' + escapeHtml(reviewCategories) + '</span>' : '',
        risks ? '  <span>Categories: ' + escapeHtml(risks) + '</span>' : '',
        '</div>'
      ].join('');
    }

    function renderQuestions(plan) {
      if (!plan.questions || plan.questions.length === 0) {
        return '<div class="summary-card"><p class="tradeoff-title">질문</p><p>추가로 직접 결정할 항목이 없습니다. 기본값으로 바로 구현을 시작할 수 있습니다.</p></div>';
      }

      return '<div class="planning-questions">' + plan.questions.map((question, index) => [
        '<section class="planning-question" data-question-id="' + escapeHtml(question.id) + '">',
        '  <div class="planning-question-head">',
        '    <div class="planning-question-copy">',
        '      <p class="decision-point-label">Q' + (index + 1) + ' · ' + escapeHtml(question.topic) + '</p>',
        '      <h2>' + escapeHtml(question.question) + '</h2>',
        '    </div>',
        '    <span class="impact-badge impact-' + escapeHtml((question.impact || '').toLowerCase()) + '">' + escapeHtml(question.impact) + '</span>',
        '  </div>',
        renderQuestionMetadata(question),
        '  <div class="options-grid">',
        getQuestionOptions(question).map((option, optionIndex) => renderOptionHtml(question.id, choiceLabel(optionIndex), option, false)).join(''),
        '  </div>',
        '  <div class="custom-choice">',
        '    <label for="custom-' + escapeHtml(question.id) + '">직접 선택 입력</label>',
        '    <input id="custom-' + escapeHtml(question.id) + '" data-question-id="' + escapeHtml(question.id) + '" type="text" placeholder="A/B 외 선택이 필요하면 직접 입력" />',
        '  </div>',
        '</section>'
      ].join('')).join('') + '</div>';
    }

    function renderStoredQuestions(planning) {
      if (!planning.questions || planning.questions.length === 0) {
        return '<div class="summary-card"><p class="tradeoff-title">질문</p><p>추가 질문 없이 기본값으로 진행한 세션입니다.</p></div>';
      }

      const choiceMap = new Map((planning.userChoices || []).map((choice) => [choice.questionId, choice]));
      return '<div class="planning-questions">' + planning.questions.map((question, index) => {
        const selected = choiceMap.get(question.id);
        return [
          '<section class="planning-question planning-question-readonly">',
          '  <div class="planning-question-head">',
          '    <div class="planning-question-copy">',
          '      <p class="decision-point-label">Q' + (index + 1) + ' · ' + escapeHtml(question.topic) + '</p>',
          '      <h2>' + escapeHtml(question.question) + '</h2>',
          '    </div>',
          '    <span class="impact-badge impact-' + escapeHtml((question.impact || '').toLowerCase()) + '">' + escapeHtml(question.impact) + '</span>',
          '  </div>',
          renderQuestionMetadata(question),
          '  <div class="options-grid">',
          getQuestionOptions(question).map((option, optionIndex) => {
            const label = choiceLabel(optionIndex);
            return renderOptionHtml(question.id, label, option, Boolean(selected && selected.choiceType === label));
          }).join(''),
          '  </div>',
          selected
            ? '<p class="readonly-choice">선택: ' + escapeHtml(selected.userChoice || selected.selectedLabel) + '</p>'
            : '<p class="readonly-choice">선택 기록 없음</p>',
          '</section>'
        ].join('');
      }).join('') + '</div>';
    }

    function appendPlanningCard(requestId, plan) {
      setMode('chat');
      setPhase(requestId, 'decision');

      const assumptionsHtml = plan.assumptions && plan.assumptions.length > 0
        ? [
            '<details class="assumptions-panel">',
            '  <summary>자동으로 결정되는 것들 (' + plan.assumptions.length + ')</summary>',
            '  <ul class="assumption-list">',
            plan.assumptions.map((item) => '<li>' + escapeHtml(item) + '</li>').join(''),
            '  </ul>',
            '</details>'
          ].join('')
        : '';

      const planHtml = [
        '<div class="workflow-head">',
        '  <p class="decision-point-label">Planning</p>',
        '  <span class="decision-badge">' + escapeHtml((plan.questions || []).length + '개 질문') + '</span>',
        '</div>',
        '<div class="summary-grid summary-grid-single">',
        '  <section class="summary-card">',
        '    <p class="tradeoff-title">무엇을 만들지</p>',
        '    <p>' + escapeHtml(plan.summary || '') + '</p>',
        '  </section>',
        '</div>',
        assumptionsHtml,
        renderQuestions(plan),
        '<div class="decision-actions"><button type="button" class="confirm-button start-build-button button-with-icon"' + ((plan.questions || []).length > 0 ? ' disabled' : '') + '>' + codicon('play') + '<span>개발 시작</span></button></div>'
      ].join('');

      const message = appendMessage('Agent', 'message-assistant planning-message', planHtml);
      const answers = new Map();
      const startButton = message.querySelector('.start-build-button');
      const questionCards = Array.from(message.querySelectorAll('.planning-question'));

      function emitPlanningAnswers() {
        const payloadAnswers = (plan.questions || [])
          .map((question) => answers.get(question.id))
          .filter(Boolean);

        vscode.postMessage({
          type: 'updatePlanningAnswers',
          requestId,
          answers: payloadAnswers
        });
      }

      function syncStartButton() {
        const ready = !plan.questions || plan.questions.every((question) => answers.has(question.id));
        startButton.disabled = !ready;
      }

      questionCards.forEach((card) => {
        const questionId = card.getAttribute('data-question-id');
        const optionButtons = Array.from(card.querySelectorAll('.option-select'));
        const customInput = card.querySelector('input');

        optionButtons.forEach((button) => {
          button.addEventListener('click', () => {
            if (!questionId) return;
            answers.set(questionId, { questionId, choiceType: button.dataset.choiceType });
            optionButtons.forEach((item) => item.classList.remove('is-selected'));
            button.classList.add('is-selected');
            if (customInput) customInput.value = '';
            syncStartButton();
            emitPlanningAnswers();
          });
        });

        customInput?.addEventListener('input', () => {
          if (!questionId) return;
          const customChoice = customInput.value.trim();
          if (!customChoice) {
            answers.delete(questionId);
            syncStartButton();
            emitPlanningAnswers();
            return;
          }

          answers.set(questionId, { questionId, choiceType: 'custom', customChoice });
          optionButtons.forEach((item) => item.classList.remove('is-selected'));
          syncStartButton();
          emitPlanningAnswers();
        });
      });

      startButton.addEventListener('click', () => {
        const payloadAnswers = (plan.questions || [])
          .map((question) => answers.get(question.id))
          .filter(Boolean);

        setPhase(requestId, 'implementation');
        message.querySelectorAll('button, input').forEach((element) => {
          element.setAttribute('disabled', 'true');
        });

        vscode.postMessage({
          type: 'startImplementation',
          requestId,
          answers: payloadAnswers
        });
      });
    }

    function appendStoredPlanningMessage(message, target) {
      const planning = message.planning || { summary: message.content || '', assumptions: [], questions: [], userChoices: [] };
      const assumptionsHtml = planning.assumptions && planning.assumptions.length > 0
        ? [
            '<details class="assumptions-panel" open>',
            '  <summary>자동으로 결정되는 것들 (' + planning.assumptions.length + ')</summary>',
            '  <ul class="assumption-list">',
            planning.assumptions.map((item) => '<li>' + escapeHtml(item) + '</li>').join(''),
            '  </ul>',
            '</details>'
          ].join('')
        : '';

      appendMessage('Agent', 'message-assistant planning-message', [
        '<div class="workflow-head">',
        '  <p class="decision-point-label">Planning</p>',
        '  <span class="decision-badge">' + escapeHtml((planning.questions || []).length + '개 질문') + '</span>',
        '</div>',
        '<div class="summary-grid summary-grid-single">',
        '  <section class="summary-card">',
        '    <p class="tradeoff-title">무엇을 만들지</p>',
        '    <p>' + escapeHtml(planning.summary || message.content || '') + '</p>',
        '  </section>',
        '</div>',
        assumptionsHtml,
        renderStoredQuestions(planning)
      ].join(''), target);
    }

    function renderResultMessageHtml(message, titleLabel, heading, readOnly) {
      const filesHtml = (message.files || []).map((file) => '<li><code>' + escapeHtml(file.path) + '</code><span>' + escapeHtml(file.description || '') + '</span></li>').join('');
      const runHtml = (message.runInstructions || []).map((step) => '<li>' + escapeHtml(step) + '</li>').join('');
      const guideHtml = message.guidePath ? '<div class="result-block"><p class="tradeoff-title">기준 문서</p><p><code>' + escapeHtml(message.guidePath) + '</code></p></div>' : '';
      const verificationHtml = renderVerificationHtml(message, readOnly);
      return [
        '<p class="decision-point-label">' + escapeHtml(titleLabel) + '</p>',
        '<h2>' + escapeHtml(heading) + '</h2>',
        '<p class="decision-question">' + escapeHtml(message.summary || '') + '</p>',
        guideHtml,
        filesHtml ? '<div class="result-block"><p class="tradeoff-title">생성 파일</p><ul class="result-list">' + filesHtml + '</ul></div>' : '',
        runHtml ? '<div class="result-block"><p class="tradeoff-title">실행 / 검증</p><ol class="result-list">' + runHtml + '</ol></div>' : '',
        verificationHtml
      ].join('');
    }

    function appendImplementationResult(message) {
      const resultMessage = appendMessage(
        'Agent',
        'message-assistant result-message',
        renderResultMessageHtml(message, '구현 결과', message.currentWork || '구현 완료', false)
      );
      attachRetryHandlers(resultMessage);
    }

    function appendVerificationRetryResult(message) {
      const resultMessage = appendMessage('Agent', 'message-assistant result-message', [
        '<p class="decision-point-label">재검증 결과</p>',
        '<h2>' + escapeHtml(message.verificationSummary || '재검증 완료') + '</h2>',
        renderVerificationHtml(message, false)
      ].join(''));
      attachRetryHandlers(resultMessage);
    }

    function appendStoredResultMessage(message, target) {
      const payload = message.result || {
        currentWork: '구현 결과',
        summary: message.content || '',
        generatedFiles: [],
        runInstructions: [],
        guidePath: '',
        verificationSummary: '',
        verificationResults: [],
        autoRepairApplied: false,
        repairFailureMessage: '',
        manualVerificationAvailable: false
      };
      const resultMessage = appendMessage(
        'Agent',
        'message-assistant result-message',
        renderResultMessageHtml(
          {
            requestId: message.requestId || '',
            currentWork: payload.currentWork,
            summary: payload.summary,
            files: payload.generatedFiles,
            runInstructions: payload.runInstructions,
            guidePath: payload.guidePath,
            verificationSummary: payload.verificationSummary,
            verificationResults: payload.verificationResults,
            autoRepairApplied: payload.autoRepairApplied,
            repairFailureMessage: payload.repairFailureMessage,
            manualVerificationAvailable: payload.manualVerificationAvailable
          },
          payload.currentWork === '재검증 결과' ? '재검증 결과' : '구현 결과',
          payload.currentWork || '구현 결과',
          true
        ),
        target
      );
    }

    function appendStoredSession(session, target) {
      target.innerHTML = '';
      if (!session || !session.messages || session.messages.length === 0) {
        target.innerHTML = INITIAL_THREAD_HTML;
        return;
      }

      session.messages.forEach((message) => {
        if (message.role === 'user') {
          appendUserMessage(message.content || '', target);
          return;
        }

        if (message.type === 'planning') {
          appendStoredPlanningMessage(message, target);
          return;
        }

        if (message.type === 'result') {
          appendStoredResultMessage(message, target);
          return;
        }

        if (message.type === 'status') {
          appendStatusMessage(
            message.content || (message.status && message.status.phaseLabel) || '',
            mapPhaseLabelToKey(message.status && message.status.phaseLabel),
            target
          );
          return;
        }

        if (message.type === 'error') {
          appendAgentText('오류: ' + (message.content || ''), 'error-message', target);
          return;
        }

        appendAgentText(message.content || '', '', target);
      });

      scrollToBottom(target);
    }

    function renderSessionList() {
      if (!state.sessionSummaries.length) {
        historyList.innerHTML = '<p class="history-empty">저장된 작업 기록이 없습니다.</p>';
        return;
      }

      historyList.innerHTML = state.sessionSummaries.map((session) => {
        const isActive = state.activeHistorySession && state.activeHistorySession.fileName === session.id;
        return [
          '<button type="button" class="history-entry' + (isActive ? ' is-active' : '') + '" data-session-id="' + escapeHtml(session.id) + '">',
          '  <span class="history-entry-text">' + escapeHtml(session.title + ' · ' + formatDateTime(session.startedAt)) + '</span>',
          '</button>'
        ].join('');
      }).join('');

      historyList.querySelectorAll('.history-entry').forEach((button) => {
        button.addEventListener('click', () => {
          const sessionId = button.getAttribute('data-session-id');
          if (!sessionId) {
            return;
          }

          vscode.postMessage({ type: 'openHistorySession', sessionId });
        });
      });
    }

    function renderHistoryDetail(session) {
      state.activeHistorySession = session;
      renderSessionList();
      historyDetail.innerHTML = [
        '<div class="history-detail-header">',
        '  <p class="tradeoff-title">세션</p>',
        '  <h2>' + escapeHtml(session.title) + '</h2>',
        '  <p class="history-detail-meta">' + escapeHtml(formatDateTime(session.startedAt)) + '</p>',
        '</div>',
        '<div id="historyThread" class="thread history-thread" aria-live="off"></div>',
        '<div class="history-actions"><button id="resumeSessionBtn" type="button" class="confirm-button button-with-icon">' + codicon('debug-continue') + '<span>이 세션 이어서 개발</span></button></div>'
      ].join('');

      const historyThread = document.getElementById('historyThread');
      appendStoredSession(session, historyThread);

      const resumeButton = document.getElementById('resumeSessionBtn');
      resumeButton?.addEventListener('click', () => {
        vscode.postMessage({ type: 'resumeHistorySession', sessionId: session.fileName });
      });
    }

    function prepareResume(sessionTitle) {
      state.activeHistorySession = null;
      renderSessionList();
      setMode('chat');
      setRestoreBanner(false);
      clearPhaseIndicator();
      resetChatThread('이전 세션을 이어서 작업할 준비가 되었습니다. 필요한 설명을 덧붙여 전송해 주세요.');
      userInput.value = '이전 세션 이어서: ' + sessionTitle;
      userInput.focus();
    }

    function submitCurrentTask() {
      const text = userInput.value.trim();
      if (!text) return;
      setMode('chat');
      setRestoreBanner(false);
      clearPhaseIndicator();
      appendUserMessage(text);
      userInput.value = '';
      const requestId = Date.now().toString() + '-' + Math.random().toString(16).slice(2);
      setPhase(requestId, 'planning');
      vscode.postMessage({ type: 'submitTask', requestId, task: text });
    }

    inputForm.addEventListener('submit', (event) => {
      event.preventDefault();
      submitCurrentTask();
    });

    userInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      submitCurrentTask();
    });

    chatModeBtn.addEventListener('click', () => setMode('chat'));
    historyModeBtn.addEventListener('click', () => setMode('history'));

    newSessionBtn.addEventListener('click', () => {
      state.activeHistorySession = null;
      renderSessionList();
      setMode('chat');
      setRestoreBanner(false);
      clearPhaseIndicator();
      resetChatThread('새 세션을 시작했습니다. 다음 작업 목표를 적어 주세요.');
      vscode.postMessage({ type: 'newSession' });
      userInput.focus();
    });

    demoSeedBtn.addEventListener('click', () => {
      setMode('chat');
      setRestoreBanner(false);
      clearPhaseIndicator();
      resetChatThread('DEMO MODE: TODO 저장 기능 sample flow를 시작합니다. 실제 파일 변경은 수행하지 않습니다.');
      vscode.postMessage({ type: 'runDemoSeed' });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;

      if (message.type === 'workspaceState') {
        state.provider = message.provider;
        state.hasWorkspace = Boolean(message.hasWorkspace);
        state.traceabilityMode = message.traceabilityMode || 'basic';
        updateEnvironmentMeta(state.provider, state.hasWorkspace, state.traceabilityMode);
        state.sessionSummaries = Array.isArray(message.sessionSummaries) ? message.sessionSummaries : state.sessionSummaries;
        renderSessionList();
        if (message.restoredSession) {
          appendStoredSession(message.restoredSession, thread);
          setRestoreBanner(Boolean(message.restoredBanner));
          setMode('chat');
        }
        return;
      }

      if (message.type === 'sessionListUpdate') {
        state.sessionSummaries = Array.isArray(message.sessionSummaries) ? message.sessionSummaries : [];
        renderSessionList();
        return;
      }

      if (message.type === 'historySessionResponse') {
        renderHistoryDetail(message.session);
        setMode('history');
        return;
      }

      if (message.type === 'resumePrepared') {
        prepareResume(message.sessionTitle || '이전 세션');
        return;
      }

      if (message.type === 'phaseUpdate') {
        if (message.phase) {
          setPhase(message.requestId, message.phase);
        }
        appendStatusMessage(message.message, message.phase);
        return;
      }

      if (message.type === 'progress') {
        appendProgressBubble(message);
        return;
      }

      if (message.type === 'planningResponse') {
        appendPlanningCard(message.requestId, message.plan);
        return;
      }

      if (message.type === 'implementationResponse') {
        setPhase(message.requestId, 'complete');
        collapseProgressGroup(message.requestId, message);
        appendImplementationResult(message);
        return;
      }

      if (message.type === 'verificationRetryResult') {
        setPhase(message.requestId, 'complete');
        collapseProgressGroup(message.requestId, message);
        appendVerificationRetryResult(message);
        return;
      }

      if (message.type === 'error') {
        if (message.requestId && message.requestId === state.activeRequestId) {
          clearPhaseIndicator();
        }
        appendAgentText('오류: ' + message.message, 'error-message');
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function buildImplementationFileSummaries(files: ImplementationFile[]): ImplementationFileSummary[] {
  return files.map((file) => ({
    path: normalizeRelativePath(file.path),
    description: file.description
  }));
}

function mergeImplementationFileSummaries(
  baseFiles: ImplementationFileSummary[],
  updatedFiles: ImplementationFileSummary[]
): ImplementationFileSummary[] {
  const merged = new Map(baseFiles.map((file) => [file.path, file]));
  for (const file of updatedFiles) {
    merged.set(file.path, file);
  }
  return Array.from(merged.values()).sort((left, right) => left.path.localeCompare(right.path));
}

function mergeWrittenFiles(baseFiles: WrittenImplementationFile[], updatedFiles: WrittenImplementationFile[]): WrittenImplementationFile[] {
  const merged = new Map(baseFiles.map((file) => [file.path, file]));
  for (const file of updatedFiles) {
    merged.set(file.path, file);
  }
  return Array.from(merged.values()).sort((left, right) => left.path.localeCompare(right.path));
}

function mergeImplementationResponses(
  base: ImplementationResponse,
  updated: ImplementationResponse
): ImplementationResponse {
  const runInstructions = Array.from(new Set([...base.runInstructions, ...updated.runInstructions]));
  return {
    currentWork: updated.currentWork || base.currentWork,
    summary: updated.summary || base.summary,
    files: base.files,
    runInstructions
  };
}

function serializeVerificationResults(results: VerificationResult[]): Array<{
  label: string;
  command: string;
  available: boolean;
  ok: boolean;
  timedOut: boolean;
  exitCode: number | null;
  output: string;
  status: string;
}> {
  return results.map((result) => ({
    label: result.label,
    command: result.command,
    available: result.available,
    ok: result.ok,
    timedOut: result.timedOut,
    exitCode: result.exitCode,
    output: result.output,
    status: result.status
  }));
}

function summarizeVerification(results: VerificationResult[], autoRepairApplied: boolean): string {
  if (results.length === 0) {
    return '';
  }

  const executableResults = results.filter((result) => result.available);
  const passedCount = executableResults.filter((result) => result.ok).length;
  const failedCount = executableResults.filter(isExecutedVerificationFailure).length;
  const unavailableCount = results.filter((result) => !result.available).length;
  const repairSummary = autoRepairApplied ? '자동 수정 1회를 거친 뒤 다시 검증했습니다.' : '';

  if (executableResults.length === 0) {
    return [`실행 가능한 자동 검증 명령을 찾지 못했습니다.`, unavailableCount > 0 ? `${unavailableCount}개 검증 항목은 not available입니다.` : '', repairSummary].filter(Boolean).join(' ');
  }

  if (failedCount === 0) {
    return [`자동 검증을 통과했습니다. (${passedCount}개 실행)`, unavailableCount > 0 ? `${unavailableCount}개 검증 항목은 not available입니다.` : '', repairSummary].filter(Boolean).join(' ');
  }

  return [`자동 검증에서 ${failedCount}개 명령이 실패했습니다.`, repairSummary].filter(Boolean).join(' ');
}

function isExecutedVerificationFailure(result: VerificationResult): boolean {
  return result.available && !result.ok;
}

function buildDecisionValidationResult(results: VerificationResult[], autoRepairApplied: boolean): {
  typecheck: string;
  build: string;
  test: string;
  lint: string;
  status: string;
  repairAttempted: boolean;
} {
  const statusByLabel = new Map(results.map((result) => [result.label, verificationStatusLabel(result)]));
  const hasFailure = results.some(isExecutedVerificationFailure);
  const hasPassed = results.some((result) => result.available && result.ok);
  const allUnavailable = results.length === 0 || results.every((result) => !result.available);

  return {
    typecheck: statusByLabel.get('typecheck') ?? 'not available',
    build: statusByLabel.get('build') ?? 'not available',
    test: statusByLabel.get('test') ?? 'not available',
    lint: statusByLabel.get('lint') ?? 'not available',
    repairAttempted: autoRepairApplied,
    status: hasFailure ? 'needs_review' : allUnavailable ? 'not_available' : hasPassed ? 'passed' : 'needs_review'
  };
}

function verificationStatusLabel(result: VerificationResult): string {
  if (!result.available) {
    return 'not available';
  }
  if (result.ok) {
    return 'passed';
  }
  return result.timedOut ? 'timeout' : 'failed';
}
function formatVerificationContext(results: VerificationResult[]): string {
  if (results.length === 0) {
    return '- No verification output was captured.';
  }

  return results
    .map((result, index) => {
      const status = !result.available ? 'NOT_AVAILABLE' : result.ok ? 'PASS' : result.timedOut ? 'TIMEOUT' : 'FAIL';
      const exitCode = result.exitCode === null ? 'none' : String(result.exitCode);
      const output = result.output.trim() || '(no output)';
      return [
        `## Verification ${index + 1}`,
        `Label: ${result.label}`,
        `Command: ${result.command}`,
        `Status: ${status}`,
        `Exit code: ${exitCode}`,
        'Output:',
        output
      ].join('\n');
    })
    .join('\n\n');
}

function resolvePlanAnswers(
  task: string,
  questions: PlanningQuestion[],
  answers: StartImplementationAnswer[],
  assumptionLog: PlanningAssumption[]
): { history: DecisionHistoryEntry[]; logEntries: DecisionLogEntryInput[]; decisionIds: string[]; assumptionEntries: PlanningAssumption[] } | undefined {
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer]));

  if (questions.some((question) => !answerMap.has(question.id))) {
    return undefined;
  }

  const timestamp = new Date().toISOString();
  const history: DecisionHistoryEntry[] = [];
  const logEntries: DecisionLogEntryInput[] = [];
  const decisionIds: string[] = [];

  for (const question of questions) {
    const answer = answerMap.get(question.id);
    if (!answer) {
      return undefined;
    }

    const resolvedChoice = resolveSelectedChoice(answer, question);
    if (!resolvedChoice) {
      return undefined;
    }

    const decisionId = buildDecisionId(timestamp, question.topic);
    decisionIds.push(decisionId);

    history.push({
      id: decisionId,
      title: question.topic,
      decisionPoint: question.question,
      userChoice: resolvedChoice.userChoice,
      outcome: resolvedChoice.outcome,
      reason: question.reason,
      leverageScore: question.leverage_score,
      riskCategories: [...question.risk_categories],
      defaultIfSkipped: question.default_if_skipped,
      riskIfWrong: question.risk_if_wrong,
      relatedFiles: question.related_files ?? question.target_files ?? [],
      source: ['user_decision', 'ai_inference']
    });

    logEntries.push({
      id: decisionId,
      title: question.topic,
      date: timestamp,
      question: `${task} / ${question.question}`,
      options: question.options.map((option, index) => summarizeOption(choiceLabelForIndex(index), option)),
      optionA: summarizeOption('A', question.optionA),
      optionB: summarizeOption('B', question.optionB),
      userChoice: resolvedChoice.userChoice,
      outcome: resolvedChoice.outcome,
      reason: `AI-generated reason: ${question.reason}`,
      leverageScore: question.leverage_score,
      riskCategories: [...question.risk_categories],
      defaultIfSkipped: question.default_if_skipped,
      riskIfWrong: question.risk_if_wrong,
      relatedFiles: question.related_files ?? question.target_files ?? [],
      validationResult: {
        typecheck: 'not available',
        build: 'not available',
        test: 'not available',
        lint: 'not available',
        status: 'needs_review'
      },
      source: ['user_decision', 'ai_inference', 'needs_review']
    });
  }

  const assumptionEntries = assumptionLog.map((assumption) => ({
    ...assumption,
    risk_categories: [...assumption.risk_categories],
    review_categories: [...(assumption.review_categories ?? [])],
    related_files: [...(assumption.related_files ?? [])]
  }));

  if (logEntries.length > 0 && assumptionEntries.length > 0) {
    logEntries[0] = {
      ...logEntries[0],
      assumptionLog: assumptionEntries
    };
  }

  return { history, logEntries, decisionIds, assumptionEntries };
}

function resolveSelectedChoice(
  answer: StartImplementationAnswer,
  question: PlanningQuestion
): { userChoice: string; outcome: string } | undefined {
  if (answer.choiceType !== 'custom') {
    const optionIndex = choiceTypeToIndex(answer.choiceType);
    const option = question.options[optionIndex];
    if (!option) {
      return undefined;
    }
    return {
      userChoice: `Option ${answer.choiceType} - ${option.label}`,
      outcome: `${option.label} 방향으로 구현을 진행합니다.`
    };
  }

  const customChoice = answer.customChoice?.trim();
  if (!customChoice) {
    return undefined;
  }

  return {
    userChoice: `Custom - ${customChoice}`,
    outcome: `${customChoice} 기준으로 구현을 진행합니다.`
  };
}

function buildSessionChoices(
  questions: PlanningQuestion[],
  answers: StartImplementationAnswer[]
): AgentSessionChoice[] {
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer]));
  const choices: AgentSessionChoice[] = [];

  for (const question of questions) {
    const answer = answerMap.get(question.id);
    if (!answer) {
      continue;
    }

    if (answer.choiceType !== 'custom') {
      const option = question.options[choiceTypeToIndex(answer.choiceType)];
      if (!option) {
        continue;
      }
      choices.push({
        questionId: question.id,
        topic: question.topic,
        choiceType: answer.choiceType,
        selectedLabel: option.label,
        userChoice: `Option ${answer.choiceType} - ${option.label}`
      });
      continue;
    }

    const customChoice = answer.customChoice?.trim();
    if (!customChoice) {
      continue;
    }

    choices.push({
      questionId: question.id,
      topic: question.topic,
      choiceType: 'custom',
      selectedLabel: customChoice,
      userChoice: `Custom - ${customChoice}`
    });
  }

  return choices;
}

function summarizeOption(choice: string, option: { label: string; pros: string[]; cons: string[] }): string {
  return `${choice} - ${option.label} | 장점: ${option.pros.join(', ')} | 단점: ${option.cons.join(', ')}`;
}

function choiceLabelForIndex(index: number): 'A' | 'B' | 'C' | 'D' {
  return (['A', 'B', 'C', 'D'][index] ?? 'D') as 'A' | 'B' | 'C' | 'D';
}

function choiceTypeToIndex(choiceType: 'A' | 'B' | 'C' | 'D'): number {
  return choiceType.charCodeAt(0) - 'A'.charCodeAt(0);
}

function buildDecisionId(dateValue: string, title: string): string {
  const date = new Date(dateValue);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return `D-${[
    safeDate.getFullYear(),
    padNumber(safeDate.getMonth() + 1),
    padNumber(safeDate.getDate())
  ].join('')}-${[padNumber(safeDate.getHours()), padNumber(safeDate.getMinutes()), padNumber(safeDate.getSeconds())].join('')}-${sanitizeDecisionTitle(title)}`;
}

function sanitizeDecisionTitle(title: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  return normalized || 'decision';
}

function padNumber(value: number): string {
  return String(value).padStart(2, '0');
}

function serializePersistedSession(session: PersistedAgentSession): PersistedAgentSession {
  return {
    fileName: session.fileName,
    title: session.title,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
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
}

function containsResumeKeyword(task: string): boolean {
  return /(이어서|계속|resume|continue|다시|중단된)/i.test(task);
}

function toPhaseLabel(phase: AgentPhase): string {
  switch (phase) {
    case 'planning':
      return '판단 분석 중';
    case 'decision':
      return '판단 선택 중';
    case 'implementation':
      return '구현 중';
    case 'verification':
      return '검증 중';
    case 'complete':
      return '완료';
    default:
      return '';
  }
}

function normalizeRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!normalized) {
    throw new Error('빈 파일 경로는 사용할 수 없습니다.');
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`절대 경로는 허용하지 않습니다: ${input}`);
  }
  if (normalized.startsWith('~') || normalized.includes('$HOME') || normalized.includes('%USERPROFILE%')) {
    throw new Error(`홈 디렉터리 경로는 허용하지 않습니다: ${input}`);
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`워크스페이스 밖으로 나가는 경로는 허용하지 않습니다: ${input}`);
  }

  return segments.join('/');
}

function isSensitivePath(relativePath: string): boolean {
  const normalized = relativePath.toLowerCase();
  const fileName = normalized.split('/').pop() ?? normalized;
  return fileName === '.env'
    || fileName.startsWith('.env.')
    || normalized.includes('/.env')
    || normalized.includes('secret')
    || normalized.includes('credential')
    || normalized.includes('private-key')
    || fileName.endsWith('.pem')
    || fileName.endsWith('.key')
    || fileName === 'id_rsa'
    || fileName === 'id_dsa';
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function countLines(content: string): number {
  if (!content) {
    return 0;
  }
  return content.split(/\r?\n/).length;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

