import { spawn } from 'child_process';
import * as vscode from 'vscode';

export interface VerificationCommand {
  label: string;
  command: string;
}

export interface VerificationResult {
  label: string;
  command: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

const BUILD_SCRIPT_PRIORITY = ['compile', 'build', 'typecheck', 'check'] as const;
const TEST_SCRIPT_PRIORITY = ['test'] as const;
const MAX_OUTPUT_CHARACTERS = 12_000;
const DEFAULT_TIMEOUT_MS = 90_000;
const VERIFICATION_SEARCH_EXCLUDE = '**/{node_modules,.git,.venv,venv,__pycache__,dist,build,target,.next,.vendor}/**';
const GENERIC_SCRIPT_GLOB = '**/{test,check,verify}.sh';
const PYTHON_FILE_GLOB = '**/*.py';

export class VerificationService {
  public async detectCommands(workspaceRoot: vscode.Uri | undefined): Promise<VerificationCommand[]> {
    if (!workspaceRoot) {
      return [];
    }

    const packageJson = await this.readPackageJson(workspaceRoot);
    const packageCommands = await this.detectPackageJsonCommands(workspaceRoot, packageJson);
    if (packageCommands.length > 0) {
      return packageCommands;
    }

    return this.detectFallbackCommands(workspaceRoot);
  }

  private async detectPackageJsonCommands(
    workspaceRoot: vscode.Uri,
    packageJson: any | undefined
  ): Promise<VerificationCommand[]> {
    const scripts = packageJson?.scripts;
    if (!scripts || typeof scripts !== 'object') {
      return [];
    }

    const packageManager = await detectPackageManager(workspaceRoot);
    const commands: VerificationCommand[] = [];

    const buildScript = BUILD_SCRIPT_PRIORITY.find((scriptName) => typeof scripts[scriptName] === 'string');
    if (buildScript) {
      commands.push({
        label: buildScript,
        command: `${packageManager} run ${buildScript}`
      });
    }

    const testScript = TEST_SCRIPT_PRIORITY.find((scriptName) => {
      const script = scripts[scriptName];
      return typeof script === 'string' && isSafeTestScript(script);
    });
    if (testScript && !commands.some((command) => command.label === testScript)) {
      commands.push({
        label: testScript,
        command: `${packageManager} run ${testScript}`
      });
    }

    return commands;
  }

  private async detectFallbackCommands(workspaceRoot: vscode.Uri): Promise<VerificationCommand[]> {
    const commands: VerificationCommand[] = [];

    const pythonIndicators = await this.findWorkspaceFiles(workspaceRoot, '**/main.py', 1);
    const pythonRequirements = await this.findWorkspaceFiles(workspaceRoot, '**/requirements.txt', 1);
    if (pythonIndicators.length > 0 || pythonRequirements.length > 0) {
      const pythonTarget = pythonIndicators[0] ?? (await this.findWorkspaceFiles(workspaceRoot, PYTHON_FILE_GLOB, 1))[0];
      if (pythonTarget) {
        commands.push({
          label: 'python -m py_compile',
          command: `python -m py_compile "${toRelativeShellPath(workspaceRoot, pythonTarget)}"`
        });
      }
    }

    const goModules = await this.findWorkspaceFiles(workspaceRoot, '**/go.mod', 1);
    if (goModules.length > 0) {
      commands.push({
        label: 'go build',
        command: 'go build ./...'
      });
    }

    const cargoTomlFiles = await this.findWorkspaceFiles(workspaceRoot, '**/Cargo.toml', 1);
    if (cargoTomlFiles.length > 0) {
      commands.push({
        label: 'cargo check',
        command: 'cargo check'
      });
    }

    if (commands.length > 0) {
      return commands;
    }

    const shellScripts = await this.findWorkspaceFiles(workspaceRoot, GENERIC_SCRIPT_GLOB, 5);
    return shellScripts.map((uri) => ({
      label: relativeBaseName(workspaceRoot, uri),
      command: `sh "${toRelativeShellPath(workspaceRoot, uri)}"`
    }));
  }

  public async runCommands(
    workspaceRoot: vscode.Uri | undefined,
    commands: VerificationCommand[],
    abortSignal?: AbortSignal
  ): Promise<VerificationResult[]> {
    if (!workspaceRoot || commands.length === 0) {
      return [];
    }

    const results: VerificationResult[] = [];
    for (const command of commands) {
      if (abortSignal?.aborted) {
        throw createAbortError();
      }
      results.push(await this.runCommand(workspaceRoot.fsPath, command, abortSignal));
    }
    return results;
  }

