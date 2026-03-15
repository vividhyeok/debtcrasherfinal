# Debtcrasher 현재 구현 기능 및 로직 정리

문서 기준: 현재 저장소의 `src/*.ts`, `package.json`, 기존 설계 문서를 함께 확인한 뒤 정리한 내용이다.  
목적은 "지금 Debtcrasher가 실제로 어디까지 구현되어 있고, 각 기능이 어떤 로직으로 동작하는가"를 외부에 설명할 수 있게 만드는 것이다.

## 1. 프로젝트 한 줄 요약

Debtcrasher는 VS Code 안에서 동작하는 개발 에이전트 확장이다.  
일반 코딩 에이전트처럼 실제 코드를 생성하고 수정하지만, 구현 전 단계에서 개발자가 반드시 고레버리지 판단을 직접 선택하도록 만들고, 그 판단을 다시 학습 가능한 문서로 남기는 구조를 핵심 차별점으로 둔다.

## 2. 현재 시스템 구조

현재 구조는 크게 4계층으로 나뉜다.

1. 확장 활성화 계층
   - `src/extension.ts`
   - `src/activation/activateDebtcrasher.ts`
   - VS Code가 확장을 활성화할 때 진입하는 지점이다.
   - 개발 모드에서는 자동으로 사이드바를 열고, 일반 모드에서는 최초 1회 환영 메시지를 띄운다.

2. 오케스트레이션 계층
   - `src/extension/DebtcrasherExtension.ts`
   - Agent View, Step View, 상태바, 명령 등록을 한곳에서 관리한다.
   - 실제 사용자 진입은 `Activity Bar` 컨테이너와 `Agent View` / `Step View` 두 웹뷰로 구성된다.

3. UI 계층
   - `src/agentView.ts`
   - `src/stepView.ts`
   - Agent View는 개발 요청, planning, 구현, 검증, 세션 히스토리를 담당한다.
   - Step View는 결정 기록 목록, 튜토리얼 생성, 저장된 문서 히스토리를 담당한다.

4. 서비스 계층
   - `src/aiClient.ts`
   - `src/logManager.ts`
   - `src/context/WorkspaceContextService.ts`
   - `src/verification/VerificationService.ts`
   - `src/sessionHistory.ts`
   - AI 호출, 워크스페이스 스냅샷 생성, 결정 기록 관리, 자동 검증, 세션 저장을 역할별로 분리해 둔 구조다.

## 3. 현재 구현된 핵심 기능

## 3-1. VS Code 확장 셸과 뷰 구조

구현된 내용:
- Activity Bar에 `Debtcrasher` 전용 컨테이너가 등록되어 있다.
- 컨테이너 안에 `Agent View`와 `Step View` 두 개의 webview view가 들어간다.
- 상태바 아이템을 통해 확장을 바로 열 수 있다.
- `openAgentView`, `openStepView`, `openBoth`, `openSettings` 명령이 등록되어 있다.

동작 로직:
- 활성화 시 `DebtcrasherExtension`이 모든 서비스와 뷰 컨트롤러를 생성한다.
- `registerWebviewViewProvider`로 두 뷰를 등록하고, `retainContextWhenHidden: true` 옵션으로 숨김 후에도 웹뷰 상태를 유지한다.
- 설정 열기 명령은 VS Code 설정 검색으로 연결되어 제공자, 모델, 질문 수준, API 키를 바로 찾을 수 있게 한다.

## 3-2. 다중 AI 제공자/모델 설정

구현된 내용:
- Anthropic, Google Gemini, OpenAI, DeepSeek 4개 제공자를 지원한다.
- 각 제공자별 모델 선택 설정이 있다.
- API 키는 VS Code Secret Storage를 우선 사용하고, 설정값 fallback도 읽는다.

동작 로직:
- `AIClient`가 현재 제공자와 모델을 `vscode.workspace.getConfiguration()`에서 읽는다.
- API 키는 `SecretStorage`를 먼저 조회하고, 없으면 설정 문자열을 읽는다.
- 실제 호출은 제공자별 HTTP API 형식에 맞게 분기한다.
- `sendMessage()`는 호출 직전 현재 system prompt를 로그로 남기도록 되어 있어 프롬프트 주입 여부를 추적할 수 있다.

## 3-3. Planning Gate 기반 개발 흐름

구현된 내용:
- 새 개발 요청은 바로 구현으로 가지 않고 planning 단계부터 시작한다.
- planning은 한 번에 최대 3개의 질문만 생성한다.
- 질문은 하나씩 순차적으로 묻지 않고 한 화면에 동시에 표시한다.
- 사용자가 모든 질문에 답한 뒤 `개발 시작`을 눌러야 구현 단계로 넘어간다.

