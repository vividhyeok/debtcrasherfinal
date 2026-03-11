import * as vscode from 'vscode';

export interface DecisionLogEntry {
  id: string;
  title: string;
  date: string;
  question: string;
  optionA: string;
  optionB: string;
  userChoice: string;
  outcome: string;
}

export interface DecisionLogEntryInput {
  title: string;
  date: string;
  question: string;
  optionA: string;
  optionB: string;
  userChoice: string;
  outcome: string;
}

export interface SavedTutorial {
  title: string;
  uri: string;
  updatedAt: number;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const GUIDE_FILE_CANDIDATES = ['AGENT.md', 'AGENTS.md'] as const;
const GENERATED_SECTION_START = '<!-- DEBTCRASHER:START -->';
const GENERATED_SECTION_END = '<!-- DEBTCRASHER:END -->';
const GENERATED_COUNT_PREFIX = '<!-- DEBTCRASHER:COUNT=';
const DECISIONS_FILE_NAME = 'DECISIONS.md';

const BASE_CONFIRMED_DECISIONS = [
  'Product form: VS Code extension with one Activity Bar container and two sidebar views — the UI and commands are already built around Agent View + Step View.',
  'Core agent behavior: mandatory decision gate before implementation — Debtcrasher exists to preserve explicit high-leverage judgment, not just auto-code.',
  'First-turn protocol: non-trivial work starts with one high-leverage question — steps must come from explicit user choices only.',
  'Decision memory: AGENT.md is the compressed cache and DECISIONS.md is the full log — agents should read the cache first and the full log only when needed.',
  'Step output flow: selected steps become markdown files and open in the editor — learning material should live as normal workspace files.',
  'History behavior: saved markdown opens directly in VS Code — there is no inline preview state in Step View.',
  'Persistence model: project artifacts stay in the workspace filesystem — there is no backend, remote sync, or database layer by default.',
  'Extension structure: Continue-inspired activation/orchestrator/workspace context layering — generic dev-agent plumbing is reused and Debtcrasher-specific behavior sits on top.'
] as const;

const IMPLIED_CONSTRAINTS = [
  'Local workspace files only -> no auth, no remote storage, no server-side coordination unless the user explicitly introduces a backend.',
  'Mandatory decision gate + explicit step recording -> no inferred steps, no autonomous first-turn implementation, and no replay of already answered topics.',
  'File-based tutorial history + editor-open flow -> markdown review and editing happen in VS Code, not inside Step View.'
] as const;

const STATIC_DO_NOT_ASK_AGAIN = [
  'AGENT.md vs DECISIONS.md memory structure',
  'Whether the first non-trivial turn must ask a high-leverage question',
  'Whether steps can be inferred without an explicit user answer',
  'Whether Step View should show inline markdown preview',
  'Whether history should open files directly in the editor',
  'Whether artifacts live locally in the workspace'
] as const;

export class LogManager {
  public getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
  }

  public getWorkspaceRootUri(): vscode.Uri | undefined {
    return this.getWorkspaceFolder()?.uri;
  }

  public async ensureLogFile(): Promise<vscode.Uri> {
    const workspaceRoot = this.getWorkspaceRootUri();
    if (!workspaceRoot) {
      throw new Error('워크스페이스 폴더를 먼저 열어 주세요.');
    }

    const logUri = vscode.Uri.joinPath(workspaceRoot, DECISIONS_FILE_NAME);
    try {
      await vscode.workspace.fs.stat(logUri);
    } catch {
      await vscode.workspace.fs.writeFile(logUri, textEncoder.encode(''));
    }
    return logUri;
  }

  public async appendDecision(entry: DecisionLogEntryInput): Promise<void> {
    const logUri = await this.ensureLogFile();
    const current = await this.readTextFile(logUri);
    const nextBlock = this.renderLogBlock(entry);
    const nextContent = current.trim().length > 0 ? `${current.trimEnd()}\n\n${nextBlock}\n` : `${nextBlock}\n`;
    await this.writeTextFile(logUri, nextContent);
  }

  public async readLogEntries(): Promise<DecisionLogEntry[]> {
    const logUri = await this.ensureLogFile();
    return this.parseLogEntries(await this.readTextFile(logUri));
  }

  public async saveTutorial(title: string, markdown: string): Promise<vscode.Uri> {
    const tutorialDir = await this.ensureTutorialDirectory();
    const tutorialUri = vscode.Uri.joinPath(tutorialDir, `${sanitizeFileName(title)}.md`);
    await this.writeTextFile(tutorialUri, markdown);
    return tutorialUri;
  }

