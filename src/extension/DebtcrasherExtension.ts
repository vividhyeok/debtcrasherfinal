import * as vscode from 'vscode';

import { AgentViewController } from '../agentView';
import { AIClient } from '../aiClient';
import { WorkspaceContextService } from '../context/WorkspaceContextService';
import { LogManager } from '../logManager';
import { SessionHistoryService } from '../sessionHistory';
import { StepViewController } from '../stepView';
import { VerificationService } from '../verification/VerificationService';
import { AGENT_VIEW_ID, SIDEBAR_CONTAINER_ID, STEP_VIEW_ID } from '../viewIds';

// Architectural structure adapted from Continue's VsCodeExtension orchestration.
// Source project: https://github.com/continuedev/continue
// License: Apache-2.0

export class DebtcrasherExtension implements vscode.Disposable {
  private readonly logManager: LogManager;
  private readonly aiClient: AIClient;
  private readonly workspaceContextService: WorkspaceContextService;
  private readonly verificationService: VerificationService;
  private readonly sessionHistoryService: SessionHistoryService;
  private readonly agentView: AgentViewController;
  private readonly stepView: StepViewController;
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.logManager = new LogManager();
    this.aiClient = new AIClient(context.secrets);
    this.workspaceContextService = new WorkspaceContextService();
    this.verificationService = new VerificationService();
    this.sessionHistoryService = new SessionHistoryService(() => this.logManager.getWorkspaceRootUri());
    this.agentView = new AgentViewController(
      context,
      this.aiClient,
      this.logManager,
      this.workspaceContextService,
      this.verificationService,
      this.sessionHistoryService
    );
    this.stepView = new StepViewController(context, this.aiClient, this.logManager);
    this.statusBarItem = this.createStatusBarItem();

    this.registerProviders();
    this.registerCommands();
  }

  public async openSidebar(): Promise<void> {
    await vscode.commands.executeCommand(`workbench.view.extension.${SIDEBAR_CONTAINER_ID}`);
  }

  public async openStepView(): Promise<void> {
    await this.openSidebar();
    this.stepView.show();
  }

  public async openAgentView(): Promise<void> {
    await this.openSidebar();
    this.agentView.show();
  }

  public async openBoth(): Promise<void> {
    await this.openSidebar();
  }

  public async showWelcomeIfNeeded(): Promise<void> {
    const stateKey = 'debtcrasher.hasShownWelcome';
    const hasShownWelcome = this.context.globalState.get<boolean>(stateKey, false);

    if (hasShownWelcome) {
      return;
    }

    await this.context.globalState.update(stateKey, true);

    const selection = await vscode.window.showInformationMessage(
      'Debtcrasher is ready.',
      'Open',
      'Settings'
    );

    if (selection === 'Open') {
      await this.openBoth();
    } else if (selection === 'Settings') {
      await vscode.commands.executeCommand('debtcrasher.openSettings');
    }
  }

  public dispose(): void {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }

    this.statusBarItem.dispose();
    this.agentView.dispose();
    this.stepView.dispose();
  }

  private registerProviders(): void {
    this.disposables.push(
      this.agentView,
      this.stepView,
      vscode.window.registerWebviewViewProvider(AGENT_VIEW_ID, this.agentView, {
        webviewOptions: { retainContextWhenHidden: true }
      }),
      vscode.window.registerWebviewViewProvider(STEP_VIEW_ID, this.stepView, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );
  }

  private registerCommands(): void {
    this.disposables.push(
      vscode.commands.registerCommand('debtcrasher.openAgentView', () => this.openAgentView()),
      vscode.commands.registerCommand('debtcrasher.openStepView', () => this.openStepView()),
      vscode.commands.registerCommand('debtcrasher.openBoth', () => this.openBoth()),
      vscode.commands.registerCommand('debtcrasher.openSettings', () =>
        vscode.commands.executeCommand('workbench.action.openSettings', 'debtcrasher api key model aiStepDev.questionFilterLevel')
      )
    );
  }

  private createStatusBarItem(): vscode.StatusBarItem {
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.name = 'Debtcrasher';
    statusBarItem.text = '$(sparkle) Debtcrasher';
    statusBarItem.tooltip = 'Open Debtcrasher';
    statusBarItem.command = 'debtcrasher.openBoth';
    statusBarItem.show();
    return statusBarItem;
  }
}