  private async readPackageJson(workspaceRoot: vscode.Uri): Promise<any | undefined> {
    const packageJsonUri = vscode.Uri.joinPath(workspaceRoot, 'package.json');

    try {
      const content = await vscode.workspace.fs.readFile(packageJsonUri);
      return JSON.parse(Buffer.from(content).toString('utf8'));
    } catch {
      return undefined;
    }
  }

  private async findWorkspaceFiles(
    workspaceRoot: vscode.Uri,
    pattern: string,
    maxResults: number
  ): Promise<vscode.Uri[]> {
    return vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceRoot, pattern),
      VERIFICATION_SEARCH_EXCLUDE,
      maxResults
    );
  }

  private runCommand(
    cwd: string,
    command: VerificationCommand,
    abortSignal?: AbortSignal
  ): Promise<VerificationResult> {
    return new Promise((resolve, reject) => {
      let output = '';
      let finished = false;
      let timedOut = false;
      const child = spawn(command.command, {
        cwd,
        shell: true,
        windowsHide: true,
        env: process.env
      });

      const append = (chunk: string | Buffer) => {
        output += String(chunk);
        if (output.length > MAX_OUTPUT_CHARACTERS) {
          output = output.slice(output.length - MAX_OUTPUT_CHARACTERS);
        }
      };

      const finalize = (result: VerificationResult) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timeout);
        abortSignal?.removeEventListener('abort', onAbort);
        resolve(result);
      };

      const onAbort = () => {
        if (finished) {
          return;
        }
        child.kill();
        reject(createAbortError());
      };

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, DEFAULT_TIMEOUT_MS);

      abortSignal?.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
      child.on('error', (error) => {
        if (finished) {
          return;
        }
        clearTimeout(timeout);
        abortSignal?.removeEventListener('abort', onAbort);
        reject(error);
      });
      child.on('close', (code) => {
        finalize({
          label: command.label,
          command: command.command,
          ok: !timedOut && code === 0,
          exitCode: code,
          timedOut,
          output: output.trim()
        });
      });
    });
  }
}

function toRelativeShellPath(workspaceRoot: vscode.Uri, target: vscode.Uri): string {
  const workspacePath = workspaceRoot.path.endsWith('/') ? workspaceRoot.path : `${workspaceRoot.path}/`;
  const relativePath = target.path.startsWith(workspacePath) ? target.path.slice(workspacePath.length) : target.path;
  return relativePath.replace(/\\/g, '/');
}

function relativeBaseName(workspaceRoot: vscode.Uri, target: vscode.Uri): string {
  const relativePath = toRelativeShellPath(workspaceRoot, target);
  const segments = relativePath.split('/');
  return segments[segments.length - 1] || relativePath;
}

async function detectPackageManager(workspaceRoot: vscode.Uri): Promise<'npm' | 'pnpm' | 'yarn' | 'bun'> {
  const candidates: Array<{ fileName: string; manager: 'npm' | 'pnpm' | 'yarn' | 'bun' }> = [
    { fileName: 'pnpm-lock.yaml', manager: 'pnpm' },
    { fileName: 'yarn.lock', manager: 'yarn' },
    { fileName: 'bun.lockb', manager: 'bun' },
    { fileName: 'bun.lock', manager: 'bun' },
    { fileName: 'package-lock.json', manager: 'npm' },
    { fileName: 'npm-shrinkwrap.json', manager: 'npm' }
  ];

  for (const candidate of candidates) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(workspaceRoot, candidate.fileName));
      return candidate.manager;
    } catch {
      continue;
    }
  }

  return 'npm';
}

function isSafeTestScript(script: string): boolean {
  const normalized = script.toLowerCase();
  if (normalized.includes('watch') || normalized.includes('--watch')) {
    return false;
  }
  if (normalized.includes('serve') || normalized.includes('dev server')) {
    return false;
  }
  if (normalized.includes('cypress open') || normalized.includes('playwright open')) {
    return false;
  }
  if (normalized.includes('no test specified') || normalized === 'echo "error: no test specified" && exit 1') {
    return false;
  }
  return true;
}

function createAbortError(): Error {
  const error = new Error('Verification was aborted.');
  error.name = 'AbortError';
  return error;
}
