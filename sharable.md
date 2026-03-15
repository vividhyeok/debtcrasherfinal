# Debtcrasher 구조 공유 문서

## 1. 한 줄 설명

Debtcrasher는 "코드를 대신 작성하는 AI 에이전트"에 "중요한 판단은 개발자가 직접 하게 만드는 planning gate"를 결합한 VS Code 확장이다.

## 2. 왜 이 프로젝트가 필요한가

기존 개발 에이전트는 보통 두 문제를 남긴다.

1. AI가 중요한 아키텍처 판단까지 대신 해 버려서 개발자가 무엇을 왜 선택했는지 체화하지 못한다.
2. 반대로 학습을 강조한 도구는 질문이 너무 잘게 쪼개져 실제 개발 시작이 늦어진다.

Debtcrasher는 이 둘 사이를 조정한다.

- 구현은 AI가 빠르게 한다.
- 하지만 되돌리기 비싼 판단은 사용자가 직접 고른다.
- 그 판단은 세션이 끝나도 사라지지 않고 다시 학습 가능한 문서로 축적된다.

## 3. 시스템 개요

전체 구조는 아래 다섯 계층으로 나뉜다.

```text
VS Code Activation
  -> Extension Orchestrator
     -> Agent View
     -> Step View
     -> AI Client
     -> Workspace Context / Decision Memory / Verification Services
```

### 3-1. Activation 계층

- `src/activation/activateDebtcrasher.ts`
- VS Code가 확장을 켤 때 가장 먼저 진입하는 지점이다.
- 개발 모드에서는 바로 사이드바를 열어 테스트 흐름을 빠르게 한다.

### 3-2. Orchestrator 계층

- `src/extension/DebtcrasherExtension.ts`
- Agent View, Step View, 상태바, 명령 등록을 한곳에서 관리한다.
- Continue 계열 확장의 구조처럼 "활성화"와 "실제 동작 오케스트레이션"을 분리해 뷰와 서비스 결합도를 낮춘다.

### 3-3. Agent View 계층

- `src/agentView.ts`
- 사용자의 자연어 요청을 받아 planning, 구현, 검증, 자동 수정까지 이어지는 메인 실행 루프를 담당한다.

### 3-4. Step View 계층

- `src/stepView.ts`
- `DECISIONS.md`에 쌓인 판단 기록을 보고, 여러 step을 골라 복습용 markdown으로 다시 만드는 흐름을 담당한다.

### 3-5. 서비스 계층

- `src/aiClient.ts`
  - 모델 호출과 prompt 구성
- `src/context/WorkspaceContextService.ts`
  - 워크스페이스 스냅샷 수집
- `src/logManager.ts`
  - `AGENT.md`, `DECISIONS.md`, `.ai-tutorials` 관리
- `src/verification/VerificationService.ts`
  - 안전한 검증 명령 탐지 및 실행

## 4. Agent View 실행 흐름

Debtcrasher의 핵심 로직은 `질문 -> 답 -> 질문 -> 답` 직렬 구조가 아니라 `planning 1회 -> 일괄 응답 -> 즉시 구현` 구조다.

```text
사용자 요청
  -> 워크스페이스 관련 파일 수집
  -> AGENT.md 읽기
  -> DECISIONS.md 기반 판단 패턴 추출
  -> Planning API 호출
  -> 질문 최대 3개를 한 화면에 표시
  -> 사용자가 모두 답변
  -> DECISIONS.md 기록
  -> AGENT.md 갱신
  -> 구현 API 호출
  -> 파일 생성
  -> 자동 검증
  -> 실패 시 1회 자동 수정
  -> 결과 표시
```

### 4-1. Planning 단계

Planning 단계의 목적은 "사용자가 정말 직접 결정해야 할 것만 고르게 만드는 것"이다.

이 단계에서 에이전트는 다음을 먼저 읽는다.

- 현재 자연어 요청
- `AGENT.md`
- 관련성이 높은 워크스페이스 파일 스냅샷
- `DECISIONS.md`에서 추출한 과거 판단 패턴

그 뒤 planning 모델은 JSON 형태로 세 가지를 반환한다.

- `summary`: 이번 요청이 무엇을 만드는지 한 줄 요약
- `assumptions`: 질문하지 않고 기본값으로 처리할 결정들
- `questions`: 사용자에게 직접 물어야 하는 고레버리지 질문들

질문 수는 최대 3개다. 이것이 질문 루프를 제한하는 장치다.

### 4-2. 왜 관련 파일 필터링이 필요한가

초기 구조에서는 워크스페이스 파일을 거의 순서대로 넣기 쉬웠다. 이 방식은 토큰을 낭비하고 planning 품질도 떨어뜨린다.

현재는 `WorkspaceContextService`가 아래 기준으로 파일을 점수화한다.

- 현재 요청 키워드와 경로 매칭
- `package.json`, `tsconfig.json`, `README.md`, `AGENT.md` 같은 앵커 파일
- 직전 구현 파일 경로 우선순위
- 코드/설정 파일 확장자 가중치

즉 "전체 파일 나열"이 아니라 "지금 요청과 관련 있을 가능성이 높은 파일 묶음"을 모델에 전달한다.

### 4-3. 과거 판단 패턴 반영

`logManager.ts`는 `DECISIONS.md` 전체를 읽고 두 가지를 추출한다.

