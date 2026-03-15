# Debtcrasher에 통합 가능한 오픈소스 정리

## 결론

지금 시점에서 Debtcrasher가 해야 할 일은 다른 에이전트로 갈아타는 것이 아니라, 이미 갖춘 구조 위에 필요한 조각만 선택적으로 이식하는 것이다.

특히 다음 판단이 중요하다.

- `Cline 베이스로 갈아타기`는 손해에 가깝다.
- `Continue의 typed webview protocol`은 바로 가져올 가치가 높다.
- `Cline의 task phase UI`는 적은 비용으로 데모 인상을 크게 올릴 수 있다.
- `VS Code Extension Samples`는 UI/UX를 VS Code답게 다듬는 기준점으로 계속 참고할 만하다.

즉 현재 권장 전략은 아래 한 줄로 요약된다.

> 베이스는 Continue식 구조를 유지하고, Continue의 typed protocol과 Cline의 phase UI만 골라 붙인다.

---

## 평가 기준

Debtcrasher 기준에서 오픈소스를 평가할 때 본 기준은 네 가지다.

1. 현재 구조에 낮은 비용으로 붙일 수 있는가
2. 발표 데모에서 체감 품질을 올리는가
3. 라이선스 부담이 낮은가
4. Debtcrasher의 핵심 가치인 `planning gate + decision memory + step 학습`을 해치지 않는가

현재 저장소 라이선스는 `Apache-2.0`이므로, 직접 코드 재사용은 `Apache-2.0`과 `MIT` 계열이 가장 안전하다.

---

## 지금 당장 붙일 가치가 큰 후보

### 1. Continue

- 링크: https://github.com/continuedev/continue
- 라이선스: Apache-2.0
- 추천도: 매우 높음

### Debtcrasher에 맞는 이유

Continue는 VS Code 개발 에이전트로서 가장 기본적인 골격이 잘 정리돼 있다.

- activation / orchestrator / service / webview 분리
- workspace-aware 흐름
- 웹뷰와 코어 간 메시지 구조
- 요청 취소, 설정 변경 감지 같은 안정성 패턴

Debtcrasher는 이미 이 방향 일부를 가져와 쓰고 있으므로, 전체 갈아타기보다 남은 약한 부분만 더 가져오는 편이 맞다.

### 지금 바로 가져올 만한 것

- typed webview protocol
  - 현재 Debtcrasher도 메시지 타입 정의는 있지만, webview 메시지 계층을 더 명시적인 protocol 구조로 정리하면 추적과 유지보수가 쉬워진다.
  - Agent View와 Step View가 더 커질수록 이득이 커진다.
- 중앙 message router / messenger 패턴
  - 웹뷰 이벤트와 확장 내부 로직의 결합을 줄이는 데 유리하다.
- view lifecycle 패턴
  - 뷰 dispose, abort, 설정 변경 반영을 더 일관되게 만들 수 있다.

### 가져오지 않는 것이 나은 것

- Continue 전체 런타임 이식
- 인덱싱, autocomplete, 엔터프라이즈 설정 계층

지금 Debtcrasher의 범위에서는 비용만 커지고 목적이 흐려진다.

---

### 2. Cline

- 링크: https://github.com/cline/cline
- 라이선스: Apache-2.0
- 추천도: 부분 채택 기준 높음, 베이스 전환 기준 낮음

### 결론 먼저

지금 Debtcrasher를 Cline 베이스로 갈아타는 것은 오히려 손해다.

이유는 단순하다.

- 현재도 이미 동작하는 planning 중심 구조가 있다.
- Cline 전체 구조를 다시 읽고 합치는 비용이 크다.
- Debtcrasher의 핵심은 일반 자율 에이전트가 아니라 `질문 강제 + 판단 기록`이다.

즉 Cline을 “엔진 교체” 대상으로 보면 안 되고, “UI/UX 부품 공급원”으로 보는 게 맞다.

### 지금 바로 가져올 만한 것

- task phase UI
  - `planning 중`, `구현 중`, `검증 중`, `자동 수정 중` 같은 상태를 더 명확하게 보여주는 패턴
  - 데모 때 사용자가 흐름을 이해하기 쉬워진다.
- 진행 상태 표현 방식
  - 현재 작업이 무엇인지 한눈에 보이게 하는 작은 phase bar, badge, timeline
- 승인/검토 UX 아이디어
  - 나중에 diff 승인 UI를 붙일 때 참고 가치가 높다.

### 지금 건드리지 않는 것이 나은 것

- Cline 전체 task loop
- tool autonomy 구조 전체
- Cline 중심 세션/상태 저장 구조 전체

