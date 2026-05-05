# DebtCrasher 포지셔닝 및 구현 근거 문서

작성 언어: 한국어.

이 문서는 DebtCrasher 저장소를 외부에 설명하거나 논문 작성 시 코드 전체 없이도 의미를 전달하기 위해 작성한 구현 기반 문서다. 일반적인 오픈소스 README처럼 설치, 사용법, 홍보 문구를 중심으로 쓰지 않는다.

작성 기준은 다음과 같다.

- 저장소의 실제 코드, 설정, 문서 파일에서 확인되는 사실을 우선한다.
- 제품적 주장, 효과 주장, 사용자 효용에 대한 추론은 최소화한다.
- `human_review_level`은 코드와 프롬프트에 명시된 것처럼 객관적 정답 점수가 아니라 워크플로 정책으로 설명한다.
- AI 판단의 정확성, 생성 코드의 안전성, 생성 문서의 완전성을 보장한다고 쓰지 않는다.
- 논문에서 “구현된 시스템의 위치”를 설명할 수 있도록 목적, 구조, 흐름, 데이터 형식, 제한 사항을 한 문서에 모은다.
- 코드 블록 안의 `...`는 원문 코드 중 설명에 직접 필요하지 않은 부분을 생략했다는 표시다.

## 1. 프로젝트 식별 정보

`package.json` 기준 프로젝트명은 `debtcrasher`, 표시 이름은 `Debtcrasher`이다.

```json
{
  "name": "debtcrasher",
  "displayName": "Debtcrasher",
  "description": "A VS Code development agent that preserves high-leverage architecture decisions as reusable learning notes.",
  "version": "0.0.1",
  "publisher": "local",
  "license": "Apache-2.0",
  "engines": {
    "vscode": "^1.95.0"
  }
}
```

형태는 VS Code 확장 프로그램이다. `package.json`의 `main`은 `./out/extension.js`이고, TypeScript 소스의 엔트리 포인트는 `src/extension.ts`이다.

```ts
import * as vscode from 'vscode';

import { activateDebtcrasher } from './activation/activateDebtcrasher';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await activateDebtcrasher(context);
}

export function deactivate(): void {
  // no-op
}
```

VS Code Activity Bar 컨테이너 하나와 Webview View 두 개를 등록한다.

```ts
export const SIDEBAR_CONTAINER_ID = 'debtcrasher';

export const STEP_VIEW_ID = 'debtcrasher.stepView';
export const AGENT_VIEW_ID = 'debtcrasher.agentView';
```

`package.json`에 등록된 명령은 네 개다.

| command | title |
| --- | --- |
| `debtcrasher.openAgentView` | Agent View 열기 |
| `debtcrasher.openStepView` | Step View 열기 |
| `debtcrasher.openBoth` | Debtcrasher 열기 |
| `debtcrasher.openSettings` | Debtcrasher 설정 열기 |

## 2. 한 문장 포지셔닝

DebtCrasher는 AI가 바로 코드를 작성하기 전에 설계상 의미가 있는 결정을 질문 후보로 분리하고, 사용자가 확인한 결정을 `DECISIONS.md`에 기록하고, 요약된 프로젝트 기억을 `AGENT.md`에 유지하며, 선택된 결정 로그를 학습용 markdown 문서로 재구성하는 VS Code 개발 에이전트다.

위 문장은 다음 구현 사실에 대응한다.

- `AgentViewController.handleSubmitTask()`는 사용자 요청을 받으면 구현을 바로 시작하지 않고 workspace snapshot, project guide context, historical decision pattern context, previous session context를 모은 뒤 `AIClient.generatePlan()`을 호출한다.
- `AgentViewController.handleStartImplementation()`은 계획 질문에 대한 답변이 모두 해소된 뒤 `LogManager.appendDecisions()`와 `LogManager.syncProjectGuide()`를 실행하고 나서 구현 단계로 넘어간다.
- `LogManager`는 `DECISIONS.md`를 생성/갱신하고, `AGENT.md`의 DebtCrasher generated section을 생성/갱신한다.
- `StepViewController`는 `DECISIONS.md`의 엔트리를 선택 가능한 step으로 보여주고, 선택된 엔트리로 학습 자료 markdown을 생성해 `.ai-tutorials/`에 저장한다.
- `VerificationService`는 사용 가능한 검증 명령을 탐지하고 실행 결과를 decision metadata와 UI 응답에 연결한다.

## 3. 기존 AI 코딩 에이전트와의 구현상 구분점

이 저장소에서 확인되는 구분점은 “코드 생성 전 의사결정 게이트”와 “결정 기록의 재사용”이다.

DebtCrasher의 구현 흐름은 다음과 같이 요약할 수 있다.

```text
User Task
  -> Workspace Snapshot / AGENT.md / DECISIONS.md / Session Context 수집
  -> Planning Response 생성
  -> Human Review Gate 필터링
  -> 사용자 선택 수집
  -> DECISIONS.md 기록
  -> AGENT.md 캐시 갱신
  -> Implementation Response 생성
  -> 파일 작성
  -> Verification 실행
  -> 필요 시 1회 repair 시도
  -> Decision metadata 갱신
  -> Step View에서 결정 로그를 학습 자료 markdown으로 변환
```

이 포지셔닝은 다음 문자열과 정책에서 직접 확인된다.

```ts
const PLANNING_SYSTEM_PROMPT = [
  'You are a planning agent for Debtcrasher, a VS Code development agent.',
  'Your job is to build a Human Review Gate, not to score importance as if AI had objective authority.',
  '',
  'Authority order:',
  '1. The current user request',
  '2. AGENT.md and other project guide files',
  '3. Existing workspace files and code patterns',
  '',
  'Human Review Gate principles:',
  '1. `human_review_level` is a workflow policy, not an objective ground-truth label.',
  '2. `REVIEW_REQUIRED` must always be surfaced to the user.',
  '3. `REVIEW_RECOMMENDED` depends on `question_sensitivity`.',
  '4. `AUTO_WITH_LOG` should be auto-applied and written to the assumption log.',
  '5. Do not ask about implementation details that the codebase can safely default.',
  '6. When the user answer changes public contracts, data safety, security, or cost, escalate to `REVIEW_REQUIRED`.',
  '7. Do not surface arbitrary brainstorming questions.',
  ...
].join('\n');
```

따라서 이 프로젝트는 “AI가 모든 코드를 빠르게 생성하는 도구”로만 설명하기보다는, “AI 개발 작업 중 위험하거나 되돌리기 어려운 결정을 코드 생성 전에 표면화하고 기록하는 VS Code 확장”으로 설명하는 것이 코드와 맞다.

