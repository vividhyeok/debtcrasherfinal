import * as vscode from 'vscode';
import { DecisionLogEntry } from './logManager';

export type AIProvider = 'anthropic' | 'google' | 'openai' | 'deepseek';

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

export interface DecisionOption { label: string; pros: string[]; cons: string[]; }
export interface DecisionHistoryEntry {
  id?: string;
  title: string;
  decisionPoint: string;
  userChoice: string;
  outcome: string;
  humanReviewLevel?: HumanReviewLevel;
  reviewCategories?: string[];
  reason?: string;
  leverageScore?: number;
  riskCategories?: RiskCategory[];
  defaultIfSkipped?: string;
  riskIfWrong?: string;
  relatedFiles?: string[];
  canAutoApply?: boolean;
  source?: string[];
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
  leverage_score?: number;
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
  leverage_score?: number;
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
export interface ImplementationFile { path: string; description: string; content: string; }
export interface ImplementationResponse { currentWork: string; summary: string; files: ImplementationFile[]; runInstructions: string[]; }
export interface TutorialGenerationContext { projectGuideContent?: string; lastImplementationSummary?: string; }
interface ProviderSettings { apiKeySetting: string; modelSetting: string; defaultModel: string; displayName: string; }
interface AnthropicTextBlock { type?: string; text?: string; }
interface AnthropicApiResponse { content?: AnthropicTextBlock[]; error?: { message?: string }; }
interface GeminiTextPart { text?: string; }
interface GeminiApiResponse {
  candidates?: Array<{ content?: { parts?: GeminiTextPart[] } }>;
  error?: { message?: string };
  promptFeedback?: { blockReason?: string };
}
interface OpenAICompatibleResponse {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string | { value?: string }; value?: string }>; refusal?: string } }>;
  error?: { message?: string };
}

const PROVIDER_SETTINGS: Record<AIProvider, ProviderSettings> = {
  anthropic: { apiKeySetting: 'anthropicApiKey', modelSetting: 'anthropicModel', defaultModel: 'claude-sonnet-4-20250514', displayName: 'Claude' },
  google: { apiKeySetting: 'geminiApiKey', modelSetting: 'geminiModel', defaultModel: 'gemini-2.5-flash', displayName: 'Gemini' },
  openai: { apiKeySetting: 'openaiApiKey', modelSetting: 'openaiModel', defaultModel: 'gpt-5', displayName: 'GPT' },
  deepseek: { apiKeySetting: 'deepseekApiKey', modelSetting: 'deepseekModel', defaultModel: 'deepseek-chat', displayName: 'DeepSeek' }
};

const MODEL_OPTIONS: Record<AIProvider, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-7-sonnet-latest'],
  google: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  openai: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner']
};

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
  '8. Use Korean for all natural-language fields.',
  '',
  'Escalation triggers:',
  '- Data loss or irreversible change: delete, overwrite, reset, migrate, truncate, purge.',
  '- Security / auth / permission / secret: API key, token, credential, password, private key.',
  '- Public contract change: API, endpoint, schema, response format, config key, file format, CLI option.',
  '- Cost: paid API, billing, quota, usage cost, subscription.',
  '- Workspace-outside file access or sensitive data handling.',
  '',
  'Review category hints:',
  '- Risk Impact',
  '- Architecture Impact',
  '- Tradeoff Point',
  '- Reversibility Cost',
  '- User Intent / Stakeholder Judgment',
  '- Learning / Reflection Value',
  '',
  'Return JSON only with this schema:',
  '{',
  '  "summary": "string",',
  '  "assumptions": ["legacy short assumption strings"],',
  '  "assumption_log": [',
  '    {',
  '      "topic": "string",',
  '      "default_value": "string",',
  '      "reason": "string",',
  '      "human_review_level": "REVIEW_REQUIRED | REVIEW_RECOMMENDED | AUTO_WITH_LOG",',
  '      "review_categories": ["string"],',
  '      "risk_categories": ["reversibility"],',
  '      "related_files": ["relative/path/or/module"],',
  '      "can_auto_apply": true,',
  '      "skipped_because": "string",',
  '      "source": "ai_inference | code_evidence | user_decision | needs_review"',
  '    }',
  '  ],',
  '  "questions": [',
  '    {',
  '      "id": "q1",',
  '      "impact": "HIGH | MEDIUM | LOW",',
  '      "topic": "string",',
  '      "question": "string",',
  '      "options": [',
  '        {"label": "string", "pros": ["string"], "cons": ["string"]},',
  '        {"label": "string", "pros": ["string"], "cons": ["string"]}',
  '      ],',
  '      "optionA": {"label": "string", "pros": ["string"], "cons": ["string"]},',
  '      "optionB": {"label": "string", "pros": ["string"], "cons": ["string"]},',
  '      "human_review_level": "REVIEW_REQUIRED | REVIEW_RECOMMENDED | AUTO_WITH_LOG",',
  '      "review_categories": ["string"],',
  '      "risk_categories": ["reversibility", "learning_value"],',
  '      "reason": "string",',
  '      "default_if_skipped": "string",',
  '      "risk_if_wrong": "string",',
  '      "related_files": ["relative/path/or/module"],',
  '      "can_auto_apply": false,',
  '      "decision_topic": "string",',
  '      "conflict_with": "optional existing decision id or title"',
  '    }',
  '  ]',
  '}'
].join('\n');

const PLANNING_TEMPLATE_LIBRARY = [
  'Reusable decision templates:',
  '- Template: static frontend vs backend-supported app',
  '  Use when the request implies deployment boundary, auth, remote data, or server logic.',
  '  Option A usually frames a static/local-first build.',
  '  Option B usually frames a backend/API-supported build.',
  '- Template: single page vs multi page structure',
  '  Use when routing, multiple surfaces, or dashboard/content split is implied.',
  '  Option A usually frames a single-surface or SPA flow.',
  '  Option B usually frames a multi-page or route-separated flow.',
  '- Template: local file persistence vs database/service persistence',
  '  Use when save/load/history/state durability is implied.',
  '  Option A usually frames local file or browser storage.',
  '  Option B usually frames database or external persistence.',
  '- Template: simple local state vs dedicated state management',
  '  Use when shared state, multi-view synchronization, or complex UI state is implied.',
  '  Option A usually frames simple built-in state.',
  '  Option B usually frames dedicated state tooling.',
  '- Template: SQL vs NoSQL',
  '  Use only when a database is already clearly required by the request.',
  '  Option A usually frames relational/schema-first persistence.',
  '  Option B usually frames document/flexible persistence.',
  'When one of these templates matches, reuse it instead of inventing a totally new question shape.'
].join('\n');

