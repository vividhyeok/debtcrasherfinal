import type { TraceabilityMode } from './aiClient';
import type { DecisionLogEntry } from './logManager';

export interface TutorialValidationReport {
  required_sections: 'pass' | 'fail';
  related_decision_log: 'pass' | 'fail';
  related_files: 'pass' | 'warn' | 'fail';
  validation_result_included: 'pass' | 'fail';
  unsupported_strong_claims: number;
  final_status: 'generated' | 'generated_with_warning' | 'blocked';
  messages: string[];
}

const REQUIRED_HEADINGS = [
  '# 제목',
  '## 선택한 결정',
  '## Human Review Level',
  '## Review Categories',
  '## 당시 맥락',
  '## 선택하지 않은 대안',
  '## 이 결정이 구현에 준 영향',
  '## 관련 결정 로그',
  '## 관련 파일',
  '## 검증 결과',
  '## 나중에 다시 확인할 점'
] as const;

const STRONG_CLAIMS = ['항상', '완벽히', '보장한다', '절대'] as const;
const EVIDENCE_LABEL_PATTERN = /^\s*(?:[-*]\s*)?\[(사용자 결정|코드 근거|검증 결과|AI 추론|확인 필요)\]/;

export function validateTutorialMarkdown(
  markdown: string,
  entries: DecisionLogEntry[],
  mode: TraceabilityMode
): { markdown: string; report: TutorialValidationReport } {
  const report = buildTutorialValidationReport(markdown, entries, mode);
  const markdownWithReport = appendValidationReport(markdown, report);

  if (report.final_status === 'blocked') {
    throw new Error(`튜토리얼 생성 검증에 실패했습니다.\n- ${report.messages.join('\n- ')}`);
  }

  return {
    markdown: markdownWithReport,
    report
  };
}

function buildTutorialValidationReport(
  markdown: string,
  entries: DecisionLogEntry[],
  mode: TraceabilityMode
): TutorialValidationReport {
  const messages: string[] = [];
  const missingHeadings = REQUIRED_HEADINGS.filter((heading) => !hasHeading(markdown, heading));
  const requiredSections = missingHeadings.length === 0 ? 'pass' : 'fail';
  if (missingHeadings.length > 0) {
    messages.push(`필수 heading 누락: ${missingHeadings.join(', ')}`);
  }

  const entryTokens = entries.flatMap((entry) => [entry.id, entry.title]).filter(Boolean);
  const includesDecisionId = entryTokens.some((token) => markdown.includes(token));
  const relatedDecisionLog = entries.length > 0 && includesDecisionId ? 'pass' : 'fail';
  if (relatedDecisionLog === 'fail') {
    messages.push('관련 결정 로그 ID 또는 제목이 본문에 포함되지 않았습니다.');
  }

  const relatedFiles = Array.from(new Set(entries.flatMap((entry) => entry.relatedFiles ?? []))).filter(Boolean);
  const hasRelatedFileEvidence = relatedFiles.length > 0 && relatedFiles.some((file) => markdown.includes(file.replace(/\s+\(overwritten\)$/i, '')));
  const relatedFilesStatus = relatedFiles.length === 0 ? 'warn' : hasRelatedFileEvidence ? 'pass' : 'warn';
  if (relatedFilesStatus === 'warn') {
    messages.push(relatedFiles.length === 0 ? '관련 파일이 기록되지 않았습니다.' : '관련 파일이 본문에 명확히 포함되지 않았습니다.');
  }

  const validationSection = extractSection(markdown, '## 검증 결과');
  const validationResultIncluded = /(typecheck|build|test|lint|passed|failed|not available|needs_review|검증)/i.test(validationSection)
    ? 'pass'
    : 'fail';
  if (validationResultIncluded === 'fail') {
    messages.push('검증 결과 섹션에 실제 검증 상태가 포함되지 않았습니다.');
  }

  const unsupportedStrongClaims = STRONG_CLAIMS.reduce(
    (count, phrase) => count + countOccurrences(markdown, phrase),
    0
  );
  if (unsupportedStrongClaims > 0) {
    messages.push(`근거 없는 강한 표현 ${unsupportedStrongClaims}개가 감지되었습니다.`);
  }

  if (hasFailedValidation(entries) && /(성공|완료|문제 없음)/.test(validationSection)) {
    messages.push('검증 실패 또는 미실행 상태가 있는데 성공/완료/문제 없음처럼 표현했습니다.');
  }

  if (markdown.trim().length < Math.max(500, entries.length * 250)) {
    messages.push('본문 길이가 지나치게 짧습니다.');
  }

  if (mode === 'strict' && !allMajorBlocksHaveEvidenceLabels(markdown)) {
    messages.push('Strict mode에서는 주요 문단 또는 bullet 앞에 근거 라벨이 필요합니다.');
  }

  const blockingFailures = [
    requiredSections === 'fail',
    relatedDecisionLog === 'fail',
    validationResultIncluded === 'fail',
    markdown.trim().length < Math.max(500, entries.length * 250),
    mode === 'strict' && !allMajorBlocksHaveEvidenceLabels(markdown)
  ];
  const finalStatus = blockingFailures.some(Boolean)
    ? 'blocked'
    : messages.length > 0
      ? 'generated_with_warning'
      : 'generated';

  return {
    required_sections: requiredSections,
    related_decision_log: relatedDecisionLog,
    related_files: relatedFilesStatus,
    validation_result_included: validationResultIncluded,
    unsupported_strong_claims: unsupportedStrongClaims,
    final_status: finalStatus,
    messages
  };
}

function appendValidationReport(markdown: string, report: TutorialValidationReport): string {
  const body = markdown.trimEnd();
  return [
    body,
    '',
    '## 생성 검증 결과',
    `- required_sections: ${report.required_sections}`,
    `- related_decision_log: ${report.related_decision_log}`,
    `- related_files: ${report.related_files}`,
    `- validation_result_included: ${report.validation_result_included}`,
    `- unsupported_strong_claims: ${report.unsupported_strong_claims}`,
    `- final_status: ${report.final_status}`,
    ''
  ].join('\n');
}

function hasHeading(markdown: string, heading: string): boolean {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}\\s*$`, 'm').test(markdown);
}

function extractSection(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return markdown.match(new RegExp(`^${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|\\s*$)`, 'm'))?.[1] ?? '';
}

function hasFailedValidation(entries: DecisionLogEntry[]): boolean {
  return entries.some((entry) => {
    const validation = entry.validationResult;
    if (!validation) {
      return false;
    }
    return [validation.typecheck, validation.build, validation.test, validation.lint, validation.status]
      .some((value) => /failed|timeout|needs_review/i.test(value));
  });
}

function allMajorBlocksHaveEvidenceLabels(markdown: string): boolean {
  const blocks = markdown
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter((block) => block && !block.startsWith('#') && !block.startsWith('```'));
  if (blocks.length === 0) {
    return false;
  }
  return blocks.every((block) => EVIDENCE_LABEL_PATTERN.test(block));
}

function countOccurrences(source: string, phrase: string): number {
  return source.split(phrase).length - 1;
}
