import * as vscode from 'vscode';

import { AIClient } from './aiClient';
import { LogManager } from './logManager';
import { validateTutorialMarkdown } from './tutorialValidator';

type StepViewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'generateTutorial'; entryIds: string[] }
  | { type: 'openSavedTutorial'; uri: string }
  | { type: 'openSettings' };

export class StepViewController implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly viewDisposables: vscode.Disposable[] = [];
  private readonly watcherDisposables: vscode.Disposable[] = [];

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly aiClient: AIClient,
    private readonly logManager: LogManager
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
      webviewView.webview.onDidReceiveMessage((message: StepViewMessage) => {
        void this.handleMessage(message);
      }),
      webviewView.onDidDispose(() => {
        this.disposeViewDisposables();
        this.disposeWatchers();
        if (this.view === webviewView) {
          this.view = undefined;
        }
      })
    );

    this.setupWatchers();
  }

  public dispose(): void {
    this.disposeViewDisposables();
    this.disposeWatchers();
    this.view = undefined;
  }

  private disposeViewDisposables(): void {
    while (this.viewDisposables.length > 0) {
      this.viewDisposables.pop()?.dispose();
    }
  }

  private disposeWatchers(): void {
    while (this.watcherDisposables.length > 0) {
      this.watcherDisposables.pop()?.dispose();
    }
  }

  private setupWatchers(): void {
    this.disposeWatchers();

    const workspaceFolder = this.logManager.getWorkspaceFolder();

    if (!workspaceFolder) {
      return;
    }

    const logWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceFolder, 'DECISIONS.md')
    );
    const tutorialWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceFolder, '.ai-tutorials/*.md')
    );

    const refresh = () => {
      void this.refreshState();
    };

    this.watcherDisposables.push(
      logWatcher,
      tutorialWatcher,
      logWatcher.onDidCreate(refresh),
      logWatcher.onDidChange(refresh),
      logWatcher.onDidDelete(refresh),
      tutorialWatcher.onDidCreate(refresh),
      tutorialWatcher.onDidChange(refresh),
      tutorialWatcher.onDidDelete(refresh)
    );
  }

  private async handleMessage(message: StepViewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
      case 'refresh':
        await this.refreshState();
        return;
      case 'generateTutorial':
        await this.handleGenerateTutorial(message.entryIds);
        return;
      case 'openSavedTutorial':
        await this.handleOpenSavedTutorial(message.uri);
        return;
      case 'openSettings':
        await vscode.commands.executeCommand('debtcrasher.openSettings');
        return;
      default:
        return;
    }
  }

  private async refreshState(): Promise<void> {
    try {
      const [entries, history] = await Promise.all([
        this.logManager.readLogEntries(),
        this.logManager.listSavedTutorials()
      ]);

      this.postMessage({
        type: 'state',
        hasWorkspace: Boolean(this.logManager.getWorkspaceRootUri()),
        traceabilityMode: this.aiClient.getTraceabilityMode(),
        entries,
        history
      });
    } catch (error) {
      this.postMessage({
        type: 'state',
        hasWorkspace: Boolean(this.logManager.getWorkspaceRootUri()),
        traceabilityMode: this.aiClient.getTraceabilityMode(),
        entries: [],
        history: []
      });
      this.postError(toErrorMessage(error));
    }
  }

  private async handleGenerateTutorial(entryIds: string[]): Promise<void> {
    try {
      if (entryIds.length === 0) {
        throw new Error('최소 한 개 이상의 step을 선택해 주세요.');
      }

      const entries = await this.logManager.readLogEntries();
      const selectedEntries = entryIds
        .map((entryId) => entries.find((entry) => entry.id === entryId))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

      if (selectedEntries.length === 0) {
        throw new Error('선택한 step을 찾지 못했습니다.');
      }

      const [projectGuideContent, lastImplementationSummary] = await Promise.all([
        this.logManager.readAgentGuideContent(),
        this.logManager.readLatestImplementationSummary()
      ]);
      const traceabilityMode = this.aiClient.getTraceabilityMode();
      const rawMarkdown = await this.aiClient.generateTutorial(
        selectedEntries,
        {
          projectGuideContent,
          lastImplementationSummary
        },
        { traceabilityMode }
      );
      const { markdown, report } = validateTutorialMarkdown(rawMarkdown, selectedEntries, traceabilityMode);
      const title = buildTutorialTitle(selectedEntries);
      const tutorialUri = await this.logManager.saveTutorial(title, markdown);

      await this.refreshState();
      await this.openMarkdownDocument(tutorialUri);

      this.postMessage({
        type: 'tutorialGenerated',
        uri: tutorialUri.toString(),
        count: selectedEntries.length,
        title,
        validation: report,
        traceabilityMode
      });
    } catch (error) {
      this.postError(toErrorMessage(error));
    }
  }

  private async handleOpenSavedTutorial(uri: string): Promise<void> {
    try {
      await this.openMarkdownDocument(vscode.Uri.parse(uri));
    } catch (error) {
      this.postError(toErrorMessage(error));
    }
  }

  private async openMarkdownDocument(uri: vscode.Uri): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false
    });
  }

  private postError(message: string): void {
    this.postMessage({
      type: 'error',
      message
    });
  }

  private postMessage(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'step.css'));
    const codiconCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
    );
    const nonce = createNonce();

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${codiconCssUri}">
  <link rel="stylesheet" href="${cssUri}">
  <title>Step View</title>
