import * as vscode from 'vscode';

import { activateDebtcrasher } from './activation/activateDebtcrasher';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await activateDebtcrasher(context);
}

export function deactivate(): void {
  // no-op
}