1. 현재 요청과 유사한 과거 판단
2. 반복적으로 나타난 우선순위

예를 들어 사용자가 과거에 계속 "단순함", "빠른 구현", "로컬 우선"을 선택했다면, planning 모델은 이를 현재 요청의 질문 우선순위에만 반영한다.  
중요한 점은 이것이 현재 요청을 덮어쓰는 규칙이 아니라, 질문 후보를 정렬하는 약한 편향이라는 점이다.

## 5. 구현 단계

사용자가 `개발 시작`을 누르면 Agent View는 더 이상 질문하지 않는다.

이 단계에서 하는 일:

1. 선택한 판단을 `DECISIONS.md`에 배치 기록
2. `AGENT.md`를 현재 기준으로 재생성
3. planning 결과와 assumptions를 포함해 구현 프롬프트 생성
4. 실제 파일 생성 및 워크스페이스 저장

이때 남아 있는 저수준 세부사항은 기본값으로 처리하고, 생성 코드 안에 `// DEFAULT:` 주석으로 흔적을 남기게 한다.

## 6. 자동 검증과 자동 수정 루프

이 부분이 이번 구조 보강에서 가장 실용적인 추가점이다.

`VerificationService`는 워크스페이스의 `package.json`을 읽어 안전하게 실행 가능한 검증 명령을 추린다.

- `compile`
- `build`
- `typecheck`
- `check`
- 안전한 `test`

watch 모드, interactive 명령, 의미 없는 기본 test 스크립트는 제외한다.

실행 흐름은 다음과 같다.

```text
구현 완료
  -> 검증 명령 탐지
  -> 검증 실행
  -> 실패하면 출력 캡처
  -> 실패 출력 + 관련 파일 스냅샷으로 repair prompt 생성
  -> 변경 파일만 다시 생성
  -> 검증 1회 재실행
```

여기서 자동 수정은 1회로 제한했다. 이유는 두 가지다.

- 무한 수정 루프를 막기 위해서
- API 비용이 끝없이 늘어나는 상황을 막기 위해서

즉 성능을 높이되 비용 통제도 같이 고려한 구조다.

## 7. Step View의 역할

Step View는 개발을 진행하는 화면이 아니라 판단을 복기하는 화면이다.

현재 구성:

- `Decision Steps`
  - `DECISIONS.md`에서 읽은 판단 목록
  - 여러 step 동시 선택 가능
- `History`
  - 생성된 markdown 문서 목록
  - 클릭 시 VS Code 에디터에서 바로 열림

핵심 목적은 "판단 부채를 기술 부채처럼 방치하지 않는 것"이다.  
개발자는 과거에 왜 그런 선택을 했는지 다시 읽고, 다음 프로젝트에서 비슷한 상황에 재사용할 수 있다.

## 8. 메모리 구조

### `DECISIONS.md`

- 전체 판단 로그
- 세션 순서대로 누적되는 원본 기록
- Step View와 패턴 추론의 기반 데이터

### `AGENT.md`

- 압축 캐시
- 확정된 판단, 암묵 제약, 다시 묻지 말아야 할 주제를 빠르게 보여줌
- 에이전트는 질문 전에 항상 이 파일을 먼저 읽는다

둘의 역할을 분리한 이유는 분명하다.

- `DECISIONS.md`는 완전한 이력
- `AGENT.md`는 빠른 참조

즉 하나는 아카이브, 하나는 런타임 캐시다.

## 9. Continue에서 가져온 것과 Debtcrasher 고유 기능

### Continue에서 가져온 방향

- Activation과 orchestration 분리
- VS Code 확장 서비스 계층 분리
- 웹뷰와 코어 흐름 분리
- 요청 취소와 설정 변경 감지 같은 안정성 패턴

### Debtcrasher 고유 기능

- planning gate 강제
- 고레버리지 질문만 일괄 표시
- `AGENT.md` / `DECISIONS.md` 기반 중복 질문 억제
- Step View 기반 학습 문서화
- 판단 패턴 추출

즉 Debtcrasher는 "기본 개발 에이전트 구조" 위에 "판단 학습 시스템"을 얹은 형태다.

## 10. 발표 포인트

캡스톤 발표에서는 아래 메시지가 핵심이다.

1. 이 프로젝트는 단순 채팅형 AI 확장이 아니라, 개발 판단을 학습 가능한 자산으로 바꾸는 개발 보조 시스템이다.
2. 사용자는 구현을 AI에게 맡기되, 되돌리기 비싼 선택은 직접 하게 된다.
3. 과거 판단은 `DECISIONS.md`와 `AGENT.md`로 누적되어 다음 요청 품질에도 영향을 준다.
4. 구현 후 자동 검증과 자동 수정 루프가 있어 실제 개발 에이전트로서의 실행력도 갖춘다.

## 11. 현재 한계와 다음 확장

현재 구조에서 남은 확장 포인트는 명확하다.

- Step 간 의존성 그래프 시각화
- 새 판단과 과거 판단의 충돌 감지
- diff 기반 승인 UI
- 더 정교한 관련 파일 검색과 임베딩 기반 컨텍스트 랭킹

하지만 현 단계에서도 Debtcrasher는 이미 다음 두 목적을 만족한다.

- 개발자가 중요한 판단을 직접 내리게 만드는 것
- 그 판단을 실제 개발 흐름과 다시 연결하는 것
