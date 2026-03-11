import * as vscode from 'vscode';
import { DecisionLogEntry } from './logManager';

export type AIProvider = 'anthropic' | 'google' | 'openai' | 'deepseek';
export type QuestionFilterLevel = 'high' | 'medium' | 'low';

export interface DecisionOption { label: string; pros: string[]; cons: string[]; }
export interface DecisionHistoryEntry { title: string; decisionPoint: string; userChoice: string; outcome: string; }
export interface DecisionTurnResponse {
  status: 'needs_decision' | 'complete';
  shortTitle: string;
  currentWork: string;
  taskSummary: string;
  implementationPlan: string[];
  verificationPlan: string[];
}
export interface DecisionPromptResponse extends DecisionTurnResponse {
  status: 'needs_decision';
  decisionPoint: string;
  optionA: DecisionOption;
  optionB: DecisionOption;
  question: string;
}
export interface DecisionCompleteResponse extends DecisionTurnResponse { status: 'complete'; completionSummary: string; }
export type DecisionResponse = DecisionPromptResponse | DecisionCompleteResponse;
export interface ImplementationFile { path: string; description: string; content: string; }
export interface ImplementationResponse { currentWork: string; summary: string; files: ImplementationFile[]; runInstructions: string[]; }

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

const AGENT_SYSTEM_PROMPT = [
  'You are Debtcrasher, a VS Code development agent.',
  'Behave like a normal workspace-aware coding agent first: inspect the request, AGENT.md, workspace files, and existing code patterns.',
  'Debtcrasher-specific goal: preserve explicit high-leverage developer judgments before implementation.',
  '',
  'Authoritative sources, in order:',
  '1. The current user request',
  '2. AGENT.md and other project guide files',
  '3. Existing workspace files and code patterns',
  '4. Prior confirmed decisions in this session',
  '',
  'Inference guard:',
  '1. If something is already explicit in authoritative sources, do not ask again.',
  '2. Never assume features and ask about them. Only ask questions about features or decisions that are directly implied by the user request. If a feature was not mentioned, do not include it and do not ask about it.',
  '3. Before asking any question, verify it is not already answered in AGENT.md. If a confirmed decision covers this topic even partially, do not ask - infer from the existing decision instead.',
  '4. Do not invent hidden requirements, preferences, architecture rules, or non-goals.',
  '5. Do not ask about low-level implementation details, naming, styling minutiae, or obvious defaults.',
  '6. Do not ask repeated questions with different wording.',
  '7. If unsure whether a question is truly new, do not ask. Reuse the existing confirmed decision as the default.',
  '',
  'Question budget:',
  '- Maximum 2 questions per user request.',
  '- After receiving answers to 2 questions, stop asking and begin implementation immediately.',
  '- If uncertainty remains, implement with sensible defaults and add comments in generated code:',
  '  // DEFAULT: [decision] - [reason]',
  '',
  'Debtcrasher protocol:',
  '1. The first turn of a non-trivial development task must return status="needs_decision".',
  '2. The first turn must ask exactly one coarse-grained, reusable, high-leverage question.',
  '3. Good categories: platform, framework/stack, application structure, UI shell, persistence boundary, integration boundary.',
  '4. Bad categories: exact algorithms, function names, folder names, styling minutiae, obvious implementation details, and unrequested features.',
  '5. After at least one explicit developer decision exists, you may ask one more truly high-leverage question or return status="complete".',
  '6. Once the 2-question budget is exhausted, you must return status="complete".',
  '7. Never choose for the developer when a high-leverage decision is still legitimately open.',
  '',
  'Return JSON only with this schema:',
  '{',
  '  "status": "needs_decision | complete",',
  '  "shortTitle": "string",',
  '  "currentWork": "string",',
  '  "taskSummary": "string",',
  '  "implementationPlan": ["string"],',
  '  "verificationPlan": ["string"],',
  '  "decisionPoint": "string",',
  '  "optionA": {"label": "string", "pros": ["string"], "cons": ["string"]},',
  '  "optionB": {"label": "string", "pros": ["string"], "cons": ["string"]},',
  '  "question": "string",',
  '  "completionSummary": "string"',
  '}',
  'Use Korean for all natural-language fields and ask exactly one question at a time.'
].join('\n');

