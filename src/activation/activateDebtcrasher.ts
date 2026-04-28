import * as vscode from 'vscode';

import { DebtcrasherExtension } from '../extension/DebtcrasherExtension';

// Activation flow adapted from Continue's activation bootstrap.
// Source project: https://github.com/continuedev/continue
// License: Apache-2.0

export async function activateDebtcrasher(
  context: vscode.ExtensionContext
): Promise<{ extension: DebtcrasherExtension }> {
  const extension = new DebtcrasherExtension(context);
  context.subscriptions.push(extension);

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    setTimeout(() => {
      extension.openBoth().catch((error) => {
        console.warn('[Debtcrasher] Failed to auto-open sidebar in dev mode:', error);
      });
    }, 800);
  } else {
    await extension.showWelcomeIfNeeded();
  }

  return { extension };
}
