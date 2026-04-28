# Debtcrasher 전체 코드 설명서

이 문서는 **이 코드를 한 번도 본 적 없는 사람**이 읽어도 전체 구조와 실행 흐름을 따라갈 수 있도록 작성한 설명서다.

의도는 두 가지다.

1. `README.md`에 있는 핵심 소개를 그대로 보존한다.
2. 실제 소스 코드 기준으로 "어디서 시작해서, 어떤 서비스가 움직이고, 어떤 파일이 생성되며, 프런트엔드와 백엔드가 어떻게 연결되는지"를 더 자세히 풀어쓴다.

---

## 먼저 짚고 갈 점

이 프로젝트는 일반적인 웹 서비스처럼 `frontend 앱 + backend 서버` 구조가 아니다.

Debtcrasher는 **VS Code 확장(Extension)** 이고, 그 안에 두 층이 같이 들어 있다.

- **Frontend**
  - VS Code 사이드바 안에서 보이는 Webview UI
  - `Agent View`, `Step View`
  - HTML/CSS/바닐라 JavaScript로 렌더링된다.

- **Backend**
  - VS Code Extension Host에서 도는 TypeScript 코드
  - 파일 읽기/쓰기, AI API 호출, 검증 명령 실행, 세션 저장, 로그 관리 등을 담당한다.

- **외부 서비스**
  - Anthropic / Google Gemini / OpenAI / DeepSeek API
  - Debtcrasher 자체 서버는 없고, 필요할 때 외부 AI API를 직접 호출한다.

즉, 이 프로젝트를 이해할 때는 "웹앱 서버"가 아니라 "VS Code 확장 내부의 프런트엔드와 확장 호스트 백엔드"라는 관점으로 보는 것이 맞다.

---

## 한눈에 보는 아키텍처

```text
사용자
  -> VS Code Sidebar
     -> Agent View / Step View (Webview UI)
        -> postMessage
           -> Extension Host (TypeScript)
              -> DebtcrasherExtension
                 -> AgentViewController
                 -> StepViewController
                 -> AIClient
                 -> WorkspaceContextService
                 -> LogManager
                 -> VerificationService
                 -> SessionHistoryService
                    -> 워크스페이스 파일 시스템
                       -> DECISIONS.md
                       -> AGENT.md
                       -> .ai-tutorials/*.md
                       -> .ai-sessions/*.json
                    -> 외부 AI API
                       -> Anthropic / Gemini / OpenAI / DeepSeek
```

---

## README 원문 복사

아래는 현재 `README.md`의 핵심 내용을 이 문서에 옮긴 것이다.

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

---

## 이 프로젝트를 한 문장으로 설명하면

Debtcrasher는 **"AI가 코드를 생성해 주는 개발 에이전트"와 "개발자가 내린 중요한 판단을 나중에 다시 학습 가능한 문서로 남기는 도구"를 하나의 VS Code 확장으로 결합한 프로젝트**다.

보통의 AI 코딩 도구는 "무엇을 만들까?"보다 "어떻게 빨리 만들까?"에 집중한다. 반면 Debtcrasher는 구현 이전에 꼭 필요한 구조적 질문을 먼저 제시하고, 그 답을 남기고, 이후에는 그 기록을 바탕으로 다음 작업과 학습 문서 생성을 이어간다.

즉, 단순 자동완성 도구가 아니라:

- 계획 유도
- 결정 기록
- 코드 생성
- 검증
- 재시도
- 학습 문서화

까지를 한 번에 다루는 흐름 중심 도구라고 보면 된다.

---

## 리포지토리 구조

```text
debtcrasher/
├─ media/
│  ├─ agent.css
│  ├─ step.css
│  ├─ agent-icon.svg
│  ├─ step-icon.svg
│  └─ sidebar-icon.svg
├─ src/
│  ├─ activation/
│  │  └─ activateDebtcrasher.ts
│  ├─ context/
│  │  └─ WorkspaceContextService.ts
│  ├─ extension/
│  │  └─ DebtcrasherExtension.ts
│  ├─ verification/
│  │  └─ VerificationService.ts
│  ├─ agentView.ts
│  ├─ aiClient.ts
│  ├─ extension.ts
│  ├─ logManager.ts
│  ├─ sessionHistory.ts
│  ├─ stepView.ts
│  └─ viewIds.ts
├─ README.md
├─ package.json
├─ tsconfig.json
└─ out/
```

---

## 기술 스택

| 항목 | 사용 기술 | 설명 |
| --- | --- | --- |
| 언어 | TypeScript | 프런트엔드 웹뷰 스크립트와 확장 호스트 로직 모두 TypeScript 중심 |
| 실행 환경 | VS Code Extension Host | 일반 웹 서버가 아니라 VS Code 확장 런타임에서 동작 |
| UI 렌더링 | VS Code Webview + HTML + CSS + 바닐라 JavaScript | React/Vue 같은 프레임워크 없이 직접 DOM 조작 |
| 스타일링 | `media/agent.css`, `media/step.css` | VS Code 테마 변수와 Codicons를 활용 |
| 아이콘 | `@vscode/codicons` | 상태 아이콘, 버튼 아이콘, 진행 상황 아이콘 |
| 빌드 | TypeScript Compiler (`tsc`) | `npm run compile`로 `out/` 생성 |
| 외부 AI 연동 | Anthropic / Gemini / OpenAI / DeepSeek | `fetch`로 직접 API 호출 |
| 저장 방식 | 로컬 파일 기반 | `DECISIONS.md`, `AGENT.md`, `.ai-tutorials`, `.ai-sessions` |
| 검증 방식 | 워크스페이스 스크립트/컴파일 명령 자동 감지 | Node 우선, 없으면 Python/Go/Rust/쉘로 fallback |
| 설정 관리 | VS Code Settings + Secret Storage | 모델 선택과 API 키 저장 |

