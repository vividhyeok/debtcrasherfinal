# PATCH 06 - Agent View Phase UI

## 수정한 문제
Agent View에는 현재 요청이 어느 단계에 있는지 보여 주는 공통 상태 표시가 없었습니다. 그래서 사용자는 지금이 판단 분석 단계인지, 사용자 선택 대기인지, 구현 중인지, 검증 중인지 바로 알기 어려웠습니다.

## 5단계와 전이 조건
- `판단 분석 중`: 사용자가 요청을 제출한 직후 시작되며, planning JSON 응답을 받기 전까지 유지됩니다.
- `판단 선택 중`: planning 카드가 렌더링된 시점부터 시작되며, 사용자가 `개발 시작`을 누르기 전까지 유지됩니다.
- `구현 중`: `개발 시작` 클릭 이후부터 구현 파일 생성과 기록 반영이 끝날 때까지 유지됩니다.
- `검증 중`: 자동 검증이 시작된 시점부터 검증 결과를 받을 때까지 유지됩니다. 자동 수정이 실행되더라도 별도 단계를 추가하지 않고 다시 `검증 중`으로 표시합니다.
- `완료`: 검증이 통과했거나 자동 수정 시도가 끝난 뒤 최종 구현 결과가 Agent View에 반영되면 표시됩니다. 수동 수정 후 재검증 결과가 돌아와도 마지막 단계는 `완료`입니다.

## 시각 디자인
- 위치는 채팅 영역 상단이며, `topbar` 바로 아래에 단일 가로 바 형태로 배치했습니다.
- 현재 단계만 강조하고 나머지 단계는 모두 비활성 톤으로 유지합니다.
- 색상과 테두리는 모두 VS Code 테마 변수만 사용합니다.
- 사용한 주요 변수:
  - `var(--vscode-panel-border)`
  - `var(--vscode-editorWidget-background)`
  - `var(--vscode-sideBarSectionHeader-background)`
  - `var(--vscode-descriptionForeground)`
  - `var(--vscode-button-background)`
  - `var(--vscode-button-foreground)`
  - `var(--vscode-button-border)`

## 동작 방식
- 요청이 없는 idle 상태에서는 phase bar를 숨깁니다.
- 새 요청을 보내면 이전 요청의 phase 표시를 초기화한 뒤 새 요청의 `판단 분석 중`부터 다시 시작합니다.
- 구현 중 상태 메시지와 검증 상태 메시지는 기존 로직을 그대로 사용하고, phase indicator는 그 이벤트에만 매핑되도록 추가했습니다.
