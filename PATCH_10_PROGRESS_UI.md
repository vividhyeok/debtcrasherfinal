# PATCH 10 - 구현 진행 상황 UI 개선

## 1. 진행 이벤트 종류와 codicon 매핑
- `file_start` : 구현 파일 쓰기 직전에 발생하며 `codicon-file`로 표시합니다.
- `file_done` : 새 파일 생성이 끝난 직후 발생하며 `codicon-check`로 표시합니다.
- `file_edit` : 기존 파일 수정이 끝난 직후 발생하며 `codicon-edit`로 표시합니다.
- `verify_start` : 검증 명령 실행 직전에 발생하며 `codicon-beaker`로 표시합니다.
- `verify_done` : 검증 명령 결과를 받은 직후 발생하며, 통과면 `codicon-pass`, 실패면 `codicon-error`로 표시합니다.
- `repair_start` : 자동 수정 루프에 들어가기 직전에 발생하며 `codicon-tools`로 표시합니다.
- `log_done` : `DECISIONS.md` 기록이 끝난 직후 발생하며 `codicon-book`으로 표시합니다.
- `agent_updated` : `AGENT.md` 갱신이 끝난 직후 발생하며 `codicon-file-symlink-file`로 표시합니다.

## 2. 진행 버블 시각 규칙
진행 버블은 일반 채팅 말풍선보다 작은 로그 라인처럼 보이도록 만들었습니다. 각 버블은 아이콘과 텍스트를 한 줄에 배치하고, 배경은 `var(--vscode-editorWidget-background)`, 텍스트는 `var(--vscode-descriptionForeground)`를 사용합니다. 아이콘 색은 `var(--vscode-foreground)`를 쓰되 `opacity: 0.6`으로 낮춰 과하게 튀지 않게 했습니다.

버블에는 별도 테두리를 두지 않았고, 작은 패딩과 11px 폰트로 밀도를 높였습니다. 새 진행 이벤트가 들어오면 150ms fade-in 애니메이션이 적용되고, 채팅 스레드는 자동으로 맨 아래까지 스크롤됩니다.

## 3. 기존 UI에 적용한 codicon 패턴
- `개발 시작` 버튼: `codicon-play`
- `문서 생성` 버튼: `codicon-notebook`
- `수동 수정 후 재검증` 버튼: `codicon-refresh`
- `새 채팅 / 작업 기록` 토글: `codicon-add`, `codicon-history`
- `이 세션 이어서 개발` 버튼: `codicon-debug-continue`

## 4. 완료 후 접힘 동작
최종 결과 카드가 나타나면 해당 요청 동안 쌓인 진행 버블은 개별 라인으로 남지 않고 하나의 요약 줄로 접힙니다. 이 요약 줄은 `codicon-checklist`와 함께 `파일 N개 생성 · 검증 통과/실패 · 총 소요 시간` 형식으로 표시됩니다.

요약 줄은 클릭 가능한 `details/summary` 구조로 구현되어 있어, 필요할 때 펼치면 해당 요청의 전체 진행 버블 목록을 다시 볼 수 있습니다. 기본 상태에서는 접혀 있으므로 채팅 영역이 결과 카드 중심으로 정리됩니다.
