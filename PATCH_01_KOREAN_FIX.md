# PATCH 01 - 한글 깨짐 수정

## 변경 파일
- `package.json`
- `src/agentView.ts`
- `src/stepView.ts`
- `src/aiClient.ts`
- `src/logManager.ts`

## 상세 변경

| 파일명 | 변경 전 | 변경 후 |
|---|---|---|
| `package.json` | `Open Agent View` | `Agent View 열기` |
| `package.json` | `Open Step View` | `Step View 열기` |
| `package.json` | `Open Debtcrasher` | `Debtcrasher 열기` |
| `package.json` | `Open Debtcrasher Settings` | `Debtcrasher 설정 열기` |
| `package.json` | `?꾩옱 ?ъ슜??AI ?쒓났?먮? ?좏깮?⑸땲??` | `현재 사용할 AI 제공자를 선택합니다.` |
| `package.json` | `?꾪궎?띿쿂瑜??ш쾶 諛붽씀??吏덈Ц留?臾살뒿?덈떎.` | `아키텍처를 크게 바꾸는 질문만 묻습니다.` |
| `package.json` | `Anthropic Claude API ?ㅼ엯?덈떎.` | `Anthropic Claude API 키입니다.` |
| `package.json` | `Google Gemini API ?ㅼ엯?덈떎.` | `Google Gemini API 키입니다.` |
| `package.json` | `OpenAI API ?ㅼ엯?덈떎.` | `OpenAI API 키입니다.` |
| `package.json` | `DeepSeek API ?ㅼ엯?덈떎.` | `DeepSeek API 키입니다.` |
| `src/agentView.ts` | `?섍꼍 ?뺣낫瑜?遺덈윭?ㅻ뒗 以묒엯?덈떎.` | `환경 정보를 불러오는 중입니다.` |
| `src/agentView.ts` | `湲곕낯 ?먮쫫` | `기본 흐름` |
| `src/agentView.ts` | `媛쒕컻 ?붿껌` | `개발 요청` |
| `src/agentView.ts` | `?? React + Vite + TypeScript...` | `예: React + Vite + TypeScript로 빠르게 프로토타입을 만들고 싶어...` |
| `src/agentView.ts` | `?뚰겕?ㅽ럹?댁뒪 ... ?곌껐?? / ?놁쓬` | `워크스페이스 연결됨 / 없음` |
| `src/agentView.ts` | `吏덈Ц` 영역의 깨진 설명 문구 | `추가로 직접 결정할 항목이 없습니다. 기본값으로 바로 구현을 시작할 수 있습니다.` |
| `src/agentView.ts` | `吏곸젒 ?좏깮 ?낅젰` | `직접 선택 입력` |
| `src/agentView.ts` | `?먮룞?쇰줈 寃곗젙?섎뒗 寃껊뱾` | `자동으로 결정되는 것들` |
| `src/agentView.ts` | `臾댁뾿??留뚮뱾吏` | `무엇을 만들지` |
| `src/agentView.ts` | `媛쒕컻 ?쒖옉` | `개발 시작` |
| `src/agentView.ts` | `湲곗? 臾몄꽌` | `기준 문서` |
| `src/agentView.ts` | `?먮룞 寃利?` | `자동 검증` |
| `src/agentView.ts` | `異쒕젰 蹂닿린` | `출력 보기` |
| `src/agentView.ts` | `援ы쁽 ?꾨즺` | `구현 완료` |
| `src/agentView.ts` | `?앹꽦 ?뚯씪` | `생성 파일` |
| `src/agentView.ts` | `?ㅽ뻾 / 寃利?` | `실행 / 검증` |
| `src/agentView.ts` | `???몄뀡???쒖옉...` | `새 세션을 시작했습니다. 다음 작업 목표를 적어 주세요.` |
| `src/agentView.ts` | `?ㅻ쪟:` | `오류:` |
| `src/stepView.ts` | `理쒖냼 ??媛??댁긽??step...` | `최소 한 개 이상의 step을 선택해 주세요.` |
| `src/stepView.ts` | `?좏깮??step??李얠? 紐삵뻽?듬땲??` | `선택한 step을 찾지 못했습니다.` |
| `src/stepView.ts` | `?좏깮??step???먮떒 湲곕줉...` | `선택한 step을 판단 기록 문서로 저장하고 기존 기록은 바로 편집기에서 다시 엽니다.` |
| `src/stepView.ts` | `?뚰겕?ㅽ럹?댁뒪瑜??댁뼱??step...` | `워크스페이스를 열어야 step 로그와 저장된 markdown 기록을 사용할 수 있습니다.` |
| `src/stepView.ts` | `湲곕줉??step` | `기록된 step` |
| `src/stepView.ts` | `??λ맂 markdown` | `저장된 markdown` |
| `src/stepView.ts` | `?꾩껜 ?좏깮 / ?좏깮 ?댁젣 / 臾몄꽌 ?앹꽦` | `전체 선택 / 선택 해제 / 문서 생성` |
| `src/stepView.ts` | `?앹꽦 以?..` | `생성 중...` |
| `src/stepView.ts` | `湲곕줉??step???놁뒿?덈떎.` | `기록된 step이 없습니다.` |
| `src/stepView.ts` | `??λ맂 markdown ?뚯씪???놁뒿?덈떎.` | `저장된 markdown 파일이 없습니다.` |
| `src/stepView.ts` | `?꾩옱 蹂댁씠??step??紐⑤몢 ?좏깮...` | `현재 보이는 step을 모두 선택했습니다.` |
| `src/stepView.ts` | `?좏깮??step??紐⑤몢 ?댁젣...` | `선택한 step을 모두 해제했습니다.` |
| `src/stepView.ts` | `... ?먮떒 湲곕줉???앹꽦...` | `... 판단 기록 문서를 생성했고, 선택 내역을 초기화했습니다.` |
| `src/stepView.ts` | `?먮떒 湲곕줉` | `판단 기록` |
| `src/aiClient.ts` | `# [Project Name] - ?먮떒 湲곕줉` | `# [Project Name] - 판단 기록` |
| `src/aiClient.ts` | `## ?꾨줈?앺듃 留λ씫` | `## 프로젝트 맥락` |
| `src/aiClient.ts` | `## ?듭떖 ?먮떒??` | `## 핵심 판단들` |
| `src/aiClient.ts` | `**寃곗젙??寃?*` | `**결정한 것**` |
| `src/aiClient.ts` | `**?????먮떒???꾩슂?덈굹**` | `**왜 이 판단이 필요했나**` |
| `src/aiClient.ts` | `**???먮떒????몄쓣 ???섑????좏샇**` | `**이 판단이 틀렸을 때 나타날 신호**` |
| `src/aiClient.ts` | `?ㅼ쓬? ?섎굹??媛쒕컻 ?몄뀡...` | `다음은 하나의 개발 세션에서 쌓인 의사결정 로그 엔트리들입니다.` |
| `src/aiClient.ts` | `?쒕ぉ / ?좎쭨 / ?듭뀡 A / ?듭뀡 B` | `제목 / 날짜 / 옵션 A / 옵션 B` |
| `src/aiClient.ts` | `AI ?묐떟 ?뺤떇??...` | `AI 응답 형식이 ... 맞지 않습니다.` |
| `src/aiClient.ts` | `... API ?ㅺ? 鍮꾩뼱 ?덉뒿?덈떎.` | `... API 키가 비어 있습니다.` |
| `src/aiClient.ts` | `吏?먰븯吏 ?딅뒗 AI ?쒓났?먯엯?덈떎.` | `지원하지 않는 AI 제공자입니다.` |
| `src/aiClient.ts` | `Claude API ?붿껌???ㅽ뙣...` | `Claude API 요청이 실패했습니다...` |
| `src/aiClient.ts` | `Gemini API ?붿껌???ㅽ뙣...` | `Gemini API 요청이 실패했습니다...` |
| `src/aiClient.ts` | `... API ?묐떟?먯꽌 ?띿뒪??...` | `... API 응답에서 텍스트 콘텐츠를 찾을 수 없습니다.` |
| `src/logManager.ts` | `['媛꾨떒', '鍮좊Ⅸ', '理쒖냼', '?꾨줈?좏???]` | `['간단', '빠른', '최소', '프로토타입']` |
| `src/logManager.ts` | `['?뺤쟻', '濡쒖뺄', '?뚯씪', '諛깆뿏???놁쓬']` | `['정적', '로컬', '파일', '백엔드 없음']` |
| `src/logManager.ts` | `['?뺤옣', '?좎뿰', '紐⑤뱢', '?ъ궗??]` | `['확장', '유연', '모듈', '재사용']` |
| `src/logManager.ts` | `['紐낆떆', '吏곸젒', '?ъ슜???좏깮', '?먮떒']` | `['명시', '직접', '사용자 선택', '판단']` |
| `src/logManager.ts` | `?뚰겕?ㅽ럹?댁뒪 ?대뜑瑜?癒쇱? ?댁뼱...` | `워크스페이스 폴더를 먼저 열어 주세요.` |
| `src/logManager.ts` | `summary.match(/?μ젏:\\s*([^|]+)/)` | `summary.match(/장점:\\s*([^|]+)/)` |

## 비고
- 로직 변경 없이 문자열 값만 수정했습니다.
- `npm run compile` 기준으로 컴파일이 정상 통과했습니다.