동작 로직:
- Agent View에서 요청이 들어오면 `handleSubmitTask()`가 실행된다.
- 먼저 워크스페이스 컨텍스트, `AGENT.md`, 과거 결정 패턴, 이전 세션 이어서 정보까지 모은다.
- 이 컨텍스트를 기반으로 `AIClient.generatePlan()`을 호출한다.
- planning 응답은 JSON이어야 하며 `summary`, `assumptions`, `questions` 구조를 강제한다.
- 응답이 오면 Agent View가 질문 카드를 렌더링하고, 선택 상태는 즉시 세션 파일에도 반영된다.
- 사용자가 선택을 완료하면 `handleStartImplementation()`이 선택 결과를 `DecisionHistoryEntry`와 log entry로 변환한 뒤 실제 구현으로 넘긴다.

## 3-4. 질문 수준 필터링

구현된 내용:
- 질문 수준 설정 `aiStepDev.questionFilterLevel`이 존재한다.
- 값은 `high`, `medium`, `low`이며 planning prompt에 동적으로 반영된다.

동작 로직:
- `AIClient.getQuestionFilterLevel()`이 현재 설정을 읽는다.
- planning system prompt 뒤에 질문 필터 블록을 붙여서 모델이 어떤 수준의 질문만 노출해야 하는지 제한한다.
- 구현 단계에서는 같은 수준 정보를 "더 이상 질문하지 말고 기본값으로 처리하라"는 규칙으로 재사용한다.

## 3-5. 중복 질문 방지용 메모리 구조

구현된 내용:
- 워크스페이스 루트에 `DECISIONS.md`와 `AGENT.md`를 자동으로 생성/갱신한다.
- `DECISIONS.md`는 전체 판단 로그, `AGENT.md`는 압축 캐시 역할을 한다.
- `AGENT.md`에는 Confirmed Decisions, Implied Constraints, Most Recent Context, Do not ask again 섹션이 들어간다.

동작 로직:
- 사용자가 planning 질문에 답하고 구현 시작을 누르면 `appendDecisions()`가 `DECISIONS.md`에 step 블록을 추가한다.
- 이후 `syncProjectGuide()`가 `AGENT.md`를 갱신한다.
- 이 갱신은 단순히 결정 개수만 비교하지 않고, `DECISIONS.md` 수정 시각, 최신 결정 요약, 최근 요청, 최근 구현 요약까지 비교해서 필요할 때 다시 생성한다.
- 다음 planning 호출 때는 `AGENT.md` 전체와 `DECISIONS.md` 기반 패턴 요약을 함께 읽어 중복 질문을 줄인다.

## 3-6. 요청 관련 파일만 고르는 워크스페이스 컨텍스트 생성

구현된 내용:
- 전체 워크스페이스를 무작정 프롬프트에 넣지 않는다.
- 사용자 요청 키워드를 기준으로 관련성 높은 파일만 골라서 스냅샷을 만든다.
- `node_modules`, `.git`, `dist`, `build`, `out`, `.ai-tutorials`, `DECISIONS.md`, `AGENT.md`, lock/map 파일 등은 항상 제외한다.

동작 로직:
- `WorkspaceContextService.buildWorkspaceSnapshot()`가 스냅샷 생성을 담당한다.
- 요청 문장에서 불용어를 제거한 키워드를 추출한 뒤, 파일 경로와 앞 50줄에서 키워드 매칭 점수를 계산한다.
- `package.json`, `tsconfig.json`, `go.mod`, `Cargo.toml`, `requirements.txt` 같은 설정 파일은 점수가 0이어도 포함 대상이 된다.
- 최종적으로 문자 수 예산과 파일 수 예산 안에서 관련 파일만 정렬해 planning/implementation prompt에 넣는다.

## 3-7. 실제 코드 생성 및 파일 쓰기

구현된 내용:
- planning 완료 후 AI가 JSON 형태의 구현 결과를 반환하면 실제 파일을 워크스페이스에 쓴다.
- 새 파일 생성과 기존 파일 수정을 구분해 처리한다.
- 경로 정규화로 워크스페이스 바깥 경로 쓰기를 막는다.

동작 로직:
- `AIClient.generateImplementation()`은 `currentWork`, `summary`, `files`, `runInstructions` 구조의 JSON을 반환해야 한다.
- `AgentViewController.writeImplementationFiles()`가 각 파일 경로를 검증한 뒤 디렉터리를 만들고 내용을 저장한다.
- 새 파일이면 생성 이벤트를, 기존 파일이면 수정 이벤트를 진행 로그로 보낸다.
- 구현이 끝나면 첫 번째 생성 파일을 VS Code 에디터로 바로 연다.