const IMPLEMENTATION_SYSTEM_PROMPT = [
  'You are Debtcrasher, a pragmatic VS Code coding agent.',
  'The developer has already answered the planning questions that matter.',
  'Generate the first working implementation, not just a description.',
  '',
  'Rules:',
  '1. Follow confirmed decisions exactly.',
  '2. Read AGENT.md and the current workspace structure before generating files.',
  '3. Adapt to the existing repository instead of inventing an unrelated architecture.',
  '4. Never assume features that the user did not request or imply.',
  '5. Do not reopen decisions already explicit in the request or AGENT.md.',
  '6. If a lower-level detail was not worth asking about, choose a sensible default and mark it in generated code:',
  '   // DEFAULT: [decision made] - [one-line reason]',
  '7. No further questions are allowed in this phase. If anything remains open, implement with defaults.',
  '8. Prefer the fewest files that can produce a working result.',
  '9. If the workspace is empty, create a minimal fresh structure.',
  '10. Do not leave TODOs or placeholders for core behavior.',
  '11. Use Korean for explanations, but keep file contents as normal source code.',
  '12. Return JSON only.',
  '',
  'Schema:',
  '{"currentWork":"string","summary":"string","files":[{"path":"relative/path","description":"string","content":"string"}],"runInstructions":["string"]}'
].join('\n');

const STEP_SYSTEM_PROMPT = [
  '너는 개발자의 의사결정 로그를 학습용 판단 문서로 다시 구성하는 시니어 개발자다.',
  '출력은 전체를 한국어로 작성한다.',
  '단순 요약이나 회고록처럼 쓰지 말고, 당시의 트레이드오프 사고가 다시 살아나도록 재구성한다.',
  '',
  '문서 기본 구조는 아래를 따른다.',
  '# [프로젝트명] — 판단 기록',
  '## 프로젝트 맥락',
  '프로젝트가 무엇이었는지, 어떤 제약과 목표가 판단을 밀어붙였는지 2~3문장으로 정리한다.',
  '',
  '## 핵심 판단들',
  '선택한 step마다 아래 7개 소제목을 반드시 포함한다.',
  '### [판단 제목]',
  '**결정한 것**',
  '**왜 필요했나**',
  '**선택지 비교표**',
  '**이 프로젝트에서 선택한 이유**',
  '**이 선택이 이후 결정에 미친 영향**',
  '**이 판단이 틀렸을 때 나타날 신호**',
  '**다음에 비슷한 상황이 오면**',
  '',
  '선택지 비교표는 반드시 markdown 표로 작성하고, 열 구조는 `선택지 | 핵심 장점 | 핵심 단점`을 사용한다.',
  '비교표를 제외한 본문은 목록형 bullet로 쓰지 말고 짧은 문단형 prose로 작성한다.',
  '각 step은 600~900자 안팎으로 작성한다.',
  '',
  '`결정한 것`에는 실제로 선택된 옵션을 한 문장으로 적는다.',
  '`왜 필요했나`에는 그 시점에서 무엇이 불확실했고 왜 이 판단이 필요했는지 설명한다.',
  '`이 프로젝트에서 선택한 이유`에는 현재 프로젝트의 제약, 목표, 앞선 판단과 연결해 왜 이 선택이 맞았는지 설명한다.',
  '`이 선택이 이후 결정에 미친 영향`에는 반드시 다른 판단 하나 이상을 직접 언급하며, 어떤 선택지를 열어 주거나 닫았는지 적는다.',
  '`이 판단이 틀렸을 때 나타날 신호`에는 코드베이스나 사용자 경험에서 관찰 가능한 경고 신호를 구체적으로 적는다.',
  '`다음에 비슷한 상황이 오면`에는 다음 프로젝트에도 재사용할 수 있는 판단 규칙 한 줄을 적는다.',
  '',
  '여러 step이 함께 들어오면 문서 마지막에 아래 두 섹션을 추가한다.',
  '## 판단들의 연결 구조',
  '핵심 판단들이 어떻게 서로를 제약했는지 짧은 문단 또는 텍스트 다이어그램으로 보여 준다.',
  '## 내 판단 패턴 분석',
  '`반복된 우선순위`, `이 우선순위가 유효한 상황`, `이 우선순위가 위험한 상황`, `다음 프로젝트를 위한 질문 하나`를 포함한다.',
  '',
  '톤은 교과서가 아니라, 시니어 개발자가 자신의 판단을 복기하는 문체로 유지한다.',
  '코드, 튜토리얼 링크, 일반론적인 학습 자료는 넣지 않는다.',
  '문서 전체는 다시 읽기 쉬워야 하며, 각 판단이 서로 어떻게 연결되는지 분명히 드러나야 한다.'
].join('\n');

const REPAIR_SYSTEM_PROMPT = [
  'You are Debtcrasher, a pragmatic VS Code coding agent in repair mode.',
  'The initial implementation already exists in the workspace, but verification failed.',
  'Fix the existing code with the smallest correct change.',
  '',
  'Rules:',
  '1. Do not ask more questions.',
  '2. Do not add new features.',
  '3. Use the verification output as the main debugging signal.',
  '4. Prefer editing only the files needed to pass verification.',
  '5. Return only changed files.',
  '6. Keep explanations in Korean and file contents as normal source code.',
  '',
  'Schema:',
  '{"currentWork":"string","summary":"string","files":[{"path":"relative/path","description":"string","content":"string"}],"runInstructions":["string"]}'
].join('\n');

export class AIClient {
  public constructor(private readonly secrets: vscode.SecretStorage) {}

