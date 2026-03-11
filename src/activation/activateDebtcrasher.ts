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
      void extension.openBoth();
    }, 400);
  } else {
    await extension.showWelcomeIfNeeded();
  }

  return { extension };
}