  public async listSavedTutorials(): Promise<SavedTutorial[]> {
    const tutorialDir = this.getTutorialDirectoryUri();
    if (!tutorialDir) {
      return [];
    }

    try {
      const items = await vscode.workspace.fs.readDirectory(tutorialDir);
      const tutorials = await Promise.all(
        items
          .filter(([name, fileType]) => fileType === vscode.FileType.File && name.endsWith('.md'))
          .map(async ([name]) => {
            const uri = vscode.Uri.joinPath(tutorialDir, name);
            const stat = await vscode.workspace.fs.stat(uri);
            return {
              title: name.replace(/\.md$/i, ''),
              uri: uri.toString(),
              updatedAt: stat.mtime
            } satisfies SavedTutorial;
          })
      );

      return tutorials.sort((left, right) => right.updatedAt - left.updatedAt);
    } catch {
      return [];
    }
  }

  public getTutorialDirectoryUri(): vscode.Uri | undefined {
    const workspaceRoot = this.getWorkspaceRootUri();
    return workspaceRoot ? vscode.Uri.joinPath(workspaceRoot, '.ai-tutorials') : undefined;
  }

  public async readProjectGuideContext(): Promise<string> {
    const workspaceRoot = this.getWorkspaceRootUri();
    if (!workspaceRoot) {
      return '';
    }

    const sections: string[] = [];
    for (const fileName of GUIDE_FILE_CANDIDATES) {
      const uri = vscode.Uri.joinPath(workspaceRoot, fileName);
      try {
        await vscode.workspace.fs.stat(uri);
        const content = await this.readTextFile(uri);
        if (content.trim()) {
          sections.push(`# ${fileName}\n${content.trim().slice(0, 8000)}`);
        }
      } catch {
        continue;
      }
    }

    return sections.join('\n\n');
  }

  public async syncProjectGuide(latestTask?: string, latestSummary?: string): Promise<vscode.Uri | undefined> {
    const workspaceRoot = this.getWorkspaceRootUri();
    if (!workspaceRoot) {
      return undefined;
    }

    const entries = await this.readLogEntries();
    const targetUri = await this.resolveGuideTargetUri();
    let existing = '';

    try {
      existing = await this.readTextFile(targetUri);
    } catch {
      existing = '';
    }

    if (!shouldRegenerateGuide(existing, entries)) {
      return targetUri;
    }

    const generated = renderProjectGuide(entries, latestTask, latestSummary);
    await this.writeTextFile(targetUri, upsertGeneratedGuideSection(existing, generated));
    return targetUri;
  }

  private async ensureTutorialDirectory(): Promise<vscode.Uri> {
    const tutorialDir = this.getTutorialDirectoryUri();
    if (!tutorialDir) {
      throw new Error('워크스페이스 폴더를 먼저 열어 주세요.');
    }
    await vscode.workspace.fs.createDirectory(tutorialDir);
    return tutorialDir;
  }

  private async readTextFile(uri: vscode.Uri): Promise<string> {
    return textDecoder.decode(await vscode.workspace.fs.readFile(uri));
  }

  private async writeTextFile(uri: vscode.Uri, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(uri, textEncoder.encode(content));
  }

  private async resolveGuideTargetUri(): Promise<vscode.Uri> {
    const workspaceRoot = this.getWorkspaceRootUri();
    if (!workspaceRoot) {
      throw new Error('워크스페이스 폴더를 먼저 열어 주세요.');
    }

    const guideUri = vscode.Uri.joinPath(workspaceRoot, 'AGENT.md');
    return guideUri;
  }

  private renderLogBlock(entry: DecisionLogEntryInput): string {
    return [
      `## Step: ${entry.title}`,
      `**Date**: ${entry.date}`,
      `**Question**: ${collapseLine(entry.question)}`,
      `**Option A**: ${collapseLine(entry.optionA)}`,
      `**Option B**: ${collapseLine(entry.optionB)}`,
      `**User chose**: ${collapseLine(entry.userChoice)}`,
      `**Outcome**: ${collapseLine(entry.outcome)}`
    ].join('\n');
  }