  public async generatePlan(
    task: string,
    workspaceContext: string,
    referenceContext = '',
    patternContext = '',
    resumeContext = '',
    decisionMemory: DecisionLogEntry[] = [],
    abortSignal?: AbortSignal
  ): Promise<PlanningResponse> {
    const questionSensitivity = await this.getQuestionSensitivity();
    const systemPrompt = `${PLANNING_SYSTEM_PROMPT}\n\n${PLANNING_TEMPLATE_LIBRARY}\n\n${buildPlanningQuestionFilterPrompt(questionSensitivity)}`;
    const userPrompt = buildPlanningUserPrompt(task, workspaceContext, referenceContext, patternContext, resumeContext);
    const rawResponse = await this.sendMessage(systemPrompt, userPrompt, 2200, abortSignal);
    let parsed: PlanningResponse;

    try {
      parsed = parseJsonResponse<PlanningResponse>(rawResponse);
    } catch (error) {
      console.warn('[Debtcrasher] Planning JSON parse failed; using fallback question.', error);
      return createFallbackPlanningResponse(task);
    }

    if (!isPlanningResponse(parsed)) {
      console.warn('[Debtcrasher] Planning schema mismatch; using fallback question.');
      return createFallbackPlanningResponse(task);
    }

    return normalizePlanningResponse(parsed, task, decisionMemory, questionSensitivity);
  }

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
      history.length > 0 ? history.map((entry, index) => [
        `${index + 1}. Title: ${entry.title}`,
        `   Decision point: ${entry.decisionPoint}`,
        `   Choice: ${entry.userChoice}`,
        `   Outcome: ${entry.outcome}`
      ].join('\n')).join('\n') : '- none',
      '',
      'Workspace context:',
      workspaceContext.trim() || 'Workspace appears empty.',
      '',
      'Implementation requirements:',
      '- Never add features that are not mentioned or directly implied by the developer request.',
      '- Reuse AGENT.md decisions and implied constraints as defaults.',
      '- For every lower-level decision made without asking, add a source-code comment: // DEFAULT: [decision made] - [reason]',
      '- Generate the first working implementation now.'
    ].join('\n');

    const parsed = parseJsonResponse<ImplementationResponse>(await this.sendMessage(systemPrompt, userPrompt, 3200, abortSignal));
    if (!isImplementationResponse(parsed)) {
      throw new Error('AI 응답 형식이 구현 JSON과 맞지 않습니다.');
    }
    return parsed;
  }

  public async repairImplementation(
    task: string,
    history: DecisionHistoryEntry[],
    workspaceContext: string,
    referenceContext = '',
    assumptions: string[] = [],
    planSummary = '',
    verificationContext = '',
    abortSignal?: AbortSignal
  ): Promise<ImplementationResponse> {
    const systemPrompt = `${REPAIR_SYSTEM_PROMPT}\n\n${buildImplementationDefaultsPrompt(await this.getQuestionSensitivity())}`;
    const userPrompt = [
      `Developer task: ${task}`,
      '',
      'Planning summary:',
      planSummary.trim() || '- none',
      '',
      'Autonomous defaults from planning:',
      assumptions.length > 0 ? assumptions.map((item, index) => `${index + 1}. ${item}`).join('\n') : '- none',
      '',
      'Confirmed decisions:',
      history.length > 0 ? history.map((entry, index) => [
        `${index + 1}. Title: ${entry.title}`,
        `   Decision point: ${entry.decisionPoint}`,
        `   Choice: ${entry.userChoice}`,
        `   Outcome: ${entry.outcome}`
      ].join('\n')).join('\n') : '- none',
      '',
      'Project reference context:',
      referenceContext.trim() || '- none',
      '',
      'Current workspace context:',
      workspaceContext.trim() || 'Workspace appears empty.',
      '',
      'Verification failures to fix:',
      verificationContext.trim() || '- none',
      '',
      'Repair requirements:',
      '- Fix the existing implementation with the smallest possible patch.',
      '- Return only files that need to change.',
      '- Do not ask questions or expand scope.',
      '- Keep // DEFAULT comments where they still explain unresolved low-level choices.'
    ].join('\n');

    const parsed = parseJsonResponse<ImplementationResponse>(await this.sendMessage(systemPrompt, userPrompt, 2200, abortSignal));
    if (!isImplementationResponse(parsed)) {
      throw new Error('AI 응답 형식이 repair JSON과 맞지 않습니다.');
    }
    return parsed;
  }

  public async generateTutorial(
    entries: DecisionLogEntry[],
    context: TutorialGenerationContext = {},
    options: { traceabilityMode?: TraceabilityMode } = {}
  ): Promise<string> {
    const strictMode = options.traceabilityMode === 'strict';
    const userPrompt = [
      '## 프로젝트 현재 상태',
      '### AGENT.md',
      context.projectGuideContent?.trim() || '- AGENT.md 내용 없음',
      '',
      '### 최근 구현 요약',
      context.lastImplementationSummary?.trim() || '- 최근 구현 요약 없음',
      '',
      '다음은 하나의 개발 세션에서 쌓인 의사결정 로그 엔트리들입니다.',
      '이 엔트리들을 단순 요약하지 말고, 다음 프로젝트에서도 다시 참고할 수 있는 판단 학습 문서로 재구성해 주세요.',
      '',
      ...entries.flatMap((entry, index) => [
        `## Entry ${index + 1}`,
        `제목: ${entry.title}`,
        `날짜: ${entry.date}`,
        `질문: ${entry.question}`,
        `옵션 A: ${entry.optionA}`,
        `옵션 B: ${entry.optionB}`,
        `사용자 선택: ${entry.userChoice}`,
        `결과: ${entry.outcome}`,
        ''
      ])
    ].join('\n');
    const groundingPrompt = [
      userPrompt,
      '',
      '## Required grounding metadata for validator',
      ...entries.flatMap((entry) => [
        `Decision ID: ${entry.id}`,
        `Related Files: ${(entry.relatedFiles ?? []).join(', ') || 'needs_review'}`,
        `Validation Result: ${formatDecisionValidationForPrompt(entry)}`,
        `Risk Categories: ${(entry.riskCategories ?? []).join(', ') || 'needs_review'}`,
        `Source: ${(entry.source ?? []).join(', ') || 'needs_review'}`,
        ''
      ])
    ].join('\n');
    const markdown = await this.sendMessage(
      buildTutorialSystemPrompt(strictMode),
      groundingPrompt,
      getTutorialTokenBudget(entries.length)
    );
    return markdown;
  }

  public getProviderCatalog(): Array<{ id: AIProvider; displayName: string; defaultModel: string }> {
    return (Object.entries(PROVIDER_SETTINGS) as Array<[AIProvider, ProviderSettings]>).map(([id, settings]) => ({ id, displayName: settings.displayName, defaultModel: settings.defaultModel }));
  }

  public async getProviderSummary(): Promise<{ id: AIProvider; displayName: string; model: string; modelOptions: string[]; hasApiKey: boolean; apiKeySource: 'secret' | 'settings' | 'none' }> {
    const provider = this.getProvider();
    const apiKeyState = await this.getApiKeyState(provider);
    const model = this.getModel(provider);
    return {
      id: provider,
      displayName: PROVIDER_SETTINGS[provider].displayName,
      model,
      modelOptions: getModelOptions(provider, model),
      hasApiKey: apiKeyState.value.length > 0,
      apiKeySource: apiKeyState.source
    };
  }

  public async getQuestionSensitivity(): Promise<QuestionSensitivity> {
    const configured = this.getConfiguration().get<string>('questionSensitivity', 'balanced');
    return isQuestionSensitivity(configured) ? configured : 'balanced';
  }

  public getTraceabilityMode(): TraceabilityMode {
    const configured = this.getConfiguration().get<string>('traceabilityMode', 'basic');
    return isTraceabilityMode(configured) ? configured : 'basic';
  }

  public async saveCurrentModel(model: string): Promise<{ id: AIProvider; displayName: string; model: string; modelOptions: string[] }> {
    const provider = this.getProvider();
    const normalizedModel = model.trim() || this.getModel(provider);
    await this.getConfiguration().update(PROVIDER_SETTINGS[provider].modelSetting, normalizedModel, vscode.ConfigurationTarget.Global);
    return {
      id: provider,
      displayName: PROVIDER_SETTINGS[provider].displayName,
      model: normalizedModel,
      modelOptions: getModelOptions(provider, normalizedModel)
    };
  }

  public async saveProviderSetup(input: { provider: AIProvider; model: string; apiKey?: string; replaceApiKey: boolean }): Promise<void> {
    const configuration = this.getConfiguration();
    const settings = PROVIDER_SETTINGS[input.provider];
    const normalizedModel = input.model.trim() || settings.defaultModel;
    await configuration.update('provider', input.provider, vscode.ConfigurationTarget.Global);
    await configuration.update(settings.modelSetting, normalizedModel, vscode.ConfigurationTarget.Global);
    if (!input.replaceApiKey) return;
    const secretKey = getSecretStorageKey(input.provider);
    const normalizedKey = input.apiKey?.trim() ?? '';
    if (normalizedKey) {
      await this.secrets.store(secretKey, normalizedKey);
    } else {
      await this.secrets.delete(secretKey);
    }
  }

  public async clearProviderApiKey(provider: AIProvider): Promise<void> {
    await this.secrets.delete(getSecretStorageKey(provider));
    await this.getConfiguration().update(PROVIDER_SETTINGS[provider].apiKeySetting, '', vscode.ConfigurationTarget.Global);
  }

  private getConfiguration(): vscode.WorkspaceConfiguration { return vscode.workspace.getConfiguration('debtcrasher'); }
  private getProvider(): AIProvider {
    const configured = this.getConfiguration().get<string>('provider', 'anthropic');
    return isProvider(configured) ? configured : 'anthropic';
  }
  private getModel(provider: AIProvider): string {
    const setting = PROVIDER_SETTINGS[provider];
    return this.getConfiguration().get<string>(setting.modelSetting, setting.defaultModel).trim() || setting.defaultModel;
  }

  private async sendMessage(
    system: string,
    userPrompt: string,
    maxTokens: number,
    abortSignal?: AbortSignal
  ): Promise<string> {
    const provider = this.getProvider();
    const model = this.getModel(provider);
    const apiKeyState = await this.getApiKeyState(provider);
    if (!apiKeyState.value) {
      throw new Error(`${PROVIDER_SETTINGS[provider].displayName} API 키가 비어 있습니다. Debtcrasher 설정을 확인해 주세요.`);
    }
    console.log(`[Debtcrasher] System prompt (${provider}/${model}):\n${system}`);

    switch (provider) {
      case 'anthropic': return this.sendAnthropicMessage(system, userPrompt, maxTokens, apiKeyState.value, model, abortSignal);
      case 'google': return this.sendGeminiMessage(system, userPrompt, maxTokens, apiKeyState.value, model, abortSignal);
      case 'openai': return this.sendOpenAICompatibleMessage('https://api.openai.com/v1/chat/completions', system, userPrompt, apiKeyState.value, model, 'OpenAI', abortSignal);
      case 'deepseek': return this.sendOpenAICompatibleMessage('https://api.deepseek.com/chat/completions', system, userPrompt, apiKeyState.value, model, 'DeepSeek', abortSignal);
      default: throw new Error('지원하지 않는 AI 제공자입니다.');
    }
  }

  private async getApiKeyState(provider: AIProvider): Promise<{ value: string; source: 'secret' | 'settings' | 'none' }> {
    const secretValue = (await this.secrets.get(getSecretStorageKey(provider)))?.trim() ?? '';
    if (secretValue) return { value: secretValue, source: 'secret' };
    const settingsValue = this.getConfiguration().get<string>(PROVIDER_SETTINGS[provider].apiKeySetting, '').trim();
    if (settingsValue) return { value: settingsValue, source: 'settings' };
    return { value: '', source: 'none' };
  }

  private async sendAnthropicMessage(
    system: string,
    userPrompt: string,
    maxTokens: number,
    apiKey: string,
    model: string,
    abortSignal?: AbortSignal
  ): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: userPrompt }] }),
      signal: abortSignal
    });
    const rawText = await response.text();
    const parsed = safeParseJson(rawText) as AnthropicApiResponse | undefined;
    if (!response.ok) throw new Error(`Claude API 요청이 실패했습니다: ${parsed?.error?.message ?? rawText}`);
    const text = parsed?.content?.filter((block) => block.type === 'text' && typeof block.text === 'string').map((block) => block.text?.trim() ?? '').join('\n').trim();
    if (!text) throw new Error('Claude API 응답에서 텍스트 콘텐츠를 찾을 수 없습니다.');
    return text;
  }

  private async sendGeminiMessage(
    system: string,
    userPrompt: string,
    maxTokens: number,
    apiKey: string,
    model: string,
    abortSignal?: AbortSignal
  ): Promise<string> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: maxTokens }
      }),
      signal: abortSignal
    });
    const rawText = await response.text();
    const parsed = safeParseJson(rawText) as GeminiApiResponse | undefined;
    if (!response.ok) throw new Error(`Gemini API 요청이 실패했습니다: ${parsed?.error?.message ?? rawText}`);
    const text = parsed?.candidates?.[0]?.content?.parts?.map((part) => part.text?.trim() ?? '').filter(Boolean).join('\n').trim();
    if (!text) throw new Error(parsed?.promptFeedback?.blockReason ? `Gemini 응답이 차단되었습니다: ${parsed.promptFeedback.blockReason}` : 'Gemini API 응답에서 텍스트 콘텐츠를 찾을 수 없습니다.');
    return text;
  }

  private async sendOpenAICompatibleMessage(
    endpoint: string,
    system: string,
    userPrompt: string,
    apiKey: string,
    model: string,
    providerName: string,
    abortSignal?: AbortSignal
  ): Promise<string> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }] }),
      signal: abortSignal
    });
    const rawText = await response.text();
    const parsed = safeParseJson(rawText) as OpenAICompatibleResponse | undefined;
    if (!response.ok) throw new Error(`${providerName} API 요청이 실패했습니다: ${parsed?.error?.message ?? rawText}`);
    const text = extractOpenAICompatibleText(parsed);
    if (!text) throw new Error(parsed?.choices?.[0]?.message?.refusal ? `${providerName} 응답이 거절되었습니다: ${parsed.choices[0].message?.refusal}` : `${providerName} API 응답에서 텍스트 콘텐츠를 찾을 수 없습니다.`);
    return text;
  }
}

