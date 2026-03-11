# Debtcrasher

Debtcrasher는 VS Code 안에서 동작하는 개발 에이전트 확장이다.  
일반적인 코딩 에이전트처럼 워크스페이스를 읽고 구현 파일을 생성하지만, 구현 전에 개발자가 직접 고레버리지 판단을 내리게 만들고 그 판단을 다시 학습 가능한 기록으로 남기는 것이 핵심이다.

## 목적

- AI가 당연한 결정까지 독단적으로 밀어붙이는 흐름을 줄인다.
- 같은 질문을 반복하는 문제를 `AGENT.md` 기반 캐시로 줄인다.
- 구현 과정에서 나온 중요한 판단을 `DECISIONS.md`와 튜토리얼 문서로 남긴다.
- 결과적으로 "코드는 AI가 도와주되, 판단은 개발자가 의식적으로 가져가는" 흐름을 만든다.

## 주요 기능

### Agent View

- 사용자 요청을 받으면 먼저 워크스페이스 파일 구조와 기준 문서를 읽는다.
- 첫 턴에는 반드시 고레버리지 질문 1개를 제시한다.
- 이미 `AGENT.md`에 정리된 결정은 다시 묻지 않도록 프롬프트를 강하게 제한한다.
- 질문 수는 요청당 최대 2개까지만 허용하고, 이후에는 바로 구현으로 넘어간다.
- 구현이 시작되면 실제 파일을 생성하고 첫 파일을 VS Code 에디터로 연다.

### Step View

- 지금까지 기록된 decision step 목록을 보여준다.
- 여러 step을 동시에 선택해 학습용 markdown 문서를 생성할 수 있다.
- 생성된 문서는 `.ai-tutorials`에 저장되고, History에서 바로 다시 열 수 있다.
- `Decision Steps`와 `History`는 독립 스크롤과 리사이즈 가능한 레이아웃을 가진다.

## 생성되는 파일

이 확장 자체의 저장소에 기록 파일을 두는 것이 아니라, 확장을 실제로 실행한 **대상 워크스페이스** 안에 아래 파일들이 생성된다.

- `AGENT.md`
  - 압축된 프로젝트 기준 문서
  - 이미 확정된 판단, 암묵 제약, 다시 묻지 말아야 할 항목을 빠르게 읽기 위한 캐시
- `DECISIONS.md`
  - 전체 decision log
  - 세션 동안 내려진 판단의 원문 기록
- `.ai-tutorials/*.md`
  - 선택한 step들을 바탕으로 만든 학습용 문서

## 설정

설정은 Agent View 안에서 직접 바꾸지 않고 **VS Code 확장 설정창**에서 변경한다.

현재 주요 설정:

- `debtcrasher.provider`
- `debtcrasher.anthropicModel`
- `debtcrasher.geminiModel`
- `debtcrasher.openaiModel`
- `debtcrasher.deepseekModel`
- `aiStepDev.questionFilterLevel`

데모 기준으로는 상위 모델을 바로 써볼 수 있도록 OpenAI 기본값을 `gpt-5`로 두었다.

## 동작 원칙

- 질문 전에 반드시 워크스페이스와 `AGENT.md`를 읽는다.
- 이미 결정된 항목과 의미적으로 같은 질문은 다시 하지 않는다.
- 사용자가 언급하지 않은 기능은 질문도 하지 않고 구현에도 넣지 않는다.
- 질문은 아키텍처나 범위에 실질적인 영향을 주는 경우에만 한다.
- 낮은 수준의 세부사항은 sensible default로 처리하고, 필요하면 코드에 `// DEFAULT:` 주석을 남긴다.

## 구조

- [src/activation/activateDebtcrasher.ts](./src/activation/activateDebtcrasher.ts)
  - 확장 활성화 진입점
- [src/extension/DebtcrasherExtension.ts](./src/extension/DebtcrasherExtension.ts)
  - 뷰 등록, 명령 등록, 전체 오케스트레이션
- [src/context/WorkspaceContextService.ts](./src/context/WorkspaceContextService.ts)
  - 워크스페이스 스냅샷 수집
- [src/aiClient.ts](./src/aiClient.ts)
  - 모델 호출, 질문 제어 프롬프트, 구현/튜토리얼 생성
- [src/agentView.ts](./src/agentView.ts)
  - Agent View UI와 메시지 흐름
- [src/stepView.ts](./src/stepView.ts)
  - Step View UI와 history/document 생성 흐름
- [src/logManager.ts](./src/logManager.ts)
  - `AGENT.md`, `DECISIONS.md`, `.ai-tutorials` 관리

## 실행

```bash
npm install
npm run compile
```

그 다음 VS Code에서 이 폴더를 열고 `F5`로 Extension Development Host를 실행하면 된다.

## 라이선스

이 프로젝트는 Apache-2.0 라이선스를 사용한다.  
일부 구조적 아이디어와 계층 분리는 Continue의 공개 구조를 참고했다.
