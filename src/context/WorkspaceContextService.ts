import * as vscode from 'vscode';

// Architectural structure adapted from Continue's VS Code extension layering.
// Source project: https://github.com/continuedev/continue
// License: Apache-2.0

const textDecoder = new TextDecoder();
const SNAPSHOT_CHARACTER_BUDGET = 8_000;
const PREVIEW_LINE_LIMIT = 50;
const DEFAULT_MAX_FILES = 12;
const DEFAULT_MAX_INLINE_FILES = 6;
const DEFAULT_MAX_FILE_SIZE = 30_000;
const SEARCH_EXCLUDE_GLOB = '{**/node_modules/**,**/.git/**,**/.vendor/**,**/dist/**,**/build/**,**/out/**,**/.ai-tutorials/**,**/*.lock,**/*.map,**/*.png,**/*.jpg,**/*.jpeg,**/*.gif,**/*.ico,**/*.pdf,**/*.zip,**/*.svg}';
const CONFIG_FILE_NAMES = new Set(['package.json', 'tsconfig.json', 'go.mod', 'cargo.toml', 'requirements.txt']);
const TASK_STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'or', 'to', 'for', 'with', 'into', 'from', 'that', 'this', 'then', 'than',
  'make', 'build', 'create', 'need', 'want', 'project', 'feature', 'using', 'user', 'request', 'please',
  'just', 'very', 'some', 'more', 'less', '은', '는', '이', '가', '을', '를', '에', '의', '로', '으로'
]);
const KOREAN_PARTICLE_SUFFIXES = ['으로', '에서', '에게', '한테', '은', '는', '이', '가', '을', '를', '에', '의', '로'];

export interface WorkspaceSnapshotOptions {
  maxFiles?: number;
  maxInlineFiles?: number;
  maxFileSize?: number;
  maxInlineCharacters?: number;
  task?: string;
  preferredPaths?: string[];
}

interface ScoredFile {
  uri: vscode.Uri;
  relativePath: string;
  score: number;
  preview: string;
  isConfig: boolean;
  preferredRank: number;
}

export class WorkspaceContextService {
  public async buildWorkspaceSnapshot(
    workspaceRoot: vscode.Uri | undefined,
    options: WorkspaceSnapshotOptions = {}
  ): Promise<string> {
    if (!workspaceRoot) {
      return 'Workspace is not open.';
    }

    const candidates = await vscode.workspace.findFiles('**/*', SEARCH_EXCLUDE_GLOB);
    const filteredCandidates = candidates.filter((uri) => !shouldAlwaysExclude(vscode.workspace.asRelativePath(uri, false)));

    if (filteredCandidates.length === 0) {
      return 'Workspace is empty.';
    }

    const rankedFiles = await rankFiles(workspaceRoot, filteredCandidates, options);
    if (rankedFiles.length === 0) {
      return 'Workspace is empty.';
    }

    const header = options.task?.trim()
      ? `Workspace snapshot (ranked for task: ${options.task.trim()}):`
      : 'Workspace snapshot (ranked by relevance):';

    const sections = buildSnapshotSections(header, rankedFiles, options);
    return sections.join('\n\n');
  }
}

async function rankFiles(
  workspaceRoot: vscode.Uri,
  files: vscode.Uri[],
  options: WorkspaceSnapshotOptions
): Promise<ScoredFile[]> {
  const keywords = extractKeywords(options.task ?? '');
  const preferredPaths = new Set((options.preferredPaths ?? []).map(normalizePath));
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  const scoredFiles = await Promise.all(
    files.map(async (uri) => {
      const relativePath = normalizePath(vscode.workspace.asRelativePath(uri, false));
      const preview = await readPreview(uri, maxFileSize);
      const score = keywords.length === 0
        ? 0
        : countKeywordMatches(relativePath, keywords) + countKeywordMatches(preview, keywords);

      return {
        uri,
        relativePath,
        score,
        preview,
        isConfig: isConfigFile(relativePath),
        preferredRank: computePreferredRank(relativePath, preferredPaths)
      } satisfies ScoredFile;
    })
  );

  const requiredFiles = scoredFiles.filter((file) => file.isConfig || file.preferredRank > 0);
  const optionalFiles = scoredFiles.filter((file) => !file.isConfig && file.preferredRank === 0);

  requiredFiles.sort(compareScoredFiles);
  optionalFiles.sort(compareScoredFiles);

  return dedupeByPath([...requiredFiles, ...optionalFiles]);
}