function buildPlanningUserPrompt(
  task: string,
  workspaceContext: string,
  referenceContext: string,
  patternContext: string,
  resumeContext: string
): string {
  return [
    `Developer task: ${task}`,
    '',
    'Workspace context (inspect before proposing any question):',
    workspaceContext.trim() || 'Workspace appears empty.',
    '',
    'Project reference context (read AGENT.md first):',
    referenceContext.trim() || '- none',
    '',
    'Historical decision pattern context:',
    patternContext.trim() || '- none',
    '',
    'Previous session context:',
    resumeContext.trim() || '- none',
    '',
    'Requirements:',
    '- Identify the planning decisions the user needs to review before development starts.',
    '- Classify each candidate as REVIEW_REQUIRED, REVIEW_RECOMMENDED, or AUTO_WITH_LOG.',
    '- Surface every REVIEW_REQUIRED item.',
    '- Use question_sensitivity to decide which REVIEW_RECOMMENDED items are shown.',
    '- AUTO_WITH_LOG items must not be asked unless the mode is strict.',
    '- Every non-surfaced item must become an assumption_log entry with a default value and source.',
    '- Include human_review_level, review_categories, reason, default_if_skipped, risk_if_wrong, risk_categories, related_files, and can_auto_apply on every question.',
    '- `leverage_score` may be used only as an internal sorting aid; do not make it a user-facing requirement.',
    '- Never include a question about a feature not mentioned in the request.',
    '- Never include a question already answered in AGENT.md or DECISIONS.md unless you explicitly mark an existing-decision conflict.',
    '- If previous session context already contains an answered decision, reuse it and do not ask again.',
    '- If historical patterns suggest a repeated preference, use that only to rank questions and shape option framing. Do not override the current request.',
    '- Do not ask about naming, styling minutiae, or obvious implementation details.',
    '- Use Korean for all natural-language fields.'
  ].join('\n');
}