## 3-8. 자동 검증 및 1회 자동 수정 루프

구현된 내용:
- 구현 후 가능한 경우 자동으로 검증 명령을 실행한다.
- 검증 실패 시 1회에 한해 자동 수정 프롬프트를 돌린 뒤 다시 검증한다.
- 그래도 실패하면 검증 출력과 함께 수동 재검증 버튼을 제공한다.

동작 로직:
- `VerificationService.detectCommands()`가 먼저 실행 가능한 검증 명령을 찾는다.
- Node 프로젝트는 `compile`, `build`, `typecheck`, `check`, `test` 순으로 안전한 스크립트를 선택한다.
- `package.json`이 없으면 Python, Go, Rust, `test/check/verify.sh`까지 fallback 탐지를 시도한다.
- `runVerificationWithProgress()`는 각 명령 실행 전후를 progress 이벤트로 보내며 결과를 누적한다.
- 실패하면 `AIClient.repairImplementation()`에 실패 출력과 현재 워크스페이스 스냅샷을 전달해 최소 수정 패치를 요청한다.
- 자동 수정이 변경 파일을 반환하지 않거나 재검증에도 실패하면, 사용자에게 검증 출력과 `수동 수정 후 재검증` 버튼을 보여 준다.

## 3-9. 세션 히스토리 저장과 복원

구현된 내용:
- Agent View 대화는 `.ai-sessions/*.json`으로 저장된다.
- 오늘 진행한 마지막 세션은 재오픈 시 자동 복원된다.
- `새 채팅`과 `작업 기록` 두 모드가 있다.
- 이전 세션을 읽기 전용으로 열어 보고, 이어서 개발할 수 있다.

동작 로직:
- 의미 있는 상태 변화가 생길 때마다 `SessionHistoryService.saveSession()`이 현재 세션을 JSON으로 저장한다.
- 세션 파일에는 메시지 순서, planning 정보, 선택 결과, 구현 결과, 검증 요약, phase 상태가 담긴다.
- API 키 같은 민감한 설정은 저장하지 않는다.
- `.ai-sessions/`는 자동으로 `.gitignore`에 추가되며, 세션은 최대 50개까지만 유지한다.
- resume 시에는 마지막 사용자 요청, 선택한 판단, 구현/실패 요약을 한 줄 컨텍스트로 planning prompt에 다시 넣는다.

## 3-10. Agent View 진행 상황 UI

구현된 내용:
- 구현 단계에서 단순히 "구현 중" 한 줄만 보이는 구조가 아니다.
- 파일 생성/수정, 검증 시작/결과, 자동 수정, `DECISIONS.md` 기록, `AGENT.md` 갱신을 개별 progress bubble로 보여 준다.
- 결과 카드가 나오면 progress 로그는 한 줄 요약으로 접힌다.

동작 로직:
- 백엔드는 `file_start`, `file_done`, `file_edit`, `verify_start`, `verify_done`, `repair_start`, `log_done`, `agent_updated` 이벤트를 즉시 전송한다.
- 프런트엔드는 이 이벤트를 codicon 기반의 작은 인라인 버블로 렌더링한다.
- 최종 결과가 나오면 같은 요청의 progress 목록을 `파일 N개 생성 · 검증 통과/실패 · 총 소요 시간` 요약 줄로 접고, 클릭 시 다시 펼칠 수 있다.

## 3-11. Step View의 결정 기록 브라우징

구현된 내용:
- Step View는 `Decision Steps`와 `History` 두 영역으로 구성된다.
- `DECISIONS.md`의 step들을 목록으로 보여 준다.
- 여러 step을 동시에 선택할 수 있다.
- `전체 선택`, `선택 해제`, `문서 생성` UX가 구현되어 있다.
- 저장된 markdown 기록은 Step View 안에서 미리보지 않고 VS Code 에디터로 바로 연다.

동작 로직:
- `LogManager.readLogEntries()`가 `DECISIONS.md`를 `## Step:` 단위로 파싱해 개별 엔트리로 만든다.
- Step View는 선택 상태를 `Set`으로 관리하고, 생성 성공 후에는 선택 상태를 자동으로 비운다.
- `DECISIONS.md`와 `.ai-tutorials/*.md`를 파일시스템 watcher로 감시해 변경 시 자동 새로고침한다.
- History 목록은 파일명과 수정 시각만 보여 주고, 클릭 시 `openTextDocument()` + `showTextDocument()`로 파일을 연다.

## 3-12. 튜토리얼 markdown 생성

