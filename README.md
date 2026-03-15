# Debtcrasher

Debtcrasher는 VS Code 안에서 동작하는 개발 에이전트 확장이다.  
핵심 목표는 "코드를 대신 써 주는 것"에서 끝나지 않고, 구현 전에 개발자가 고레버리지 판단을 직접 내리게 만들고 그 판단을 다시 학습 가능한 자산으로 남기는 것이다.

## 무엇을 해결하려는가

일반적인 개발 에이전트는 빠르게 코드를 만들지만, 중요한 구조 판단까지 모두 AI가 묵시적으로 정해 버리면 개발자가 왜 그런 선택이 나왔는지 놓치기 쉽다. Debtcrasher는 이 지점을 줄이기 위해 planning gate, 결정 로그, 복습용 Step View를 묶어서 제공한다.

이 확장은 두 가지를 동시에 하도록 설계되어 있다.

- 실제 파일을 생성하고 수정하는 개발 에이전트
- 중요한 판단을 기록하고 다시 학습 자료로 변환하는 학습 보조 도구

## 현재 구현된 핵심 기능

- Agent View 기반 개발 흐름
  - 새 요청을 받으면 바로 구현하지 않고 planning 단계부터 시작한다.
  - 한 번의 planning 호출에서 최대 3개의 고레버리지 질문을 한 화면에 제시한다.
  - 사용자가 답을 확정하면 그 뒤에는 추가 질문 없이 바로 구현으로 들어간다.

- 결정 메모리 구조
  - `DECISIONS.md`에 전체 판단 로그를 저장한다.
  - `AGENT.md`에 다음 요청에서 빠르게 참조할 압축 캐시를 저장한다.
  - 이미 확정된 결정은 planning에서 다시 질문하지 않도록 프롬프트와 캐시 구조를 함께 사용한다.

- 워크스페이스 컨텍스트 필터링
  - 전체 파일을 무작정 프롬프트에 넣지 않는다.
  - 요청 키워드와 관련성 높은 파일만 골라 스냅샷을 만든다.
  - `package.json`, `tsconfig.json`, `go.mod`, `Cargo.toml`, `requirements.txt` 같은 핵심 설정 파일은 우선적으로 포함한다.

- 실제 코드 생성과 파일 쓰기
  - 구현 단계에서는 JSON 구조의 파일 결과를 받아 워크스페이스에 직접 쓴다.
  - 새 파일 생성과 기존 파일 수정을 구분해 처리한다.
  - 상대 경로 검증으로 워크스페이스 밖 파일 쓰기를 막는다.

- 자동 검증과 1회 자동 수정
  - Node 프로젝트에서는 `compile`, `build`, `typecheck`, `check`, `test` 스크립트를 감지해 실행한다.
  - `package.json`이 없는 경우 Python, Go, Rust, 셸 스크립트까지 fallback 탐지를 지원한다.
  - 검증 실패 시 1회 자동 수정 후 재검증하고, 그래도 실패하면 수동 재검증 버튼을 제공한다.

- 세션 히스토리
  - Agent View 대화는 `.ai-sessions/*.json`으로 저장된다.
  - 가장 최근 세션을 다시 불러올 수 있고, 읽기 전용으로 히스토리를 탐색한 뒤 이어서 개발할 수 있다.

- 진행 상황 UI
  - 구현 중에는 파일 생성, 파일 수정, 검증 시작/결과, 자동 수정, `DECISIONS.md` 기록, `AGENT.md` 갱신을 progress bubble로 표시한다.
  - 완료 후에는 진행 로그를 접어 한 줄 요약으로 정리한다.

- Step View
  - `DECISIONS.md`에 저장된 step 목록을 보여 준다.
  - 여러 step을 동시에 선택해 복습용 markdown 문서를 생성할 수 있다.
  - 생성된 문서는 `.ai-tutorials/`에 저장되고, 히스토리에서 다시 VS Code 에디터로 바로 열 수 있다.

- 튜토리얼 생성 품질 보강
  - 선택한 결정 로그와 최신 `AGENT.md`, 최근 구현 요약을 함께 전달한다.
  - 응답 후 필수 섹션, 표, 최소 길이를 검증해 형식이 부족하면 저장하지 않는다.

## 현재 구조