function extractOpenAICompatibleText(response: OpenAICompatibleResponse | undefined): string {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (typeof part.text === 'string') return part.text.trim();
    if (typeof part.text === 'object' && part.text && typeof part.text.value === 'string') return part.text.value.trim();
    if (typeof part.value === 'string') return part.value.trim();
    return '';
  }).filter(Boolean).join('\n').trim();
}

function safeParseJson(rawText: string): unknown {
  try { return JSON.parse(rawText); } catch { return undefined; }
}

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

function createFallbackPlanningResponse(task: string): PlanningResponse {
  const options: DecisionOption[] = [
    {
      label: '가장 단순한 MVP 방식',
      pros: ['빠르게 구현하고 검증할 수 있습니다.'],
      cons: ['이후 확장 시 구조를 다시 잡아야 할 수 있습니다.']
    },
    {
      label: '확장성을 고려한 구조',
      pros: ['후속 기능 추가와 분리가 쉬워집니다.'],
      cons: ['초기 구현량이 늘어날 수 있습니다.']
    },
    {
      label: '기존 코드 스타일을 최대한 따르는 방식',
      pros: ['현재 코드베이스와 충돌이 적고 리뷰가 쉽습니다.'],
      cons: ['새 요구에 최적인 구조가 아닐 수 있습니다.']
    }
  ];

  const question: PlanningQuestion = {
    id: 'fallback-q1',
    impact: 'HIGH',
    topic: '구현 방향',
    question: '이 작업에서 가장 중요한 구현 방향을 선택해주세요.',
    options,
    optionA: options[0],
    optionB: options[1],
    human_review_level: 'REVIEW_REQUIRED',
    review_categories: ['Architecture Impact', 'Reversibility Cost', 'Tradeoff Point'],
    leverage_score: 4,
    reason: 'AI planning 응답을 JSON으로 해석하지 못해 사용자가 가장 중요한 구현 방향만 선택하도록 축소했습니다.',
    default_if_skipped: '기존 코드 스타일을 최대한 따르는 방식',
    risk_if_wrong: '초기 구현 방향이 기대한 속도, 확장성, 기존 코드 일관성과 어긋날 수 있습니다.',
    risk_categories: ['user_intent', 'code_evidence_lack', 'learning_value'],
    decision_topic: 'implementation_direction',
    related_files: [],
    can_auto_apply: false
  };

  return {
    summary: task.trim() || '요청된 작업',
    assumptions: [],
    assumption_log: [],
    questions: [question]
  };
}

function normalizePlanningResponse(
  parsed: PlanningResponse,
  task: string,
  decisionMemory: DecisionLogEntry[],
  questionSensitivity: QuestionSensitivity
): PlanningResponse {
  const normalizedAssumptions = parsed.assumption_log
    .map((assumption) => normalizePlanningAssumption(assumption))
    .filter((assumption) => assumption.topic || assumption.default_value);
  const candidateQuestions = parsed.questions.map((question, index) => normalizePlanningQuestion(question, index));
  const selectedQuestions: PlanningQuestion[] = [];
  const droppedAssumptions: PlanningAssumption[] = [];
  const duplicateAssumptions: PlanningAssumption[] = [];

  for (const question of candidateQuestions) {
    const duplicate = findDuplicateDecision(question, decisionMemory);
    if (!duplicate) {
      if (shouldAskQuestion(question, questionSensitivity)) {
        selectedQuestions.push(question);
      } else {
        droppedAssumptions.push(questionToAssumption(question, questionSensitivity, '질문 민감도 또는 자동 처리 정책 때문에 사용자에게 묻지 않고 기본값으로 처리합니다.'));
      }
      continue;
    }

    if (question.conflict_with || question.reason.includes('기존 결정과 충돌 가능성')) {
      if (shouldAskQuestion(question, questionSensitivity)) {
        selectedQuestions.push({
          ...question,
          reason: question.reason.includes('기존 결정과 충돌 가능성')
            ? question.reason
            : `기존 결정과 충돌 가능성: ${duplicate.title}. ${question.reason}`
        });
      } else {
        droppedAssumptions.push(questionToAssumption(question, questionSensitivity, `기존 결정(${duplicate.title})과 충돌 가능성이 있어 기본값으로 기록합니다.`));
      }
      continue;
    }

    duplicateAssumptions.push(questionToAssumption(
      question,
      questionSensitivity,
      `이미 답한 결정(${duplicate.title})과 중복되어 기존 결정을 기본값으로 재사용합니다.`
    ));
  }

  const assumptionLog = [...normalizedAssumptions, ...duplicateAssumptions, ...droppedAssumptions];
  const assumptionLines = Array.from(new Set([
    ...parsed.assumptions.map((item) => item.trim()).filter(Boolean),
    ...assumptionLog.map((assumption) =>
      `${assumption.topic}: ${assumption.default_value} (${assumption.reason})`
    )
  ]));

  return {
    summary: parsed.summary.trim() || task.trim() || '요청된 작업',
    assumptions: assumptionLines,
    assumption_log: assumptionLog,
    questions: prioritizePlanningQuestions(selectedQuestions, questionSensitivity)
  };
}