  private parseLogEntries(content: string): DecisionLogEntry[] {
    const sections = content.split(/(?=^## Step:\s+)/gm).map((section) => section.trim()).filter(Boolean);
    const entries = sections.map((section) => ({
      id: Buffer.from(`${extractField(section, /^## Step:\s*(.+)$/m)}::${extractField(section, /^\*\*Date\*\*:\s*(.+)$/m)}`, 'utf8').toString('base64url'),
      title: extractField(section, /^## Step:\s*(.+)$/m),
      date: extractField(section, /^\*\*Date\*\*:\s*(.+)$/m),
      question: extractField(section, /^\*\*Question\*\*:\s*(.+)$/m),
      optionA: extractField(section, /^\*\*Option A\*\*:\s*(.+)$/m),
      optionB: extractField(section, /^\*\*Option B\*\*:\s*(.+)$/m),
      userChoice: extractField(section, /^\*\*User chose\*\*:\s*(.+)$/m),
      outcome: extractField(section, /^\*\*Outcome\*\*:\s*(.+)$/m)
    } satisfies DecisionLogEntry));

    return entries.reverse();
  }
}

function extractField(section: string, pattern: RegExp): string {
  return section.match(pattern)?.[1]?.trim() ?? '';
}

function collapseLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sanitizeFileName(title: string): string {
  const stripped = title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').replace(/\.+$/g, '').trim();
  return stripped.length > 0 ? stripped.slice(0, 80) : 'tutorial';
}

function shouldRegenerateGuide(existing: string, entries: DecisionLogEntry[]): boolean {
  if (!existing.trim()) {
    return true;
  }
  if (!existing.includes(GENERATED_SECTION_START) || !existing.includes(GENERATED_SECTION_END)) {
    return true;
  }
  const cachedCountMatch = existing.match(/<!-- DEBTCRASHER:COUNT=(\d+) -->/);
  const cachedCount = cachedCountMatch ? Number(cachedCountMatch[1]) : -1;
  return cachedCount !== entries.length;
}

function renderProjectGuide(entries: DecisionLogEntry[], latestTask?: string, latestSummary?: string): string {
  const dynamicTopics = entries.map((entry) => entry.title);
  const doNotAskAgain = Array.from(new Set([...STATIC_DO_NOT_ASK_AGAIN, ...dynamicTopics])).sort((left, right) => left.localeCompare(right));
  const confirmedLines = entries.length === 0
    ? ['- Logged user decisions: none yet.']
    : entries.map((entry) => `- ${summarizeLoggedDecision(entry)}`);
  const undecidedLines = [
    latestTask?.trim()
      ? `- Current request-specific architecture beyond the confirmed defaults: ${collapseLine(latestTask)}.`
      : '- The exact architecture for the next task remains request-specific.',
    '- AI provider and model remain configurable by the user in VS Code settings.',
    latestSummary?.trim()
      ? `- Latest implementation summary reference: ${collapseLine(latestSummary)}.`
      : undefined
  ].filter((line): line is string => Boolean(line));

  return [
    GENERATED_SECTION_START,
    `${GENERATED_COUNT_PREFIX}${entries.length} -->`,
    '## Agent Behavior Rules',
    '- Before asking ANY question, read this file in full',
    '- If the answer can be inferred from confirmed decisions or implied constraints, do not ask - implement with that inference',
    '- Maximum 2 questions per user request. If more seem possible, keep only the most architecturally significant ones',
    '- If a decision is listed in "Do not ask again", treat it as immutable and never surface it again',
    '- When implementing, add a one-line comment for any default assumption you made without asking: // ASSUMPTION: [what and why]',
    '- This file is regenerated every 5 confirmed decisions. Do not treat it as a log - treat it as ground truth for this project',
    '- The full decision history is in DECISIONS.md - read it only when this file is not enough',
    '',
    '# Debtcrasher Cache',
    '',
    '## Confirmed Decisions',
    ...BASE_CONFIRMED_DECISIONS.map((line) => `- ${line}`),
    ...confirmedLines,
    '',
    '## Implied Constraints',
    ...IMPLIED_CONSTRAINTS.map((line) => `- ${line}`),
    '',
    '## Still Undecided',
    ...undecidedLines,
    '',
    '## Do not ask again',
    ...doNotAskAgain.map((line) => `- ${line}`),
    GENERATED_SECTION_END
  ].join('\n');
}

function summarizeLoggedDecision(entry: DecisionLogEntry): string {
  const chosenSummary = pickChosenSummary(entry);
  const chosenLabel = extractChoiceLabel(chosenSummary, entry.userChoice);
  const reason = extractReason(chosenSummary) || collapseLine(entry.outcome) || collapseLine(entry.question);
  return `${entry.title}: ${chosenLabel} — ${reason}`;
}

function pickChosenSummary(entry: DecisionLogEntry): string {
  if (entry.userChoice.startsWith('Option A')) {
    return entry.optionA;
  }
  if (entry.userChoice.startsWith('Option B')) {
    return entry.optionB;
  }
  return entry.userChoice;
}

function extractChoiceLabel(summary: string, fallback: string): string {
  const head = summary.split('|')[0]?.trim() ?? '';
  const normalized = head.replace(/^Option\s+[AB]\s*-\s*/i, '').replace(/^[AB]\s*-\s*/i, '').trim();
  return normalized || fallback;
}

function extractReason(summary: string): string {
  const prosMatch = summary.match(/장점:\s*([^|]+)/) ?? summary.match(/pros:\s*([^|]+)/i);
  return prosMatch?.[1]?.split(',').map((value) => value.trim()).find(Boolean) ?? '';
}

function upsertGeneratedGuideSection(existing: string, generated: string): string {
  const trimmed = existing.trim();
  const pattern = new RegExp(`${escapeRegExp(GENERATED_SECTION_START)}[\\s\\S]*?${escapeRegExp(GENERATED_SECTION_END)}`, 'm');
  if (!trimmed) {
    return `${generated}\n`;
  }
  if (pattern.test(existing)) {
    return existing.replace(pattern, generated);
  }
  return `${trimmed}\n\n${generated}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
