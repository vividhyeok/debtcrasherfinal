import * as vscode from 'vscode';
import { DecisionLogEntry } from './logManager';

export type AIProvider = 'anthropic' | 'google' | 'openai' | 'deepseek';
export type QuestionFilterLevel = 'high' | 'medium' | 'low';
export type PlanningImpact = 'HIGH' | 'MEDIUM' | 'LOW';

export interface DecisionOption { label: string; pros: string[]; cons: string[]; }
export interface DecisionHistoryEntry { title: string; decisionPoint: string; userChoice: string; outcome: string; }
export interface PlanningQuestion {
  id: string;
  impact: PlanningImpact;
  topic: string;
  question: string;
  optionA: DecisionOption;
  optionB: DecisionOption;
}
export interface PlanningResponse {
  summary: string;
  assumptions: string[];
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
  'Given a development request, identify all explicit high-leverage decisions the developer should make before implementation starts.',
  '',
  'Authority order:',
  '1. The current user request',
  '2. AGENT.md and other project guide files',
  '3. Existing workspace files and code patterns',
  '',
  'Planning rules:',
  '1. Never assume features and ask about them. Only ask about decisions directly implied by the request.',
  '2. Before adding any question, verify the topic is not already answered in AGENT.md Confirmed Decisions or Do not ask again.',
  '3. If a decision is already covered even partially, do not ask it again. Reuse the existing decision.',
  '4. Every surfaced question must be coarse-grained and architecturally meaningful.',
  '5. Every non-surfaced decision must go into assumptions as an autonomous default.',
  '6. questions must contain at most 3 items.',
  '7. Use Korean for all natural-language fields.',
  '',
  'Return JSON only with this schema:',
  '{',
  '  "summary": "string",',
  '  "assumptions": ["string"],',
  '  "questions": [',
  '    {',
  '      "id": "q1",',
  '      "impact": "HIGH | MEDIUM | LOW",',
  '      "topic": "string",',
  '      "question": "string",',
  '      "optionA": {"label": "string", "pros": ["string"], "cons": ["string"]},',
  '      "optionB": {"label": "string", "pros": ["string"], "cons": ["string"]}',
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
    abortSignal?: AbortSignal
  ): Promise<PlanningResponse> {
    const systemPrompt = `${PLANNING_SYSTEM_PROMPT}\n\n${PLANNING_TEMPLATE_LIBRARY}\n\n${buildPlanningQuestionFilterPrompt(await this.getQuestionFilterLevel())}`;
    const userPrompt = buildPlanningUserPrompt(task, workspaceContext, referenceContext, patternContext, resumeContext);
    const parsed = parseJsonResponse<PlanningResponse>(await this.sendMessage(systemPrompt, userPrompt, 1800, abortSignal));

    if (!isPlanningResponse(parsed)) {
      throw new Error('AI 응답 형식이 Debtcrasher planning JSON과 맞지 않습니다.');
    }

    return {
      summary: parsed.summary.trim(),
      assumptions: parsed.assumptions.map((item) => item.trim()).filter(Boolean),
      questions: parsed.questions.slice(0, 3)
    };
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
    const systemPrompt = `${IMPLEMENTATION_SYSTEM_PROMPT}\n\n${buildImplementationDefaultsPrompt(await this.getQuestionFilterLevel())}`;
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
    const systemPrompt = `${REPAIR_SYSTEM_PROMPT}\n\n${buildImplementationDefaultsPrompt(await this.getQuestionFilterLevel())}`;
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
    context: TutorialGenerationContext = {}
  ): Promise<string> {
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
    const markdown = await this.sendMessage(
      STEP_SYSTEM_PROMPT,
      userPrompt,
      getTutorialTokenBudget(entries.length)
    );
    validateTutorialMarkdown(markdown, entries.length);
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

  public async getQuestionFilterLevel(): Promise<QuestionFilterLevel> {
    const configured = vscode.workspace.getConfiguration().get<string>('aiStepDev.questionFilterLevel', 'medium');
    return isQuestionFilterLevel(configured) ? configured : 'medium';
  }

  public async saveQuestionFilterLevel(level: QuestionFilterLevel): Promise<void> {
    await vscode.workspace.getConfiguration().update('aiStepDev.questionFilterLevel', level, vscode.ConfigurationTarget.Workspace);
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
    '- Identify all decisions the user needs to make before development starts.',
    '- Classify each candidate decision as HIGH / MEDIUM / LOW.',
    '- Surface only questions that meet the active question filter threshold.',
    '- Ask about at most 3 decisions.',
    '- Every other decision must become an assumption.',
    '- Never include a question about a feature not mentioned in the request.',
    '- Never include a question already answered in AGENT.md.',
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

function isPlanningResponse(value: unknown): value is PlanningResponse {
  return isRecord(value)
    && typeof value.summary === 'string'
    && isStringArray(value.assumptions)
    && Array.isArray(value.questions)
    && value.questions.every((question) => isPlanningQuestion(question));
}

function isDecisionOption(value: unknown): value is DecisionOption {
  return isRecord(value) && typeof value.label === 'string' && isStringArray(value.pros) && isStringArray(value.cons);
}

function isPlanningQuestion(value: unknown): value is PlanningQuestion {
  return isRecord(value)
    && typeof value.id === 'string'
    && isPlanningImpact(value.impact)
    && typeof value.topic === 'string'
    && typeof value.question === 'string'
    && isDecisionOption(value.optionA)
    && isDecisionOption(value.optionB);
}

function isImplementationResponse(value: unknown): value is ImplementationResponse {
  return isRecord(value) && typeof value.currentWork === 'string' && typeof value.summary === 'string' && Array.isArray(value.files) && value.files.every((file) => isImplementationFile(file)) && isStringArray(value.runInstructions);
}

function isImplementationFile(value: unknown): value is ImplementationFile {
  return isRecord(value) && typeof value.path === 'string' && typeof value.description === 'string' && typeof value.content === 'string';
}

function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
function isProvider(value: string): value is AIProvider { return value === 'anthropic' || value === 'google' || value === 'openai' || value === 'deepseek'; }
function isQuestionFilterLevel(value: string): value is QuestionFilterLevel { return value === 'high' || value === 'medium' || value === 'low'; }
function isPlanningImpact(value: unknown): value is PlanningImpact { return value === 'HIGH' || value === 'MEDIUM' || value === 'LOW'; }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null; }
function getSecretStorageKey(provider: AIProvider): string { return `debtcrasher.${provider}.apiKey`; }

function getModelOptions(provider: AIProvider, currentModel: string): string[] {
  const options = [...MODEL_OPTIONS[provider]];
  if (!options.includes(currentModel)) {
    options.unshift(currentModel);
  }
  return options;
}

function buildPlanningQuestionFilterPrompt(level: QuestionFilterLevel): string {
  const levelInstruction = level === 'high'
    ? 'Question Filter: HIGH only. Only ask about tech stack, platform, or architectural decisions that cannot be reversed without significant rewriting. Everything else: implement with a sensible default.'
    : level === 'medium'
      ? 'Question Filter: HIGH + MEDIUM. Ask about architecture and UX scope decisions. Skip implementation details.'
      : 'Question Filter: Ask all meaningful questions.';

  return [
    '---',
    `## Question Filter Level: ${level}`,
    '',
    levelInstruction,
    '',
    'Planning constraints:',
    '- questions must contain only items that meet the active threshold.',
    '- questions must contain at most 3 items.',
    '- Every unasked decision must be recorded in assumptions instead.',
    '---'
  ].join('\n');
}

function buildImplementationDefaultsPrompt(level: QuestionFilterLevel): string {
  return [
    '---',
    `## Planning Applied: ${level}`,
    '',
    'The planning phase is complete. Do not ask any more questions in implementation mode.',
    'Any remaining uncertainty must be resolved with sensible defaults that match the workspace and AGENT.md.',
    'For every unasked lower-level decision, add a source-code comment:',
    '// DEFAULT: [decision made] - [one-line reason]',
    '---'
  ].join('\n');
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