const IMPLEMENTATION_SYSTEM_PROMPT = [
  'You are Debtcrasher, a pragmatic VS Code coding agent.',
  'The developer has already made the important high-level decisions.',
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
  '7. Prefer the fewest files that can produce a working result.',
  '8. If the workspace is empty, create a minimal fresh structure.',
  '9. Do not leave TODOs or placeholders for core behavior.',
  '10. Use Korean for explanations, but keep file contents as normal source code.',
  '11. Return JSON only.',
  '',
  'Schema:',
  '{"currentWork":"string","summary":"string","files":[{"path":"relative/path","description":"string","content":"string"}],"runInstructions":["string"]}'
].join('\n');

const STEP_SYSTEM_PROMPT = [
  'You are a technical writer helping a developer transform their development decision log into a structured knowledge document.',
  'Write in Korean.',
  'Do not summarize mechanically. Reconstruct the reasoning so the developer can re-experience the tradeoffs later.',
  '',
  'Required structure:',
  '# [Project Name] - 판단 기록',
  '## 프로젝트 맥락',
  '## 핵심 판단들',
  'For each decision include:',
  '### [Decision Title]',
  '**결정한 것**',
  '**왜 이 판단이 필요했나**',
  '**고려한 선택지** with a 2-column tradeoff table',
  '**이 프로젝트에서 선택한 이유**',
  '**이 선택이 이후 결정에 미친 영향**',
  '**이 판단이 틀렸을 때 나타날 신호**',
  '**다음에 비슷한 상황이 오면**',
  '---',
  '## 판단들의 연결 구조',
  '## 내 판단 패턴 분석',
  '',
  'Rules:',
  '- Show how decisions connect and constrain each other.',
  '- Every "이 선택이 이후 결정에 미친 영향" must reference at least one other decision.',
  '- Failure signals must be concrete and observable.',
  '- "다음에 비슷한 상황이 오면" must read like a reusable heuristic.',
  '- Tone: a senior developer reflecting on their own work, not a textbook.',
  '- Do not include code or generic learning resources.',
  '- Target 700-1000 words.'
].join('\n');

export class AIClient {
  public constructor(private readonly secrets: vscode.SecretStorage) {}

  public async generateDecision(task: string, history: DecisionHistoryEntry[], workspaceContext: string, referenceContext = ''): Promise<DecisionResponse> {
    const isFirstTurn = history.length === 0;
    const questionBudgetExhausted = history.length >= 2;
    const systemPrompt = `${AGENT_SYSTEM_PROMPT}\n\n${buildQuestionFilterPrompt(await this.getQuestionFilterLevel())}`;
    const userPrompt = buildDecisionUserPrompt(task, history, workspaceContext, referenceContext, isFirstTurn, questionBudgetExhausted);
    let parsed = parseJsonResponse<DecisionResponse>(await this.sendMessage(systemPrompt, userPrompt, 1200));

    if (isFirstTurn && parsed.status !== 'needs_decision') {
      parsed = parseJsonResponse<DecisionResponse>(await this.sendMessage(systemPrompt, `${userPrompt}\n\nProtocol correction:\n- This is the first turn.\n- You must return status="needs_decision".\n- Ask exactly one coarse-grained, reusable, high-leverage question.`, 1200));
    }

    if (questionBudgetExhausted && parsed.status !== 'complete') {
      parsed = parseJsonResponse<DecisionResponse>(await this.sendMessage(systemPrompt, `${userPrompt}\n\nProtocol correction:\n- The developer already answered 2 questions.\n- The question budget is exhausted.\n- Return status="complete" and stop asking questions.`, 1200));
    }

    if (!isDecisionResponse(parsed)) {
      throw new Error('AI 응답 형식이 Debtcrasher decision JSON과 맞지 않습니다.');
    }
    if (isFirstTurn && parsed.status !== 'needs_decision') {
      throw new Error('Debtcrasher 규칙상 첫 턴은 반드시 고레버리지 판단 질문이어야 합니다.');
    }
    if (questionBudgetExhausted && parsed.status !== 'complete') {
      throw new Error('질문 한도 2개를 넘긴 뒤에도 추가 질문이 생성되었습니다.');
    }

    return parsed;
  }

