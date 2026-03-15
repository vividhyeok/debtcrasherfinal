# PATCH 02 - AGENT 동기화 조건 수정

## 무엇이 문제였나

기존 `syncProjectGuide()`는 `AGENT.md`를 다시 만들지 말지 판단할 때 `결정 개수`만 봤습니다.  
그래서 다음 상황에서 `AGENT.md`가 오래된 상태로 남았습니다.

- `DECISIONS.md` 내용이 수정되었지만 step 개수는 그대로인 경우
- 구현이 다시 실행되어 최신 구현 요약이 바뀌었지만 step 개수는 그대로인 경우
- `AGENT.md` 안의 최신 결정 캐시가 실제 최신 `DECISIONS.md` 엔트리와 어긋난 경우

결과적으로 `AGENT.md`가 빠른 참조 캐시 역할을 제대로 못 하고, 최신 구현 요약과 최근 컨텍스트가 갱신되지 않는 문제가 있었습니다.

## 어떻게 고쳤나

`syncProjectGuide()`가 이제 아래 조건들을 함께 확인합니다.

- 결정 개수 변화 여부
- `DECISIONS.md`의 수정 시간이 `AGENT.md`보다 더 최근인지
- `AGENT.md`에 저장된 최신 결정 요약이 `DECISIONS.md`의 최신 엔트리 요약과 일치하는지
- `AGENT.md`에 저장된 최신 구현 요약이 현재 전달된 구현 요약과 일치하는지
- `AGENT.md`에 저장된 최근 요청 컨텍스트가 현재 요청 컨텍스트와 일치하는지

즉, 이제는 단순히 step 수가 같다는 이유만으로 캐시를 재사용하지 않습니다.

## 조건 변경 요약

### 변경 전

```text
재생성 조건:
- cachedCount !== entries.length
```

### 변경 후

```text
재생성 조건:
- cachedCount !== entries.length
- DECISIONS.md.mtime > AGENT.md.mtime
- AGENT.md의 최신 결정 요약 != DECISIONS.md의 최신 엔트리 요약
- AGENT.md의 최신 구현 요약 != 이번 구현의 최신 요약
- AGENT.md의 최근 요청 컨텍스트 != 이번 요청 컨텍스트
```

## AGENT.md 재생성 내용도 같이 수정한 부분

재생성된 `AGENT.md`는 이제 항상 아래 내용을 포함합니다.

- 모든 confirmed decision을 한 줄 요약으로 유지
- 조합된 implied constraints 유지
- `Do not ask again` 섹션 유지
- 가장 최근 요청 컨텍스트 유지
- 가장 최근 구현 요약 유지

또한 내부 메타데이터 주석에 최신 결정 요약, 최신 구현 요약, 최신 요청 컨텍스트를 같이 저장해서 다음 동기화 시 비교 기준으로 사용하도록 바꿨습니다.
