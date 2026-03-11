import * as vscode from 'vscode';

// Architectural structure adapted from Continue's VS Code extension layering.
// Source project: https://github.com/continuedev/continue
// License: Apache-2.0

const textDecoder = new TextDecoder();

export interface WorkspaceSnapshotOptions {
  maxFiles?: number;
  maxInlineFiles?: number;
  maxFileSize?: number;
  maxInlineCharacters?: number;
}

export class WorkspaceContextService {
  public async buildWorkspaceSnapshot(
    workspaceRoot: vscode.Uri | undefined,
    options: WorkspaceSnapshotOptions = {}
  ): Promise<string> {
    if (!workspaceRoot) {
      return 'Workspace is not open.';
    }

    const files = await vscode.workspace.findFiles(
      '**/*',
      '{**/node_modules/**,**/.git/**,**/.vendor/**,**/out/**,**/.ai-tutorials/**,**/DECISIONS.md,**/*.png,**/*.jpg,**/*.jpeg,**/*.gif,**/*.ico,**/*.pdf,**/*.zip,**/*.svg}',
      options.maxFiles ?? 12
    );

    if (files.length === 0) {
      return 'Workspace is empty.';
    }

    const sections: string[] = ['Workspace files:'];
    sections.push(...files.map((uri) => `- ${vscode.workspace.asRelativePath(uri, false)}`));

    const inlineFiles = files.slice(0, options.maxInlineFiles ?? 6);

    for (const uri of inlineFiles) {
      const relativePath = vscode.workspace.asRelativePath(uri, false);

      try {
        const stat = await vscode.workspace.fs.stat(uri);

        if (stat.size > (options.maxFileSize ?? 30_000)) {
          sections.push(`\nFILE: ${relativePath}\n(too large to inline, skipped content)`);
          continue;
        }

        const content = textDecoder.decode(await vscode.workspace.fs.readFile(uri));
        sections.push(`\nFILE: ${relativePath}\n${content.slice(0, options.maxInlineCharacters ?? 4_000)}`);
      } catch {
        sections.push(`\nFILE: ${relativePath}\n(unable to read file content)`);
      }
    }

    return sections.join('\n');
  }
}
