import * as vscode from 'vscode';

import type { HumanReviewLevel, PlanningAssumption, RiskCategory } from './aiClient';

export interface DecisionLogEntry {
  id: string;
  title: string;
  date: string;
  question: string;
  options: string[];
  optionA: string;
  optionB: string;
  userChoice: string;
  outcome: string;
  reason: string;
  humanReviewLevel?: HumanReviewLevel;
  reviewCategories?: string[];
  aiReasonForReview?: string;
  leverageScore: number | undefined;
  riskCategories: RiskCategory[];
  defaultIfSkipped: string;
  riskIfWrong: string;
  relatedFiles: string[];
  canAutoApply?: boolean;
  assumptionLog?: PlanningAssumption[];
  validationResult?: DecisionValidationResult;
  source: DecisionSource[];
}

export interface DecisionLogEntryInput {
  id?: string;
  title: string;
  date: string;
  question: string;
  options?: string[];
  optionA: string;
  optionB: string;
  userChoice: string;
  outcome: string;
  reason?: string;
  humanReviewLevel?: HumanReviewLevel;
  reviewCategories?: string[];
  aiReasonForReview?: string;
  leverageScore?: number;
  riskCategories?: RiskCategory[];
  defaultIfSkipped?: string;
  riskIfWrong?: string;
  relatedFiles?: string[];
  canAutoApply?: boolean;
  assumptionLog?: PlanningAssumption[];
  validationResult?: DecisionValidationResult;
  source?: DecisionSource[];
}

export type DecisionSource = 'user_decision' | 'code_evidence' | 'validation_result' | 'ai_inference' | 'needs_review';

export interface DecisionValidationResult {
  typecheck: string;
  build: string;
  test: string;
  lint: string;
  status: string;
  repairAttempted?: boolean;
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
const PATTERN_GROUPS = [
  {
    label: 'simple-fast',
    description: '간단함과 빠른 전달을 우선하는 경향',
    keywords: ['simple', 'fast', 'minimal', 'quick', 'prototype', 'lean', '간단', '빠른', '최소', '프로토타입', '가볍게', '빨리']
  },
  {
    label: 'local-static',
    description: '로컬 또는 정적 구조를 우선하는 경향',
    keywords: ['static', 'local', 'workspace', 'browser-only', 'file-based', 'offline', '정적', '로컬', '워크스페이스', '파일 기반', '백엔드 없음', '오프라인']
  },
  {
    label: 'extensible',
    description: '확장성과 유연성을 우선하는 경향',
    keywords: ['extensible', 'scalable', 'modular', 'flexible', 'reusable', 'plugin', '확장', '유연', '모듈', '재사용', '스케일', '플러그인']
  },
  {
    label: 'explicit-control',
    description: '명시적인 사용자 통제를 우선하는 경향',
    keywords: ['explicit', 'control', 'manual', 'direct', 'approval', 'decision gate', '명시', '직접', '수동', '사용자 선택', '판단', '승인']
  },
  {
    label: 'performance-first',
    description: '성능과 응답 속도를 우선하는 경향',
    keywords: ['performance', 'latency', 'throughput', 'optimize', 'efficient', 'speed', '성능', '속도', '응답 속도', '지연', '최적화', '효율']
  },
  {
    label: 'security-first',
    description: '보안과 안전한 경계 설정을 우선하는 경향',
    keywords: ['security', 'secure', 'auth', 'authentication', 'authorization', 'privacy', 'secret', 'encryption', '보안', '인증', '인가', '비밀키', '개인정보', '암호화']
  },
  {
    label: 'ux-first',
    description: '사용자 경험과 사용성을 우선하는 경향',
    keywords: ['ux', 'user experience', 'usability', 'onboarding', 'clarity', 'accessible', 'interaction', '사용자 경험', '사용성', '온보딩', '명확성', '접근성', '인터랙션']
  }
] as const;

const BASE_CONFIRMED_DECISIONS = [
  'Product form: VS Code extension with one Activity Bar container and two sidebar views -- the UI and commands are centered around Agent View and Step View.',
  'Core agent behavior: mandatory Human Review Gate before implementation -- Debtcrasher exists to preserve explicit human review, not just auto-code.',
  'Planning protocol: non-trivial work starts with one planning pass that surfaces REVIEW_REQUIRED items first and records REVIEW_RECOMMENDED or AUTO_WITH_LOG items in the assumption log -- implementation begins only after those answers are confirmed.',
  'Decision memory: AGENT.md is the compressed cache and DECISIONS.md is the full log -- agents should read the cache first and the full log only when needed.',
  'Step output flow: selected steps become markdown files and open in the editor -- learning material should live as normal workspace files.',
  'History behavior: saved markdown opens directly in VS Code -- there is no inline preview state in Step View.',
  'Persistence model: project artifacts stay in the workspace filesystem -- there is no backend, remote sync, or database layer by default.',
  'Extension structure: Continue-inspired activation/orchestrator/workspace context layering -- generic dev-agent plumbing is reused and Debtcrasher-specific behavior sits on top.'
] as const;

const IMPLIED_CONSTRAINTS = [
  'Local workspace files only -> no auth, no remote storage, and no server-side coordination unless the user explicitly introduces a backend.',
  'Mandatory planning gate + explicit step recording -> no autonomous implementation before surfaced questions are answered, no inferred steps, and no replay of already answered topics.',
  'File-based tutorial history + editor-open flow -> markdown review and editing happen in VS Code, not inside Step View.'
] as const;

const STATIC_DO_NOT_ASK_AGAIN = [
  'AGENT.md vs DECISIONS.md memory structure',
  'Whether planning happens before implementation',
  'Whether questions are asked one at a time or in one planning batch',
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
    await this.appendDecisions([entry]);
  }