  public async generateImplementation(task: string, history: DecisionHistoryEntry[], workspaceContext: string, referenceContext = ''): Promise<ImplementationResponse> {
    const systemPrompt = `${IMPLEMENTATION_SYSTEM_PROMPT}\n\n${buildQuestionFilterPrompt(await this.getQuestionFilterLevel())}`;
    const userPrompt = [
      `Developer task: ${task}`,
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

    const parsed = parseJsonResponse<ImplementationResponse>(await this.sendMessage(systemPrompt, userPrompt, 3200));
    if (!isImplementationResponse(parsed)) {
      throw new Error('AI 응답 형식이 구현 JSON과 맞지 않습니다.');
    }
    return parsed;
  }

  public async generateTutorial(entries: DecisionLogEntry[]): Promise<string> {
    const userPrompt = [
      '다음은 하나의 개발 세션에서 나온 의사결정 로그 엔트리들입니다.',
      '이 엔트리들을 단순 요약이 아니라, 다음 프로젝트에서도 다시 참고할 수 있는 판단 학습 문서로 재구성해주세요.',
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
    return this.sendMessage(STEP_SYSTEM_PROMPT, userPrompt, 1800);
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

  private async sendMessage(system: string, userPrompt: string, maxTokens: number): Promise<string> {
    const provider = this.getProvider();
    const model = this.getModel(provider);
    const apiKeyState = await this.getApiKeyState(provider);
    if (!apiKeyState.value) {
      throw new Error(`${PROVIDER_SETTINGS[provider].displayName} API 키가 비어 있습니다. Debtcrasher 설정을 확인해 주세요.`);
    }
    console.log(`[Debtcrasher] System prompt (${provider}/${model}):\n${system}`);

    switch (provider) {
      case 'anthropic': return this.sendAnthropicMessage(system, userPrompt, maxTokens, apiKeyState.value, model);
      case 'google': return this.sendGeminiMessage(system, userPrompt, maxTokens, apiKeyState.value, model);
      case 'openai': return this.sendOpenAICompatibleMessage('https://api.openai.com/v1/chat/completions', system, userPrompt, apiKeyState.value, model, 'OpenAI');
      case 'deepseek': return this.sendOpenAICompatibleMessage('https://api.deepseek.com/chat/completions', system, userPrompt, apiKeyState.value, model, 'DeepSeek');
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

  private async sendAnthropicMessage(system: string, userPrompt: string, maxTokens: number, apiKey: string, model: string): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: userPrompt }] })
    });
    const rawText = await response.text();
    const parsed = safeParseJson(rawText) as AnthropicApiResponse | undefined;
    if (!response.ok) throw new Error(`Claude API 요청이 실패했습니다: ${parsed?.error?.message ?? rawText}`);
    const text = parsed?.content?.filter((block) => block.type === 'text' && typeof block.text === 'string').map((block) => block.text?.trim() ?? '').join('\n').trim();
    if (!text) throw new Error('Claude API 응답에서 텍스트 콘텐츠를 찾을 수 없습니다.');
    return text;
  }

  private async sendGeminiMessage(system: string, userPrompt: string, maxTokens: number, apiKey: string, model: string): Promise<string> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: maxTokens }
      })
    });
    const rawText = await response.text();
    const parsed = safeParseJson(rawText) as GeminiApiResponse | undefined;
    if (!response.ok) throw new Error(`Gemini API 요청이 실패했습니다: ${parsed?.error?.message ?? rawText}`);
    const text = parsed?.candidates?.[0]?.content?.parts?.map((part) => part.text?.trim() ?? '').filter(Boolean).join('\n').trim();
    if (!text) throw new Error(parsed?.promptFeedback?.blockReason ? `Gemini 응답이 차단되었습니다: ${parsed.promptFeedback.blockReason}` : 'Gemini API 응답에서 텍스트 콘텐츠를 찾을 수 없습니다.');
    return text;
  }

  private async sendOpenAICompatibleMessage(endpoint: string, system: string, userPrompt: string, apiKey: string, model: string, providerName: string): Promise<string> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }] })
    });
    const rawText = await response.text();
    const parsed = safeParseJson(rawText) as OpenAICompatibleResponse | undefined;
    if (!response.ok) throw new Error(`${providerName} API 요청이 실패했습니다: ${parsed?.error?.message ?? rawText}`);
    const text = extractOpenAICompatibleText(parsed);
    if (!text) throw new Error(parsed?.choices?.[0]?.message?.refusal ? `${providerName} 응답이 거절되었습니다: ${parsed.choices[0].message?.refusal}` : `${providerName} API 응답에서 텍스트 콘텐츠를 찾을 수 없습니다.`);
    return text;
  }
}