## 4. 핵심 개념: Human Review Gate

Human Review Gate는 `src/aiClient.ts`의 타입과 planning prompt에서 정의된다.

```ts
export type QuestionSensitivity = 'flow' | 'balanced' | 'review' | 'strict';
export type PlanningImpact = 'HIGH' | 'MEDIUM' | 'LOW';
export type TraceabilityMode = 'basic' | 'strict';
export type HumanReviewLevel = 'REVIEW_REQUIRED' | 'REVIEW_RECOMMENDED' | 'AUTO_WITH_LOG';
export type RiskCategory =
  | 'reversibility'
  | 'security'
  | 'data_loss'
  | 'public_contract'
  | 'user_intent'
  | 'code_evidence_lack'
  | 'ripple_effect'
  | 'learning_value';
```

세 review level의 동작은 코드와 프롬프트상 다음과 같이 배치된다.

| level | 구현상 의미 |
| --- | --- |
| `REVIEW_REQUIRED` | `question_sensitivity`와 무관하게 사용자에게 표면화된다. |
| `REVIEW_RECOMMENDED` | `question_sensitivity` 설정에 따라 표면화되거나 assumption log로 이동한다. |
| `AUTO_WITH_LOG` | strict 모드가 아니면 질문하지 않고 assumption log에 기록된다. |

질문 표면화 여부는 `shouldAskQuestion()`에서 결정된다.

```ts
function shouldAskQuestion(question: PlanningQuestion, sensitivity: QuestionSensitivity): boolean {
  const level = question.human_review_level ?? 'AUTO_WITH_LOG';
  if (sensitivity === 'strict') return true;
  if (level === 'REVIEW_REQUIRED') return true;
  if (level === 'AUTO_WITH_LOG') return false;
  if (sensitivity === 'flow') return false;
  if (sensitivity === 'balanced') return isPriorityRisk(question) || hasStrongReviewSignal(question);
  return true; // 'review' mode: show REVIEW_RECOMMENDED
}
```

정렬은 review level, topic 순서로 이루어진다.

```ts
function comparePlanningQuestions(left: PlanningQuestion, right: PlanningQuestion): number {
  const levelOrder: Record<HumanReviewLevel, number> = {
    REVIEW_REQUIRED: 0,
    REVIEW_RECOMMENDED: 1,
    AUTO_WITH_LOG: 2
  };
  const leftLevel = normalizeHumanReviewLevel(left.human_review_level ?? deriveHumanReviewLevel(left));
  const rightLevel = normalizeHumanReviewLevel(right.human_review_level ?? deriveHumanReviewLevel(right));
  const levelDelta = levelOrder[leftLevel] - levelOrder[rightLevel];
  if (levelDelta !== 0) {
    return levelDelta;
  }
  return left.topic.localeCompare(right.topic);
}
```

`leverage_score`는 코드베이스에서 완전히 제거되었다. 정렬은 `human_review_level`과 `topic`으로만 이루어진다.

## 5. 질문 민감도 설정

`package.json`에는 `debtcrasher.questionSensitivity` 설정이 등록되어 있다.

```json
{
  "debtcrasher.questionSensitivity": {
    "type": "string",
    "enum": ["flow", "balanced", "review", "strict"],
    "default": "balanced",
    "markdownDescription": "Question sensitivity level. Flow / Balanced / Review / Strict."
  }
}
```

`AIClient.getQuestionSensitivity()`는 VS Code 설정에서 값을 읽고, 허용된 값이 아니면 `balanced`를 사용한다.

```ts
public async getQuestionSensitivity(): Promise<QuestionSensitivity> {
  const configured = this.getConfiguration().get<string>('questionSensitivity', 'balanced');
  return isQuestionSensitivity(configured) ? configured : 'balanced';
}
```

planning prompt에는 각 모드의 처리 원칙이 문자열로 삽입된다.

```ts
function buildPlanningQuestionFilterPrompt(level: QuestionSensitivity): string {
  const levelInstruction = level === 'flow'
    ? 'Question sensitivity: FLOW. Ask only REVIEW_REQUIRED items and apply all others as assumptions.'
    : level === 'balanced'
      ? 'Question sensitivity: BALANCED. Ask REVIEW_REQUIRED items and the most important REVIEW_RECOMMENDED items.'
      : level === 'review'
        ? 'Question sensitivity: REVIEW. Ask REVIEW_REQUIRED items and most REVIEW_RECOMMENDED items.'
        : 'Question sensitivity: STRICT. Show all candidates, including AUTO_WITH_LOG items, and keep the review metadata explicit.';

  return [
    '---',
    `## Question Sensitivity: ${level}`,
    '',
    levelInstruction,
    '',
    'Planning constraints:',
    '- Every candidate must have human_review_level, review_categories, risk_categories, reason, default_if_skipped, risk_if_wrong, related_files, and can_auto_apply.',
    '- REVIEW_REQUIRED items must always be surfaced.',
    '- REVIEW_RECOMMENDED items depend on the active sensitivity mode.',
    '- AUTO_WITH_LOG items should only be surfaced in STRICT mode.',
    '- Every unasked decision must be recorded in assumption_log instead.',
    '---'
  ].join('\n');
}
```

## 6. PlanningResponse 자료구조

planning 단계의 반환 스키마는 `src/aiClient.ts`에 TypeScript interface로 정의되어 있다.

```ts
export interface DecisionOption {
  label: string;
  pros: string[];
  cons: string[];
}

export interface PlanningAssumption {
  topic: string;
  default_value: string;
  reason: string;
  human_review_level?: HumanReviewLevel;
  review_categories?: string[];
  risk_categories: RiskCategory[];
  related_files?: string[];
  can_auto_apply?: boolean;
  skipped_because?: string;
  source: 'ai_inference' | 'code_evidence' | 'user_decision' | 'needs_review';
}

export interface PlanningQuestion {
  id: string;
  impact: PlanningImpact;
  topic: string;
  question: string;
  options: DecisionOption[];
  optionA: DecisionOption;
  optionB: DecisionOption;
  human_review_level?: HumanReviewLevel;
  review_categories?: string[];
  reason: string;
  default_if_skipped: string;
  risk_if_wrong: string;
  risk_categories: RiskCategory[];
  decision_topic?: string;
  related_files?: string[];
  target_files?: string[];
  can_auto_apply?: boolean;
  conflict_with?: string;
}

