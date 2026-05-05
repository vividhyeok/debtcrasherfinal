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
  openai: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5', 'gpt-5-mini', 'gpt-4.1'],
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
  '9. Beginner context: Assume novice users cannot prompt about architecture, data persistence, or file structures. You MUST find the hidden decisions.',
  '10. Overlap rule: NEVER include a topic in `assumption_log` if you are asking it in `questions`.',
  '11. Implementation delivery (e.g., CLI vs Web vs VS Code) MUST always be `REVIEW_REQUIRED` (User Intent / Architecture Impact) because it completely changes the surface area.',
  '12. Data storage: If the user asks for persistence, mark as `REVIEW_REQUIRED`. If unmentioned, mark as `REVIEW_RECOMMENDED` unless it touches public DBs.',
  '13. Safe technical conventions (e.g., adding data files to .gitignore, npm install triggers) MUST be `AUTO_WITH_LOG` with a safe default. Do not ask them in standard flows.',
  '',
  'Escalation triggers:',
  '- Data loss or irreversible change: delete, overwrite, reset, migrate, truncate, purge.',
  '- Security / auth / permission / secret: API key, token, credential, password, private key.',
  '- Public contract change: API, endpoint, schema, response format, config key, file format, CLI option.',
  '- Cost: paid API, billing, quota, usage cost, subscription.',
  '- Workspace-outside file access or sensitive data handling.',
  '',
  'Review category hints: Risk Impact / Architecture Impact / Tradeoff Point / Reversibility Cost / User Intent / Learning Value',
  '',
  'Return JSON only:',
  '{',
  '  "summary": "string",',
  '  "assumption_log": [{ "topic": "string", "default_value": "string", "reason": "string", "human_review_level": "REVIEW_REQUIRED | REVIEW_RECOMMENDED | AUTO_WITH_LOG", "review_categories": ["string"], "risk_categories": ["reversibility"], "related_files": ["path"], "can_auto_apply": true, "source": "ai_inference" }],',
  '  "questions": [{ "id": "q1", "impact": "HIGH | MEDIUM | LOW", "topic": "string", "question": "string", "options": [{ "label": "string", "pros": ["string"], "cons": ["string"] }], "human_review_level": "REVIEW_REQUIRED", "review_categories": ["string"], "risk_categories": ["string"], "reason": "string", "default_if_skipped": "string", "risk_if_wrong": "string", "related_files": ["path"], "can_auto_apply": false }]',
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
    const rawResponse = await this.sendMessage(systemPrompt, userPrompt, 4096, abortSignal);
    let parsed: PlanningResponse;

    try {
      parsed = parseJsonResponse<PlanningResponse>(rawResponse);
    } catch (error) {
      console.warn('[Debtcrasher] Planning JSON parse failed; using fallback question.', error);
      return createFallbackPlanningResponse(task);
    }

    const coerced = coercePlanningResponse(parsed);
    if (!coerced) {
      console.warn('[Debtcrasher] Planning schema mismatch; using fallback question.');
      return createFallbackPlanningResponse(task);
    }

    return normalizePlanningResponse(coerced, task, decisionMemory, questionSensitivity);
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

    const parsed = parseJsonResponse<ImplementationResponse>(await this.sendMessage(systemPrompt, userPrompt, 8192, abortSignal));
    const coerced = coerceImplementationResponse(parsed);
    if (!coerced) {
      throw new Error('AI 응답 형식이 구현 JSON과 맞지 않습니다.');
    }
    return coerced;
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

    const parsed = parseJsonResponse<ImplementationResponse>(await this.sendMessage(systemPrompt, userPrompt, 4096, abortSignal));
    const coerced = coerceImplementationResponse(parsed);
    if (!coerced) {
      throw new Error('AI 응답 형식이 repair JSON과 맞지 않습니다.');
    }
    return coerced;
  }

  public async generateTutorial(
    entries: DecisionLogEntry[],
    context: TutorialGenerationContext = {},
    options: { traceabilityMode?: TraceabilityMode } = {}
  ): Promise<string> {
    // Current demo-safe path: keep the AIClient boundary, but compose from recorded evidence
    // before the validator so a higher-level AI generator can be reintroduced behind it later.
    return buildDecisionAnalysisMarkdown(entries, context, options.traceabilityMode === 'strict');
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
      case 'openai': return this.sendOpenAICompatibleMessage('https://api.openai.com/v1/chat/completions', system, userPrompt, apiKeyState.value, model, maxTokens, 'OpenAI', abortSignal);
      case 'deepseek': return this.sendOpenAICompatibleMessage('https://api.deepseek.com/chat/completions', system, userPrompt, apiKeyState.value, model, maxTokens, 'DeepSeek', abortSignal);
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
    maxTokens: number,
    providerName: string,
    abortSignal?: AbortSignal
  ): Promise<string> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }] }),
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
    '- Classify each as REVIEW_REQUIRED, REVIEW_RECOMMENDED, or AUTO_WITH_LOG.',
    '- Surface every REVIEW_REQUIRED item. Use question_sensitivity to decide REVIEW_RECOMMENDED items.',
    '- AUTO_WITH_LOG items must not be asked unless the mode is strict.',
    '- Every non-surfaced item must become an assumption_log entry.',
    '- Each question needs: human_review_level, review_categories, reason, default_if_skipped, risk_if_wrong, risk_categories, related_files, can_auto_apply.',
    '- Never include a question about a feature not in the request.',
    '- Never re-ask what is answered in AGENT.md/DECISIONS.md unless you mark an existing-decision conflict.',
    '- If previous session has answered decisions, reuse them.',
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

  const filteredNormalizedAssumptions = normalizedAssumptions.filter((assumption) => {
    return !selectedQuestions.some((question) => isSimilarTopic(assumption.topic, question.decision_topic || question.topic));
  });

  const assumptionLog = [...filteredNormalizedAssumptions, ...duplicateAssumptions, ...droppedAssumptions];
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
  const reviewCategories = normalizeReviewCategories(question.review_categories);
  const relatedFiles = Array.isArray(question.related_files)
    ? question.related_files.map((item) => item.trim()).filter(Boolean)
    : Array.isArray(question.target_files)
      ? question.target_files.map((item) => item.trim()).filter(Boolean)
      : [];

  return {
    ...question,
    id: question.id.trim() || `q${index + 1}`,
    impact: deriveImpactFromReviewLevel(humanReviewLevel, question.risk_categories),
    topic: question.topic.trim() || question.decision_topic?.trim() || `판단 ${index + 1}`,
    question: question.question.trim(),
    options: normalizedOptions.slice(0, 4),
    optionA: normalizedOptions[0],
    optionB: normalizedOptions[1],
    human_review_level: humanReviewLevel,
    review_categories: reviewCategories,
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
  const level = question.human_review_level ?? 'AUTO_WITH_LOG';
  if (sensitivity === 'strict') return true;
  if (level === 'REVIEW_REQUIRED') return true;
  if (level === 'AUTO_WITH_LOG') return false;
  if (sensitivity === 'flow') return false;
  if (sensitivity === 'balanced') return isPriorityRisk(question) || hasStrongReviewSignal(question);
  return true; // 'review' mode: show REVIEW_RECOMMENDED
}