구현된 내용:
- 선택한 step들을 기반으로 학습용 markdown 문서를 생성한다.
- 생성 문서는 `.ai-tutorials/` 아래 저장된다.
- 단일 step과 다중 step 모두 지원한다.
- 출력 품질 검증이 들어가 있어 포맷이 부족하면 저장하지 않는다.

동작 로직:
- Step View는 선택된 log entry, 최신 `AGENT.md`, 최근 구현 요약을 `AIClient.generateTutorial()`로 넘긴다.
- `STEP_SYSTEM_PROMPT`는 결정한 것, 왜 필요했나, 선택지 비교표, 이후 결정 영향, 틀렸을 때 신호, 다음에 비슷한 상황이 오면 등을 포함한 구조를 요구한다.
- 토큰 예산은 step 수에 따라 동적으로 늘어난다.
- 응답 후 validator가 필수 섹션, markdown 표, 다중 step일 때 연결 구조/판단 패턴 분석, 최소 길이를 검사한다.
- 검증 실패 시 파일을 저장하지 않고 Step View에 인라인 오류를 보여 주며, 사용자의 선택 상태도 유지한다.

## 4. 워크스페이스에 실제로 생성되는 파일

- `DECISIONS.md`
  - 전체 판단 로그
  - Step View의 step 목록 원본
- `AGENT.md`
  - 다음 planning 때 빠르게 읽는 압축 캐시
- `.ai-tutorials/*.md`
  - Step View에서 생성한 학습용 튜토리얼 문서
- `.ai-sessions/*.json`
  - Agent View 세션 히스토리

즉 Debtcrasher는 자체 데이터베이스를 두지 않고, 모든 학습 자산과 히스토리를 워크스페이스 파일로 남기는 설계다.

## 5. 현재 end-to-end 실행 흐름

1. 사용자가 Agent View에 개발 요청을 입력한다.
2. 에이전트는 워크스페이스 스냅샷, `AGENT.md`, 과거 결정 패턴, 이전 세션 정보를 읽는다.
3. planning 모델이 최대 3개의 질문과 assumptions를 생성한다.
4. 사용자가 판단을 확정하고 `개발 시작`을 누른다.
5. 선택한 판단이 `DECISIONS.md`에 기록된다.
6. `AGENT.md`가 현재 결정 상태 기준으로 재생성된다.
7. 구현 모델이 실제 파일 JSON을 반환한다.
8. 파일이 워크스페이스에 기록된다.
9. 가능한 검증 명령이 있으면 자동 검증이 실행된다.
10. 실패하면 1회 자동 수정 후 재검증한다.
11. 결과 요약, 생성 파일 목록, 검증 결과가 Agent View에 표시된다.
12. 이후 Step View에서 선택한 판단들을 튜토리얼 markdown으로 다시 변환할 수 있다.

## 6. 현재 구조의 의미

이 코드베이스는 "단순히 코드 생성만 하는 에이전트"가 아니라, 다음 세 가지를 함께 해결하려는 형태로 구현되어 있다.

1. 개발 생산성
   - 실제 코드 생성, 파일 쓰기, 자동 검증, 자동 수정까지 수행한다.

2. 판단 기록성
   - 중요한 아키텍처 결정은 `DECISIONS.md`와 `AGENT.md`로 남긴다.

3. 학습 가능성
   - 과거 판단을 Step View에서 다시 선택해 복습 문서로 변환할 수 있다.

즉 Debtcrasher의 현재 구현은 "개발 에이전트"와 "판단 학습 시스템"을 하나의 VS Code 확장으로 결합한 상태라고 설명할 수 있다.

## 7. 외부 설명 시 강조할 포인트

- Continue류 구조를 참고한 일반 개발 에이전트 베이스 위에, Debtcrasher 고유의 planning gate와 step 학습 구조를 얹었다.
- 구현 시작 전 질문을 한 번에 모아 제시하고, 이후에는 추가 질문 없이 구현으로 바로 들어간다.
- AGENT/DECISIONS 이중 파일 구조를 통해 중복 질문을 줄이고, 판단 히스토리를 장기 자산으로 축적한다.
- 코드 생성 이후 자동 검증과 1회 자동 수정을 통해 단순 채팅형 도우미가 아니라 실제 개발 루프를 수행한다.
- Step View는 과거 판단을 다시 학습 자료로 바꾸는 별도 인터페이스로 설계되어 있다.

## 8. 현재 코드 기준 보완 여지

현재 소스만 기준으로 보면 핵심 흐름은 구현되어 있지만, 일부 UI 한글 문자열 정리와 프롬프트 현지화 품질은 추가 정돈 여지가 있다.  
즉 구조와 기능은 이미 갖춰져 있고, 다음 단계는 안정화와 polish에 가깝다.