export interface PlanningResponse {
  summary: string;
  assumptions: string[];
  assumption_log: PlanningAssumption[];
  questions: PlanningQuestion[];
}
```

planning 응답은 JSON으로 파싱된다. 코드 fence 안의 JSON, 전체 문자열, 첫 `{`부터 마지막 `}`까지의 부분 문자열을 순서대로 파싱 후보로 사용한다.

```ts
function parseJsonResponse<T>(text: string): T {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.unshift(fenced[1].trim());
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try { return JSON.parse(candidate) as T; } catch { continue; }
  }
  throw new Error('AI가 유효한 JSON 응답을 반환하지 않았습니다.');
}
```

planning JSON 파싱 실패 또는 schema mismatch 시 `createFallbackPlanningResponse()`가 호출된다. fallback은 `REVIEW_REQUIRED` 질문 하나를 생성한다.

## 7. Planning 단계 입력 컨텍스트

`AgentViewController.handleSubmitTask()`에서 planning 입력에 사용되는 컨텍스트는 네 종류다.

```ts
const workspaceContext = await this.workspaceContextService.buildWorkspaceSnapshot(
  workspaceRoot,
  {
    ...WORKSPACE_SNAPSHOT_OPTIONS,
    task
  }
);
const referenceContext = await this.logManager.readProjectGuideContext();
const patternContext = await this.logManager.readDecisionPatternContext(task);
const decisionMemory = await this.logManager.readLogEntries();
const plan = await this.aiClient.generatePlan(
  task,
  workspaceContext,
  referenceContext,
  patternContext,
  resumeContext,
  decisionMemory,
  abortController.signal
);
```

각 컨텍스트의 출처는 다음과 같다.

| 컨텍스트 | 구현 파일 | 내용 |
| --- | --- | --- |
| workspace snapshot | `WorkspaceContextService` | 작업 요청과 파일명/미리보기 기준으로 관련 파일을 랭킹해 일부 내용을 포함한다. |
| project guide context | `LogManager.readProjectGuideContext()` | `AGENT.md`, `AGENTS.md` 후보 파일을 최대 8000자씩 읽는다. |
| historical decision pattern context | `LogManager.readDecisionPatternContext()` | 기존 `DECISIONS.md` 엔트리에서 유사 결정과 반복 선호 패턴을 추출한다. |
| previous session context | `SessionHistoryService.buildResumeContext()` | 이전 세션의 마지막 요청, 선택, 결과/오류 요약을 문자열로 만든다. |
| decision memory | `LogManager.readLogEntries()` | 중복 질문 방지에 사용되는 기존 결정 로그 엔트리 배열이다. |

`WorkspaceContextService`는 다음 경로/파일을 workspace snapshot에서 제외한다.

```ts
const SEARCH_EXCLUDE_GLOB =
  '{**/node_modules/**,**/.git/**,**/.vendor/**,**/dist/**,**/build/**,**/out/**,**/.ai-tutorials/**,**/*.lock,**/*.map,**/*.png,**/*.jpg,**/*.jpeg,**/*.gif,**/*.ico,**/*.pdf,**/*.zip,**/*.svg}';
```

추가로 `shouldAlwaysExclude()`는 `node_modules`, `.git`, `dist`, `build`, `out`, `.ai-tutorials`, `.vendor`, `DECISIONS.md`, `AGENT.md`, lock/map 파일을 제외한다.

## 8. 중복 질문 방지와 assumption log

planning 응답 정규화는 `normalizePlanningResponse()`에서 수행된다. 이 함수는 AI가 반환한 question 후보를 정규화한 뒤 기존 결정 로그와 중복되는지를 확인한다.

중복 판단은 세 조건 중 두 개 이상이 겹치면 중복으로 본다.

```ts
function findDuplicateDecision(question: PlanningQuestion, decisionMemory: DecisionLogEntry[]): DecisionLogEntry | undefined {
  for (const entry of decisionMemory) {
    const sameRiskCategory = question.risk_categories.some((category) => entry.riskCategories?.includes(category));
    const sameTarget = hasOverlappingPathOrModule(question.related_files ?? question.target_files ?? [], entry.relatedFiles ?? []);
    const sameDecisionTopic = isSameDecisionTopic(question, entry);
    const overlapCount = [sameRiskCategory, sameTarget, sameDecisionTopic].filter(Boolean).length;
    if (overlapCount >= 2) {
      return entry;
    }
  }
  return undefined;
}
```

질문으로 표면화되지 않은 항목은 `questionToAssumption()`을 통해 assumption log entry가 된다.

```ts
function questionToAssumption(question: PlanningQuestion, sensitivity: QuestionSensitivity, reason: string): PlanningAssumption {
  return {
    topic: question.decision_topic || question.topic,
    default_value: question.default_if_skipped || question.options[0]?.label || '기존 코드 스타일을 따릅니다.',
    human_review_level: question.human_review_level,
    review_categories: [...(question.review_categories ?? [])],
    reason,
    risk_categories: [...question.risk_categories],
    related_files: [...(question.related_files ?? question.target_files ?? [])],
    can_auto_apply: Boolean(question.can_auto_apply) || sensitivity === 'flow' || question.human_review_level === 'AUTO_WITH_LOG',
    skipped_because: reason,
    source: 'ai_inference'
  };
}
```

`normalizePlanningResponse()`는 최종적으로 다음 값을 반환한다.

```ts
return {
  summary: parsed.summary.trim() || task.trim() || '요청된 작업',
  assumptions: assumptionLines,
  assumption_log: assumptionLog,
  questions: prioritizePlanningQuestions(selectedQuestions, questionSensitivity)
};
```

## 9. 사용자 선택 처리

Agent View UI는 planning question마다 최대 네 개의 option을 표시한다. 사용자는 `A`, `B`, `C`, `D` 중 하나를 고르거나 custom choice를 입력할 수 있다.

```ts
interface StartImplementationAnswer {
  questionId: string;
  choiceType: 'A' | 'B' | 'C' | 'D' | 'custom';
  customChoice?: string;
}
```

구현 시작 시 모든 질문에 답이 있어야 한다.

```ts
function resolvePlanAnswers(
  task: string,
  questions: PlanningQuestion[],
  answers: StartImplementationAnswer[],
  assumptionLog: PlanningAssumption[]
): { history: DecisionHistoryEntry[]; logEntries: DecisionLogEntryInput[]; decisionIds: string[]; assumptionEntries: PlanningAssumption[] } | undefined {
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer]));

  if (questions.some((question) => !answerMap.has(question.id))) {
    return undefined;
  }

  ...
}
```

선택 결과는 implementation phase에 전달되는 `history`와 `DECISIONS.md`에 기록될 `logEntries`로 변환된다.

```ts
history.push({
  id: decisionId,
  title: question.topic,
  decisionPoint: question.question,
  userChoice: resolvedChoice.userChoice,
  outcome: resolvedChoice.outcome,
  reason: question.reason,
  riskCategories: [...question.risk_categories],
  defaultIfSkipped: question.default_if_skipped,
  riskIfWrong: question.risk_if_wrong,
  relatedFiles: question.related_files ?? question.target_files ?? [],
  source: ['user_decision', 'ai_inference']
});
```

assumption log는 첫 번째 decision log entry에 붙는다.

```ts
if (logEntries.length > 0 && assumptionEntries.length > 0) {
  logEntries[0] = {
    ...logEntries[0],
    assumptionLog: assumptionEntries
  };
}
```

## 10. DECISIONS.md의 위치와 형식

`LogManager`는 workspace root에 `DECISIONS.md`를 만든다.

```ts
const DECISIONS_FILE_NAME = 'DECISIONS.md';

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
```

`DECISIONS.md` 엔트리는 `renderLogBlock()`에서 다음 heading 구조로 만들어진다.

```md
## D-YYYYMMDD-HHMMSS-title
### Question
...