```text
VS Code Activation
  -> DebtcrasherExtension
     -> AgentViewController
     -> StepViewController
     -> AIClient
     -> WorkspaceContextService
     -> LogManager
     -> VerificationService
     -> SessionHistoryService
```

### 주요 파일

- `src/activation/activateDebtcrasher.ts`
  - 확장 활성화 진입점

- `src/extension/DebtcrasherExtension.ts`
  - 전체 서비스와 뷰를 조립하는 오케스트레이터

- `src/agentView.ts`
  - Agent View 웹뷰 UI와 planning -> 구현 -> 검증 흐름

- `src/stepView.ts`
  - Step View UI, step 선택, 튜토리얼 생성, 저장 히스토리 열기

- `src/aiClient.ts`
  - planning / implementation / repair / tutorial 프롬프트 구성과 모델 호출

- `src/context/WorkspaceContextService.ts`
  - 요청 관련 파일 위주로 워크스페이스 스냅샷 생성

- `src/logManager.ts`
  - `DECISIONS.md`, `AGENT.md`, `.ai-tutorials` 관리

- `src/verification/VerificationService.ts`
  - 검증 명령 탐지와 실행

- `src/sessionHistory.ts`
  - `.ai-sessions` 저장, 목록 조회, 복원, resume 컨텍스트 구성

## Agent View 동작 흐름

1. 사용자가 개발 요청을 입력한다.
2. 워크스페이스 관련 파일, `AGENT.md`, 과거 결정 패턴, 이전 세션 정보를 읽는다.
3. planning 모델이 최대 3개의 질문과 assumptions를 JSON으로 반환한다.
4. 사용자가 모든 판단에 답하고 `개발 시작`을 누른다.
5. 선택한 판단을 `DECISIONS.md`에 기록한다.
6. `AGENT.md`를 현재 상태 기준으로 갱신한다.
7. 구현 모델이 실제 생성할 파일 목록과 내용을 반환한다.
8. 워크스페이스에 파일을 쓴다.
9. 가능한 경우 자동 검증을 실행한다.
10. 실패하면 1회 자동 수정 후 재검증한다.
11. 결과 요약, 생성 파일, 검증 상태를 Agent View에 표시한다.

## Step View 동작 흐름

1. `DECISIONS.md`를 step 단위로 파싱해 목록을 만든다.
2. 사용자가 여러 step을 선택한다.
3. 선택한 step, `AGENT.md`, 최근 구현 요약을 기반으로 튜토리얼 생성을 요청한다.
4. 응답이 형식 검증을 통과하면 `.ai-tutorials/*.md`로 저장한다.
5. 저장한 문서를 VS Code 에디터에서 바로 연다.

## 실행 방법

### 개발 환경

```bash
npm install
npm run compile
```

이후 VS Code에서 이 저장소를 열고 `F5`를 눌러 Extension Development Host를 실행하면 된다.

### 확장 사용

1. 사이드바의 `Debtcrasher` 아이콘을 연다.
2. `Agent View`에서 개발 요청을 입력한다.
3. planning 질문에 답하고 구현을 시작한다.
4. 필요하면 `Step View`에서 판단 기록을 복습용 문서로 변환한다.

## 설정

VS Code 설정에서 다음 항목을 사용한다.

- `debtcrasher.provider`
- `debtcrasher.anthropicApiKey`
- `debtcrasher.anthropicModel`
- `debtcrasher.geminiApiKey`
- `debtcrasher.geminiModel`
- `debtcrasher.openaiApiKey`
- `debtcrasher.openaiModel`
- `debtcrasher.deepseekApiKey`
- `debtcrasher.deepseekModel`
- `aiStepDev.questionFilterLevel`

## 워크스페이스에 생성되는 파일

이 파일들은 확장 저장소가 아니라, Debtcrasher를 실행한 대상 워크스페이스에 생성된다.

- `DECISIONS.md`
- `AGENT.md`
- `.ai-tutorials/*.md`
- `.ai-sessions/*.json`

## 참고 사항

- 확장 구조는 Continue의 VS Code 확장 계층 분리 방식을 참고했다.
- Debtcrasher의 차별점은 planning gate, 결정 메모리 구조, Step 기반 학습 문서화 흐름에 있다.

## 라이선스

Apache-2.0