function normalizePlanningAssumption(assumption: PlanningAssumption): PlanningAssumption {
  const humanReviewLevel = normalizeHumanReviewLevel(assumption.human_review_level ?? 'AUTO_WITH_LOG');
  return {
    topic: assumption.topic.trim(),
    default_value: assumption.default_value.trim(),
    reason: assumption.reason.trim() || 'AI가 코드 맥락을 근거로 기본값을 선택했습니다.',
    human_review_level: humanReviewLevel,
    review_categories: normalizeReviewCategories(assumption.review_categories),
    risk_categories: normalizeRiskCategories(assumption.risk_categories),
    related_files: Array.isArray(assumption.related_files)
      ? assumption.related_files.map((item) => item.trim()).filter(Boolean)
      : [],
    can_auto_apply: Boolean(assumption.can_auto_apply),
    skipped_because: assumption.skipped_because?.trim(),
    source: assumption.source
  };
}

function ensureMinimumOptions(options: DecisionOption[]): DecisionOption[] {
  if (options.length >= 2) {
    return options;
  }
  return [
    ...options,
    {
      label: '기존 코드 스타일을 따르는 기본값',
      pros: ['현재 코드베이스와 충돌이 적습니다.'],
      cons: ['사용자 의도와 다르면 후속 수정이 필요합니다.']
    },
    {
      label: '최소 구현 기본값',
      pros: ['빠르게 구현하고 검증할 수 있습니다.'],
      cons: ['확장 요구가 생기면 구조 보강이 필요합니다.']
    }
  ].slice(0, 2);
}

function normalizePlanningQuestion(question: PlanningQuestion, index: number): PlanningQuestion {
  const rawOptions = Array.isArray(question.options) ? question.options : [];
  const options = rawOptions
    .map((option) => ({
      label: option.label.trim(),
      pros: option.pros.map((item) => item.trim()).filter(Boolean),
      cons: option.cons.map((item) => item.trim()).filter(Boolean)
    }))
    .filter((option) => option.label);
  const fallbackOptions = [question.optionA, question.optionB].filter(isDecisionOption);
  const normalizedOptions = ensureMinimumOptions(options.length >= 2 ? options : fallbackOptions);
  const humanReviewLevel = normalizeHumanReviewLevel(question.human_review_level ?? deriveHumanReviewLevel(question));
  const leverageScore = normalizeLeverageScore(question.leverage_score, humanReviewLevel, question.risk_categories);
  const reviewCategories = normalizeReviewCategories(question.review_categories);
  const relatedFiles = Array.isArray(question.related_files)
    ? question.related_files.map((item) => item.trim()).filter(Boolean)
    : Array.isArray(question.target_files)
      ? question.target_files.map((item) => item.trim()).filter(Boolean)
      : [];

  return {
    ...question,
    id: question.id.trim() || `q${index + 1}`,
    impact: leverageToImpact(leverageScore, question.risk_categories),
    topic: question.topic.trim() || question.decision_topic?.trim() || `판단 ${index + 1}`,
    question: question.question.trim(),
    options: normalizedOptions.slice(0, 4),
    optionA: normalizedOptions[0],
    optionB: normalizedOptions[1],
    human_review_level: humanReviewLevel,
    review_categories: reviewCategories,
    leverage_score: leverageScore,
    reason: question.reason.trim(),
    default_if_skipped: question.default_if_skipped.trim(),
    risk_if_wrong: question.risk_if_wrong.trim(),
    risk_categories: normalizeRiskCategories(question.risk_categories),
    decision_topic: question.decision_topic?.trim() || question.topic.trim(),
    related_files: relatedFiles,
    target_files: relatedFiles,
    can_auto_apply: Boolean(question.can_auto_apply) || humanReviewLevel === 'AUTO_WITH_LOG',
    conflict_with: question.conflict_with?.trim()
  };
}

function prioritizePlanningQuestions(questions: PlanningQuestion[], sensitivity: QuestionSensitivity): PlanningQuestion[] {
  const selected = questions.filter((question) => shouldAskQuestion(question, sensitivity));
  return [...selected].sort((left, right) => comparePlanningQuestions(left, right));
}

function shouldAskQuestion(question: PlanningQuestion, sensitivity: QuestionSensitivity): boolean {
  const level = normalizeHumanReviewLevel(question.human_review_level ?? deriveHumanReviewLevel(question));
  if (sensitivity === 'strict') {
    return true;
  }
  if (level === 'REVIEW_REQUIRED') {
    return true;
  }
  if (level === 'AUTO_WITH_LOG') {
    return false;
  }
  if (sensitivity === 'flow') {
    return false;
  }
  if (sensitivity === 'balanced') {
    return isPriorityRisk(question) || hasStrongReviewSignal(question);
  }
  return true;
}

function hasStrongReviewSignal(question: PlanningQuestion): boolean {
  return (question.review_categories ?? []).some((category) => {
    const normalized = category.toLowerCase();
    return normalized.includes('risk impact')
      || normalized.includes('architecture')
      || normalized.includes('reversibility')
      || normalized.includes('stakeholder')
      || normalized.includes('tradeoff');
  }) || (question.leverage_score ?? 0) >= 4;
}

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
  const scoreDelta = (right.leverage_score ?? 0) - (left.leverage_score ?? 0);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  return left.topic.localeCompare(right.topic);
}

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