</head>
<body>
  <div class="app-shell">
    <header class="toolbar">
      <div class="toolbar-copy">
        <p class="kicker">Step View</p>
        <h1>Decision Archive</h1>
        <p class="toolbar-subtitle">선택한 step을 판단 기록 문서로 저장하고 기존 기록은 바로 편집기에서 다시 엽니다.</p>
      </div>
      <div class="toolbar-actions">
        <button id="refreshButton" class="icon-button" title="Refresh" aria-label="새로고침"><i class="codicon codicon-refresh"></i></button>
        <button id="settingsButton" class="icon-button" title="Settings" aria-label="설정"><i class="codicon codicon-settings-gear"></i></button>
      </div>
    </header>

    <div id="workspaceNotice" class="notice hidden">워크스페이스를 열어야 step 로그와 저장된 markdown 기록을 사용할 수 있습니다.</div>
    <div id="modeNotice" class="notice"></div>
    <div id="statusBanner" class="status-banner hidden"></div>
    <div id="errorBanner" class="error-banner hidden"></div>

    <div id="workbench" class="workbench">
      <section id="stepsSection" class="split-section top-section" style="flex-basis: 58%;">
        <div id="stepsHeader" class="section-header resize-handle">
          <div class="header-copy">
            <p class="section-label">Decision Steps</p>
            <h2>기록된 step</h2>
          </div>
          <div class="header-actions">
            <span id="stepsMeta" class="header-meta">0개 선택</span>
            <button id="selectAllButton" class="secondary-button" type="button" data-no-drag="true">전체 선택</button>
            <button id="clearSelectionButton" class="secondary-button" type="button" data-no-drag="true" disabled>선택 해제</button>
            <button id="generateButton" class="primary-button button-with-icon" type="button" data-no-drag="true" disabled><i class="codicon codicon-notebook"></i><span>문서 생성</span></button>
          </div>
        </div>
        <div id="stepsList" class="section-scroll step-list"></div>
      </section>

      <div id="splitDivider" class="split-divider" role="separator" aria-orientation="horizontal" aria-label="Resize step and history panels"></div>

      <section id="historySection" class="split-section bottom-section">
        <div id="historyHeader" class="section-header resize-handle">
          <div class="header-copy">
            <p class="section-label">History</p>
            <h2>저장된 markdown</h2>
          </div>
          <div class="header-actions">
            <span id="historyMeta" class="header-meta">0개 파일</span>
          </div>
        </div>
        <div id="historyList" class="section-scroll history-list"></div>
      </section>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const workbench = document.getElementById('workbench');
    const stepsSection = document.getElementById('stepsSection');
    const stepsHeader = document.getElementById('stepsHeader');
    const historyHeader = document.getElementById('historyHeader');
    const splitDivider = document.getElementById('splitDivider');
    const stepsList = document.getElementById('stepsList');
    const historyList = document.getElementById('historyList');
    const generateButton = document.getElementById('generateButton');
    const selectAllButton = document.getElementById('selectAllButton');
    const clearSelectionButton = document.getElementById('clearSelectionButton');
    const stepsMeta = document.getElementById('stepsMeta');
    const historyMeta = document.getElementById('historyMeta');
    const workspaceNotice = document.getElementById('workspaceNotice');
    const modeNotice = document.getElementById('modeNotice');
    const statusBanner = document.getElementById('statusBanner');
    const errorBanner = document.getElementById('errorBanner');

    const MIN_SECTION_HEIGHT = 80;
    const state = {
      entries: [],
      history: [],
      selectedIds: new Set(),
      isGenerating: false,
      traceabilityMode: 'basic'
    };

    let isDragging = false;

    function escapeHtml(value) {
      if (!value) return '';
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function showError(message) {
      errorBanner.textContent = message;
      errorBanner.classList.remove('hidden');
    }

    function clearError() {
      errorBanner.textContent = '';
      errorBanner.classList.add('hidden');
    }

    function showStatus(message) {
      statusBanner.textContent = message;
      statusBanner.classList.remove('hidden');
    }

    function clearStatus() {
      statusBanner.textContent = '';
      statusBanner.classList.add('hidden');
    }

    function pruneSelection() {
      const validIds = new Set((state.entries || []).map((entry) => entry.id));
      Array.from(state.selectedIds).forEach((id) => {
        if (!validIds.has(id)) {
          state.selectedIds.delete(id);
        }
      });
    }

    function updateButtons() {
      const selectedCount = state.selectedIds.size;
      const totalCount = state.entries.length;
      const hasSelection = selectedCount > 0;
      const hasEntries = totalCount > 0;
      const allSelected = hasEntries && selectedCount === totalCount;

      generateButton.innerHTML = state.isGenerating
        ? '<i class="codicon codicon-loading codicon-modifier-spin"></i><span>생성 중...</span>'
        : '<i class="codicon codicon-notebook"></i><span>문서 생성</span>';
      selectAllButton.textContent = allSelected ? '모두 선택됨' : '전체 선택';

      if (hasSelection && !state.isGenerating) {
        generateButton.removeAttribute('disabled');
      } else {
        generateButton.setAttribute('disabled', 'true');
      }

      if (hasEntries && !allSelected && !state.isGenerating) {
        selectAllButton.removeAttribute('disabled');
      } else {
        selectAllButton.setAttribute('disabled', 'true');
      }

      if (hasSelection && !state.isGenerating) {
        clearSelectionButton.removeAttribute('disabled');
      } else {
        clearSelectionButton.setAttribute('disabled', 'true');
      }
    }

    function updateMeta() {
      const selectedCount = state.selectedIds.size;
      const totalCount = state.entries.length;
      stepsMeta.textContent = selectedCount + ' / ' + totalCount + '개 선택';
      historyMeta.textContent = state.history.length + '개 파일';
      updateButtons();
    }

    function renderSteps() {
      pruneSelection();

      if (!state.entries || state.entries.length === 0) {
        stepsList.innerHTML = '<p class="empty-state">기록된 step이 없습니다.</p>';
        updateMeta();
        return;
      }

      stepsList.innerHTML = state.entries.map((entry) => {
        const checked = state.selectedIds.has(entry.id);
        return [
          '<label class="step-item ' + (checked ? 'is-selected' : '') + '">',
          '  <input type="checkbox" data-id="' + escapeHtml(entry.id) + '" ' + (checked ? 'checked' : '') + ' />',
          '  <span class="step-title">' + escapeHtml(entry.title) + '</span>',
          '</label>'
        ].join('');
      }).join('');

      stepsList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
          const id = checkbox.dataset.id;
          if (!id) {
            return;
          }

          if (checkbox.checked) {
            state.selectedIds.add(id);
          } else {
            state.selectedIds.delete(id);
          }

          renderSteps();
        });
      });

      updateMeta();
    }

    function formatDateTime(value) {
      try {
        return new Date(value).toLocaleString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch {
        return '';
      }
    }

    function getFileName(item) {
      const match = String(item.uri || '').match(/([^/]+)$/);
      return match ? decodeURIComponent(match[1]) : ((item.title || 'tutorial') + '.md');
    }

    function renderHistory() {
      if (!state.history || state.history.length === 0) {
        historyList.innerHTML = '<p class="empty-state">저장된 markdown 파일이 없습니다.</p>';
        updateMeta();
        return;
      }

      historyList.innerHTML = state.history.map((item) => {
        return [
          '<button type="button" class="history-item" data-uri="' + escapeHtml(item.uri) + '">',
          '  <span class="history-name">' + escapeHtml(getFileName(item)) + '</span>',
          '  <span class="history-time">' + escapeHtml(formatDateTime(item.updatedAt)) + '</span>',
          '</button>'
        ].join('');
      }).join('');

      historyList.querySelectorAll('.history-item').forEach((button) => {
        button.addEventListener('click', () => {
          const uri = button.dataset.uri || '';
          if (!uri) {
            return;
          }

          clearStatus();
          clearError();
          vscode.postMessage({
            type: 'openSavedTutorial',
            uri
          });
        });
      });

      updateMeta();
    }

    function applySplit(clientY) {
      const rect = workbench.getBoundingClientRect();
      const dividerHeight = splitDivider.offsetHeight || 6;
      const maxTopHeight = rect.height - dividerHeight - MIN_SECTION_HEIGHT;
      const nextTopHeight = Math.min(
        Math.max(clientY - rect.top, MIN_SECTION_HEIGHT),
        maxTopHeight
      );

      stepsSection.style.flexBasis = nextTopHeight + 'px';
    }

    function beginResize(event) {
      if (event.target.closest('[data-no-drag="true"]')) {
        return;
      }

      isDragging = true;
      document.body.classList.add('is-resizing');
      event.preventDefault();
    }

    function selectAllSteps() {
      state.entries.forEach((entry) => state.selectedIds.add(entry.id));
      renderSteps();
      showStatus('현재 보이는 step을 모두 선택했습니다.');
    }

    function clearSelection() {
      if (state.selectedIds.size === 0) {
        return;
      }

      state.selectedIds.clear();
      renderSteps();
      showStatus('선택한 step을 모두 해제했습니다.');
    }

    window.addEventListener('mousemove', (event) => {
      if (!isDragging) {
        return;
      }

      applySplit(event.clientY);
    });

    window.addEventListener('mouseup', () => {
      if (!isDragging) {
        return;
      }

      isDragging = false;
      document.body.classList.remove('is-resizing');
    });

    [stepsHeader, historyHeader, splitDivider].forEach((element) => {
      element.addEventListener('mousedown', beginResize);
    });

    document.getElementById('refreshButton').addEventListener('click', () => {
      clearError();
      clearStatus();
      vscode.postMessage({ type: 'refresh' });
    });

    document.getElementById('settingsButton').addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' });
    });

    selectAllButton.addEventListener('click', () => {
      if (selectAllButton.hasAttribute('disabled')) {
        return;
      }

      clearError();
      selectAllSteps();
    });

    clearSelectionButton.addEventListener('click', () => {
      if (clearSelectionButton.hasAttribute('disabled')) {
        return;
      }

      clearError();
      clearSelection();
    });

    generateButton.addEventListener('click', () => {
      if (state.selectedIds.size === 0 || state.isGenerating) {
        return;
      }

      clearError();
      clearStatus();
      state.isGenerating = true;
      updateButtons();

      vscode.postMessage({
        type: 'generateTutorial',
        entryIds: Array.from(state.selectedIds)
      });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;

      if (message.type === 'state') {
        clearError();
        workspaceNotice.classList.toggle('hidden', message.hasWorkspace);
        state.traceabilityMode = message.traceabilityMode || 'basic';
        modeNotice.textContent = 'Mode: ' + (state.traceabilityMode === 'strict' ? 'Strict' : 'Basic') + ' — Strict mode is slower but provides stronger traceability checks.';
        state.entries = message.entries || [];
        state.history = message.history || [];
        renderSteps();
        renderHistory();
        return;
      }

      if (message.type === 'tutorialGenerated') {
        clearError();
        state.isGenerating = false;
        state.selectedIds.clear();
        renderSteps();
        const finalStatus = message.validation && message.validation.final_status ? message.validation.final_status : 'generated';
        showStatus((message.count || 0) + '개 step으로 판단 기록 문서를 생성했습니다. 검증 상태: ' + finalStatus);
        return;
        showStatus((message.count || 0) + '개의 step으로 판단 기록 문서를 생성했고, 선택 내역을 초기화했습니다.');
        return;
      }

      if (message.type === 'error') {
        state.isGenerating = false;
        updateButtons();
        showError(message.message);
      }
    });

    updateMeta();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function buildTutorialTitle(entries: Array<{ title: string }>): string {
  if (entries.length === 1) {
    return `${entries[0].title} 판단 기록`;
  }

  return `${entries[0].title} 외 ${entries.length - 1}개 판단 기록`;
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
