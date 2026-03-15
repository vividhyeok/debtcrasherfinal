# PATCH 03 - 검증 루프 보완

## 무엇이 깨져 있었는가

### Fix 1: VerificationService fallback 부재
- 기존 `VerificationService.detectCommands()`는 `package.json`의 `compile/build/typecheck/test` 스크립트만 읽었습니다.
- 그래서 Python, Go, Rust처럼 `package.json`이 없는 워크스페이스에서는 자동 검증 명령이 하나도 잡히지 않았고, 검증 실패 기반 자동 수정 루프도 아예 시작되지 않았습니다.

### Fix 2: 자동 수정 실패 시 종료 흐름이 너무 조용했음
- 기존 구현은 `repairImplementation()`이 호출된 뒤 `files.length === 0`이면 그냥 추가 처리 없이 끝났습니다.
- 사용자 입장에서는 "자동 수정이 왜 멈췄는지", "무엇이 실제로 실패했는지", "이제 뭘 눌러야 하는지"가 Agent View에 충분히 드러나지 않았습니다.

## 추가된 fallback 감지 조건

### package.json 스크립트가 없을 때
- 기존과 동일하게 `compile`, `build`, `typecheck`, `check`, `test` 스크립트를 먼저 확인
- 이 중 실행 가능한 스크립트가 하나도 없을 때만 아래 fallback로 이동

### Python fallback
- `**/main.py`가 있으면 Python 워크스페이스로 간주
- 또는 `**/requirements.txt`가 있으면 Python 워크스페이스로 간주
- 이 경우 `python -m py_compile [대상 파일]` 형태의 최소 검증 명령 생성

### Go fallback
- `**/go.mod`가 있으면 `go build ./...` 추가

### Rust fallback
- `**/Cargo.toml`이 있으면 `cargo check` 추가

### Generic shell fallback
- 위 언어별 fallback이 하나도 없을 때
- `**/{test,check,verify}.sh` 파일을 찾아 `sh "[상대 경로]"` 형태로 실행 명령 생성

## sync 전/후 조건 변화가 아니라, 이번 패치에서 바뀐 검증 분기

### 이전
- package.json 스크립트가 없으면 검증 명령 배열이 빈 값으로 끝남
- 자동 수정 응답에 변경 파일이 없으면 추가 안내 없이 구현 결과만 반환

### 이후
- package.json 스크립트가 없어도 Python / Go / Rust / shell 스크립트 fallback을 탐지
- 자동 수정 응답에 변경 파일이 없으면 실패 이유를 명시적으로 노출
- 실패한 검증 출력은 Agent View에 바로 보이도록 표시
- 사용자가 `수동 수정 후 재검증` 버튼으로 planning 없이 검증만 다시 실행 가능

## 새 실패 UI 동작

- 자동 수정이 변경 파일을 반환하지 않으면 Agent View 결과 카드에 실패 안내 박스를 표시
- 안내 문구에는 "자동 수정 응답에 변경 파일이 없어 적용할 수 없었다"는 이유를 직접 설명
- 실패한 검증 항목의 출력은 접힌 상태가 아니라 바로 보이도록 표시
- 결과 카드 하단에 `수동 수정 후 재검증` 버튼을 추가
- 이 버튼은 현재 워크스페이스 기준으로 검증 명령만 다시 탐지하고 재실행하며, planning / decision logging 흐름은 다시 타지 않음
- 재검증이 다시 실패하면 같은 방식으로 실패 이유와 출력, 재검증 버튼을 다시 표시
