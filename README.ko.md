# DebtCrasher

영문 README의 한국어 버전입니다. 영어 버전은 [README.md](README.md)에서 볼 수 있습니다.

## 1. DebtCrasher란?

DebtCrasher는 AI가 코드를 대신 작성하는 도구가 아니라, AI 협업 개발 중 사라지기 쉬운 설계 판단을 기록하고 회고 가능한 학습 자료로 전환하는 VS Code 확장 프로그램입니다.

즉, AI가 바로 코드를 생성하게 두는 대신, 먼저 중요한 설계 결정을 개발자가 검토하게 만들고, 그 결정을 `DECISIONS.md`에 남기며, `AGENT.md`에 프로젝트 맥락을 유지하고, 선택된 결정 로그를 다시 읽을 수 있는 학습 노트로 바꿉니다.

## 2. 왜 필요한가?

AI 코딩 에이전트는 빠르지만, 중요한 설계 결정을 사용자도 모르게 넘겨버릴 수 있습니다. DebtCrasher는 이런 결정을 개발자에게 다시 드러내서 저장 전략, API 형태, 삭제 정책, 파일 구조 같은 항목이 조용히 자동화되지 않도록 막습니다.

## 3. 핵심 아이디어

```text
User Request
→ Planning Gate
→ Human Review Gate
→ User Decision
→ DECISIONS.md
→ Code Generation
→ Verification
→ Step View Tutorial
```

핵심 목표는 AI 결정이 항상 정답임을 증명하는 것이 아닙니다. 중요한 결정이 사용자 검토 없이 자동화되는 일을 막는 것이 목표입니다.

## 4. 주요 기능

- Agent View 기반 개발 흐름
  - 구현 전에 planning 단계를 먼저 실행합니다.
  - 검토가 필요한 설계 판단을 보여 줍니다.
  - 결정이 확정된 뒤에만 구현 단계로 넘어갑니다.

- Human Review Gate
  - 결정 후보를 검토 필요도에 따라 분류합니다.
  - `REVIEW_REQUIRED`, `REVIEW_RECOMMENDED`, `AUTO_WITH_LOG`를 사용합니다.
  - 질문 민감도를 사용자가 조절할 수 있습니다.

- Decision Logging
  - 사용자의 결정을 `DECISIONS.md`에 기록합니다.
  - 이유, 선택지, 관련 파일, 검증 결과를 함께 저장합니다.

- `AGENT.md` Context Memory
  - 프로젝트 맥락을 요약해서 유지합니다.
  - AI 세션마다 같은 설명을 반복하는 일을 줄입니다.

- Step View
  - 결정 로그를 step 단위로 파싱합니다.
  - 검토 가능한 markdown 튜토리얼을 생성합니다.

- Verification
  - 사용할 수 있는 build/typecheck/test 스크립트를 탐지합니다.
  - 가능할 때 검증을 실행합니다.
  - 실패를 숨기지 않고 보여 줍니다.

## 5. Human Review Gate

DebtCrasher는 AI가 만든 질문 우선순위를 객관적 진실로 취급하지 않습니다.

Human Review Gate는 구현 전에 어떤 결정을 개발자가 검토해야 하는지 정하는 워크플로 정책입니다.

| Level | Meaning |
| --- | --- |
| `REVIEW_REQUIRED` | 개발자가 반드시 검토해야 함 |
| `REVIEW_RECOMMENDED` | 민감도 모드에 따라 검토를 권장함 |
| `AUTO_WITH_LOG` | 자동 처리 가능하지만 가정으로 로그에 남김 |

질문 민감도는 어떤 검토 후보를 얼마나 보여줄지 결정합니다.

| Mode | Behavior |
| --- | --- |
| `Flow` | 반드시 필요한 질문만 묻기 |
| `Balanced` | 필요한 질문과 중요한 권장 질문을 함께 묻기 |
| `Review` | 대부분의 검토 후보를 묻기 |
| `Strict` | 모든 후보와 이유를 보여 주기 |

## 6. 프로젝트 흐름

1. 개발자가 Agent View에 작업을 입력합니다.
2. DebtCrasher가 워크스페이스 맥락을 수집합니다.
3. Planning Gate가 결정 후보를 만듭니다.
4. Human Review Gate가 개발자 검토가 필요한 결정을 고릅니다.
5. 개발자가 선택지를 고릅니다.
6. 결정이 `DECISIONS.md`에 저장됩니다.
7. `AGENT.md`가 요약된 프로젝트 맥락으로 갱신됩니다.
8. AI 구현이 실행됩니다.
9. 사용 가능한 경우 검증이 실행됩니다.
10. Step View가 선택한 결정을 markdown 학습 노트로 바꿉니다.

## 7. 출력 파일

| File / Directory | Purpose |
| --- | --- |
| `DECISIONS.md` | 전체 결정 로그 |
| `AGENT.md` | 이후 AI 세션을 위한 압축 프로젝트 맥락 |
| `.ai-tutorials/` | 생성된 markdown 튜토리얼 |
| `.ai-sessions/` | 세션 히스토리와 가정 |

## 8. 설치 및 실행

```bash
git clone https://github.com/vividhyeok/debtcrasherfinal.git
cd debtcrasherfinal
npm install
npm run compile
```

그다음 VS Code에서 프로젝트를 열고 `F5`를 누르면 Extension Development Host가 실행됩니다.

테스트를 하기 전에 VS Code 설정에서 provider API key를 구성해야 합니다.

## 9. 개발 스크립트

```bash
npm install
npm run compile
npm run watch
```

정확한 스크립트 이름은 현재 브랜치의 `package.json`을 확인하세요.

## 10. 현재 상태

DebtCrasher는 활발히 개발 중입니다.

현재 집중하는 항목:

- Human Review Gate
- Question sensitivity modes
- Decision logging
- Assumption log
- Step View tutorial generation
- Verification result exposure

## 11. 제한 사항

DebtCrasher는 AI가 만든 질문, 코드, 튜토리얼이 항상 정확하다고 주장하지 않습니다.

Human Review Level은 진실 판정이 아니라 워크플로 정책입니다.

목표는 완전한 AI 신뢰성 증명이 아니라, 보이고 다시 확인할 수 있고 재사용 가능한 결정 맥락을 남기는 것입니다.

## 12. 로드맵

- Human Review Gate 동작 개선
- 튜토리얼 검증 개선
- Step View UX 개선
- VS Code 확장으로 패키징 및 배포
- 배포 후 사용자 평가 진행
  - 질문 유용성
  - 개입 비용
  - 결정 회상
  - 튜토리얼 유용성

## 13. 참고 자료

- Continue: https://github.com/continuedev/continue
- Apache-2.0 license
- VS Code Extension API and Webview docs