### Options
- A. ...
- B. ...

### Selected
...

### Human Review Level
...

### Review Categories
- ...

### AI Reason For Review
...

### Reason
...

### Risk Categories
- ...

### Default If Skipped
...

### Risk If Wrong
...

### Related Files
- ...

### Assumption Log
- ...

### Validation Result
- typecheck: ...
- build: ...
- test: ...
- lint: ...
- repair_attempted: ...
- status: ...

### Source
- user_decision
- ai_inference
- code_evidence
- validation_result
```

실제 렌더링 함수 일부는 다음과 같다.

```ts
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
  ...
].filter((line) => typeof line === 'string').join('\n');
```

구현과 검증이 끝난 뒤에는 `updateDecisionImplementationMetadata()`가 방금 선택된 decision id들의 related files, overwritten files, validation result, source를 갱신한다.

```ts
return {
  ...entry,
  relatedFiles,
  validationResult: metadata.validationResult,
  source: Array.from(new Set([...entry.source, 'code_evidence', 'validation_result']))
} satisfies DecisionLogEntry;
```

## 11. AGENT.md 캐시

`AGENT.md`는 전체 로그가 아니라 재사용 가능한 요약 캐시로 생성된다. target file은 항상 workspace root의 `AGENT.md`이다.

```ts
private async resolveGuideTargetUri(): Promise<vscode.Uri> {
  const workspaceRoot = this.getWorkspaceRootUri();
  if (!workspaceRoot) {
    throw new Error('워크스페이스 폴더를 먼저 열어 주세요.');
  }

  return vscode.Uri.joinPath(workspaceRoot, 'AGENT.md');
}
```

`renderProjectGuide()`는 다음 marker 사이에 generated section을 만든다.

```ts
const GENERATED_SECTION_START = '<!-- DEBTCRASHER:START -->';
const GENERATED_SECTION_END = '<!-- DEBTCRASHER:END -->';
const GENERATED_COUNT_PREFIX = '<!-- DEBTCRASHER:COUNT=';
```

`AGENT.md` generated section에는 다음 정보가 포함된다.

- `DEBTCRASHER:COUNT`
- `DEBTCRASHER:LATEST_DECISION`
- `DEBTCRASHER:BUILD_SUMMARY`
- `DEBTCRASHER:LATEST_TASK`
- `## Agent Behavior Rules`
- `# Debtcrasher Cache`
- `## Confirmed Decisions`
- `## Implied Constraints`
- `## Most Recent Context`
- `## Do not ask again`

`renderProjectGuide()`의 핵심 내용은 다음과 같다.

```ts
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
  ...
  GENERATED_SECTION_END
].join('\n');
```

`upsertGeneratedGuideSection()`은 기존 파일에 generated marker가 있으면 해당 구간을 교체하고, 없으면 기존 내용 뒤에 generated section을 붙인다.

## 12. 구현 생성 단계

implementation 단계는 `AIClient.generateImplementation()`이 담당한다. 입력으로 사용자 task, 선택된 decision history, workspace context, project reference context, planning assumptions, plan summary를 받는다.

```ts
public async generateImplementation(
  task: string,
  history: DecisionHistoryEntry[],
  workspaceContext: string,
  referenceContext = '',
  assumptions: string[] = [],
  planSummary = '',
  abortSignal?: AbortSignal
): Promise<ImplementationResponse> {
  const systemPrompt = `${IMPLEMENTATION_SYSTEM_PROMPT}\n\n${buildImplementationDefaultsPrompt(await this.getQuestionSensitivity())}`;
  const userPrompt = [
    `Developer task: ${task}`,
    '',
    'Planning summary:',
    planSummary.trim() || '- none',
    '',
    'Autonomous defaults from planning:',
    assumptions.length > 0 ? assumptions.map((item, index) => `${index + 1}. ${item}`).join('\n') : '- none',
    '',
    'Project reference context:',
    referenceContext.trim() || '- none',
    '',
    'Chosen decisions:',
    ...
    'Implementation requirements:',
    '- Never add features that are not mentioned or directly implied by the developer request.',
    '- Reuse AGENT.md decisions and implied constraints as defaults.',
    '- For every lower-level decision made without asking, add a source-code comment: // DEFAULT: [decision made] - [reason]',
    '- Generate the first working implementation now.'
  ].join('\n');
  ...
}
```

implementation 응답 스키마는 다음과 같다.

```ts
export interface ImplementationFile {
  path: string;
  description: string;
  content: string;
}

export interface ImplementationResponse {
  currentWork: string;
  summary: string;
  files: ImplementationFile[];
  runInstructions: string[];
}
```

파일 작성은 `AgentViewController.writeImplementationFiles()`가 수행한다. 절대 경로, home directory, `..` segment 등은 거부된다.

```ts
function normalizeRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!normalized) {
    throw new Error('빈 파일 경로는 사용할 수 없습니다.');
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`절대 경로는 허용하지 않습니다: ${input}`);
  }
  if (normalized.startsWith('~') || normalized.includes('$HOME') || normalized.includes('%USERPROFILE%')) {
    throw new Error(`홈 디렉터리 경로는 허용하지 않습니다: ${input}`);
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`워크스페이스 밖으로 나가는 경로는 허용하지 않습니다: ${input}`);
  }

  return segments.join('/');
}
```