function hasOverlappingPathOrModule(left: string[], right: string[]): boolean {
  const normalizedRight = right.map(normalizeMemoryToken).filter(Boolean);
  return left
    .map(normalizeMemoryToken)
    .filter(Boolean)
    .some((leftItem) => normalizedRight.some((rightItem) => leftItem === rightItem || leftItem.includes(rightItem) || rightItem.includes(leftItem)));
}

function isSameDecisionTopic(question: PlanningQuestion, entry: DecisionLogEntry): boolean {
  const topic = normalizeMemoryToken(question.decision_topic || question.topic);
  if (!topic) {
    return false;
  }
  const entryTopic = normalizeMemoryToken(`${entry.title} ${entry.question}`);
  return entryTopic.includes(topic) || topic.includes(entryTopic);
}

function normalizeMemoryToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9가-힣/_-]+/gi, ' ').replace(/\s+/g, ' ').trim();
}

function isPriorityRisk(question: PlanningQuestion): boolean {
  const categories = question.risk_categories;
  const text = `${question.question} ${question.reason} ${question.risk_if_wrong}`.toLowerCase();
  return categories.includes('security')
    || categories.includes('data_loss')
    || categories.includes('public_contract')
    || text.includes('비용')
    || text.includes('유료')
    || text.includes('paid api')
    || text.includes('cost');
}

function normalizeRiskCategories(categories: RiskCategory[]): RiskCategory[] {
  return Array.from(new Set(categories.filter(isRiskCategory)));
}

function normalizeReviewCategories(categories: string[] | undefined): string[] {
  return Array.from(new Set((Array.isArray(categories) ? categories : []).map((item) => item.trim()).filter(Boolean)));
}

function normalizeHumanReviewLevel(value: unknown): HumanReviewLevel {
  return value === 'REVIEW_REQUIRED' || value === 'REVIEW_RECOMMENDED' || value === 'AUTO_WITH_LOG'
    ? value
    : 'AUTO_WITH_LOG';
}

function deriveHumanReviewLevel(question: Pick<PlanningQuestion, 'risk_categories' | 'reason' | 'risk_if_wrong' | 'review_categories' | 'leverage_score'>): HumanReviewLevel {
  const text = `${question.reason} ${question.risk_if_wrong}`.toLowerCase();
  if (question.risk_categories.includes('security') || question.risk_categories.includes('data_loss') || question.risk_categories.includes('public_contract') || text.includes('비용') || text.includes('유료')) {
    return 'REVIEW_REQUIRED';
  }
  if ((question.review_categories || []).some((category) => /architecture|reversibility|stakeholder|risk impact/i.test(category))) {
    return 'REVIEW_RECOMMENDED';
  }
  return 'AUTO_WITH_LOG';
}

function normalizeLeverageScore(score: number | undefined, humanReviewLevel: HumanReviewLevel, categories: RiskCategory[]): number {
  if (Number.isFinite(score)) {
    return Math.max(0, Math.min(5, Math.round(score as number)));
  }
  const base = humanReviewLevel === 'REVIEW_REQUIRED' ? 5 : humanReviewLevel === 'REVIEW_RECOMMENDED' ? 3 : 1;
  return categories.includes('security') || categories.includes('data_loss') || categories.includes('public_contract') ? Math.max(base, 5) : base;
}

function leverageToImpact(score: number, categories: RiskCategory[]): PlanningImpact {
  if (categories.includes('security') || categories.includes('data_loss') || categories.includes('public_contract') || score >= 4) {
    return 'HIGH';
  }
  if (score >= 2) {
    return 'MEDIUM';
  }
  return 'LOW';
}

function isPlanningResponse(value: unknown): value is PlanningResponse {
  return isRecord(value)
    && typeof value.summary === 'string'
    && isStringArray(value.assumptions)
    && Array.isArray(value.assumption_log)
    && value.assumption_log.every((assumption) => isPlanningAssumption(assumption))
    && Array.isArray(value.questions)
    && value.questions.every((question) => isPlanningQuestion(question));
}

function isDecisionOption(value: unknown): value is DecisionOption {
  return isRecord(value) && typeof value.label === 'string' && isStringArray(value.pros) && isStringArray(value.cons);
}

function isPlanningAssumption(value: unknown): value is PlanningAssumption {
  return isRecord(value)
    && typeof value.topic === 'string'
    && typeof value.default_value === 'string'
    && typeof value.reason === 'string'
    && (value.human_review_level === 'REVIEW_REQUIRED'
      || value.human_review_level === 'REVIEW_RECOMMENDED'
      || value.human_review_level === 'AUTO_WITH_LOG')
    && Array.isArray(value.review_categories)
    && Array.isArray(value.risk_categories)
    && value.risk_categories.every((category) => isRiskCategory(category))
    && Array.isArray(value.related_files)
    && typeof value.can_auto_apply === 'boolean'
    && (value.source === 'ai_inference'
      || value.source === 'code_evidence'
      || value.source === 'user_decision'
      || value.source === 'needs_review');
}

function isPlanningQuestion(value: unknown): value is PlanningQuestion {
  const hasOptions = isRecord(value)
    && Array.isArray(value.options)
    && value.options.every((option) => isDecisionOption(option));
  const hasLegacyOptions = isRecord(value)
    && isDecisionOption(value.optionA)
    && isDecisionOption(value.optionB);

  return isRecord(value)
    && typeof value.id === 'string'
    && isPlanningImpact(value.impact)
    && typeof value.topic === 'string'
    && typeof value.question === 'string'
    && (hasOptions || hasLegacyOptions)
    && (value.human_review_level === 'REVIEW_REQUIRED'
      || value.human_review_level === 'REVIEW_RECOMMENDED'
      || value.human_review_level === 'AUTO_WITH_LOG')
    && Array.isArray(value.review_categories)
    && typeof value.reason === 'string'
    && typeof value.default_if_skipped === 'string'
    && typeof value.risk_if_wrong === 'string'
    && Array.isArray(value.risk_categories)
    && value.risk_categories.every((category) => isRiskCategory(category))
    && Array.isArray(value.related_files)
    && typeof value.can_auto_apply === 'boolean';
}

function isImplementationResponse(value: unknown): value is ImplementationResponse {
  return isRecord(value) && typeof value.currentWork === 'string' && typeof value.summary === 'string' && Array.isArray(value.files) && value.files.every((file) => isImplementationFile(file)) && isStringArray(value.runInstructions);
}

