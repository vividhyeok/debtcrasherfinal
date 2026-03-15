# DebtCrasher 현재 개발 현황

## 1. 패치별 반영 상태
- PATCH 01: 부분 반영 — 명령명과 일부 UI 문구는 정상화됐지만 [package.json](./package.json)의 모델 설명, [src/stepView.ts](./src/stepView.ts), [src/aiClient.ts](./src/aiClient.ts)에 깨진 한글 문자열이 아직 남아 있다.
- PATCH 02: 반영됨 — [src/logManager.ts](./src/logManager.ts)의 `syncProjectGuide()`가 결정 수, `DECISIONS.md` 수정 시간, 최신 결정 요약, 최신 구현 요약, 최신 요청 컨텍스트를 함께 비교해 `AGENT.md`를 재생성한다.
- PATCH 03: 반영됨 — [src/verification/VerificationService.ts](./src/verification/VerificationService.ts)에 Python/Go/Rust/shell fallback이 있고, [src/agentView.ts](./src/agentView.ts)에 자동 수정 실패 메시지와 `수동 수정 후 재검증` 버튼이 있다.
- PATCH 04: 부분 반영 — 관련 파일 랭킹, 8000자 예산, 노이즈 파일 제외는 들어갔지만 [src/context/WorkspaceContextService.ts](./src/context/WorkspaceContextService.ts)의 한국어 불용어/조사 목록 문자열이 깨져 있어 한국어 요청 relevance 품질은 완전하지 않다.
- PATCH 05: 부분 반영 — [src/logManager.ts](./src/logManager.ts)의 `PATTERN_GROUPS`는 성능/보안/UX 그룹까지 확장됐지만 [src/aiClient.ts](./src/aiClient.ts)의 `STEP_SYSTEM_PROMPT`와 튜토리얼 입력 문구가 여전히 깨져 있어 구조화된 학습 문서 생성 규칙이 실제로는 약하다.
- PATCH 06: 반영됨 — [src/agentView.ts](./src/agentView.ts)와 [media/agent.css](./media/agent.css)에 phase bar와 `판단 분석 중 → 판단 선택 중 → 구현 중 → 검증 중 → 완료` 전이 표시가 구현돼 있다.

## 2. 현재 동작하는 것
- VS Code Activity Bar에 `Debtcrasher` 컨테이너를 등록하고 `Agent View`, `Step View` 두 개의 `WebviewView`를 띄운다.
- 확장 활성화 시 명령(`openAgentView`, `openStepView`, `openBoth`, `openSettings`)과 상태바 버튼을 등록한다.
- 개발 모드에서는 사이드바를 자동으로 열고, 일반 모드에서는 1회성 welcome 메시지를 띄운다.
- 설정에서 AI 제공자, 모델, API 키, 질문 수준(`aiStepDev.questionFilterLevel`)을 정의하고 읽는다.
- `AIClient`가 Anthropic, Gemini, OpenAI, DeepSeek 네 제공자에 대해 모델 선택과 API 호출 경로를 분기한다.
- Agent View 로드 시 현재 워크스페이스 연결 상태와 선택된 제공자/모델 정보를 webview로 전달한다.
- 새 요청 제출 시 `AbortController`를 요청별로 만들고, 새 세션 시작 시 진행 중 요청을 중단한다.
- planning 전에 `WorkspaceContextService`가 요청 키워드와 파일 내용 앞부분을 기준으로 관련 파일 스냅샷을 만든다.
- planning 전에 `AGENT.md`/`AGENTS.md` 컨텍스트와 `DECISIONS.md` 기반 과거 판단 패턴을 함께 읽는다.
- planning 응답은 `summary`, `assumptions`, 최대 3개의 질문 카드 JSON으로 파싱되고, Agent View에 한 번에 렌더링된다.
- 질문 카드는 Option A/B 선택과 custom 입력을 지원하고, 모든 질문이 답변되어야 `개발 시작` 버튼이 활성화된다.
- `개발 시작` 이후 선택한 판단을 `DECISIONS.md`에 배치 기록하고 `AGENT.md`를 갱신한다.
- 구현 응답으로 받은 파일을 실제 워크스페이스에 쓰고, 첫 번째 생성 파일을 VS Code 편집기로 연다.
- 구현 후 자동 검증을 실행하고, 실패 시 검증 출력 기반으로 자동 수정 1회를 시도한다.
- 자동 수정이 변경 파일을 돌려주지 않으면 실패 이유와 검증 출력을 Agent View에 표시하고 수동 재검증 버튼을 노출한다.
- `VerificationService`는 `package.json` 스크립트뿐 아니라 Python, Go, Rust, `.sh` 검증 스크립트 fallback도 탐지한다.
- Agent View 상단에 현재 phase를 보여주는 가로형 indicator가 있고, 현재 단계만 강조 표시된다.
- `Enter` 제출, `Shift+Enter` 줄바꿈 입력 UX가 구현되어 있다.
- Step View는 `DECISIONS.md`와 `.ai-tutorials/*.md` 변경을 `FileSystemWatcher`로 감시하고 자동 새로고침한다.
- Step View는 decision step 다중 선택, 전체 선택, 선택 해제, 문서 생성 UX를 제공한다.
- Step View는 상단/하단 섹션을 독립 스크롤로 나누고 divider 및 헤더 드래그로 높이를 조절할 수 있다.
- History 목록은 파일명과 수정 시각 한 줄만 보여주고 클릭 시 markdown 파일을 VS Code 편집기로 직접 연다.
- 튜토리얼 생성 후 선택 상태를 비우고, 생성한 markdown 파일을 자동으로 연다.
- `LogManager`는 `DECISIONS.md` 생성, 로그 파싱, `.ai-tutorials` 저장, `AGENT.md` 압축 캐시 재생성을 담당한다.
- 현재 소스는 `npm run compile`을 통과한다.