민감 파일로 보이는 경로는 사용자 확인 없이 수정하지 않는다.

```ts
function isSensitivePath(relativePath: string): boolean {
  const normalized = relativePath.toLowerCase();
  const fileName = normalized.split('/').pop() ?? normalized;
  return fileName === '.env'
    || fileName.startsWith('.env.')
    || normalized.includes('/.env')
    || normalized.includes('secret')
    || normalized.includes('credential')
    || normalized.includes('private-key')
    || fileName.endsWith('.pem')
    || fileName.endsWith('.key')
    || fileName === 'id_rsa'
    || fileName === 'id_dsa';
}
```

## 13. 검증과 자동 repair

`VerificationService.detectCommands()`는 workspace에서 실행 가능한 검증 명령을 탐지한다.

package.json이 있으면 다음 순서로 script를 확인한다.

```ts
const PACKAGE_SCRIPT_ORDER = [
  { label: 'typecheck', commandName: 'typecheck', command: 'run typecheck' },
  { label: 'build', commandName: 'build', command: 'run build' },
  { label: 'test', commandName: 'test', command: 'test' },
  { label: 'lint', commandName: 'lint', command: 'run lint' }
] as const;
```

package manager는 lockfile 기준으로 `pnpm`, `yarn`, `bun`, `npm` 순서로 탐지한다. fallback으로 Python, Go, Rust, shell script를 탐지한다.

```ts
const GENERIC_SCRIPT_GLOB = '**/{test,check,verify}.sh';
const PYTHON_FILE_GLOB = '**/*.py';
```

검증 실행은 `spawn(command.command, { cwd, shell: true, windowsHide: true, env: process.env })`로 수행된다. output은 최대 12,000자까지 보관하고, timeout은 90,000ms이다.

```ts
const MAX_OUTPUT_CHARACTERS = 12_000;
const DEFAULT_TIMEOUT_MS = 90_000;
```

검증 실패가 있으면 `AIClient.repairImplementation()`을 한 번 호출한다. repair 응답에 변경 파일이 있으면 파일을 다시 쓰고 같은 검증 명령을 다시 실행한다.

```ts
if (verificationResults.some(isExecutedVerificationFailure)) {
  this.postPhaseUpdate(requestId, '현재 작업: 검증 실패를 바탕으로 자동 수정 중입니다.', 'verification');
  this.postProgress(requestId, 'repair_start');

  const repairWorkspaceContext = await this.workspaceContextService.buildWorkspaceSnapshot(workspaceRoot, {
    ...WORKSPACE_SNAPSHOT_OPTIONS,
    maxFiles: 8,
    maxInlineFiles: 4,
    maxInlineCharacters: 3_000,
    task,
    preferredPaths: files.map((file) => file.path)
  });
  const refreshedReferenceContext = await this.logManager.readProjectGuideContext();
  const repairedImplementation = await this.aiClient.repairImplementation(
    task,
    history,
    repairWorkspaceContext,
    refreshedReferenceContext,
    plan.assumptions,
    plan.summary,
    formatVerificationContext(verificationResults),
    abortSignal
  );

  if (repairedImplementation.files.length > 0) {
    const repairedFiles = await this.writeImplementationFiles(requestId, repairedImplementation.files, 'repair');
    ...
    autoRepairApplied = true;
    verificationResults = await this.runVerificationWithProgress(
      requestId,
      workspaceRoot,
      verificationCommands,
      abortSignal
    );
  }
}
```

검증 결과는 `DecisionValidationResult`로 decision metadata에 기록된다.

```ts
export interface DecisionValidationResult {
  typecheck: string;
  build: string;
  test: string;
  lint: string;
  status: string;
  repairAttempted?: boolean;
}
```

status 계산은 다음과 같다.

```ts
return {
  typecheck: statusByLabel.get('typecheck') ?? 'not available',
  build: statusByLabel.get('build') ?? 'not available',
  test: statusByLabel.get('test') ?? 'not available',
  lint: statusByLabel.get('lint') ?? 'not available',
  repairAttempted: autoRepairApplied,
  status: hasFailure ? 'needs_review' : allUnavailable ? 'not_available' : hasPassed ? 'passed' : 'needs_review'
};
```

## 14. Step View와 학습 자료 생성

Step View는 `DECISIONS.md`의 decision entry를 step처럼 보여준다. 사용자는 하나 이상의 step을 선택하고 학습 자료 markdown을 생성할 수 있다.

`StepViewController`는 다음 file watcher를 등록한다.

```ts
const logWatcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(workspaceFolder, 'DECISIONS.md')
);
const tutorialWatcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(workspaceFolder, '.ai-tutorials/*.md')
);
```

학습 자료 생성 흐름은 다음과 같다. 현재 코드의 `AIClient.generateTutorial()` 엔트리포인트는 유지되어 있지만, 이 경로는 외부 provider 호출보다 기록된 decision log를 근거 우선 markdown으로 재구성한 뒤 validator를 통과시키는 방식으로 동작한다.

```ts
const entries = await this.logManager.readLogEntries();
const selectedEntries = entryIds
  .map((entryId) => entries.find((entry) => entry.id === entryId))
  .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

const [projectGuideContent, lastImplementationSummary] = await Promise.all([
  this.logManager.readAgentGuideContent(),
  this.logManager.readLatestImplementationSummary()
]);
const traceabilityMode = this.aiClient.getTraceabilityMode();
const rawMarkdown = await this.aiClient.generateTutorial(
  selectedEntries,
  {
    projectGuideContent,
    lastImplementationSummary
  },
  { traceabilityMode }
);
const { markdown, report } = validateTutorialMarkdown(rawMarkdown, selectedEntries, traceabilityMode);
const title = buildTutorialTitle(selectedEntries);
const tutorialUri = await this.logManager.saveTutorial(title, markdown);

await this.refreshState();
await this.openMarkdownDocument(tutorialUri);
```

학습 자료 파일은 workspace root의 `.ai-tutorials/`에 저장된다.

```ts
public getTutorialDirectoryUri(): vscode.Uri | undefined {
  const workspaceRoot = this.getWorkspaceRootUri();
  return workspaceRoot ? vscode.Uri.joinPath(workspaceRoot, '.ai-tutorials') : undefined;
}
```

생성된 markdown은 VS Code editor에서 직접 열린다.

```ts
private async openMarkdownDocument(uri: vscode.Uri): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false
  });
}
```

