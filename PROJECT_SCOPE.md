# DebtCrasher 현재 범위 정리

## 1. 현재 동작하는 것
- VS Code Activity Bar에 `Debtcrasher` 컨테이너를 등록하고 그 안에 `Agent View`와 `Step View` 두 개의 webview view를 띄운다.
- 확장 활성화 시 명령(`openAgentView`, `openStepView`, `openBoth`, `openSettings`)과 상태바 버튼을 등록한다.
- Agent View가 로드되면 현재 워크스페이스 존재 여부와 선택된 AI 제공자/모델 상태를 webview로 보낸다.
- Agent View에서 새 요청을 입력하면 requestId와 AbortController를 생성해 요청별로 취소 가능한 planning 흐름을 시작한다.
- Planning 전에 `WorkspaceContextService`가 요청 키워드와 파일 경로를 기준으로 관련성 높은 파일만 골라 워크스페이스 스냅샷을 만든다.
- Planning 전에 `AGENT.md`/`AGENTS.md`를 읽고, `DECISIONS.md`에서 과거 판단 패턴을 추출해 planning prompt에 함께 넣는다.
- `AIClient.generatePlan()`이 JSON 형식의 planning 응답을 요구하고, 질문 수를 최대 3개로 제한한다.
- Planning 응답이 오면 Agent View가 summary, assumptions, 질문 카드, Option A/B, custom 입력칸을 한 화면에 렌더링한다.
- 사용자가 모든 질문에 답해야만 `개발 시작` 버튼이 활성화되고, 선택 결과를 한 번에 수집한다.
- `개발 시작`을 누르면 선택한 판단들을 배치로 `DECISIONS.md`에 기록하고 `AGENT.md`를 갱신한다.
- `AIClient.generateImplementation()`이 판단 기록, assumptions, 워크스페이스 스냅샷을 바탕으로 실제 파일 생성 JSON을 반환하도록 구성돼 있다.
- Agent View가 구현 응답으로 받은 파일들을 워크스페이스에 실제로 쓰고, 첫 번째 생성 파일을 VS Code 에디터로 연다.
- `VerificationService`가 `package.json`의 `compile/build/typecheck/check/test` 스크립트를 감지해 자동 검증 명령 목록을 만든다.
- 구현 후 자동 검증을 실행하고, 실패하면 검증 출력과 관련 파일 스냅샷을 넣어 `repairImplementation()`을 한 번 호출한다.
- 자동 수정이 파일을 반환하면 수정 파일만 다시 쓰고 검증 명령을 한 번 더 실행한다.
- Agent View 결과 카드가 생성 파일 목록, 실행 안내, `AGENT.md` 경로, 검증 요약, 검증 명령별 PASS/FAIL 출력을 표시한다.
- Step View가 `DECISIONS.md`와 `.ai-tutorials/*.md`를 감시하고 파일 변경 시 자동으로 상태를 새로고침한다.
- Step View가 decision step 목록을 체크박스로 렌더링하고 `전체 선택`, `선택 해제`, `문서 생성` 버튼을 제공한다.
- Step View에서 여러 step을 동시에 골라 `AIClient.generateTutorial()`로 학습용 markdown을 생성하고 `.ai-tutorials`에 저장한다.
- 튜토리얼 생성이 끝나면 선택 상태를 초기화하고, 생성된 markdown 파일을 VS Code 에디터에서 바로 연다.
- Step View History가 저장된 markdown 파일명을 한 줄씩 보여주고 클릭 시 인라인 프리뷰 없이 파일을 직접 연다.
- `LogManager`가 `DECISIONS.md`를 없으면 생성하고, 로그 파싱, 튜토리얼 저장, `AGENT.md` 압축 캐시 재생성을 담당한다.
- AI 제공자는 Anthropic, Gemini, OpenAI, DeepSeek 네 종류로 정의돼 있고 API 키는 secret storage 또는 설정값에서 읽는다.