function buildSnapshotSections(
  header: string,
  rankedFiles: ScoredFile[],
  options: WorkspaceSnapshotOptions
): string[] {
  const maxOptionalFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxInlineFiles = options.maxInlineFiles ?? DEFAULT_MAX_INLINE_FILES;
  const maxInlineCharacters = options.maxInlineCharacters ?? 4_000;
  const sections = [header];
  let remainingBudget = SNAPSHOT_CHARACTER_BUDGET - header.length;
  let optionalCount = 0;
  let inlineCount = 0;

  for (const file of rankedFiles) {
    const isRequired = file.isConfig || file.preferredRank > 0;
    if (!isRequired && optionalCount >= maxOptionalFiles) {
      continue;
    }

    const separatorCost = sections.length > 1 ? 2 : 0;
    const availableBudget = remainingBudget - separatorCost;
    if (availableBudget <= 0) {
      break;
    }

    const includePreview = inlineCount < maxInlineFiles;
    const section = buildSnapshotSection(file, includePreview, maxInlineCharacters, availableBudget);
    if (!section) {
      continue;
    }

    sections.push(section);
    remainingBudget -= section.length + separatorCost;
    if (!isRequired) {
      optionalCount += 1;
    }
    if (includePreview && file.preview) {
      inlineCount += 1;
    }
  }

  return sections;
}

function buildSnapshotSection(
  file: ScoredFile,
  includePreview: boolean,
  maxInlineCharacters: number,
  availableBudget: number
): string | undefined {
  const title = `FILE: ${file.relativePath}`;
  if (availableBudget < title.length) {
    return undefined;
  }

  if (!includePreview || !file.preview) {
    return title;
  }

  const previewBudget = Math.min(maxInlineCharacters, availableBudget - title.length - 1);
  if (previewBudget < 32) {
    return title;
  }

  const preview = trimToBudget(file.preview, previewBudget);
  return preview ? `${title}\n${preview}` : title;
}

async function readPreview(uri: vscode.Uri, maxFileSize: number): Promise<string> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > maxFileSize) {
      return '';
    }

    const content = textDecoder.decode(await vscode.workspace.fs.readFile(uri));
    return content.split(/\r?\n/).slice(0, PREVIEW_LINE_LIMIT).join('\n').trim();
  } catch {
    return '';
  }
}

function compareScoredFiles(left: ScoredFile, right: ScoredFile): number {
  if (right.preferredRank !== left.preferredRank) {
    return right.preferredRank - left.preferredRank;
  }
  if (Number(right.isConfig) !== Number(left.isConfig)) {
    return Number(right.isConfig) - Number(left.isConfig);
  }
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  return left.relativePath.localeCompare(right.relativePath);
}

function extractKeywords(input: string): string[] {
  const splitTokens = input
    .toLowerCase()
    .split(/\s+/)
    .flatMap((token) => token.split(/[\\/.,:;()[\]{}<>!?'"`~+=|]+/g))
    .map((token) => stripParticle(token.trim()))
    .filter((token) => token.length >= 2 && !TASK_STOPWORDS.has(token));

  return Array.from(new Set(splitTokens));
}

function stripParticle(token: string): string {
  if (!token) {
    return '';
  }

  for (const suffix of KOREAN_PARTICLE_SUFFIXES) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 2) {
      return token.slice(0, -suffix.length);
    }
  }

  return token;
}

function countKeywordMatches(source: string, keywords: string[]): number {
  const normalizedSource = source.toLowerCase();
  return keywords.reduce((score, keyword) => score + (normalizedSource.includes(keyword) ? 1 : 0), 0);
}

function computePreferredRank(relativePath: string, preferredPaths: Set<string>): number {
  if (preferredPaths.size === 0) {
    return 0;
  }

  if (preferredPaths.has(relativePath)) {
    return 2;
  }

  for (const preferredPath of preferredPaths) {
    if (relativePath.startsWith(`${preferredPath}/`) || preferredPath.startsWith(`${relativePath}/`)) {
      return 1;
    }
  }

  return 0;
}

function isConfigFile(relativePath: string): boolean {
  const fileName = relativePath.split('/').pop() ?? relativePath;
  return CONFIG_FILE_NAMES.has(fileName.toLowerCase());
}

function shouldAlwaysExclude(relativePath: string): boolean {
  const normalized = normalizePath(relativePath);
  const fileName = normalized.split('/').pop() ?? normalized;
  const segments = normalized.split('/');

  if (segments.includes('node_modules') || segments.includes('.git')) {
    return true;
  }
  if (segments.includes('dist') || segments.includes('build') || segments.includes('out')) {
    return true;
  }
  if (segments.includes('.ai-tutorials') || segments.includes('.vendor')) {
    return true;
  }
  if (fileName === 'decisions.md' || fileName === 'agent.md') {
    return true;
  }
  if (fileName.endsWith('.lock') || fileName.endsWith('.map')) {
    return true;
  }
  return false;
}

function trimToBudget(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  if (limit <= 1) {
    return value.slice(0, limit);
  }
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function dedupeByPath(files: ScoredFile[]): ScoredFile[] {
  const seen = new Set<string>();
  const deduped: ScoredFile[] = [];

  for (const file of files) {
    if (seen.has(file.relativePath)) {
      continue;
    }
    seen.add(file.relativePath);
    deduped.push(file);
  }

  return deduped;
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}