## 15. 학습 자료 validator와 traceability mode

`package.json`에는 `debtcrasher.traceabilityMode` 설정이 있다.

```json
{
  "debtcrasher.traceabilityMode": {
    "type": "string",
    "enum": ["basic", "strict"],
    "default": "basic",
    "markdownDescription": "Mode: Basic / Strict. Strict mode adds extra traceability checks and evidence labeling requirements."
  }
}
```

`AIClient.getTraceabilityMode()`는 설정값이 `basic` 또는 `strict`가 아니면 `basic`을 사용한다.

```ts
public getTraceabilityMode(): TraceabilityMode {
  const configured = this.getConfiguration().get<string>('traceabilityMode', 'basic');
  return isTraceabilityMode(configured) ? configured : 'basic';
}
```

`src/tutorialValidator.ts`의 validation report 구조는 다음과 같다.

```ts
export interface TutorialValidationReport {
  required_sections: 'pass' | 'fail';
  related_decision_log: 'pass' | 'fail';
  related_files: 'pass' | 'warn' | 'fail';
  validation_result_included: 'pass' | 'fail';
  unsupported_strong_claims: number;
  final_status: 'generated' | 'generated_with_warning' | 'blocked';
  messages: string[];
}
```

validator는 다음을 검사한다.

- 필수 heading 존재 여부
- 관련 decision id 또는 title이 본문에 포함되는지
- related file evidence가 있는지
- validation result section에 `typecheck`, `build`, `test`, `lint`, `passed`, `failed`, `not available`, `needs_review` 등이 포함되는지
- 근거 없는 강한 표현 개수
- 검증 실패/미실행 상태를 성공처럼 표현했는지
- 본문 길이가 너무 짧은지
- strict mode에서 주요 문단 또는 bullet이 evidence label로 시작하는지

strict mode 조건은 다음 코드로 구현되어 있다.

```ts
if (mode === 'strict' && !allMajorBlocksHaveEvidenceLabels(markdown)) {
  messages.push('Strict mode에서는 주요 문단 또는 bullet 앞에 근거 라벨이 필요합니다.');
}
```

blocking failure가 있으면 저장이 중단된다.

```ts
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
```

생성 문서 끝에는 validation report가 append된다.

```md
## 생성 검증 결과
- required_sections: ...
- related_decision_log: ...
- related_files: ...
- validation_result_included: ...
- unsupported_strong_claims: ...
- final_status: ...
```

## 16. 세션 기록

Agent View 작업 세션은 `.ai-sessions/`에 JSON 파일로 저장된다.

```ts
const SESSIONS_DIRECTORY = '.ai-sessions';
const SESSION_FILE_LIMIT = 50;
const SESSION_TITLE_LIMIT = 30;
const GITIGNORE_ENTRY = '.ai-sessions/';
```

세션 구조는 다음과 같다.

```ts
export interface PersistedAgentSession {
  fileName: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  messages: AgentSessionMessage[];
}

export interface AgentSessionMessage {
  requestId?: string;
  role: AgentSessionMessageRole;
  type: AgentSessionMessageType;
  content: string;
  timestamp: string;
  planning?: AgentSessionPlanningPayload;
  result?: AgentSessionResultPayload;
  status?: AgentSessionStatusPayload;
}
```

`.ai-sessions/`는 `SessionHistoryService.ensureGitignoreEntry()`에서 `.gitignore`에 자동 추가된다.

```ts
private async ensureGitignoreEntry(workspaceRoot: vscode.Uri): Promise<void> {
  const gitignoreUri = vscode.Uri.joinPath(workspaceRoot, '.gitignore');
  ...
  if (normalizedLines.includes(GITIGNORE_ENTRY)) {
    return;
  }

  const nextContent = existing.trim().length > 0
    ? `${existing.trimEnd()}\n${GITIGNORE_ENTRY}\n`
    : `${GITIGNORE_ENTRY}\n`;
  await vscode.workspace.fs.writeFile(gitignoreUri, textEncoder.encode(nextContent));
}
```

저장된 세션은 최대 50개까지 유지되고, 초과분은 삭제된다.

```ts
private async pruneSessions(sessionsDir: vscode.Uri): Promise<void> {
  const summaries = await this.listSessions();
  if (summaries.length <= SESSION_FILE_LIMIT) {
    return;
  }

  const staleSessions = summaries.slice(SESSION_FILE_LIMIT);
  await Promise.all(
    staleSessions.map((session) =>
      vscode.workspace.fs.delete(vscode.Uri.joinPath(sessionsDir, session.id), { useTrash: false })
    )
  );
}
```

## 17. AI provider와 모델 설정

지원 provider type은 네 개다.

```ts
export type AIProvider = 'anthropic' | 'google' | 'openai' | 'deepseek';
```

기본 provider는 `package.json` 기준 `anthropic`이다.

| provider | displayName | default model | model options |
| --- | --- | --- | --- |
| `anthropic` | Claude | `claude-sonnet-4-20250514` | `claude-sonnet-4-20250514`, `claude-opus-4-20250514`, `claude-3-7-sonnet-latest` |
| `google` | Gemini | `gemini-2.5-flash` | `gemini-2.5-flash`, `gemini-2.5-pro` |
| `openai` | GPT | `gpt-5` | `gpt-5`, `gpt-5-mini`, `gpt-4.1` |
| `deepseek` | DeepSeek | `deepseek-chat` | `deepseek-chat`, `deepseek-reasoner` |

요청 endpoint는 다음과 같다.

```ts
case 'anthropic':
  return this.sendAnthropicMessage(system, userPrompt, maxTokens, apiKeyState.value, model, abortSignal);
case 'google':
  return this.sendGeminiMessage(system, userPrompt, maxTokens, apiKeyState.value, model, abortSignal);
case 'openai':
  return this.sendOpenAICompatibleMessage('https://api.openai.com/v1/chat/completions', system, userPrompt, apiKeyState.value, model, 'OpenAI', abortSignal);
case 'deepseek':
  return this.sendOpenAICompatibleMessage('https://api.deepseek.com/chat/completions', system, userPrompt, apiKeyState.value, model, 'DeepSeek', abortSignal);
```

API key는 우선 VS Code SecretStorage에서 읽고, 없으면 VS Code 설정값에서 읽는다.