Debtcrasher는 이미 planning gate가 중심이기 때문에, Cline 전체 로직을 들여오면 오히려 목적 충돌이 난다.

---

### 3. Microsoft VS Code Extension Samples

- 링크: https://github.com/microsoft/vscode-extension-samples
- 라이선스: MIT
- 추천도: 매우 높음

### Debtcrasher에 맞는 이유

이 저장소는 개발 에이전트 로직을 주지는 않지만, VS Code 확장으로서 자연스러운 UI/UX를 만드는 기준점으로 가장 안전하다.

### 특히 참고할 샘플

- `webview-view-sample`
- `webview-sample`
- `statusbar-sample`
- `chat-sample`

### 지금 바로 가져올 만한 것

- sidebar action 배치 방식
- toolbar / command 연결 방식
- webview view 구조 패턴
- 설정, 상태바, 커맨드 연결 방식

Debtcrasher가 “AI스럽다”보다 “VS Code 확장답다”를 강화하는 데 직접적이다.

---

## 중기적으로 참고할 후보

### 4. Roo Code

- 링크: https://github.com/RooVetGit/Roo-Code
- 라이선스: Apache-2.0
- 추천도: 중간

### 왜 참고할 만한가

Roo Code는 mode 분리와 자율성 수준 표현이 강하다. Debtcrasher의 planning / implementation 분리와 잘 맞는 부분이 있다.

### 가져올 만한 부분

- planning mode / implementation mode를 명시적으로 보여주는 UX
- 모델 역할 분리 UI
- 자율성 수준을 설명하는 표현 방식

### 당장 안 가져오는 이유

현재 Debtcrasher는 mode 자체보다 planning 품질과 검증 루프 완성도가 더 우선이다.

---

### 5. VT Code

- 링크: https://github.com/vinhnx/vtcode
- 라이선스: MIT
- 추천도: 중간

### 왜 참고할 만한가

컨텍스트 예산 관리, tool policy, agent lifecycle 같은 운영 측면이 강하다.

### 가져올 만한 부분

- context budget 관리 아이디어
- tool approval / policy 구조
- lifecycle hook 설계

### 당장 안 가져오는 이유

UI보다는 운영 정책 쪽 가치가 더 크고, 지금 Debtcrasher 우선순위는 planning 품질과 메시지 안정성이다.

---

## 장기 참고용

### 6. Sourcegraph Cody Public Snapshot

- 링크: https://github.com/sourcegraph/cody-public-snapshot
- 라이선스: Apache-2.0

장점은 대규모 코드베이스 컨텍스트 수집과 적용 UX다.  
하지만 지금 Debtcrasher 단계에서는 너무 무겁고, 나중에 retrieval 품질을 더 높일 때 참고하는 편이 맞다.

### 7. OpenHands

- 링크: https://github.com/All-Hands-AI/OpenHands
- 라이선스: MIT

범용 에이전트 루프와 실행 환경 분리 관점에서는 참고 가치가 있다.  
다만 VS Code 확장 UI/UX에 바로 이식할 대상은 아니다.

---

## 지금 기준 추천 우선순위

### 바로 실행할 것

1. Continue의 typed webview protocol
2. Cline의 task phase UI
3. VS Code Extension Samples 기반 UI/UX 정리

### 보류할 것

1. Cline 전체 구조 이식
2. Roo Code 전체 mode 시스템 이식
3. Cody/OpenHands 수준의 무거운 구조 도입

---

## 실무 판단

지금 Debtcrasher의 목적은 일반 개발 에이전트를 새로 만드는 것이 아니라, 기존 개발 에이전트 구조 위에 `판단 보존 계층`을 얹는 것이다.

그래서 가장 현실적인 선택은 이 조합이다.

```text
기본 구조: Continue 방향 유지
메시지 안정성: Continue typed protocol
시각적 완성도: Cline phase UI
VS Code 적합성: Extension Samples
장기 운영 개선: VT Code / Cody 일부 아이디어
```

이 조합이면 다음을 동시에 얻는다.

- 갈아타기 비용 최소화
- 발표 시연 품질 향상
- 현재 planning 중심 구조 보존
- Debtcrasher만의 차별점 유지

---

## 다음 액션 제안

지금 문서 기준으로 실제 작업 우선순위는 아래가 맞다.

1. Agent View와 Step View에 typed webview protocol 도입
2. Agent View 상단에 phase UI 추가
3. VS Code Extension Samples 기준으로 toolbar / 상태 표시 정리

그다음에야 diff 승인 UI나 더 무거운 retrieval 구조를 보는 게 맞다.