## 3. 현재 동작하지 않거나 불완전한 것
- 설정 화면 문구와 모델 설명 일부가 [package.json](./package.json)에 여전히 깨져 있어 설정 UX가 완전히 복구되지 않았다.
- Step View의 안내 문구, 버튼 텍스트, 상태 메시지 일부가 [src/stepView.ts](./src/stepView.ts)에 깨진 상태로 남아 있다.
- 튜토리얼 생성 관련 프롬프트와 오류 메시지 상당수가 [src/aiClient.ts](./src/aiClient.ts)에서 깨져 있어 Debtcrasher의 핵심 학습 문서 품질을 신뢰하기 어렵다.
- [src/context/WorkspaceContextService.ts](./src/context/WorkspaceContextService.ts)의 한국어 불용어/조사 문자열이 깨져 있어 한국어 요청에서 relevance ranking 정확도가 떨어질 가능성이 크다.
- `AGENT.md` 재생성 내용은 압축 캐시 형태이지만, 라인 수를 60줄 이하로 제한하는 강제 로직은 없다.
- webview 메시지 교환은 여전히 수동 객체 기반이며, typed protocol이나 중앙 router 계층은 없다.
- 구현 결과를 바로 파일에 쓰기 때문에 diff 리뷰/승인 단계는 아직 없다.
- 자동 검증 fallback은 Node/Python/Go/Rust/`.sh`까지만 다루며, 그 외 생태계에는 일반화된 검증 경로가 없다.
- 자동 수정은 1회만 시도하고 종료하므로 반복적 self-heal 루프는 아직 없다.
- 튜토리얼 생성 토큰 예산이 고정값이라 여러 step을 동시에 선택할 때 출력이 짧아질 수 있다.

## 4. 코드 품질 이슈
- 문자열 인코딩 문제가 여러 파일에 흩어져 있어 UI/프롬프트/에러 메시지의 일관성이 깨져 있다.
- [src/agentView.ts](./src/agentView.ts)와 [src/stepView.ts](./src/stepView.ts)에 `createNonce`, `toErrorMessage` 같은 유틸이 중복돼 있다.
- [src/logManager.ts](./src/logManager.ts)의 `shouldRegenerateGuide()`는 현재 호출되지 않는 죽은 코드다.
- [src/aiClient.ts](./src/aiClient.ts)의 `saveQuestionFilterLevel`, `saveCurrentModel`, `saveProviderSetup`, `clearProviderApiKey`는 현재 뷰 흐름에서 사용되지 않는다.
- [src/aiClient.ts](./src/aiClient.ts)와 [src/verification/VerificationService.ts](./src/verification/VerificationService.ts)에 `any` 기반 파싱이 남아 있어 타입 안전성이 낮다.
- `AGENT.md` 규칙은 `// ASSUMPTION:`을 요구하지만 구현 프롬프트는 `// DEFAULT:`를 요구해 주석 컨벤션이 서로 다르다.
- 스냅샷 예산, 질문 수, 검증 타임아웃, 토큰 수, fallback 우선순위 같은 운영 상수가 여러 파일에 하드코딩돼 있다.
- `catch { return '' }`, `catch { return [] }` 같은 패턴이 많아 디버깅 시 실제 실패 원인을 추적하기 어렵다.
- [src/aiClient.ts](./src/aiClient.ts)는 매 API 호출 전에 전체 system prompt를 `console.log`로 출력해 디버그 노이즈와 컨텍스트 노출 가능성이 있다.

## 5. 다음 작업 우선순위
1. 깨진 한글 문자열을 [package.json](./package.json), [src/stepView.ts](./src/stepView.ts), [src/aiClient.ts](./src/aiClient.ts), [src/context/WorkspaceContextService.ts](./src/context/WorkspaceContextService.ts)에서 먼저 정리해 UI와 프롬프트 품질을 안정화한다.
2. 튜토리얼 생성 경로를 다시 손봐서 `STEP_SYSTEM_PROMPT`와 입력 포맷이 실제로 Debtcrasher 학습 문서 구조를 강제하도록 복구한다.
3. webview 메시지 프로토콜 정리와 dead code 제거를 진행해 Agent/Step 뷰의 유지보수성과 디버깅 난도를 낮춘다.