function hasStrongReviewSignal(question: PlanningQuestion): boolean {
  return (question.review_categories ?? []).some((category) => {
    const normalized = category.toLowerCase();
    return normalized.includes('risk impact')
      || normalized.includes('architecture')
      || normalized.includes('reversibility')
      || normalized.includes('stakeholder')
      || normalized.includes('tradeoff');
  });
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
  const topic = question.decision_topic || question.topic;
  const entryTopic = `${entry.title} ${entry.question}`;
  return isSimilarTopic(topic, entryTopic);
}

function isSimilarTopic(a: string, b: string): boolean {
  const normA = normalizeMemoryToken(a);
  const normB = normalizeMemoryToken(b);
  if (!normA || !normB) {
    return false;
  }
  return normA.includes(normB) || normB.includes(normA);
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

function deriveHumanReviewLevel(question: Pick<PlanningQuestion, 'risk_categories' | 'reason' | 'risk_if_wrong' | 'review_categories'>): HumanReviewLevel {
  const text = `${question.reason} ${question.risk_if_wrong}`.toLowerCase();
  if (question.risk_categories.includes('security') || question.risk_categories.includes('data_loss') || question.risk_categories.includes('public_contract') || text.includes('비용') || text.includes('유료')) {
    return 'REVIEW_REQUIRED';
  }
  if ((question.review_categories || []).some((category) => /architecture|reversibility|stakeholder|risk impact/i.test(category))) {
    return 'REVIEW_RECOMMENDED';
  }
  return 'AUTO_WITH_LOG';
}

function deriveImpactFromReviewLevel(humanReviewLevel: HumanReviewLevel, categories: RiskCategory[]): PlanningImpact {
  if (categories.includes('security') || categories.includes('data_loss') || categories.includes('public_contract') || humanReviewLevel === 'REVIEW_REQUIRED') {
    return 'HIGH';
  }
  if (humanReviewLevel === 'REVIEW_RECOMMENDED') {
    return 'MEDIUM';
  }
  return 'LOW';
}

// --- Lenient coercion: normalize AI responses instead of rejecting on single-field mismatch ---

function coercePlanningResponse(value: unknown): PlanningResponse | undefined {
  if (!isRecord(value)) return undefined;
  const summary = typeof value.summary === 'string' ? value.summary : '';
  const assumptions = isStringArray(value.assumptions) ? value.assumptions : [];
  const rawAssumptionLog = Array.isArray(value.assumption_log) ? value.assumption_log : [];
  const rawQuestions = Array.isArray(value.questions) ? value.questions : [];
  const assumption_log = rawAssumptionLog.map(coercePlanningAssumption).filter((a): a is PlanningAssumption => a !== undefined);
  const questions = rawQuestions.map(coercePlanningQuestion).filter((q): q is PlanningQuestion => q !== undefined);
  if (questions.length === 0 && assumption_log.length === 0 && !summary) return undefined;
  return { summary, assumptions, assumption_log, questions };
}

function coercePlanningAssumption(value: unknown): PlanningAssumption | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.topic !== 'string' || typeof value.default_value !== 'string') return undefined;
  return {
    topic: value.topic,
    default_value: value.default_value,
    reason: typeof value.reason === 'string' ? value.reason : 'AI가 기본값을 선택했습니다.',
    human_review_level: normalizeHumanReviewLevel(value.human_review_level),
    review_categories: normalizeReviewCategories(Array.isArray(value.review_categories) ? value.review_categories : []),
    risk_categories: coerceRiskCategories(value.risk_categories),
    related_files: Array.isArray(value.related_files) ? value.related_files.filter((f) => typeof f === 'string') : [],
    can_auto_apply: typeof value.can_auto_apply === 'boolean' ? value.can_auto_apply : true,
    skipped_because: typeof value.skipped_because === 'string' ? value.skipped_because : undefined,
    source: isAssumptionSource(value.source) ? value.source : 'ai_inference'
  };
}