### `package.json` 기준 의존성

- 런타임 의존성
  - `@vscode/codicons`

- 개발 의존성
  - `typescript`
  - `@types/node`
  - `@types/vscode`

### `tsconfig.json` 기준 컴파일 설정

- `target`: `ES2022`
- `module`: `commonjs`
- `rootDir`: `src`
- `outDir`: `out`
- `strict`: `true`
- `noImplicitOverride`: `true`

이 설정만 봐도 이 프로젝트가 비교적 보수적이고 읽기 쉬운 TypeScript 확장 구조를 지향한다는 것을 알 수 있다.

---

## 이 프로젝트에서 frontend / backend를 어떻게 봐야 하는가

### Frontend

이 프로젝트의 frontend는 브라우저 앱이 아니라 **VS Code Webview UI**다.

구성 요소는 크게 두 개다.

1. `Agent View`
   - 사용자가 개발 요청을 입력
   - planning 질문에 답변
   - 구현 결과와 검증 결과를 확인
   - 세션 히스토리를 탐색

2. `Step View`
   - `DECISIONS.md`에서 읽어온 step을 선택
   - 선택한 step 기반으로 튜토리얼 문서를 생성
   - 저장된 `.ai-tutorials/*.md` 파일을 다시 열기

이 UI는 모두 `getHtml()` 내부에서 HTML 문자열을 만들고, `<script>` 태그 안의 바닐라 JavaScript가 `postMessage`를 통해 확장 백엔드와 통신하는 방식이다.

### Backend

이 프로젝트의 backend는 별도 서버가 아니다. **VS Code Extension Host에서 실행되는 TypeScript 코드**가 백엔드 역할을 한다.

이 백엔드가 하는 일:

- 사용자 요청 수신
- workspace 스냅샷 생성
- `AGENT.md`, `DECISIONS.md` 읽기/쓰기
- AI 모델 호출
- 생성 파일을 실제 디스크에 쓰기
- 검증 명령 실행
- 실패 시 1회 자동 수정
- 세션 JSON 저장

### 외부 API

Debtcrasher는 자체 백엔드 서버가 없는 대신, 필요할 때 외부 AI API를 직접 호출한다.

- Anthropic
- Google Gemini
- OpenAI
- DeepSeek

즉, "내부 백엔드"는 VS Code 확장 호스트이고, "원격 처리"는 외부 AI API가 담당한다고 보면 된다.

---

## 가장 중요한 실행 흐름

이 프로젝트의 핵심은 결국 `Agent View -> planning -> decision log -> implementation -> verification -> tutorial generation` 흐름이다.

아래 순서로 이해하면 전체 코드가 훨씬 잘 보인다.

### 1. VS Code가 확장을 활성화한다

- 진입점: `src/extension.ts`
- 실제 부트스트랩: `src/activation/activateDebtcrasher.ts`

여기서 `activateDebtcrasher()`가 호출되고 `DebtcrasherExtension` 인스턴스가 만들어진다.

### 2. `DebtcrasherExtension`이 모든 서비스를 조립한다

- 위치: `src/extension/DebtcrasherExtension.ts`

이 클래스는 사실상 전체 시스템의 조립자다.

여기서 생성되는 주요 객체:

- `LogManager`
- `AIClient`
- `WorkspaceContextService`
- `VerificationService`
- `SessionHistoryService`
- `AgentViewController`
- `StepViewController`

또한:

- Activity Bar 컨테이너 연결
- Webview provider 등록
- 명령 등록
- 상태바 버튼 생성

까지 수행한다.

### 3. Agent View가 사용자 입력을 받는다

- 위치: `src/agentView.ts`

사용자가 개발 요청을 입력하면 프런트엔드 Webview가 `submitTask` 메시지를 백엔드로 보낸다.

### 4. 백엔드는 planning에 필요한 문맥을 모은다

여기서 여러 서비스가 동시에 의미를 갖기 시작한다.

- `WorkspaceContextService`
  - 요청과 관련된 파일 위주로 스냅샷 생성

- `LogManager`
  - `AGENT.md` 등 프로젝트 가이드 읽기
  - 과거 결정 패턴 요약

- `SessionHistoryService`
  - 이전 세션이 있으면 resume context 생성

### 5. `AIClient.generatePlan()`이 planning 질문을 만든다

planning 응답은 JSON 구조를 강제한다.

- `summary`
- `assumptions`
- `questions`

그리고 질문 수는 최대 3개로 제한된다.

### 6. 사용자가 질문에 답하면 결정이 기록된다

구현 시작 버튼을 누르면:

- `DECISIONS.md`에 로그 추가
- `AGENT.md` 갱신

이후부터는 "이미 결정된 내용"으로 간주되므로 다음 planning에서 반복 질문을 줄일 수 있다.