## 2. 현재 동작하지 않거나 미완성인 것
- `package.json`, `agentView.ts`, `stepView.ts`, `aiClient.ts`, `logManager.ts`에 깨진 한글 문자열이 남아 있어 설정 설명과 UI 문구 일부가 정상 표시되지 않을 수 있다.
- 튜토리얼 생성용 `STEP_SYSTEM_PROMPT` 내부 문자열이 깨져 있어 생성되는 학습 문서 품질을 신뢰하기 어렵다.
- 판단 패턴 추론용 `PATTERN_GROUPS`의 한국어 키워드 일부가 깨져 있어 한국어 로그에서 패턴 추론 품질이 떨어질 수 있다.
- `syncProjectGuide()`는 decision 개수 변화만 보고 `AGENT.md` 재생성을 결정하므로, decision 수가 같으면 최신 구현 요약이 갱신되지 않을 수 있다.
- 자동 검증은 `package.json` 기반 스크립트만 다루므로 비 Node 워크스페이스에는 검증 루프가 사실상 동작하지 않는다.
- 자동 수정 단계가 실패 검증 후에도 변경 파일을 돌려주지 않으면, 그 시점에서 추가 복구 없이 실패 결과만 남기고 종료된다.
- Agent View와 Step View 메시지 교환은 개별 객체 기반으로 동작하며 별도의 중앙 typed protocol 계층은 아직 없다.

## 3. 1학기 안에 완성 가능한 것 (현실적 범위)
- Agent View, Step View, 설정 설명에 남아 있는 한글 깨짐을 정리해 발표용 UI를 안정화하기
- `STEP_SYSTEM_PROMPT`와 판단 패턴 키워드를 정리해 튜토리얼 품질과 planning 품질을 한국어 기준으로 보정하기
- `AGENT.md` 재생성 조건을 보강해 최신 구현 요약과 최신 요청 맥락이 stale 되지 않게 만들기
- 현재 있는 자동 검증/자동 수정 루프를 샘플 프로젝트 기준으로 다듬어 실패 메시지와 복구 결과를 더 명확히 보여주기
- `package.json`이 없는 워크스페이스에서도 최소한의 검증 명령 후보를 고를 수 있도록 VerificationService fallback을 추가하기

## 4. 논문/발표에서 "구현한 것"으로 보여줄 수 있는 핵심 기능
1. 한 번의 planning으로 질문을 최대 3개까지 모아 보여주는 흐름 — 일반 채팅형 에이전트보다 판단 지점을 통제한다는 점을 데모로 보여주기 쉽다.
2. `DECISIONS.md`와 `AGENT.md`를 동시에 유지하는 결정 메모리 구조 — 같은 프로젝트에서 판단을 누적하고 다음 요청에 반영하는 모습을 바로 시연할 수 있다.
3. 사용자가 답을 고른 뒤 실제 파일을 생성하고 에디터를 여는 구현 루프 — 단순 스케줄러가 아니라 실제 개발 에이전트라는 점을 증명한다.
4. 구현 후 자동 검증과 1회 자동 수정 루프 — 실패한 뒤 스스로 다시 고치는 흐름이 시연 효과가 크다.
5. Step View에서 여러 판단을 골라 학습용 markdown으로 바꾸는 기능 — Debtcrasher만의 차별점인 “판단의 학습 자산화”를 직접 보여줄 수 있다.

## 5. 추후 연구 방향으로 넘길 것
- Step 간 의존성을 그래프로 시각화하면 개발자의 판단 복기 속도와 이해도는 얼마나 향상되는가?
- 새 판단이 과거 `AGENT.md`/`DECISIONS.md`와 충돌할 때 자동 경고하는 방식은 어떤 기준으로 설계해야 하는가?
- 생성 코드의 diff를 승인/거부하는 UI를 추가하면 개발자 통제감과 학습 효과가 실제로 높아지는가?
- 키워드 기반 파일 랭킹 대신 임베딩 기반 관련 파일 검색을 쓰면 planning 품질이 얼마나 더 좋아지는가?
- webview 메시지 계층을 typed protocol로 재구성하면 유지보수 비용과 버그율을 얼마나 줄일 수 있는가?