function coercePlanningQuestion(value: unknown): PlanningQuestion | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.question !== 'string' || !value.question.trim()) return undefined;
  const rawOptions = Array.isArray(value.options) ? value.options.filter(isDecisionOption) : [];
  const legacyOptions = [value.optionA, value.optionB].filter(isDecisionOption);
  const options = rawOptions.length >= 2 ? rawOptions : legacyOptions.length >= 2 ? legacyOptions : rawOptions.length > 0 ? rawOptions : legacyOptions;
  if (options.length === 0) return undefined;
  const normalizedOptions = ensureMinimumOptions(options.slice(0, 4));
  return {
    id: typeof value.id === 'string' ? value.id : `q${Date.now()}`,
    impact: isPlanningImpact(value.impact) ? value.impact : 'MEDIUM',
    topic: typeof value.topic === 'string' ? value.topic : typeof value.decision_topic === 'string' ? value.decision_topic : '판단',
    question: value.question,
    options: normalizedOptions,
    optionA: normalizedOptions[0],
    optionB: normalizedOptions[1],
    human_review_level: normalizeHumanReviewLevel(value.human_review_level),
    review_categories: normalizeReviewCategories(Array.isArray(value.review_categories) ? value.review_categories : []),
    reason: typeof value.reason === 'string' ? value.reason : '판단이 필요합니다.',
    default_if_skipped: typeof value.default_if_skipped === 'string' ? value.default_if_skipped : normalizedOptions[0]?.label ?? '기본값으로 진행',
    risk_if_wrong: typeof value.risk_if_wrong === 'string' ? value.risk_if_wrong : '잘못 선택하면 수정이 필요할 수 있습니다.',
    risk_categories: coerceRiskCategories(value.risk_categories),
    decision_topic: typeof value.decision_topic === 'string' ? value.decision_topic : typeof value.topic === 'string' ? value.topic : undefined,
    related_files: Array.isArray(value.related_files) ? value.related_files.filter((f) => typeof f === 'string') : Array.isArray(value.target_files) ? value.target_files.filter((f) => typeof f === 'string') : [],
    target_files: Array.isArray(value.target_files) ? value.target_files.filter((f) => typeof f === 'string') : Array.isArray(value.related_files) ? value.related_files.filter((f) => typeof f === 'string') : [],
    can_auto_apply: typeof value.can_auto_apply === 'boolean' ? value.can_auto_apply : false,
    conflict_with: typeof value.conflict_with === 'string' ? value.conflict_with : undefined
  };
}

