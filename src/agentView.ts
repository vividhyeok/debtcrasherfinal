import * as vscode from 'vscode';

import {
  AIClient,
  DecisionCompleteResponse,
  DecisionHistoryEntry,
  DecisionPromptResponse,
  ImplementationFile
} from './aiClient';
import { WorkspaceContextService } from './context/WorkspaceContextService';
import { DecisionLogEntryInput, LogManager } from './logManager';

interface SubmitTaskMessage { type: 'submitTask'; requestId: string; task: string; }
interface ConfirmDecisionMessage { type: 'confirmDecision'; requestId: string; choiceType: 'A' | 'B' | 'custom'; customChoice?: string; }
interface NewSessionMessage { type: 'newSession'; }
type AgentViewMessage =
  | SubmitTaskMessage
  | ConfirmDecisionMessage
  | NewSessionMessage
  | { type: 'ready' }
  | { type: 'openSettings' };

interface PendingDecisionSession {
  task: string;
  history: DecisionHistoryEntry[];
  currentTurn: DecisionPromptResponse;
}

const textEncoder = new TextEncoder();

export class AgentViewController implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly sessions = new Map<string, PendingDecisionSession>();
  private readonly viewDisposables: vscode.Disposable[] = [];

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly aiClient: AIClient,
    private readonly logManager: LogManager,
    private readonly workspaceContextService: WorkspaceContextService
  ) {}

  public show(): void {
    this.view?.show(false);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeViewDisposables();
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage((message: AgentViewMessage) => {
        void this.handleMessage(message);
      }),
      webviewView.onDidDispose(() => {
        this.disposeViewDisposables();
        if (this.view === webviewView) {
          this.view = undefined;
        }
        this.sessions.clear();
      })
    );
  }

  public dispose(): void {
    this.disposeViewDisposables();
    this.view = undefined;
    this.sessions.clear();
  }

  private disposeViewDisposables(): void {
    while (this.viewDisposables.length > 0) {
      this.viewDisposables.pop()?.dispose();
    }
  }

  private async handleMessage(message: AgentViewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.postBootstrapState();
        return;
      case 'newSession':
        this.sessions.clear();
        await this.postBootstrapState();
        return;
      case 'submitTask':
        await this.handleSubmitTask(message);
        return;
      case 'confirmDecision':
        await this.handleConfirmDecision(message);
        return;
      case 'openSettings':
        await vscode.commands.executeCommand('debtcrasher.openSettings');
        return;
      default:
        return;
    }
  }

  private async postBootstrapState(): Promise<void> {
    const [provider, questionFilterLevel] = await Promise.all([
      this.aiClient.getProviderSummary(),
      this.aiClient.getQuestionFilterLevel()
    ]);

    this.postMessage({
      type: 'workspaceState',
      hasWorkspace: Boolean(this.logManager.getWorkspaceRootUri()),
      provider,
      questionFilterLevel
    });
  }

  private async handleSubmitTask(message: SubmitTaskMessage): Promise<void> {
    const task = message.task.trim();
    if (!task) {
      this.postError('질문이나 작업 요청을 입력해 주세요.', message.requestId);
      return;
    }

    try {
      if (!this.logManager.getWorkspaceRootUri()) {
        throw new Error('워크스페이스 폴더가 열려 있어야 구현 파일을 생성할 수 있습니다.');
      }

      this.postPhaseUpdate(
        message.requestId,
        '현재 작업: 파일 구조와 AGENT.md를 먼저 읽고, 이미 정해진 내용과 이번 요청에서 직접 결정해야 할 고레버리지 판단을 분리하는 중입니다.'
      );

      const workspaceContext = await this.workspaceContextService.buildWorkspaceSnapshot(this.logManager.getWorkspaceRootUri());
      const referenceContext = await this.logManager.readProjectGuideContext();
      const turn = await this.aiClient.generateDecision(task, [], workspaceContext, referenceContext);

      if (turn.status === 'complete') {
        throw new Error('Debtcrasher는 첫 턴에 반드시 고레버리지 판단 질문을 받아야 합니다.');
      }

      this.sessions.set(message.requestId, { task, history: [], currentTurn: turn });
      this.postMessage({ type: 'decisionResponse', requestId: message.requestId, turn });
    } catch (error) {
      this.postError(toErrorMessage(error), message.requestId);
    }
  }

  private async handleConfirmDecision(message: ConfirmDecisionMessage): Promise<void> {
    const session = this.sessions.get(message.requestId);
    if (!session) {
      this.postError('현재 진행 중인 판단 세션을 찾지 못했습니다.', message.requestId);
      return;
    }

    const resolvedChoice = resolveChoice(message, session.currentTurn);
    if (!resolvedChoice) {
      this.postError('옵션 A/B를 선택하거나 직접 선택 내용을 입력해 주세요.', message.requestId);
      return;
    }

    try {
      const logEntry: DecisionLogEntryInput = {
        title: session.currentTurn.shortTitle,
        date: new Date().toISOString(),
        question: session.task,
        optionA: summarizeOption('A', session.currentTurn.optionA),
        optionB: summarizeOption('B', session.currentTurn.optionB),
        userChoice: resolvedChoice.userChoice,
        outcome: resolvedChoice.outcome
      };

      await this.logManager.appendDecision(logEntry);
      await this.logManager.syncProjectGuide(session.task);

      const nextHistory: DecisionHistoryEntry[] = [
        ...session.history,
        {
          title: session.currentTurn.shortTitle,
          decisionPoint: session.currentTurn.decisionPoint,
          userChoice: resolvedChoice.userChoice,
          outcome: resolvedChoice.outcome
        }
      ];

      this.postPhaseUpdate(
        message.requestId,
        '현재 작업: 방금 확정된 판단을 AGENT.md와 DECISIONS.md에 반영하고, 추가 질문이 정말 필요한지 다시 확인하는 중입니다.'
      );

      const workspaceContext = await this.workspaceContextService.buildWorkspaceSnapshot(this.logManager.getWorkspaceRootUri());
      const referenceContext = await this.logManager.readProjectGuideContext();
      const nextTurn = await this.aiClient.generateDecision(session.task, nextHistory, workspaceContext, referenceContext);

      if (nextTurn.status === 'complete') {
        this.sessions.delete(message.requestId);
        await this.finishTask(message.requestId, session.task, nextHistory, nextTurn);
        return;
      }

      this.sessions.set(message.requestId, { ...session, history: nextHistory, currentTurn: nextTurn });
      this.postMessage({ type: 'decisionResponse', requestId: message.requestId, turn: nextTurn, followUp: true });
    } catch (error) {
      this.postError(toErrorMessage(error), message.requestId);
    }
  }

  private async finishTask(
    requestId: string,
    task: string,
    history: DecisionHistoryEntry[],
    completion: DecisionCompleteResponse
  ): Promise<void> {
    this.postMessage({
      type: 'completionResponse',
      requestId,
      summary: completion.completionSummary,
      shortTitle: completion.shortTitle,
      currentWork: completion.currentWork,
      taskSummary: completion.taskSummary,
      implementationPlan: completion.implementationPlan,
      verificationPlan: completion.verificationPlan
    });

    this.postPhaseUpdate(requestId, '현재 작업: 확정된 판단을 기준으로 실제 구현 파일과 실행 가능한 결과를 생성하는 중입니다.');

    try {
      await this.logManager.syncProjectGuide(task, completion.completionSummary);
      const workspaceContext = await this.workspaceContextService.buildWorkspaceSnapshot(this.logManager.getWorkspaceRootUri());
      const referenceContext = await this.logManager.readProjectGuideContext();
      const implementation = await this.aiClient.generateImplementation(task, history, workspaceContext, referenceContext);
      const files = await this.writeImplementationFiles(implementation.files);
      const guideUri = await this.logManager.syncProjectGuide(task, implementation.summary);

      await this.openFirstGeneratedFile(files);

      this.postMessage({
        type: 'implementationResponse',
        requestId,
        currentWork: implementation.currentWork,
        summary: implementation.summary,
        files: files.map((file, index) => ({
          path: file.path,
          description: implementation.files[index]?.description ?? ''
        })),
        runInstructions: implementation.runInstructions,
        guidePath: guideUri ? vscode.workspace.asRelativePath(guideUri, false) : ''
      });
    } catch (error) {
      this.postError(toErrorMessage(error), requestId);
    }
  }

  private async writeImplementationFiles(files: ImplementationFile[]): Promise<Array<{ path: string; uri: vscode.Uri }>> {
    const workspaceRoot = this.logManager.getWorkspaceRootUri();
    if (!workspaceRoot) {
      throw new Error('워크스페이스 폴더가 열려 있지 않습니다.');
    }
    if (files.length === 0) {
      throw new Error('AI가 생성할 파일을 반환하지 않았습니다.');
    }

    const written: Array<{ path: string; uri: vscode.Uri }> = [];

    for (const file of files) {
      const normalizedPath = normalizeRelativePath(file.path);
      const segments = normalizedPath.split('/');
      const fileName = segments.pop();
      if (!fileName) {
        throw new Error(`잘못된 파일 경로입니다: ${file.path}`);
      }

      if (segments.length > 0) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceRoot, ...segments));
      }

      const targetUri = vscode.Uri.joinPath(workspaceRoot, ...segments, fileName);
      await vscode.workspace.fs.writeFile(targetUri, textEncoder.encode(file.content));
      written.push({ path: normalizedPath, uri: targetUri });
    }

    return written;
  }

  private async openFirstGeneratedFile(files: Array<{ path: string; uri: vscode.Uri }>): Promise<void> {
    const firstFile = files[0];
    if (!firstFile) {
      return;
    }

    const document = await vscode.workspace.openTextDocument(firstFile.uri);
    await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
  }

  private postPhaseUpdate(requestId: string, message: string): void {
    this.postMessage({ type: 'phaseUpdate', requestId, message });
  }

  private postError(message: string, requestId?: string): void {
    this.postMessage({ type: 'error', requestId, message });
  }

  private postMessage(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'agent.css'));
    const nonce = createNonce();
    const plusIcon = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M8 2.5V13.5M2.5 8H13.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
    const planeIcon = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M2 2L14 8L2 14L4.6 8L2 2Z" fill="currentColor"/></svg>`;
    const settingsIcon = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M8 1.5L9 3.4L11.2 3.8L10.1 5.7L10.6 8L8.5 7.2L6.5 8L6.9 5.7L5.8 3.8L8 3.4L8 1.5ZM3.3 9.2L4.5 10L5 11.5L6.5 12L7.3 13.2L6 14.3L4.8 13.5L3.3 13L2.8 11.5L1.7 10.3L3.3 9.2ZM12.7 9.2L14.3 10.3L13.2 11.5L12.7 13L11.2 13.5L10 14.3L8.7 13.2L9.5 12L11 11.5L11.5 10L12.7 9.2Z" fill="currentColor"/></svg>`;

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
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
        <button id="settingsToggleButton" class="icon-button" title="Settings">${settingsIcon}</button>
        <button id="newSessionBtn" class="icon-button" title="New Session">${plusIcon}</button>
      </div>
    </header>

    <section id="settingsPanel" class="settings-panel hidden">
      <div class="settings-row">
        <div class="settings-copy">
          <p class="settings-title">설정은 VS Code에서 변경</p>
          <p id="settingsSummary" class="settings-description">현재 적용된 제공자, 모델, 질문 수준을 불러오는 중입니다.</p>
        </div>
      </div>
      <div class="settings-row settings-row-secondary">
        <button id="openSettingsButton" type="button" class="secondary-button">VS Code 설정 열기</button>
      </div>
    </section>

    <main id="thread" class="thread" aria-live="polite">
      <article class="message message-assistant">
        <div class="message-role">Agent</div>
        <div class="bubble system-bubble">
          <p class="system-title">기본 흐름</p>
          <p>일반 개발 에이전트처럼 요청 이해, 파일 구조 확인, 구현 계획, 실제 파일 생성, 실행/검증 포인트 정리까지 진행합니다.</p>
          <p>Debtcrasher는 구현 전에 고레버리지 판단을 개발자가 직접 결정하게 만들고, 그 판단을 다시 학습 가능한 기록으로 남깁니다.</p>
        </div>
      </article>
    </main>

    <form id="inputForm" class="composer">
      <label for="userInput" class="composer-label">개발 요청</label>
      <textarea id="userInput" class="input-box" rows="4" placeholder="예: React + Vite + TypeScript로 빠르게 프로토타입을 만들고 싶어. 구조는 단순하게 가고, 구현은 바로 시작해도 돼."></textarea>
      <div class="composer-footer">
        <p class="composer-hint">요청에 이미 드러난 스택, 구조, 제약은 다시 묻지 않습니다. Enter로 전송하고 Shift+Enter로 줄바꿈합니다.</p>
        <button type="submit" id="sendBtn" class="send-btn" title="Send">${planeIcon}</button>
      </div>
    </form>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const thread = document.getElementById('thread');
    const inputForm = document.getElementById('inputForm');
    const userInput = document.getElementById('userInput');
    const newSessionBtn = document.getElementById('newSessionBtn');
    const settingsToggleButton = document.getElementById('settingsToggleButton');
    const settingsPanel = document.getElementById('settingsPanel');
    const openSettingsButton = document.getElementById('openSettingsButton');
    const settingsSummary = document.getElementById('settingsSummary');
    const environmentMeta = document.getElementById('environmentMeta');

    const filterLabelMap = { high: '핵심만', medium: '중요한 것만', low: '모두' };
    const state = { questionFilterLevel: 'medium', provider: null, hasWorkspace: false };

    userInput.focus();

    function escapeHtml(value) {
      if (!value) return '';
      return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function scrollToBottom() { thread.scrollTop = thread.scrollHeight; }

    function updateEnvironmentMeta(provider, hasWorkspace) {
      if (!provider) return;
      environmentMeta.textContent = provider.displayName + ' / ' + provider.model + ' / 질문 수준: ' + filterLabelMap[state.questionFilterLevel] + ' / 워크스페이스 ' + (hasWorkspace ? '연결됨' : '없음');
    }

    function updateSettingsSummary(provider) {
      if (!provider) return;
      settingsSummary.textContent = '제공자 ' + provider.displayName + ', 모델 ' + provider.model + ', 질문 수준 ' + filterLabelMap[state.questionFilterLevel] + '이 적용되어 있습니다. 변경은 VS Code 설정창에서 합니다.';
    }

    function appendMessage(role, kind, html) {
      const msg = document.createElement('article');
      msg.className = 'message ' + kind;
      msg.innerHTML = '<div class="message-role">' + role + '</div><div class="bubble">' + html + '</div>';
      thread.appendChild(msg);
      scrollToBottom();
      return msg;
    }

    function appendUserMessage(text) {
      appendMessage('You', 'message-user', '<p>' + escapeHtml(text).replace(/\\n/g, '<br>') + '</p>');
    }

    function appendAgentText(text, extraClass) {
      appendMessage('Agent', 'message-assistant ' + (extraClass || ''), '<p>' + escapeHtml(text).replace(/\\n/g, '<br>') + '</p>');
    }

    function renderPlanList(items) {
      if (!items || items.length === 0) return '<p class="empty-line">없음</p>';
      return '<ol class="plan-list">' + items.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') + '</ol>';
    }

    function appendWorkflowCard(payload, variant) {
      appendMessage('Agent', 'message-assistant workflow-message ' + (variant || ''), [
        '<div class="workflow-head">',
        '  <p class="decision-point-label">' + escapeHtml(payload.shortTitle || 'Workflow') + '</p>',
        '  <span class="decision-badge">' + escapeHtml(variant === 'decision-gated' ? 'Decision Gate' : 'Execution Plan') + '</span>',
        '</div>',
        '<p class="workflow-current">' + escapeHtml(payload.currentWork || '') + '</p>',
        '<div class="summary-grid">',
        '  <section class="summary-card"><p class="tradeoff-title">작업 이해</p><p>' + escapeHtml(payload.taskSummary || '') + '</p></section>',
        '  <section class="summary-card"><p class="tradeoff-title">구현 계획</p>' + renderPlanList(payload.implementationPlan || []) + '</section>',
        '  <section class="summary-card"><p class="tradeoff-title">검증 계획</p>' + renderPlanList(payload.verificationPlan || []) + '</section>',
        '</div>'
      ].join(''));
    }

    function renderOptionHtml(choice, option) {
      return [
        '<section class="option-card">',
        '  <button type="button" class="option-select" data-choice="' + choice + '">',
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

    function appendDecisionCard(requestId, turn, followUp) {
      const lead = followUp
        ? '이전 선택을 반영했고, 지금 남은 질문도 실제로 구조를 바꾸는지 다시 확인한 뒤 제시합니다.'
        : '바로 구현에 들어가기 전에, 이 프로젝트에서 나중에도 다시 참고할 가치가 있는 판단 하나를 먼저 확정합니다.';

      const cardHtml = [
        '<div class="decision-head">',
        '  <p class="decision-point-label">' + escapeHtml(turn.shortTitle) + '</p>',
        '  <span class="decision-badge">Decision</span>',
        '</div>',
        '<p class="decision-lead">' + escapeHtml(lead) + '</p>',
        '<h2>' + escapeHtml(turn.decisionPoint) + '</h2>',
        '<p class="decision-question">' + escapeHtml(turn.question) + '</p>',
        '<div class="options-grid">',
        renderOptionHtml('A', turn.optionA),
        renderOptionHtml('B', turn.optionB),
        '</div>',
        '<div class="custom-choice">',
        '  <label for="custom-' + requestId + '">직접 선택 입력</label>',
        '  <input id="custom-' + requestId + '" type="text" placeholder="예: 단일 파일 프로토타입으로 빠르게 진행" />',
        '</div>',
        '<div class="decision-actions"><button type="button" class="confirm-button" data-request-id="' + requestId + '">선택 확정</button></div>'
      ].join('');

      const msg = appendMessage('Agent', 'message-assistant decision-message', cardHtml);
      const optionButtons = msg.querySelectorAll('.option-select');
      const customInput = msg.querySelector('input');
      const confirmButton = msg.querySelector('.confirm-button');
      let selected = '';

      optionButtons.forEach((button) => {
        button.addEventListener('click', () => {
          selected = button.dataset.choice || '';
          optionButtons.forEach((item) => item.classList.remove('is-selected'));
          button.classList.add('is-selected');
          if (customInput) customInput.value = '';
        });
      });

      customInput?.addEventListener('input', () => {
        if (customInput.value.trim()) {
          selected = 'custom';
          optionButtons.forEach((item) => item.classList.remove('is-selected'));
        }
      });

      confirmButton?.addEventListener('click', () => {
        const customChoice = customInput ? customInput.value.trim() : '';
        const choiceType = customChoice ? 'custom' : selected;
        vscode.postMessage({ type: 'confirmDecision', requestId, choiceType, customChoice });
        confirmButton.setAttribute('disabled', 'true');
      });
    }

    function appendImplementationResult(message) {
      const filesHtml = (message.files || []).map((file) => '<li><code>' + escapeHtml(file.path) + '</code><span>' + escapeHtml(file.description || '') + '</span></li>').join('');
      const runHtml = (message.runInstructions || []).map((step) => '<li>' + escapeHtml(step) + '</li>').join('');
      const guideHtml = message.guidePath ? '<div class="result-block"><p class="tradeoff-title">기준 문서</p><p><code>' + escapeHtml(message.guidePath) + '</code></p></div>' : '';

      appendMessage('Agent', 'message-assistant result-message', [
        '<p class="decision-point-label">Implementation Result</p>',
        '<h2>' + escapeHtml(message.currentWork || '구현 완료') + '</h2>',
        '<p class="decision-question">' + escapeHtml(message.summary || '') + '</p>',
        guideHtml,
        filesHtml ? '<div class="result-block"><p class="tradeoff-title">생성 파일</p><ul class="result-list">' + filesHtml + '</ul></div>' : '',
        runHtml ? '<div class="result-block"><p class="tradeoff-title">실행 / 검증</p><ol class="result-list">' + runHtml + '</ol></div>' : ''
      ].join(''));
    }

    function submitCurrentTask() {
      const text = userInput.value.trim();
      if (!text) return;
      appendUserMessage(text);
      userInput.value = '';
      const requestId = Date.now().toString() + '-' + Math.random().toString(16).slice(2);
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

    newSessionBtn.addEventListener('click', () => {
      thread.innerHTML = '';
      appendAgentText('새 세션을 시작했습니다. 다음 작업 목표를 적어 주세요.', 'system-bubble');
      vscode.postMessage({ type: 'newSession' });
      userInput.focus();
    });

    settingsToggleButton.addEventListener('click', () => {
      settingsPanel.classList.toggle('hidden');
    });

    openSettingsButton.addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;

      if (message.type === 'workspaceState') {
        state.provider = message.provider;
        state.hasWorkspace = Boolean(message.hasWorkspace);
        state.questionFilterLevel = message.questionFilterLevel || 'medium';
        updateEnvironmentMeta(state.provider, state.hasWorkspace);
        updateSettingsSummary(state.provider);
        return;
      }

      if (message.type === 'phaseUpdate') {
        appendAgentText(message.message, 'status-message');
        return;
      }

      if (message.type === 'decisionResponse') {
        appendWorkflowCard(message.turn, 'decision-gated');
        appendDecisionCard(message.requestId, message.turn, Boolean(message.followUp));
        return;
      }

      if (message.type === 'completionResponse') {
        appendWorkflowCard(message, 'execution-ready');
        appendAgentText('판단 정리가 끝났습니다. 이제 실제 구현 단계로 들어갑니다.', 'status-message');
        return;
      }

      if (message.type === 'implementationResponse') {
        appendImplementationResult(message);
        return;
      }

      if (message.type === 'error') {
        appendAgentText('오류: ' + message.message, 'error-message');
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function resolveChoice(message: ConfirmDecisionMessage, turn: DecisionPromptResponse): { userChoice: string; outcome: string } | undefined {
  if (message.choiceType === 'A') {
    return { userChoice: `Option A - ${turn.optionA.label}`, outcome: `${turn.optionA.label} 방향으로 구현을 진행합니다.` };
  }
  if (message.choiceType === 'B') {
    return { userChoice: `Option B - ${turn.optionB.label}`, outcome: `${turn.optionB.label} 방향으로 구현을 진행합니다.` };
  }

  const customChoice = message.customChoice?.trim();
  if (!customChoice) {
    return undefined;
  }

  return { userChoice: `Custom - ${customChoice}`, outcome: `${customChoice} 기준으로 구현을 진행합니다.` };
}

function summarizeOption(choice: 'A' | 'B', option: { label: string; pros: string[]; cons: string[] }): string {
  return `${choice} - ${option.label} | 장점: ${option.pros.join(', ')} | 단점: ${option.cons.join(', ')}`;
}

function normalizeRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!normalized) {
    throw new Error('빈 파일 경로는 사용할 수 없습니다.');
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`절대 경로는 허용되지 않습니다: ${input}`);
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`워크스페이스 밖으로 나가는 경로는 허용되지 않습니다: ${input}`);
  }

  return segments.join('/');
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