function buildDecisionUserPrompt(task: string, history: DecisionHistoryEntry[], workspaceContext: string, referenceContext: string, isFirstTurn: boolean, questionBudgetExhausted: boolean): string {
  return [
    `Developer task: ${task}`,
    '',
    `Session state: ${isFirstTurn ? 'first decision turn' : 'follow-up decision turn'}`,
    `Answered question count: ${history.length} / 2`,
    `Question budget status: ${questionBudgetExhausted ? 'exhausted - implementation must begin now' : 'still available'}`,
    '',
    'Workspace context (inspect before asking anything):',
    workspaceContext.trim() || 'Workspace appears empty.',
    '',
    'Project reference context (read AGENT.md first):',
    referenceContext.trim() || '- none',
    '',
    'Decisions already made in this request:',
    history.length > 0 ? history.map((entry, index) => [
      `${index + 1}. Title: ${entry.title}`,
      `   Decision point: ${entry.decisionPoint}`,
      `   Choice: ${entry.userChoice}`,
      `   Outcome: ${entry.outcome}`
    ].join('\n')).join('\n') : '- none yet',
    '',
    'Requirements:',
    '- Read AGENT.md in full before asking anything.',
    '- Before asking, verify the topic is not already covered in Confirmed Decisions or Do not ask again.',
    '- Never ask about features the user did not mention or clearly imply.',
    '- Only ask about decisions that materially change architecture or scope.',
    '- Ask exactly one question when status="needs_decision".',
    '- Maximum 2 questions per user request.',
    questionBudgetExhausted ? '- The question budget is exhausted. Return status="complete" and start implementation.' : '- If you can proceed safely without a new high-leverage question, return status="complete".',
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

function isDecisionResponse(value: unknown): value is DecisionResponse {
  if (!isRecord(value)) return false;
  if (value.status === 'complete') return hasPlanningFields(value) && typeof value.shortTitle === 'string' && typeof value.completionSummary === 'string';
  if (value.status !== 'needs_decision') return false;
  return hasPlanningFields(value) && typeof value.shortTitle === 'string' && typeof value.decisionPoint === 'string' && isDecisionOption(value.optionA) && isDecisionOption(value.optionB) && typeof value.question === 'string';
}

function hasPlanningFields(value: Record<string, any>): boolean {
  return typeof value.currentWork === 'string' && typeof value.taskSummary === 'string' && isStringArray(value.implementationPlan) && isStringArray(value.verificationPlan);
}

function isDecisionOption(value: unknown): value is DecisionOption {
  return isRecord(value) && typeof value.label === 'string' && isStringArray(value.pros) && isStringArray(value.cons);
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
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null; }
function getSecretStorageKey(provider: AIProvider): string { return `debtcrasher.${provider}.apiKey`; }

function getModelOptions(provider: AIProvider, currentModel: string): string[] {
  const options = [...MODEL_OPTIONS[provider]];
  if (!options.includes(currentModel)) {
    options.unshift(currentModel);
  }
  return options;
}

function buildQuestionFilterPrompt(level: QuestionFilterLevel): string {
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
    'Before asking any question, classify it as HIGH / MEDIUM / LOW using the rules below.',
    'Only ask questions that meet the current filter level threshold.',
    'For every question you decide NOT to ask, implement a sensible default and append a comment in the generated code:',
    '// DEFAULT: [decision made] - [one-line reason]',
    '',
    'HIGH impact questions - ask always:',
    '- Tech stack or platform choice (affects all downstream decisions)',
    '- Single page vs multi page (changes file/routing structure)',
    '- Backend vs static (changes deployment and data model)',
    '- Database or persistence strategy',
    '- Any decision that cannot be reversed without significant rewriting',
    '',
    'MEDIUM impact questions - ask only if level is "medium" or "low":',
    '- Navigation pattern (hamburger vs sidebar vs tabs)',
    '- Page section structure (which sections to include)',
    '- Authentication approach',
    '- State management strategy',
    '- Any decision that changes UX scope but can be refactored in a day',
    '',
    'LOW impact questions - ask only if level is "low":',
    '- Whether to include a profile photo',
    '- Contact link scope (email only vs social links)',
    '- Color scheme or font choice',
    '- Sound on/off',
    '- Any decision where a sensible default exists and changing it later takes under an hour',
    '',
    'If you find yourself wanting to ask more than 2 questions that meet the threshold, ask only the highest impact ones and handle the rest as defaults.',
    '---'
  ].join('\n');
}