function coerceRiskCategories(value: unknown): RiskCategory[] {
  if (!Array.isArray(value)) return ['code_evidence_lack'];
  const valid = value.filter(isRiskCategory);
  return valid.length > 0 ? valid : ['code_evidence_lack'];
}

function isAssumptionSource(value: unknown): value is PlanningAssumption['source'] {
  return value === 'ai_inference' || value === 'code_evidence' || value === 'user_decision' || value === 'needs_review';
}

function coerceImplementationResponse(value: unknown): ImplementationResponse | undefined {
  if (!isRecord(value)) return undefined;
  const rawFiles = Array.isArray(value.files) ? value.files.filter(isImplementationFile) : [];
  const files = rawFiles.map((file) => ({
    path: (file as ImplementationFile).path,
    description: (file as ImplementationFile).description || '',
    content: (file as ImplementationFile).content
  }));
  if (files.length === 0) return undefined;
  return {
    currentWork: typeof value.currentWork === 'string' ? value.currentWork : '구현 완료',
    summary: typeof value.summary === 'string' ? value.summary : '파일을 생성했습니다.',
    files,
    runInstructions: isStringArray(value.runInstructions) ? value.runInstructions : []
  };
}

function isDecisionOption(value: unknown): value is DecisionOption {
  if (!isRecord(value) || typeof value.label !== 'string') return false;
  // Lenient: allow missing or non-array pros/cons — they will be normalized later
  if (!isStringArray(value.pros)) { (value as Record<string, unknown>).pros = []; }
  if (!isStringArray(value.cons)) { (value as Record<string, unknown>).cons = []; }
  return true;
}