```ts
private async getApiKeyState(provider: AIProvider): Promise<{ value: string; source: 'secret' | 'settings' | 'none' }> {
  const secretValue = (await this.secrets.get(getSecretStorageKey(provider)))?.trim() ?? '';
  if (secretValue) return { value: secretValue, source: 'secret' };
  const settingsValue = this.getConfiguration().get<string>(PROVIDER_SETTINGS[provider].apiKeySetting, '').trim();
  if (settingsValue) return { value: settingsValue, source: 'settings' };
  return { value: '', source: 'none' };
}
```

## 18. UI 구성

Agent View는 webview 기반 chat/workflow 화면이다. 주요 UI 상태는 다음과 같다.

```ts
const state = {
  provider: null,
  traceabilityMode: 'basic',
  hasWorkspace: false,
  activeRequestId: '',
  activePhase: '',
  mode: 'chat',
  sessionSummaries: [],
  activeHistorySession: null,
  progressGroups: {}
};
```

phase는 다음 다섯 개다.

```ts
type AgentPhase = 'planning' | 'decision' | 'implementation' | 'verification' | 'complete';
```

Agent View에서 표시되는 planning question metadata에는 다음 필드가 포함된다.

```ts
function renderQuestionMetadata(question) {
  const risks = Array.isArray(question.risk_categories) ? question.risk_categories.join(', ') : '';
  const reviewCategories = Array.isArray(question.review_categories) ? question.review_categories.join(', ') : '';
  const reviewLevel = normalizeHumanReviewLevel(question.human_review_level);
  return [
    '<div class="question-metadata">',
    '  <span class="review-badge review-' + escapeHtml(reviewLevel.toLowerCase()) + '">' + escapeHtml(renderReviewLevelLabel(reviewLevel)) + '</span>',
    question.reason ? '  <span>' + escapeHtml(question.reason) + '</span>' : '',
    question.default_if_skipped ? '  <span>Default: ' + escapeHtml(question.default_if_skipped) + '</span>' : '',
    question.risk_if_wrong ? '  <span>Risk: ' + escapeHtml(question.risk_if_wrong) + '</span>' : '',
    reviewCategories ? '  <span>Review Categories: ' + escapeHtml(reviewCategories) + '</span>' : '',
    risks ? '  <span>Categories: ' + escapeHtml(risks) + '</span>' : '',
    '</div>'
  ].join('');
}
```

Step View는 상단 Steps 영역과 하단 History 영역으로 나뉘며, split divider로 높이를 조절한다. Steps는 `DECISIONS.md` entries, History는 `.ai-tutorials/*.md` 목록이다.

## 19. 저장소 산출물의 역할

DebtCrasher가 대상 workspace에 생성하거나 갱신하는 파일/디렉터리는 다음과 같다.

| 경로 | 생성/갱신 주체 | 역할 |
| --- | --- | --- |
| `DECISIONS.md` | `LogManager` | 사용자 선택, review level, risk metadata, 관련 파일, 검증 결과를 누적 기록한다. |
| `AGENT.md` | `LogManager` | decision log를 기반으로 다음 작업에서 재사용할 요약 캐시를 유지한다. |
| `.ai-tutorials/*.md` | `StepViewController` + `LogManager` | 선택한 decision entry를 학습 자료 markdown으로 저장한다. |
| `.ai-sessions/*.json` | `SessionHistoryService` | Agent View의 user/agent/planning/result/status/error 메시지를 세션 단위로 저장한다. |
| `.gitignore` | `SessionHistoryService` | `.ai-sessions/` 항목을 추가한다. |

현재 저장소 자체의 `.gitignore`에는 DebtCrasher가 대상 프로젝트에서 생성하는 workspace artifact가 제외 항목으로 등록되어 있다.

```gitignore
# Workspace artifacts generated by running Debtcrasher in a target project
AGENT.md
AGENTS.md
DECISIONS.md
.ai-tutorials/
.ai-sessions/
```

## 20. Continue와의 관계

`NOTICE` 파일에는 DebtCrasher가 Continue의 구조와 구현 패턴을 일부 차용했다고 기록되어 있다.

```text
Debtcrasher includes architecture and implementation patterns adapted from Continue.

Upstream project:
- Continue
- Repository: https://github.com/continuedev/continue
- License: Apache License 2.0

Files and structures in this project were adapted from Continue's VS Code extension bootstrap and orchestration patterns, including concepts from:
- extensions/vscode/src/activation/activate.ts
- extensions/vscode/src/extension/VsCodeExtension.ts
- extensions/vscode/src/ContinueGUIWebviewViewProvider.ts

Debtcrasher adds its own decision-gate, step history, AGENT.md memory, and learning-note workflow on top of that base architecture.
```

코드 주석에도 activation, extension orchestration, workspace context layering이 Continue에서 adapted되었다고 적혀 있다.

## 21. 개발 정책 문서의 포지셔닝 문장

`.github/agents/debtcrasher-development.agent.md`에는 개발 방향이 명시되어 있다. 이 파일은 구현 파일은 아니지만, 저장소 내부 정책 문서로 볼 수 있다.

확인되는 핵심 문장은 다음과 같다.

```text
Your job is to continue the project with a safer Human Review Gate centered design instead of a naive leverage-score centered design.

Core principles:
- This is not an attempt to directly reproduce a specific paper workflow.
- Apply the ideas of ATAM risk points, sensitivity points, tradeoff points, Boehm risk exposure, architecture decision documentation, and Human-AI interaction in a lightweight way that fits DebtCrasher.
- `human_review_level` is not an objective ground-truth label.
- It is a workflow policy that decides whether AI may resolve a decision automatically or whether developer review is required.
- The system does not guarantee absolute trustworthiness of AI judgments.
- Its purpose is to prevent AI from silently making risky decisions and to make room for developer intervention.
- User feedback collection is out of scope for the current implementation. In reports and presentations, describe it only as a future post-release evaluation plan.
```

이 문서에 따르면 DebtCrasher의 설계 언어는 기존 `leverage_score`, `High/Mid/Low leverage` 중심에서 `human_review_level`, `review_categories`, `risk_categories`, `default_if_skipped`, `assumption_log`, `question_sensitivity` 중심으로 이동했다.

`leverage_score` 필드는 코드베이스에서 완전히 제거되었다. 정렬과 파생 로직 모두 `human_review_level`과 `risk_categories`만을 사용한다.

## 22. 논문 서술 시 사용할 수 있는 시스템 범위

다음 항목은 코드와 문서에서 직접 확인된다.