### 7. `AIClient.generateImplementation()`이 구현 결과를 만든다

AI는 파일 설명과 내용이 포함된 JSON을 반환한다.

그 결과를 `writeImplementationFiles()`가 실제 워크스페이스에 쓴다.

### 8. `VerificationService`가 자동 검증을 시도한다

가능한 검증 명령을 자동 탐지해서 실행한다.

- Node 프로젝트면 `compile`, `build`, `typecheck`, `check`, `test`
- 아니면 Python/Go/Rust/쉘 스크립트 fallback

### 9. 실패하면 1회 자동 수정한다

검증 실패 시:

- 실패 로그를 다시 AI에 전달
- 최소 수정 패치만 요청
- 파일 반영
- 재검증 실행

### 10. Step View가 판단 로그를 학습 문서로 바꾼다

이 흐름은 별도지만 Debtcrasher의 차별점이다.

- `DECISIONS.md`에서 선택한 step들
- `AGENT.md`
- 최신 구현 요약

을 함께 써서 markdown 튜토리얼을 생성하고 `.ai-tutorials/`에 저장한다.

---

## 주요 파일별 역할

| 파일 | 역할 | 처음 읽을 때 포인트 |
| --- | --- | --- |
| `src/extension.ts` | VS Code 확장 진입점 | `activate()`에서 어디로 넘기는지 |
| `src/activation/activateDebtcrasher.ts` | 확장 부트스트랩 | 개발 모드에서 자동으로 사이드바를 여는지 |
| `src/extension/DebtcrasherExtension.ts` | 전체 오케스트레이션 | 서비스 생성, provider 등록, command 등록 |
| `src/agentView.ts` | Agent View 전체 흐름 | planning, 구현, 검증, 세션 저장의 중심 |
| `src/stepView.ts` | Step View 전체 흐름 | step 선택, 튜토리얼 생성, 히스토리 열기 |
| `src/aiClient.ts` | AI 모델 호출과 프롬프트 관리 | planning / implementation / repair / tutorial 분리 |
| `src/context/WorkspaceContextService.ts` | 관련 파일 스냅샷 생성 | 프롬프트 예산을 아끼기 위한 랭킹 로직 |
| `src/logManager.ts` | 결정 로그와 프로젝트 가이드 관리 | `DECISIONS.md`, `AGENT.md`, `.ai-tutorials` |
| `src/verification/VerificationService.ts` | 검증 명령 탐지와 실행 | 어떤 프로젝트든 최소한의 검증 루프를 돌리려는 의도 |
| `src/sessionHistory.ts` | 세션 JSON 저장과 복원 | resume 흐름과 `.gitignore` 처리 |
| `media/agent.css` | Agent View 스타일 | progress bubble, planning card, history pane |
| `media/step.css` | Step View 스타일 | split view, selection, history list |

---

## 프런트엔드 상세 설명

### Agent View가 하는 일

Agent View는 이 프로젝트의 메인 작업 공간이다.

화면 기능을 나누면:

1. 상단바
   - Agent View 표시
   - 새 세션 버튼
   - 현재 모델/워크스페이스 상태 표시

2. 채팅 모드
   - 사용자가 작업 요청 입력
   - planning 질문 렌더링
   - 진행 상황 bubble 표시
   - 최종 구현 결과와 검증 결과 표시

3. 히스토리 모드
   - 저장된 세션 목록 표시
   - 이전 세션 내용을 읽기 전용으로 복원
   - 이어서 작업할 세션 선택

### Step View가 하는 일

Step View는 "결정 로그 브라우저 + 튜토리얼 생성기"에 가깝다.

화면이 위아래로 분리되어 있다.

- 위쪽: `DECISIONS.md`에서 파싱한 step 목록
- 아래쪽: 저장된 `.ai-tutorials/*.md` 기록

여기서 사용자는:

- step 여러 개 선택
- 전체 선택 / 선택 해제
- 문서 생성
- 저장된 markdown 다시 열기

를 할 수 있다.

### 프런트엔드가 백엔드와 통신하는 방식

전형적인 Webview 패턴을 사용한다.

- 프런트엔드: `vscode.postMessage(...)`
- 백엔드: `webview.onDidReceiveMessage(...)`
- 백엔드 -> 프런트엔드: `webview.postMessage(...)`

즉, REST API나 WebSocket이 아니라 **VS Code Webview message bridge**를 사용한다.

---

## 백엔드 상세 설명

### 1. 활성화 계층

#### `src/extension.ts`

역할은 매우 단순하다.

- VS Code가 확장을 로드할 때 `activate()` 호출
- 실제 로직은 `activateDebtcrasher()`로 위임

이 파일은 진입점 역할만 하고, 확장 로직은 숨기지 않는다.

#### `src/activation/activateDebtcrasher.ts`

여기서 중요한 점은:

- `DebtcrasherExtension`을 만들고
- 개발 모드면 자동으로 열어주고
- 배포 모드면 처음 한 번만 환영 메시지를 보여준다는 것

즉, 확장 생애주기의 아주 초입을 담당한다.

### 2. 오케스트레이터 계층

#### `src/extension/DebtcrasherExtension.ts`

이 파일은 구조적으로 매우 중요하다.

이 클래스는 스스로 복잡한 비즈니스 로직을 가지기보다는:

- 서비스 인스턴스를 만들고
- Agent View / Step View를 연결하고
- 명령을 등록하고
- 상태바 항목을 보여주는

조립 중심 클래스다.

이렇게 분리되어 있어서 이후 기능이 늘어나도 서비스 단위로 읽기 쉽다.

### 3. Agent View 컨트롤러

#### `src/agentView.ts`

이 파일이 사실상 Debtcrasher의 핵심이다.

이 안에 들어 있는 주요 책임:

- Webview HTML 생성
- Webview 메시지 처리
- planning 세션 임시 보관
- 구현 시작
- 검증 실행
- 자동 수정
- 세션 저장
- 이전 세션 복원

이 파일 하나만 읽어도 사용자가 어떤 경험을 하게 되는지 거의 다 알 수 있다.

특히 중요한 메서드:

- `handleSubmitTask()`
- `handleStartImplementation()`
- `finishTask()`
- `writeImplementationFiles()`
- `runVerificationWithProgress()`

### 4. AI 계층

#### `src/aiClient.ts`

AIClient는 크게 네 가지 모드로 분리되어 있다.

1. `generatePlan()`
   - 구현 전에 필요한 질문과 가정을 만든다.

2. `generateImplementation()`
   - 확정된 판단을 바탕으로 실제 파일 결과를 만든다.

3. `repairImplementation()`
   - 검증 실패 후 최소 수정만 수행하도록 요청한다.

4. `generateTutorial()`
   - step 로그를 학습용 markdown 문서로 바꾼다.

이 클래스에서 특히 중요한 설계 포인트는 "모든 응답을 JSON 또는 구조화된 텍스트로 강제한다"는 점이다.

그 이유는:

- Agent View가 UI에 안정적으로 렌더링하려면 구조가 필요하고
- 실제 파일 쓰기를 하려면 파일 목록과 내용이 분리되어야 하며
- repair 단계에서 변경 파일만 좁게 받고 싶기 때문이다.

### 5. 컨텍스트 스냅샷 계층

#### `src/context/WorkspaceContextService.ts`

이 서비스는 LLM에게 무작정 전체 프로젝트를 던지지 않기 위해 존재한다.

핵심 동작:

- 워크스페이스 파일 검색
- `node_modules`, `.git`, `out`, `dist`, `.ai-tutorials` 등 제외
- task 문자열에서 키워드 추출
- 파일 경로와 파일 프리뷰에서 키워드 매칭 점수 계산
- 핵심 설정 파일 우선 포함
- 최대 파일 수 / 인라인 프리뷰 수 / 전체 문자 수 예산에 맞게 스냅샷 구성

즉, "LLM 컨텍스트 절약기"이자 "관련 파일 선별기"다.

### 6. 로그와 캐시 계층

#### `src/logManager.ts`

이 서비스는 Debtcrasher의 정체성을 가장 잘 보여준다.

주요 책임:

- `DECISIONS.md` 생성 및 append
- `DECISIONS.md` 파싱
- `AGENT.md` 자동 생성/갱신
- `.ai-tutorials` 저장
- 과거 결정 패턴 요약
- 최신 구현 요약 읽기

여기서 특히 중요한 점은 `AGENT.md`가 단순 문서가 아니라 **압축 캐시**로 쓰인다는 것이다.

`renderProjectGuide()`를 보면 `AGENT.md` 안에는 다음이 들어간다.

- Agent Behavior Rules
- Confirmed Decisions
- Implied Constraints
- Most Recent Context
- Do not ask again

즉, 다음 planning 단계에서 "다시 묻지 말아야 할 것"과 "이미 확정된 것"을 빠르게 알려 주는 일종의 프로젝트 기억 장치다.

### 7. 검증 계층

#### `src/verification/VerificationService.ts`

이 서비스는 구현 후 바로 끝내지 않고 최소한의 실행 검증을 붙인다.

동작 순서:

1. `package.json` 확인
2. 스크립트 중 `compile`, `build`, `typecheck`, `check`, `test` 감지
3. 패키지 매니저 자동 추론
4. 스크립트가 없으면 Python/Go/Rust/쉘 스크립트 fallback
5. `child_process.spawn()`으로 실행
6. 타임아웃, abort, 출력 길이 제한 관리

즉, 프로젝트 종류를 조금이라도 감지해서 "최소 검증 루프"를 만들려는 서비스다.

### 8. 세션 히스토리 계층

#### `src/sessionHistory.ts`

이 서비스는 Agent View 대화를 `.ai-sessions/*.json`에 저장한다.

주요 기능:

- 새 세션 객체 생성
- JSON 저장
- 최근 세션 목록 반환
- 특정 세션 로드
- 오늘 가장 최근 세션 로드
- resume용 한 줄 컨텍스트 생성
- `.gitignore`에 `.ai-sessions/` 자동 추가
- 50개 초과 세션 정리

즉, 단순 채팅 기록 보관이 아니라 "이전 작업을 이어서 개발할 수 있는 상태 저장"에 가깝다.

---

## 데이터 파일이 어떻게 쓰이는가

### `DECISIONS.md`

이 파일은 전체 판단 로그다.

포맷은 step 단위다.

```md
## Step: [제목]
**Date**: ...
**Question**: ...
**Option A**: ...
**Option B**: ...
**User chose**: ...
**Outcome**: ...
```

이 포맷 덕분에:

- 사람이 읽기 쉽고
- `Step View`가 다시 파싱하기 쉽고
- step별 학습 문서 생성에도 바로 재사용할 수 있다.

### `AGENT.md`

이 파일은 현재 프로젝트 판단 상태를 압축해 둔 캐시다.

목적:

- 다음 planning에서 중복 질문 줄이기
- 이전 선택을 빠르게 반영하기
- "이 프로젝트는 어떤 방향으로 굳어졌는가"를 AI가 빠르게 읽게 하기

### `.ai-tutorials/*.md`

Step View에서 생성되는 학습 문서다.

특징:

- 일반 markdown 파일
- VS Code 에디터에서 바로 열림
- Webview 내부 미리보기 상태를 오래 들고 있지 않음

### `.ai-sessions/*.json`

Agent View의 대화와 진행 상태를 저장한다.

들어가는 정보:

- 사용자 메시지
- planning 질문과 선택 내용
- 구현 결과 요약
- 생성 파일 목록
- 검증 결과
- 상태 메시지

---

## 실제 코드 흐름을 단계별로 해설

### 1. 확장 활성화

`src/extension.ts`에서:

```ts
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await activateDebtcrasher(context);
}
```

여기서는 아무 판단도 하지 않고, 부트스트랩 함수로 넘긴다.

### 2. 확장 조립

`src/extension/DebtcrasherExtension.ts`에서:

```ts
this.logManager = new LogManager();
this.aiClient = new AIClient(context.secrets);
this.workspaceContextService = new WorkspaceContextService();
this.verificationService = new VerificationService();
this.sessionHistoryService = new SessionHistoryService(() => this.logManager.getWorkspaceRootUri());
this.agentView = new AgentViewController(
  context,
  this.aiClient,
  this.logManager,
  this.workspaceContextService,
  this.verificationService,
  this.sessionHistoryService
);
this.stepView = new StepViewController(context, this.aiClient, this.logManager);
```

이 코드가 의미하는 것은 매우 단순하다.

- `DebtcrasherExtension`은 모든 서비스의 조립 지점이다.
- `AgentViewController`는 거의 모든 백엔드 서비스를 주입받는다.
- `StepViewController`는 상대적으로 단순해서 `AIClient`와 `LogManager`만 필요하다.

### 3. Agent View 프런트엔드 골격

`src/agentView.ts`의 `getHtml()` 안에는 다음과 같은 구조가 있다.

```ts
<section id="chatPane" class="pane pane-chat">
  <main id="thread" class="thread" aria-live="polite">${initialThreadHtml}</main>

  <form id="inputForm" class="composer">
    <label for="userInput" class="composer-label">개발 요청</label>
    <textarea id="userInput" class="input-box" rows="4"></textarea>
    <div class="composer-footer">
      <button type="submit" id="sendBtn" class="send-btn" title="전송">${planeIcon}</button>
    </div>
  </form>
</section>
```

이 코드는 Agent View가 결국:

- 채팅 스레드
- 입력창
- 전송 버튼

중심의 UI라는 것을 보여준다.

다만 일반 챗 UI와 다른 점은, 여기에 planning 카드와 progress bubble, verification 결과, history 탐색까지 붙는다는 점이다.

### 4. planning 카드 렌더링

같은 파일에서 planning 질문은 이런 식으로 렌더링된다.

```ts
function renderQuestions(plan) {
  if (!plan.questions || plan.questions.length === 0) {
    return '<div class="summary-card"><p class="tradeoff-title">질문</p><p>추가로 직접 결정할 항목이 없습니다.</p></div>';
  }

  return '<div class="planning-questions">' + plan.questions.map((question, index) => [
    '<section class="planning-question" data-question-id="' + escapeHtml(question.id) + '">',
    '  <div class="planning-question-head">',
    '    <div class="planning-question-copy">',
    '      <p class="decision-point-label">Q' + (index + 1) + ' · ' + escapeHtml(question.topic) + '</p>',
    '      <h2>' + escapeHtml(question.question) + '</h2>',
    '    </div>',
    '    <span class="impact-badge impact-' + escapeHtml((question.impact || '').toLowerCase()) + '">' + escapeHtml(question.impact) + '</span>',
    '  </div>',
    '  <div class="options-grid">',
    renderOptionHtml(question.id, 'A', question.optionA, false),
    renderOptionHtml(question.id, 'B', question.optionB, false),
    '  </div>',
    '</section>'
  ].join('')).join('') + '</div>';
}
```

여기서 알 수 있는 점:

- 질문은 단순 텍스트가 아니라 구조화된 카드로 출력된다.
- 각 질문에는 `impact`가 붙는다.
- A/B 선택지와 직접 입력(custom choice)이 함께 지원된다.
- 이 시점부터 Agent View는 "대화창"이라기보다 "결정 인터페이스"에 가까워진다.

### 5. planning 요청 처리 백엔드