function isImplementationFile(value: unknown): value is ImplementationFile {
  return isRecord(value) && typeof value.path === 'string' && typeof value.content === 'string' && typeof (value.description ?? '') === 'string';
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

function buildDecisionAnalysisMarkdown(
  entries: DecisionLogEntry[],
  context: TutorialGenerationContext,
  strictMode: boolean
): string {
  const safeEntries = entries.filter(Boolean);
  const title = safeEntries.length === 1
    ? `${safeEntries[0].title} 선택 기록 분석`
    : `${safeEntries[0]?.title ?? '개발'} 외 ${Math.max(0, safeEntries.length - 1)}개 선택 기록 분석`;
  const latestSummary = compactLine(context.lastImplementationSummary ?? '');
  const projectGuide = compactLine(context.projectGuideContent ?? '');

  return [
    '# 제목',
    title,
    '',
    '## 선택 기록',
    ...safeEntries.flatMap((entry, index) => renderDecisionRecordBlock(entry, index)),
    '',
    '## 선택 근거',
    ...safeEntries.flatMap((entry, index) => renderChoiceReasonBlock(entry, index)),
    '',
    '## 이전 선택과의 연결',
    ...renderDecisionConnectionBlock(safeEntries),
    '',
    '## 사용자 선택 성향',
    ...renderUserPatternBlock(safeEntries),
    '',
    '## 관련 결정 로그',
    ...safeEntries.map((entry) => evidenceLine('사용자 결정', `${entry.id}: ${compactLine(entry.title)} / source=${formatSource(entry.source)}`)),
    '',
    '## 관련 파일',
    ...renderRelatedFileBlock(safeEntries),
    '',
    '## 검증 상태',
    ...safeEntries.flatMap((entry) => renderValidationBlock(entry)),
    '',
    '## 다음 작업에서 확인할 점',
    ...renderFollowUpBlock(safeEntries, latestSummary, projectGuide, strictMode)
  ].join('\n');
}

function renderDecisionRecordBlock(entry: DecisionLogEntry, index: number): string[] {
  return [
    `### ${index + 1}. ${compactLine(entry.title)}`,
    evidenceLine('사용자 결정', `결정 ID는 ${entry.id}입니다.`),
    evidenceLine('사용자 결정', `질문은 "${compactLine(entry.question)}"입니다.`),
    evidenceLine('사용자 결정', `선택은 "${compactLine(entry.userChoice)}"입니다.`),
    evidenceLine('사용자 결정', `기록된 결과는 "${compactLine(entry.outcome)}"입니다.`),
    evidenceLine('AI 추론', `Human Review Level은 ${entry.humanReviewLevel ?? 'AUTO_WITH_LOG'}이며, Review Categories는 ${formatList(entry.reviewCategories)}입니다.`),
    ''
  ];
}

function renderChoiceReasonBlock(entry: DecisionLogEntry, index: number): string[] {
  const recordedOptions = formatOptions(entry.options.length > 0 ? entry.options : [entry.optionA, entry.optionB].filter(Boolean));
  return [
    `### ${index + 1}. ${compactLine(entry.title)}`,
    evidenceLine('AI 추론', `선택 근거로 기록된 내용은 "${compactLine(entry.reason || entry.aiReasonForReview || 'needs_review')}"입니다.`),
    evidenceLine('사용자 결정', `당시 기록된 선택지는 ${recordedOptions}입니다.`),
    evidenceLine('AI 추론', `선택을 생략했을 때의 기본값은 "${compactLine(entry.defaultIfSkipped || 'needs_review')}"로 기록되어 있습니다.`),
    evidenceLine('확인 필요', `잘못 선택했을 때의 위험은 "${compactLine(entry.riskIfWrong || 'needs_review')}"로 기록되어 있습니다.`),
    ''
  ];
}

function renderDecisionConnectionBlock(entries: DecisionLogEntry[]): string[] {
  if (entries.length <= 1) {
    return [
      evidenceLine('확인 필요', '선택된 결정 로그가 1개라서 이전 선택과의 반복 패턴은 단정하지 않습니다. 이 문서는 현재 선택의 질문, 선택지, 위험, 검증 상태를 읽기 쉽게 정리합니다.')
    ];
  }

  return entries.flatMap((entry, index) => {
    if (index === 0) {
      return [
        evidenceLine('사용자 결정', `${entry.title}은 선택된 로그 범위에서 첫 번째 결정입니다.`)
      ];
    }

    const previousEntries = entries.slice(0, index);
    const related = previousEntries.filter((previous) =>
      hasOverlap(previous.riskCategories, entry.riskCategories)
      || hasOverlap(previous.relatedFiles, entry.relatedFiles)
      || hasOverlap(previous.reviewCategories ?? [], entry.reviewCategories ?? [])
    );
    const relatedText = related.length > 0
      ? related.map((item) => item.title).join(', ')
      : previousEntries.map((item) => item.title).join(', ');

    return [
      evidenceLine(
        related.length > 0 ? '코드 근거' : '확인 필요',
        `${entry.title}은 앞선 선택 중 ${relatedText}와 함께 읽을 수 있습니다. 연결 근거는 risk/review category 또는 related file의 겹침 여부입니다.`
      )
    ];
  });
}

function renderUserPatternBlock(entries: DecisionLogEntry[]): string[] {
  const selectedDirections = entries.map((entry) => extractChoiceLabelForAnalysis(entry.userChoice)).filter(Boolean);
  const reviewCategoryCounts = countTokens(entries.flatMap((entry) => entry.reviewCategories ?? []));
  const riskCategoryCounts = countTokens(entries.flatMap((entry) => entry.riskCategories ?? []));
  const strongestReviewCategory = reviewCategoryCounts[0]?.[0] ?? 'needs_review';
  const strongestRiskCategory = riskCategoryCounts[0]?.[0] ?? 'needs_review';
  const lines = [
    evidenceLine('사용자 결정', `이 문서에 포함된 선택 수는 ${entries.length}개입니다.`),
    evidenceLine('사용자 결정', `선택 라벨: ${selectedDirections.length > 0 ? selectedDirections.join(', ') : '기록 없음'}`),
    evidenceLine('사용자 결정', `자주 등장한 review category: ${strongestReviewCategory}`),
    evidenceLine('사용자 결정', `자주 등장한 risk category: ${strongestRiskCategory}`)
  ];

  if (entries.length < 2) {
    lines.push(evidenceLine('확인 필요', '선택이 1개뿐이므로 반복 패턴은 아직 판단하기 어렵습니다.'));
  } else {
    lines.push(evidenceLine('확인 필요', '위 라벨들은 기록된 선택을 그대로 나열한 것입니다. 성향 해석은 포함하지 않습니다.'));
  }

  return lines;
}

function renderRelatedFileBlock(entries: DecisionLogEntry[]): string[] {
  const files = Array.from(new Set(entries.flatMap((entry) => entry.relatedFiles ?? [])))
    .map((file) => compactLine(file))
    .filter(Boolean);
  if (files.length === 0) {
    return [evidenceLine('확인 필요', '관련 파일이 decision log에 기록되지 않았습니다.')];
  }
  return files.map((file) => evidenceLine('코드 근거', file));
}

function renderValidationBlock(entry: DecisionLogEntry): string[] {
  const validation = entry.validationResult;
  if (!validation) {
    return [evidenceLine('검증 결과', `${entry.id}: validation result가 기록되지 않았습니다.`)];
  }
  return [
    evidenceLine(
      '검증 결과',
      `${entry.id}: typecheck=${validation.typecheck || 'not available'}, build=${validation.build || 'not available'}, test=${validation.test || 'not available'}, lint=${validation.lint || 'not available'}, status=${validation.status || 'needs_review'}, repair_attempted=${validation.repairAttempted ? 'true' : 'false'}`
    )
  ];
}

function renderFollowUpBlock(
  entries: DecisionLogEntry[],
  latestSummary: string,
  _projectGuide: string,
  _strictMode: boolean
): string[] {
  const hasFailedValidation = entries.some((entry) =>
    [entry.validationResult?.typecheck, entry.validationResult?.build, entry.validationResult?.test, entry.validationResult?.lint, entry.validationResult?.status]
      .some((value) => typeof value === 'string' && /failed|timeout|needs_review/i.test(value))
  );
  const hasMissingFiles = entries.some((entry) => !entry.relatedFiles || entry.relatedFiles.length === 0);
  const lines = [
    hasFailedValidation
      ? evidenceLine('검증 결과', '검증에 실패한 항목이 있습니다. 다음 작업 전에 같은 명령을 다시 실행해 확인하세요.')
      : evidenceLine('검증 결과', '기록된 검증을 기준으로 추가 확인이 필요하면 not available이나 needs_review 항목을 먼저 확인하세요.'),
    hasMissingFiles
      ? evidenceLine('확인 필요', '관련 파일이 기록되지 않은 결정이 있습니다. 다음부터는 영향을 준 파일도 함께 기록하면 복습이 쉬워집니다.')
      : evidenceLine('코드 근거', '관련 파일이 기록되어 있어서, 다음에 이 결정을 다시 볼 때 해당 파일부터 확인하면 됩니다.')
  ];

  if (latestSummary) {
    lines.push(evidenceLine('코드 근거', `최근 구현 요약: ${latestSummary}`));
  }

  return lines;
}

function evidenceLine(label: '사용자 결정' | '코드 근거' | '검증 결과' | 'AI 추론' | '확인 필요', text: string): string {
  return `- [${label}] ${compactLine(text)}`;
}

function compactLine(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || 'needs_review';
}

function formatList(values: string[] | undefined): string {
  const list = (values ?? []).map((value) => compactLine(value)).filter(Boolean);
  return list.length > 0 ? list.join(', ') : 'needs_review';
}

function formatSource(values: string[] | undefined): string {
  return formatList(values);
}

function formatOptions(options: string[]): string {
  const normalized = options
    .map((option) => compactLine(option))
    .filter(Boolean);
  return normalized.length > 0 ? normalized.join(' / ') : 'needs_review';
}

function extractChoiceLabelForAnalysis(choice: string): string {
  return compactLine(choice)
    .replace(/^Option\s+[A-D]\s*-\s*/i, '')
    .replace(/^Custom\s*-\s*/i, '')
    .trim();
}

function countTokens(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  values.map((value) => compactLine(value)).filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function hasOverlap(left: string[] | undefined, right: string[] | undefined): boolean {
  const leftSet = new Set((left ?? []).map((value) => compactLine(value).toLowerCase()).filter(Boolean));
  return (right ?? [])
    .map((value) => compactLine(value).toLowerCase())
    .some((value) => leftSet.has(value));
}