function isImplementationFile(value: unknown): value is ImplementationFile {
  return isRecord(value) && typeof value.path === 'string' && typeof value.description === 'string' && typeof value.content === 'string';
}

function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
function isProvider(value: string): value is AIProvider { return value === 'anthropic' || value === 'google' || value === 'openai' || value === 'deepseek'; }

function isQuestionSensitivity(value: string): value is QuestionSensitivity { return value === 'flow' || value === 'balanced' || value === 'review' || value === 'strict'; }
function isPlanningImpact(value: unknown): value is PlanningImpact { return value === 'HIGH' || value === 'MEDIUM' || value === 'LOW'; }
function isTraceabilityMode(value: unknown): value is TraceabilityMode { return value === 'basic' || value === 'strict'; }
function isRiskCategory(value: unknown): value is RiskCategory {
  return value === 'reversibility'
    || value === 'security'
    || value === 'data_loss'
    || value === 'public_contract'
    || value === 'user_intent'
    || value === 'code_evidence_lack'
    || value === 'ripple_effect'
    || value === 'learning_value';
}
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null; }
function getSecretStorageKey(provider: AIProvider): string { return `debtcrasher.${provider}.apiKey`; }

function getModelOptions(provider: AIProvider, currentModel: string): string[] {
  const options = [...MODEL_OPTIONS[provider]];
  if (!options.includes(currentModel)) {
    options.unshift(currentModel);
  }
  return options;
}

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
    '- `leverage_score` is optional and should only be used as an internal sorting aid if needed.',
    '- REVIEW_REQUIRED items must always be surfaced.',
    '- REVIEW_RECOMMENDED items depend on the active sensitivity mode.',
    '- AUTO_WITH_LOG items should only be surfaced in STRICT mode.',
    '- Every unasked decision must be recorded in assumption_log instead.',
    '---'
  ].join('\n');
}

function buildImplementationDefaultsPrompt(sensitivity: QuestionSensitivity): string {
  return [
    '---',
    `## Planning Applied: sensitivity=${sensitivity}`,
    '',
    'The planning phase is complete. Do not ask any more questions in implementation mode.',
    'Any remaining uncertainty must be resolved with sensible defaults that match the workspace and AGENT.md.',
    'For every unasked lower-level decision, add a source-code comment:',
    '// DEFAULT: [decision made] - [one-line reason]',
    '---'
  ].join('\n');
}

function buildTutorialSystemPrompt(strictMode: boolean): string {
  return [
    'You generate Korean tutorial markdown for Debtcrasher.',
    'Debtcrasher does not claim AI output is always correct; it preserves traceable decisions, code evidence, and validation results.',
    '',
    'Required headings, exactly:',
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
    '## 나중에 다시 확인할 점',
    '',
    'Grounding rules:',
    '- Do not invent facts beyond the provided decision log, related files, validation result, and AGENT.md context.',
    '- Mention the selected step id or decision id in the body.',
    '- Mention the human review level and review categories explicitly.',
    '- If validation failed or is unavailable, do not describe the result as successful, complete, problem-free, or guaranteed.',
    '- Avoid strong claims such as "항상", "완벽히", "보장한다", or "절대".',
    '- Use these evidence labels: [사용자 결정], [코드 근거], [검증 결과], [AI 추론], [확인 필요].',
    strictMode
      ? '- Strict mode: every major paragraph or bullet must start with one evidence label, and the "나중에 다시 확인할 점" section is mandatory and substantive.'
      : '- Basic mode: use concise evidence labels on major bullets or paragraphs where useful.',
    '- Keep the tutorial useful but clearly bounded by the evidence.'
  ].join('\n');
}

function formatDecisionValidationForPrompt(entry: DecisionLogEntry): string {
  const validation = entry.validationResult;
  if (!validation) {
    return 'needs_review';
  }
  return [
    `typecheck=${validation.typecheck || 'not available'}`,
    `build=${validation.build || 'not available'}`,
    `test=${validation.test || 'not available'}`,
    `lint=${validation.lint || 'not available'}`,
    `repair_attempted=${validation.repairAttempted ? 'true' : 'false'}`,
    `status=${validation.status || 'needs_review'}`
  ].join(', ');
}

function getTutorialTokenBudget(entryCount: number): number {
  if (entryCount <= 1) {
    return 1200;
  }
  if (entryCount === 2) {
    return 2000;
  }
  if (entryCount === 3) {
    return 2800;
  }
  return 3600;
}

function validateTutorialMarkdown(markdown: string, entryCount: number): void {
  const missingSections: string[] = [];
  const decisionSectionCount = countOccurrences(markdown, '결정한 것');
  const downstreamImpactCount = countOccurrences(markdown, '이 선택이 이후 결정에 미친 영향');
  const hasMarkdownTable = /\|.+\|\s*\r?\n\|[\s:|\-]+\|/m.test(markdown);
  const minimumLength = entryCount * 400;
  const actualLength = markdown.trim().length;

  if (decisionSectionCount < entryCount) {
    missingSections.push(`'결정한 것' 섹션이 부족합니다. 필요 ${entryCount}개 / 현재 ${decisionSectionCount}개`);
  }

  if (!hasMarkdownTable) {
    missingSections.push(`'선택지 비교표' markdown 표가 없습니다.`);
  }

  if (downstreamImpactCount < entryCount) {
    missingSections.push(`'이 선택이 이후 결정에 미친 영향' 섹션이 부족합니다. 필요 ${entryCount}개 / 현재 ${downstreamImpactCount}개`);
  }

  if (entryCount > 1 && !markdown.includes('판단들의 연결 구조')) {
    missingSections.push(`여러 step 문서에 필요한 '판단들의 연결 구조' 섹션이 없습니다.`);
  }

  if (entryCount > 1 && !markdown.includes('내 판단 패턴 분석')) {
    missingSections.push(`여러 step 문서에 필요한 '내 판단 패턴 분석' 섹션이 없습니다.`);
  }

  if (actualLength < minimumLength) {
    missingSections.push(`문서 길이가 너무 짧습니다. 최소 ${minimumLength}자 이상 필요하지만 현재 ${actualLength}자입니다.`);
  }

  if (missingSections.length > 0) {
    throw new Error(`튜토리얼 생성 결과 검증에 실패했습니다.\n- ${missingSections.join('\n- ')}`);
  }
}

function countOccurrences(source: string, phrase: string): number {
  if (!phrase) {
    return 0;
  }
  return source.split(phrase).length - 1;
}