  public async appendDecisions(entries: DecisionLogEntryInput[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const logUri = await this.ensureLogFile();
    const current = await this.readTextFile(logUri);
    const nextBlocks = entries.map((entry) => this.renderLogBlock(entry)).join('\n\n');
    const nextContent = current.trim().length > 0 ? `${current.trimEnd()}\n\n${nextBlocks}\n` : `${nextBlocks}\n`;
    await this.writeTextFile(logUri, nextContent);
  }

  public async updateDecisionImplementationMetadata(
    decisionIds: string[],
    metadata: {
      relatedFiles: string[];
      overwrittenFiles?: string[];
      validationResult: DecisionValidationResult;
    }
  ): Promise<void> {
    if (decisionIds.length === 0) {
      return;
    }

    const logUri = await this.ensureLogFile();
    const entries = await this.readLogEntries();
    const targetIds = new Set(decisionIds);
    const relatedFiles = Array.from(new Set([
      ...metadata.relatedFiles,
      ...(metadata.overwrittenFiles ?? []).map((file) => `${file} (overwritten)`)
    ])).sort((left, right) => left.localeCompare(right));

    const updatedEntries = entries
      .slice()
      .reverse()
      .map((entry) => {
        if (!targetIds.has(entry.id)) {
          return entry;
        }

        return {
          ...entry,
          relatedFiles,
          validationResult: metadata.validationResult,
          source: Array.from(new Set([...entry.source, 'code_evidence', 'validation_result']))
        } satisfies DecisionLogEntry;
      });

    const nextContent = updatedEntries.map((entry) => this.renderLogBlock(entry)).join('\n\n');
    await this.writeTextFile(logUri, nextContent.trim().length > 0 ? `${nextContent}\n` : '');
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

  public async readAgentGuideContent(): Promise<string> {
    const workspaceRoot = this.getWorkspaceRootUri();
    if (!workspaceRoot) {
      return '';
    }

    const uri = vscode.Uri.joinPath(workspaceRoot, 'AGENT.md');
    try {
      const content = await this.readTextFile(uri);
      return content.trim().slice(0, 8000);
    } catch {
      return '';
    }
  }

  public async readLatestImplementationSummary(): Promise<string> {
    const guideContent = await this.readAgentGuideContent();
    if (!guideContent) {
      return '';
    }

    const encoded = guideContent.match(/<!-- DEBTCRASHER:BUILD_SUMMARY=([^\n>]*) -->/)?.[1];
    const summary = collapseLine(decodeGuideMeta(encoded));
    return summary === '아직 구현 요약이 없습니다.' ? '' : summary;
  }

  public async readDecisionPatternContext(task: string): Promise<string> {
    const entries = await this.readLogEntries();
    if (entries.length === 0) {
      return '';
    }

    const taskTokens = tokenizeForPatterns(task);
    const similarEntries = entries
      .map((entry) => ({
        entry,
        score: computeSimilarityScore(
          taskTokens,
          tokenizeForPatterns(`${entry.title} ${entry.question} ${entry.userChoice} ${entry.outcome}`)
        )
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map((item) => `- ${item.entry.title}: ${extractChoiceLabel(pickChosenSummary(item.entry), item.entry.userChoice)}`);

    const repeatedPriorities = PATTERN_GROUPS
      .map((group) => ({
        description: group.description,
        score: entries.reduce(
          (total, entry) => total + scorePatternGroup(group.keywords, `${entry.userChoice} ${entry.outcome} ${entry.question}`),
          0
        )
      }))
      .filter((group) => group.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map((group) => `${group.description} (${group.score})`);

    if (similarEntries.length === 0 && repeatedPriorities.length === 0) {
      return '';
    }

    return [
      'Historical decision patterns:',
      repeatedPriorities.length > 0
        ? `- Repeated priorities: ${repeatedPriorities.join(', ')}`
        : '- Repeated priorities: none strong enough yet',
      similarEntries.length > 0
        ? ['- Similar past decisions:', ...similarEntries].join('\n')
        : '- Similar past decisions: none close enough',
      '- Duplicate prevention metadata:',
      ...entries.slice(0, 12).map((entry) => [
        `  - id: ${entry.id}`,
        `    topic: ${entry.title}`,
        `    risk_categories: ${entry.riskCategories.join(', ') || 'none'}`,
        `    related_files: ${entry.relatedFiles.join(', ') || 'none'}`,
        `    selected: ${extractChoiceLabel(pickChosenSummary(entry), entry.userChoice)}`
      ].join('\n')),
      '- Use these patterns only as a ranking bias. Never override the current request.'
    ].join('\n');
  }

  public async syncProjectGuide(latestTask?: string, latestSummary?: string): Promise<vscode.Uri | undefined> {
    const workspaceRoot = this.getWorkspaceRootUri();
    if (!workspaceRoot) {
      return undefined;
    }

    const entries = await this.readLogEntries();
    const targetUri = await this.resolveGuideTargetUri();
    const decisionsUri = vscode.Uri.joinPath(workspaceRoot, DECISIONS_FILE_NAME);
    let existing = '';

    try {
      existing = await this.readTextFile(targetUri);
    } catch {
      existing = '';
    }

    const decodeMeta = (value?: string): string => {
      if (!value) {
        return '';
      }
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };

    const readStat = async (uri: vscode.Uri): Promise<vscode.FileStat | undefined> => {
      try {
        return await vscode.workspace.fs.stat(uri);
      } catch {
        return undefined;
      }
    };

    const guideStat = await readStat(targetUri);
    const decisionsStat = await readStat(decisionsUri);
    const cachedCount = Number(existing.match(/<!-- DEBTCRASHER:COUNT=(\d+) -->/)?.[1] ?? '-1');
    const storedLatestDecision = decodeMeta(existing.match(/<!-- DEBTCRASHER:LATEST_DECISION=([^\n>]*) -->/)?.[1]);
    const storedBuildSummary = decodeMeta(existing.match(/<!-- DEBTCRASHER:BUILD_SUMMARY=([^\n>]*) -->/)?.[1]);
    const storedTaskContext = decodeMeta(existing.match(/<!-- DEBTCRASHER:LATEST_TASK=([^\n>]*) -->/)?.[1]);

    const latestDecisionSummary = entries[0]
      ? summarizeLoggedDecision(entries[0]).replace(' -- ', ' — ')
      : '';
    const effectiveTask = latestTask?.trim()
      ? collapseLine(latestTask)
      : storedTaskContext || '최근 요청 컨텍스트 없음.';
    const effectiveSummary = latestSummary?.trim()
      ? collapseLine(latestSummary)
      : storedBuildSummary || latestDecisionSummary || '아직 구현 요약이 없습니다.';

    const decisionCountChanged = cachedCount !== entries.length;
    const decisionsFileIsNewer = Boolean(decisionsStat && (!guideStat || decisionsStat.mtime > guideStat.mtime));
    const latestDecisionChanged = storedLatestDecision !== latestDecisionSummary;
    const buildSummaryChanged = storedBuildSummary !== effectiveSummary;
    const taskContextChanged = storedTaskContext !== effectiveTask;

    if (!(decisionCountChanged || decisionsFileIsNewer || latestDecisionChanged || buildSummaryChanged || taskContextChanged)) {
      return targetUri;
    }

    const generated = renderProjectGuide(entries, effectiveTask, effectiveSummary);
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

    return vscode.Uri.joinPath(workspaceRoot, 'AGENT.md');
  }

  private renderLogBlock(entry: DecisionLogEntryInput): string {
    const id = entry.id || buildDecisionId(entry.date, entry.title);
    const options = entry.options && entry.options.length > 0
      ? entry.options
      : [entry.optionA, entry.optionB].filter(Boolean);
    const riskCategories = entry.riskCategories && entry.riskCategories.length > 0
      ? entry.riskCategories
      : ['needs_review'];
    const source = entry.source && entry.source.length > 0
      ? entry.source
      : ['user_decision', 'ai_inference', 'needs_review'];
    const validation = entry.validationResult ?? {
      typecheck: 'not available',
      build: 'not available',
      test: 'not available',
      lint: 'not available',
      status: 'needs_review'
    };
    const relatedFiles = entry.relatedFiles && entry.relatedFiles.length > 0
      ? entry.relatedFiles
      : ['needs_review'];
    const reviewLevel = normalizeHumanReviewLevel(entry.humanReviewLevel, entry.leverageScore);
    const reviewCategories = entry.reviewCategories && entry.reviewCategories.length > 0
      ? entry.reviewCategories
      : deriveReviewCategories(entry);
    const assumptionLog = entry.assumptionLog && entry.assumptionLog.length > 0
      ? entry.assumptionLog
      : [];

    return [
      `## ${id}`,
      '### Question',
      collapseLine(entry.question),
      '',
      '### Options',
      ...options.map((option, index) => `- ${choiceLabelForIndex(index)}. ${collapseLine(option)}`),
      '',
      '### Selected',
      collapseLine(entry.userChoice),
      '',
      '### Human Review Level',
      reviewLevel,
      '',
      '### Review Categories',
      ...reviewCategories.map((category) => `- ${category}`),
      '',
      '### AI Reason For Review',
      collapseLine(entry.aiReasonForReview || entry.reason || `AI-generated reason: ${entry.outcome}`),
      '',
      '### Reason',
      collapseLine(entry.reason || `AI-generated reason: ${entry.outcome}`),
      '',
      '### Risk Categories',
      ...riskCategories.map((category) => `- ${category}`),
      '',
      '### Default If Skipped',
      collapseLine(entry.defaultIfSkipped || 'needs_review'),
      '',
      '### Risk If Wrong',
      collapseLine(entry.riskIfWrong || 'needs_review'),
      '',
      '### Related Files',
      ...relatedFiles.map((file) => `- ${file}`),
      assumptionLog.length > 0 ? '' : undefined,
      assumptionLog.length > 0 ? '### Assumption Log' : undefined,
      ...assumptionLog.flatMap((assumption, index) => renderAssumptionLogBlock(assumption, index)).filter(Boolean),
      '',
      '### Validation Result',
      `- typecheck: ${validation.typecheck}`,
      `- build: ${validation.build}`,
      `- test: ${validation.test}`,
      `- lint: ${validation.lint}`,
      `- repair_attempted: ${validation.repairAttempted ? 'true' : 'false'}`,
      `- status: ${validation.status}`,
      '',
      '### Source',
      ...source.map((item) => `- ${item}`)
    ].filter((line) => typeof line === 'string').join('\n');
  }

  private parseLogEntries(content: string): DecisionLogEntry[] {
    const sections = content
      .split(/(?=^##\s+(?:D-\d{8}-\d{6}-|Step:\s+))/gm)
      .map((section) => section.trim())
      .filter(Boolean);

    const entries = sections.map((section) =>
      section.startsWith('## Step:')
        ? parseLegacyLogEntry(section)
        : parseStructuredLogEntry(section)
    );

    return entries.reverse();
  }
}

function parseStructuredLogEntry(section: string): DecisionLogEntry {
  const id = extractField(section, /^##\s+(.+)$/m);
  const title = titleFromDecisionId(id);
  const options = extractListSection(section, 'Options').map((option) => option.replace(/^[A-Z]\.\s*/, '').trim());
  const riskCategories = extractListSection(section, 'Risk Categories')
    .filter((category): category is RiskCategory => isRiskCategory(category));
  const reviewCategories = extractListSection(section, 'Review Categories');
  const source = extractListSection(section, 'Source')
    .filter((item): item is DecisionSource => isDecisionSource(item));
  const humanReviewLevel = normalizeHumanReviewLevel(
    extractMarkdownSection(section, 'Human Review Level') || undefined,
    toOptionalNumber(extractMarkdownSection(section, 'Leverage Score'))
  );

  return {
    id,
    title,
    date: dateFromDecisionId(id),
    question: extractMarkdownSection(section, 'Question'),
    options,
    optionA: options[0] ?? '',
    optionB: options[1] ?? '',
    userChoice: extractMarkdownSection(section, 'Selected'),
    outcome: extractMarkdownSection(section, 'Reason'),
    reason: extractMarkdownSection(section, 'Reason'),
    humanReviewLevel,
    reviewCategories,
    aiReasonForReview: extractMarkdownSection(section, 'AI Reason For Review'),
    leverageScore: toOptionalNumber(extractMarkdownSection(section, 'Leverage Score')),
    riskCategories,
    defaultIfSkipped: extractMarkdownSection(section, 'Default If Skipped'),
    riskIfWrong: extractMarkdownSection(section, 'Risk If Wrong'),
    relatedFiles: extractListSection(section, 'Related Files').filter((file) => file !== 'needs_review'),
    canAutoApply: extractMarkdownSection(section, 'Human Review Level') === 'AUTO_WITH_LOG',
    validationResult: parseValidationSection(extractListSection(section, 'Validation Result')),
    source
  };
}

function parseLegacyLogEntry(section: string): DecisionLogEntry {
  const title = extractField(section, /^## Step:\s*(.+)$/m);
  const date = extractField(section, /^\*\*Date\*\*:\s*(.+)$/m);
  const optionA = extractField(section, /^\*\*Option A\*\*:\s*(.+)$/m);
  const optionB = extractField(section, /^\*\*Option B\*\*:\s*(.+)$/m);
  return {
    id: Buffer.from(`${title}::${date}`, 'utf8').toString('base64url'),
    title,
    date,
    question: extractField(section, /^\*\*Question\*\*:\s*(.+)$/m),
    options: [optionA, optionB].filter(Boolean),
    optionA,
    optionB,
    userChoice: extractField(section, /^\*\*User chose\*\*:\s*(.+)$/m),
    outcome: extractField(section, /^\*\*Outcome\*\*:\s*(.+)$/m),
    reason: `AI-generated reason: ${extractField(section, /^\*\*Outcome\*\*:\s*(.+)$/m)}`,
    humanReviewLevel: 'REVIEW_REQUIRED',
    reviewCategories: [],
    aiReasonForReview: `AI-generated reason: ${extractField(section, /^\*\*Outcome\*\*:\s*(.+)$/m)}`,
    leverageScore: undefined,
    riskCategories: [],
    defaultIfSkipped: 'needs_review',
    riskIfWrong: 'needs_review',
    relatedFiles: [],
    canAutoApply: false,
    validationResult: {
      typecheck: 'not available',
      build: 'not available',
      test: 'not available',
      lint: 'not available',
      status: 'needs_review'
    },
    source: ['user_decision', 'ai_inference', 'needs_review']
  };
}

function extractField(section: string, pattern: RegExp): string {
  return section.match(pattern)?.[1]?.trim() ?? '';
}

function extractMarkdownSection(section: string, heading: string): string {
  const pattern = new RegExp(`^### ${escapeRegExp(heading)}\\s*\\r?\\n([\\s\\S]*?)(?=^###\\s+|\\s*$)`, 'm');
  return section.match(pattern)?.[1]?.trim() ?? '';
}

function extractListSection(section: string, heading: string): string[] {
  return extractMarkdownSection(section, heading)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean);
}

function parseValidationSection(lines: string[]): DecisionValidationResult {
  const fields = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      fields.set(match[1].trim(), match[2].trim());
    }
  }
  return {
    typecheck: fields.get('typecheck') || 'not available',
    build: fields.get('build') || 'not available',
    test: fields.get('test') || 'not available',
    lint: fields.get('lint') || 'not available',
    repairAttempted: fields.get('repair_attempted') === 'true',
    status: fields.get('status') || 'needs_review'
  };
}

function buildDecisionId(dateValue: string, title: string): string {
  return `D-${formatDecisionTimestamp(new Date(dateValue))}-${sanitizeDecisionTitle(title)}`;
}

function formatDecisionTimestamp(date: Date): string {
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return [
    safeDate.getFullYear(),
    pad(safeDate.getMonth() + 1),
    pad(safeDate.getDate())
  ].join('')
    + '-'
    + [pad(safeDate.getHours()), pad(safeDate.getMinutes()), pad(safeDate.getSeconds())].join('');
}

function sanitizeDecisionTitle(title: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  return normalized || 'decision';
}

function titleFromDecisionId(id: string): string {
  return id.replace(/^D-\d{8}-\d{6}-/, '').replace(/-/g, ' ').trim() || id;
}

function dateFromDecisionId(id: string): string {
  const match = id.match(/^D-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/);
  if (!match) {
    return '';
  }
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
}

function choiceLabelForIndex(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index);
}

function toOptionalNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeHumanReviewLevel(value?: string, leverageScore?: number): HumanReviewLevel {
  if (value === 'REVIEW_REQUIRED' || value === 'REVIEW_RECOMMENDED' || value === 'AUTO_WITH_LOG') {
    return value;
  }
  if (typeof leverageScore === 'number' && leverageScore >= 4) {
    return 'REVIEW_REQUIRED';
  }
  if (typeof leverageScore === 'number' && leverageScore >= 2) {
    return 'REVIEW_RECOMMENDED';
  }
  return 'AUTO_WITH_LOG';
}

function deriveReviewCategories(entry: Pick<DecisionLogEntryInput, 'riskCategories' | 'leverageScore' | 'relatedFiles' | 'reason'>): string[] {
  const categories = new Set<string>();
  if ((entry.riskCategories ?? []).includes('security') || (entry.riskCategories ?? []).includes('data_loss') || (entry.riskCategories ?? []).includes('public_contract')) {
    categories.add('Risk Impact');
  }
  if ((entry.leverageScore ?? 0) >= 4) {
    categories.add('Architecture Impact');
  }
  if ((entry.leverageScore ?? 0) >= 3) {
    categories.add('Tradeoff Point');
  }
  if (categories.size === 0) {
    categories.add('Learning / Reflection Value');
  }
  return [...categories];
}

function renderAssumptionLogBlock(assumption: PlanningAssumption, index: number): string[] {
  return [
    `- ${index + 1}. ${collapseLine(assumption.topic)}`,
    `  - Human Review Level: ${assumption.human_review_level ?? 'AUTO_WITH_LOG'}`,
    `  - Review Categories: ${(assumption.review_categories ?? []).join(', ') || 'none'}`,
    `  - Default If Skipped: ${collapseLine(assumption.default_value)}`,
    `  - Reason: ${collapseLine(assumption.reason)}`,
    `  - Risk Categories: ${(assumption.risk_categories ?? []).join(', ') || 'none'}`,
    `  - Related Files: ${(assumption.related_files ?? []).join(', ') || 'none'}`,
    `  - Can Auto Apply: ${assumption.can_auto_apply ? 'true' : 'false'}`,
    assumption.skipped_because ? `  - Skipped Because: ${collapseLine(assumption.skipped_because)}` : '',
    `  - Source: ${assumption.source}`
  ].filter(Boolean);
}

function isDecisionSource(value: string): value is DecisionSource {
  return value === 'user_decision'
    || value === 'code_evidence'
    || value === 'validation_result'
    || value === 'ai_inference'
    || value === 'needs_review';
}

function isRiskCategory(value: string): value is RiskCategory {
  return value === 'reversibility'
    || value === 'security'
    || value === 'data_loss'
    || value === 'public_contract'
    || value === 'user_intent'
    || value === 'code_evidence_lack'
    || value === 'ripple_effect'
    || value === 'learning_value';
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function collapseLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeGuideMeta(value?: string): string {
  if (!value) {
    return '';
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
  const doNotAskAgain = Array.from(new Set([...STATIC_DO_NOT_ASK_AGAIN, ...dynamicTopics])).sort((left, right) =>
    left.localeCompare(right)
  );
  const latestDecisionSummary = entries.length > 0
    ? summarizeLoggedDecision(entries[0]).replace(' -- ', ' — ')
    : '';
  const confirmedLines =
    entries.length === 0
      ? ['- Logged user decisions: none yet.']
      : entries.map((entry) => `- ${summarizeLoggedDecision(entry).replace(' -- ', ' — ')}`);
  const confirmedDefaults = BASE_CONFIRMED_DECISIONS.map((line) => `- ${line.replace(' -- ', ' — ')}`);
  const normalizedTask = latestTask?.trim() ? collapseLine(latestTask) : '최근 요청 컨텍스트 없음.';
  const normalizedSummary = latestSummary?.trim()
    ? collapseLine(latestSummary)
    : latestDecisionSummary || '아직 구현 요약이 없습니다.';

  return [
    GENERATED_SECTION_START,
    `${GENERATED_COUNT_PREFIX}${entries.length} -->`,
    `<!-- DEBTCRASHER:LATEST_DECISION=${encodeURIComponent(latestDecisionSummary)} -->`,
    `<!-- DEBTCRASHER:BUILD_SUMMARY=${encodeURIComponent(normalizedSummary)} -->`,
    `<!-- DEBTCRASHER:LATEST_TASK=${encodeURIComponent(normalizedTask)} -->`,
    '## Agent Behavior Rules',
    '- Before asking ANY question, read this file in full',
    '- If the answer can be inferred from confirmed decisions or implied constraints, do not ask - implement with that inference',
    '- For a new task, plan first and surface REVIEW_REQUIRED items first, then record REVIEW_RECOMMENDED or AUTO_WITH_LOG items in the assumption log',
    '- Planning questions must include human_review_level, review_categories, reason, default_if_skipped, risk_if_wrong, and risk_categories',
    '- Do not re-ask a decision when risk category, target file/module, and decision topic overlap with an existing decision in at least 2 of those 3 dimensions',
    '- If an existing decision may conflict with the current request, explicitly mark "기존 결정과 충돌 가능성" before asking again',
    '- After the surfaced planning questions are answered, begin implementation immediately and do not ask more questions',
    '- If a decision is listed in "Do not ask again", treat it as immutable and never surface it again',
    '- When implementing, add a one-line comment for any default assumption you made without asking: // ASSUMPTION: [what and why]',
    '- This file is regenerated from the current decision state. Do not treat it as a log - treat it as ground truth for this project',
    '- The full decision history is in DECISIONS.md - read it only when this file is not enough',
    '',
    '# Debtcrasher Cache',
    '',
    '## Confirmed Decisions',
    ...confirmedDefaults,
    ...confirmedLines,
    '',
    '## Implied Constraints',
    ...IMPLIED_CONSTRAINTS.map((line) => `- ${line}`),
    '',
    '## Most Recent Context',
    `- Request: ${normalizedTask}`,
    `- Last built feature: ${normalizedSummary}`,
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
  return `${entry.title}: ${chosenLabel} -- ${reason}`;
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
  const normalized = head
    .replace(/^Option\s+[AB]\s*-\s*/i, '')
    .replace(/^[AB]\s*-\s*/i, '')
    .trim();
  return normalized || fallback;
}

function extractReason(summary: string): string {
  const prosMatch = summary.match(/장점:\s*([^|]+)/) ?? summary.match(/pros:\s*([^|]+)/i);
  return prosMatch?.[1]?.split(',').map((value) => value.trim()).find(Boolean) ?? '';
}

function tokenizeForPatterns(input: string): string[] {
  const matches = input.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  return Array.from(
    new Set(
      matches
        .flatMap((token) => token.split(/[._-]+/g))
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    )
  );
}

function computeSimilarityScore(taskTokens: string[], entryTokens: string[]): number {
  if (taskTokens.length === 0 || entryTokens.length === 0) {
    return 0;
  }

  const entrySet = new Set(entryTokens);
  return taskTokens.reduce((score, token) => score + (entrySet.has(token) ? 2 : 0), 0);
}

function scorePatternGroup(keywords: readonly string[], text: string): number {
  const normalized = text.toLowerCase();
  return keywords.reduce((score, keyword) => score + (normalized.includes(keyword.toLowerCase()) ? 1 : 0), 0);
}

function upsertGeneratedGuideSection(existing: string, generated: string): string {
  const trimmed = existing.trim();
  const pattern = new RegExp(
    `${escapeRegExp(GENERATED_SECTION_START)}[\\s\\S]*?${escapeRegExp(GENERATED_SECTION_END)}`,
    'm'
  );
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