`handleSubmitTask()`는 Agent View의 첫 번째 핵심 메서드다.

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
const plan = await this.aiClient.generatePlan(
  task,
  workspaceContext,
  referenceContext,
  patternContext,
  resumeContext,
  abortController.signal
);
```

이 코드는 planning이 단순히 "사용자 문장 하나"만 보고 생성되는 것이 아니라는 점을 보여준다.

planning에 들어가는 재료:

- 현재 task
- 관련 파일 스냅샷
- `AGENT.md` 같은 프로젝트 가이드
- 과거 decision pattern
- 이전 세션 resume context

즉, 이 프로젝트의 planning은 상당히 문맥 지향적이다.

### 6. 구현 시작 시 결정 기록

구현 시작 버튼을 누르면 `handleStartImplementation()`이 실행되고 먼저 아래 작업을 한다.

```ts
await this.logManager.appendDecisions(resolved.logEntries);
this.postProgress(message.requestId, 'log_done');
await this.logManager.syncProjectGuide(session.task);
this.postProgress(message.requestId, 'agent_updated');
```

이 순서가 중요한 이유는:

- 먼저 기록한다.
- 그 다음 캐시를 갱신한다.
- 그 다음 구현으로 간다.

즉, Debtcrasher는 "기억을 남긴 뒤 구현한다"는 순서를 의도적으로 강제한다.

### 7. 실제 파일 쓰기

`writeImplementationFiles()`는 AI 응답을 실제 파일로 반영하는 함수다.

```ts
const normalizedPath = normalizeRelativePath(file.path);
const segments = normalizedPath.split('/');
...
await vscode.workspace.fs.writeFile(targetUri, textEncoder.encode(file.content));
```

여기서 중요한 점:

- 상대 경로 정규화
- 디렉터리 생성
- 실제 파일 쓰기
- 새 파일 생성과 기존 파일 수정에 따라 progress 이벤트 분리

즉, 단순히 결과를 보여주는 것이 아니라 워크스페이스에 바로 반영하는 "실행형 에이전트"다.

### 8. 결정 로그 렌더링 포맷

`src/logManager.ts`의 `renderLogBlock()`은 `DECISIONS.md`의 포맷을 만드는 가장 직관적인 코드다.

```ts
private renderLogBlock(entry: DecisionLogEntryInput): string {
  return [
    `## Step: ${entry.title}`,
    `**Date**: ${entry.date}`,
    `**Question**: ${collapseLine(entry.question)}`,
    `**Option A**: ${collapseLine(entry.optionA)}`,
    `**Option B**: ${collapseLine(entry.optionB)}`,
    `**User chose**: ${collapseLine(entry.userChoice)}`,
    `**Outcome**: ${collapseLine(entry.outcome)}`
  ].join('\n');
}
```

이 포맷은 단순하지만 아주 중요하다.

- 사람이 읽기 쉬움
- 정규식 파싱 쉬움
- Step View가 재사용하기 쉬움
- AGENT.md 갱신 재료로도 사용 가능

### 9. 자동 검증

`VerificationService`는 다음 우선순위로 검증 명령을 고른다.

```ts
const buildScript = BUILD_SCRIPT_PRIORITY.find((scriptName) => typeof scripts[scriptName] === 'string');
...
const testScript = TEST_SCRIPT_PRIORITY.find((scriptName) => {
  const script = scripts[scriptName];
  return typeof script === 'string' && isSafeTestScript(script);
});
```

즉, 무작정 `npm test`를 돌리는 게 아니라:

- 존재하는지 확인하고
- watch/serve/open 계열 위험 스크립트는 피하고
- 비교적 안전한 검증 명령만 고른다.

### 10. Step View의 튜토리얼 생성

`src/stepView.ts`의 `handleGenerateTutorial()`은 다음 순서로 동작한다.

1. 선택한 step ID를 실제 로그 엔트리로 변환
2. `AGENT.md`와 최신 구현 요약 읽기
3. `AIClient.generateTutorial()` 호출
4. markdown 저장
5. 파일을 에디터에서 열기

즉, Step View는 단순 viewer가 아니라 "과거 결정 -> 학습 문서" 변환기다.

---

## `AGENT.md`가 중요한 이유

처음 코드를 읽는 사람은 `DECISIONS.md`만 보면 충분하다고 생각할 수 있다.

하지만 실제로는 `AGENT.md`가 훨씬 중요하다.

이유:

1. `DECISIONS.md`는 전체 로그다.
2. 로그는 길어진다.
3. planning 단계에서 매번 전체 로그를 길게 읽는 것은 비효율적이다.
4. 그래서 `AGENT.md`가 "현재 프로젝트의 확정된 규칙과 맥락"을 압축해서 담는다.

`renderProjectGuide()`를 보면 `AGENT.md`에 다음 정보가 들어간다.

- Agent Behavior Rules
- Confirmed Decisions
- Implied Constraints
- Most Recent Context
- Do not ask again

결론적으로 Debtcrasher는:

- `DECISIONS.md`를 장기 기억
- `AGENT.md`를 단기/압축 기억

처럼 쓰고 있다.

이 구조가 planning 반복 질문을 줄이는 핵심이다.

---

## 워크스페이스 스냅샷이 왜 필요한가

LLM 기반 개발 도구는 흔히 "프로젝트 전체를 프롬프트에 넣고 싶다"는 유혹이 있다.

하지만 실제로는:

- 토큰이 낭비되고
- 관련 없는 파일이 섞이고
- 중요한 파일이 오히려 묻힌다.

Debtcrasher는 이 문제를 `WorkspaceContextService`로 푼다.

핵심 전략:

- task 키워드 추출
- 파일 경로와 파일 내용 프리뷰를 점수화
- 설정 파일 우선 보존
- 최근 수정된 파일이 아니라 "task 관련 파일"을 우선
- 문자 수 예산 내에서만 전달

이것은 작은 구현처럼 보이지만 실제로는 LLM 도구 품질에 큰 영향을 주는 부분이다.

---

## 검증과 자동 수정 루프가 왜 중요한가

Debtcrasher는 구현 결과를 생성한 뒤 그냥 끝내지 않는다.

다음 세 단계를 시도한다.

1. 검증 명령 탐지
2. 실행
3. 실패 시 1회 자동 수정 후 재검증

이 구조 덕분에 사용자는:

- "모델이 뭔가 만들어 줬다" 수준이 아니라
- "최소한 컴파일/체크를 시도한 결과"를 받게 된다.

특히 `finishTask()`는 이 흐름을 거의 한 메서드 안에서 보여준다.

- 구현 생성
- 파일 쓰기
- 검증 실행
- repair 실행
- 재검증
- AGENT.md 갱신
- 결과 메시지 저장

즉, Debtcrasher의 실제 가치 중 하나는 "생성"이 아니라 "생성 후 후속 처리"다.

---

## 세션 히스토리가 왜 별도 서비스인가

보통 채팅 히스토리는 UI 상태로만 들고 끝나는 경우가 많다.

하지만 이 프로젝트는 `.ai-sessions/*.json`으로 저장한다.

이렇게 한 이유는 분명하다.

- VS Code를 닫았다 다시 열어도 이어갈 수 있어야 함
- 이전 작업 과정을 다시 읽을 수 있어야 함
- "이어서 개발"이라는 개념이 있어야 함

또한 `SessionHistoryService`는 `.gitignore`에 `.ai-sessions/`를 자동 추가한다.

이 점도 중요하다.

- 세션은 로컬 작업 상태이지
- 일반적으로 Git에 올릴 산출물은 아니기 때문이다.

---

## 프런트엔드 스타일링 포인트

`media/agent.css`와 `media/step.css`를 보면 UI 방향성도 꽤 분명하다.

특징:

- VS Code 테마 변수 사용
- 단순 평면 배경이 아니라 약한 radial gradient 사용
- 라운드 패널 중심 레이아웃
- progress bubble로 작업 단계 시각화
- 모바일 폭도 일부 고려한 반응형 스타일

즉, Webview UI가 완전히 기본 스타일은 아니고, "VS Code 안에 자연스럽게 섞이되 상태 변화는 명확하게 보이게" 디자인되어 있다.

---

## 초심자가 코드 읽을 때 추천 순서

이 프로젝트를 처음 읽는다면 아래 순서를 추천한다.

1. `README.md`
2. `src/extension.ts`
3. `src/activation/activateDebtcrasher.ts`
4. `src/extension/DebtcrasherExtension.ts`
5. `src/agentView.ts`
6. `src/aiClient.ts`
7. `src/logManager.ts`
8. `src/context/WorkspaceContextService.ts`
9. `src/verification/VerificationService.ts`
10. `src/sessionHistory.ts`
11. `src/stepView.ts`
12. `media/agent.css`, `media/step.css`

이 순서가 좋은 이유:

- 먼저 실행 진입점을 본다.
- 그 다음 전체 조립 구조를 본다.
- 그 다음 핵심 사용자 흐름인 Agent View를 본다.
- 이후 supporting service를 붙여서 이해한다.
- 마지막에 Step View와 CSS를 보면 전체 그림이 마무리된다.

---

## 이 프로젝트의 설계 의도 요약

Debtcrasher는 단순히 "AI가 코드를 써 주는 도구"가 아니라 아래 세 가지를 묶으려는 프로젝트다.

### 1. 개발 생산성

- 실제 파일 생성
- 실제 파일 수정
- 자동 검증
- 자동 수정

### 2. 판단의 명시화

- planning gate
- 최대 3개의 고레버리지 질문
- 사용자 답변을 로그로 고정

### 3. 학습 자산화

- `DECISIONS.md`
- `AGENT.md`
- `.ai-tutorials/*.md`

이 셋이 함께 있기 때문에 Debtcrasher는 "한 번 만들고 끝나는 코드 생성기"가 아니라 "판단과 구현을 같이 축적하는 도구"가 된다.

---

## 코드 일부 정리

### Frontend 예시 1: Agent View 기본 화면

```ts
<section id="chatPane" class="pane pane-chat">
  <main id="thread" class="thread" aria-live="polite">${initialThreadHtml}</main>

  <form id="inputForm" class="composer">
    <label for="userInput" class="composer-label">개발 요청</label>
    <textarea id="userInput" class="input-box" rows="4"></textarea>
    <div class="composer-footer">
      <button type="submit" id="sendBtn" class="send-btn" title="전송">${planeIcon}</button>
    </div>
  </form>
</section>
```

설명:

- 전형적인 chat shell 구조다.
- 하지만 이후 planning 카드와 검증 결과가 여기에 차곡차곡 쌓인다.

### Frontend 예시 2: planning 질문 렌더링

```ts
function appendPlanningCard(requestId, plan) {
  setMode('chat');
  setPhase(requestId, 'decision');
  ...
  const startButton = message.querySelector('.start-build-button');
  ...
  startButton.addEventListener('click', () => {
    const payloadAnswers = (plan.questions || [])
      .map((question) => answers.get(question.id))
      .filter(Boolean);
```

설명:

- planning 응답을 읽어 질문 카드로 만든다.
- 사용자가 모든 질문에 답해야 구현 버튼이 활성화된다.
- 즉시 구현으로 넘어가지 않는 Debtcrasher의 철학이 UI에도 반영되어 있다.

### Backend 예시 1: planning 전에 문맥 수집

```ts
const workspaceContext = await this.workspaceContextService.buildWorkspaceSnapshot(...);
const referenceContext = await this.logManager.readProjectGuideContext();
const patternContext = await this.logManager.readDecisionPatternContext(task);
const plan = await this.aiClient.generatePlan(
  task,
  workspaceContext,
  referenceContext,
  patternContext,
  resumeContext,
  abortController.signal
);
```

설명:

- 이 프로젝트가 단순 프롬프트 래퍼가 아니라는 점을 보여주는 코드다.
- planning은 항상 현재 프로젝트 문맥과 과거 결정을 함께 참고한다.

### Backend 예시 2: 결정 로그 저장

```ts
private renderLogBlock(entry: DecisionLogEntryInput): string {
  return [
    `## Step: ${entry.title}`,
    `**Date**: ${entry.date}`,
    `**Question**: ${collapseLine(entry.question)}`,
    `**Option A**: ${collapseLine(entry.optionA)}`,
    `**Option B**: ${collapseLine(entry.optionB)}`,
    `**User chose**: ${collapseLine(entry.userChoice)}`,
    `**Outcome**: ${collapseLine(entry.outcome)}`
  ].join('\n');
}
```

설명:

- 이 간단한 포맷이 Step View와 튜토리얼 생성의 기반이 된다.

### Backend 예시 3: 검증 명령 감지

```ts
const buildScript = BUILD_SCRIPT_PRIORITY.find((scriptName) => typeof scripts[scriptName] === 'string');
if (buildScript) {
  commands.push({
    label: buildScript,
    command: `${packageManager} run ${buildScript}`
  });
}
```

설명:

- 검증도 프로젝트 상황에 따라 유연하게 선택된다.
- 단순 고정 명령 실행보다 훨씬 실전적이다.

---

## 새로 들어온 사람이 헷갈리기 쉬운 포인트

### 1. 별도 서버가 없다

이 프로젝트는 Express, Fastify, Nest 같은 백엔드 서버가 없다.

백엔드는 VS Code Extension Host다.

### 2. 프런트엔드도 React가 아니다

웹뷰 UI이긴 하지만 React/Vue/Svelte가 아니라 HTML 문자열 + DOM 조작 기반이다.

### 3. `AGENT.md`는 부수 문서가 아니다

실제로 planning 품질과 중복 질문 방지에 핵심인 캐시다.

### 4. Step View는 부가 기능이 아니라 차별화 기능이다

대부분의 AI 코딩 도구가 놓치는 "결정의 재학습" 부분을 담당한다.

### 5. 세션 저장과 결정 저장은 다르다

- 세션 저장: `.ai-sessions/*.json`
- 결정 저장: `DECISIONS.md`

둘은 목적이 다르다.

---

## 현재 코드에서 보이는 주의점

설명 문서를 쓰면서 보인 점도 남긴다.

### 1. 일부 한국어 문자열 인코딩이 깨진 흔적이 있다

특히 아래 파일의 일부 문자열은 깨져 보이는 구간이 있다.

- `src/aiClient.ts`
- `src/context/WorkspaceContextService.ts`
- `src/stepView.ts`

이건 구조 이해를 막을 정도는 아니지만:

- UI 문구 품질
- tutorial prompt 품질
- 한국어 키워드 매칭 품질

에는 영향을 줄 수 있다.

### 2. 테스트 스크립트보다는 컴파일 중심 구조다

`package.json` 기준으로 현재 제공되는 스크립트는 `compile`, `watch`, `vscode:prepublish` 정도다.

즉, 이 프로젝트는 아직 자동화 테스트 스위트보다 기능 구현과 확장 구조 정리에 더 무게가 실려 있다.

### 3. 핵심 로직이 `agentView.ts`에 많이 모여 있다

이건 현재 단계에서는 장점도 있다.

- 전체 흐름을 한 파일에서 보기 쉽다.

하지만 규모가 더 커지면:

- planning state
- result rendering
- history rendering
- verification UI

등을 더 쪼갤 여지가 있다.

---

## 결론

Debtcrasher는 VS Code 안에서 동작하는 **계획 기반 개발 에이전트**이자 **결정 학습 도구**다.

코드 구조를 가장 간단하게 요약하면:

- `DebtcrasherExtension`이 전체를 조립하고
- `AgentViewController`가 메인 개발 흐름을 담당하며
- `AIClient`가 planning/구현/수정/튜토리얼 생성 모델 호출을 맡고
- `LogManager`가 `DECISIONS.md`와 `AGENT.md`를 유지하며
- `VerificationService`가 자동 검증을 수행하고
- `SessionHistoryService`가 작업 맥락을 이어 주고
- `StepViewController`가 판단 로그를 학습 문서로 바꾼다.

처음 보는 사람이 이 프로젝트를 이해하려면 "코드 생성기"로만 보지 말고, **개발자의 판단을 먼저 고정하고 그 판단을 다시 재사용하게 만드는 확장**으로 이해하는 것이 가장 정확하다.