- VS Code extension 형태의 로컬 개발 보조 도구다.
- AI provider는 Anthropic, Google, OpenAI, DeepSeek 네 종류를 설정할 수 있다.
- 작업 요청이 들어오면 workspace context와 기존 decision memory를 읽고 planning response를 생성한다.
- planning response에는 summary, assumptions, assumption_log, questions가 포함된다.
- question에는 options, human_review_level, review_categories, risk_categories, reason, default_if_skipped, risk_if_wrong, related_files, can_auto_apply 등이 포함된다.
- 질문 표시 여부는 `questionSensitivity`와 `human_review_level`에 의해 결정된다.
- 표면화되지 않은 결정 후보는 assumption log로 이동한다.
- 사용자 선택은 `DECISIONS.md`에 저장된다.
- `DECISIONS.md`에는 선택뿐 아니라 human review level, review categories, risk categories, default, wrong-risk, related files, validation result, source가 기록된다.
- `AGENT.md`는 다음 planning/implementation에서 참조할 요약 캐시로 생성된다.
- 구현 단계에서는 더 질문하지 않고, 선택된 결정과 assumption을 바탕으로 파일을 생성한다.
- 파일 작성은 workspace-relative path만 허용한다.
- 민감 파일명은 별도 확인 없이 쓰지 않는다.
- 검증 명령을 탐지하고 실행한다.
- 검증 실패가 있으면 repair를 한 번 시도한다.
- 검증 결과는 decision metadata에 기록된다.
- Step View는 decision entry를 선택해 학습 자료 markdown을 생성한다.
- 학습 자료 validator는 필수 section, decision id 포함, related files, validation result, strong claim, strict evidence label 조건을 검사한다.
- 세션 기록은 `.ai-sessions/` JSON으로 저장된다.
- user feedback collection은 현재 구현 범위가 아니며 정책 문서에서 future post-release evaluation으로만 설명하라고 되어 있다.

## 23. 논문 서술 시 피해야 할 표현

다음 표현은 코드와 정책 문서의 내용과 맞지 않는다.

- “AI가 설계 결정의 중요도를 객관적으로 평가한다.”
- “Human Review Level은 정답 label이다.”
- “DebtCrasher는 AI 판단의 신뢰성을 보장한다.”
- “생성 코드가 안전하다고 보장한다.”
- “생성 학습 자료가 완전하고 정확하다고 보장한다.”
- “사용자 피드백 기반 평가가 이미 구현되어 있다.”
- “원격 서버/DB 기반 협업 시스템이다.”

대신 다음처럼 쓰는 것이 코드와 맞다.

- “`human_review_level`은 사용자 검토 필요성을 나타내는 워크플로 정책이다.”
- “DebtCrasher는 AI가 자동으로 처리할 수 있는 항목과 사용자 확인이 필요한 항목을 분리해 기록한다.”
- “표면화되지 않은 결정 후보는 assumption log로 남긴다.”
- “검증 실패 또는 미실행 상태는 validation result와 학습 자료 validation report에 남는다.”
- “사용자 피드백 평가는 현재 구현 범위 밖이며 향후 배포 후 평가 계획으로 분리되어 있다.”

## 24. 현재 구현상 제한 사항

다음 제한 사항은 저장소 코드 기준으로 확인된다.

- `human_review_level` 분류는 AI planning 응답과 코드의 정규화/필터링에 의존한다. 코드 어디에도 이 분류가 객관적 ground truth라고 정의되어 있지 않다.
- `leverage_score`는 코드베이스에서 완전히 제거되었다. 정렬과 파생 로직은 `human_review_level`과 `risk_categories`만을 사용한다.
- `questionSensitivity`와 `traceabilityMode`는 VS Code settings로 제공된다. Agent View 안에서 별도 sensitivity selector UI가 구현되어 있지는 않다.
- `.github/agents/debtcrasher-development.agent.md`에는 Strict mode에서 review level override control을 언급하지만, 현재 Agent View 코드에는 사용자가 review level 자체를 override하는 별도 control이 보이지 않는다. 사용자는 option 선택 또는 custom choice 입력은 할 수 있다.
- Step View는 markdown을 inline preview하지 않고 VS Code editor로 연다.
- workspace artifact는 로컬 파일 기반이다. 기본 구현에 backend, remote sync, database layer는 없다.
- 자동 검증은 사용 가능한 script나 언어별 fallback이 있을 때만 실행된다.
- repair는 검증 실패 후 한 번 시도하는 흐름으로 구현되어 있다.
- 학습 자료 생성은 현재 `AIClient.generateTutorial()` 엔트리포인트 안에서 선택된 decision log를 AI API 호출 없이 template 기반으로 재구성한다. 선택 기록, 선택 근거, 검증 상태, 관련 파일을 결정 로그에서 그대로 가져와 보기 편한 형태로 정리하는 수준이며, AI가 내용을 추가하거나 성향을 해석하지 않는다. validator는 section/근거/강한 표현 등을 검사하지만 문서 내용의 사실성을 완전히 증명하지 않는다.
- 소스 파일의 한국어 문자열은 UTF-8 인코딩으로 정상 저장되어 있다. 다만 Windows 터미널이나 특정 코드 페이지 환경에서 출력할 때 한글이 mojibake 형태로 보일 수 있으므로, 시연 환경의 터미널 인코딩 설정(예: `chcp 65001`)을 미리 확인해야 한다.

## 25. 외부 설명용 짧은 요약

DebtCrasher는 VS Code 확장 형태의 AI 개발 에이전트다. 일반적인 코드 생성 흐름 앞에 planning phase와 Human Review Gate를 두고, AI가 제안한 결정 후보를 `REVIEW_REQUIRED`, `REVIEW_RECOMMENDED`, `AUTO_WITH_LOG`로 분류한다. `REVIEW_REQUIRED`는 항상 사용자에게 묻고, `REVIEW_RECOMMENDED`는 질문 민감도 설정에 따라 묻거나 assumption log로 이동하며, `AUTO_WITH_LOG`는 기본적으로 자동 적용 대상으로 기록된다. 사용자가 선택한 결정은 `DECISIONS.md`에 구조화된 markdown으로 저장되고, 요약된 결정 캐시는 `AGENT.md`에 유지된다. 구현 후 가능한 검증 명령을 실행하고, 결과를 decision metadata에 연결한다. 이후 Step View에서 선택한 결정 로그를 학습 자료 markdown으로 변환해 `.ai-tutorials/`에 저장한다. 이 시스템은 AI 판단의 객관적 정확성을 보장하는 것이 아니라, AI 개발 과정에서 자동화되기 쉬운 설계 결정을 사용자 검토와 기록의 대상으로 만드는 워크플로 구현물이다.
