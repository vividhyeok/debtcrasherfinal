import type { PlanningResponse } from './aiClient';

export const DEMO_TASK = 'todoapp 만들어줘';
export const DEMO_TUTORIAL_TITLE = 'demo-web-todo-app-decision-analysis';
export const DEMO_HTML_PATH = '.debtcrasher-demo/todo-app.html';

export const DEMO_PLANNING_RESPONSE: PlanningResponse = {
  summary: 'todoapp을 만든다는 짧은 요청에서 실제로 먼저 정해야 하는 범위, 데이터 보존 방식, 화면 구성을 분리해 보여주는 demo flow입니다. 사용자가 선택한 결정은 DECISIONS.md에 기록되고, Step View에서 직접 선택한 step만 markdown 학습 자료로 생성합니다.',
  assumptions: [
    'demo mode: 제품 구현 파일은 생성하거나 수정하지 않습니다.',
    '시연 안정성을 위해 TODO 앱 결과물은 독립 HTML 파일 하나로 생성합니다.',
    '질문 선택은 자동으로 채우지 않고 발표자가 직접 선택합니다.'
  ],
  assumption_log: [
    {
      topic: 'demo mode safety',
      default_value: '제품 구현 파일 변경 없음',
      reason: '발표 시연 안정성을 위해 demo seed는 Debtcrasher 산출물과 데모 HTML만 생성합니다.',
      human_review_level: 'AUTO_WITH_LOG',
      review_categories: ['Learning / Reflection Value'],
      risk_categories: ['code_evidence_lack', 'learning_value'],
      related_files: [],
      can_auto_apply: true,
      source: 'ai_inference'
    }
  ],
  questions: [
    {
      id: 'demo-q1-output',
      impact: 'HIGH',
      topic: '첫 버전 구현 범위',
      question: 'todoapp 첫 버전은 어디까지 구현할까요?',
      options: [
        {
          label: '빠른 MVP: 추가와 삭제만 구현',
          pros: ['짧은 요청에 맞게 결과가 빨리 나오고, 데모 중 동작 실패 가능성이 낮습니다.'],
          cons: ['완료 체크, 필터, 저장 같은 실제 TODO 앱의 기본 기대치는 뒤로 미뤄집니다.']
        },
        {
          label: '실사용 MVP: 완료 체크와 필터까지 포함',
          pros: ['사용자가 TODO 앱이라고 기대하는 핵심 상호작용을 더 잘 충족합니다.'],
          cons: ['구현과 검증 포인트가 늘어나 데모의 Decision Log 설명 시간이 줄어듭니다.']
        },
        {
          label: '확장형 구조: 상태 모델과 렌더러 분리',
          pros: ['나중에 태그, 마감일, 동기화 기능을 붙이기 쉬운 구조가 됩니다.'],
          cons: ['첫 버전치고 코드가 커지고, 청중에게 보여줄 핵심 동작보다 구조 설명이 앞설 수 있습니다.']
        }
      ],
      optionA: {
        label: '빠른 MVP: 추가와 삭제만 구현',
        pros: ['짧은 요청에 맞게 결과가 빨리 나오고, 데모 중 동작 실패 가능성이 낮습니다.'],
        cons: ['완료 체크, 필터, 저장 같은 실제 TODO 앱의 기본 기대치는 뒤로 미뤄집니다.']
      },
      optionB: {
        label: '실사용 MVP: 완료 체크와 필터까지 포함',
        pros: ['사용자가 TODO 앱이라고 기대하는 핵심 상호작용을 더 잘 충족합니다.'],
        cons: ['구현과 검증 포인트가 늘어나 데모의 Decision Log 설명 시간이 줄어듭니다.']
      },
      human_review_level: 'REVIEW_REQUIRED',
      review_categories: ['User Intent / Stakeholder Judgment', 'Reversibility Cost', 'Learning / Reflection Value'],
      reason: '짧은 요청에서는 사용자가 원하는 범위를 추정해야 하므로, 첫 버전의 기능 폭을 먼저 확인해야 합니다.',
      default_if_skipped: '빠른 MVP: 추가와 삭제만 구현',
      risk_if_wrong: '너무 좁게 잡으면 TODO 앱답지 않고, 너무 넓게 잡으면 데모가 기능 구현 설명으로 흐를 수 있습니다.',
      risk_categories: ['user_intent', 'ripple_effect', 'learning_value'],
      decision_topic: 'demo_first_version_scope',
      related_files: [DEMO_HTML_PATH, `.ai-tutorials/${DEMO_TUTORIAL_TITLE}.md`],
      target_files: [DEMO_HTML_PATH, `.ai-tutorials/${DEMO_TUTORIAL_TITLE}.md`],
      can_auto_apply: false
    },
    {
      id: 'demo-q2-interaction',
      impact: 'HIGH',
      topic: '데이터 보존 방식',
      question: 'TODO 항목은 새로고침 후에도 남겨야 할까요?',
      options: [
        {
          label: '세션 안에서만 유지',
          pros: ['상태 흐름이 단순해서 첫 구현과 데모 검증이 빠릅니다.'],
          cons: ['새로고침하면 데이터가 사라져 실제 앱처럼 느껴지지 않을 수 있습니다.']
        },
        {
          label: 'localStorage에 자동 저장',
          pros: ['백엔드 없이도 새로고침 후 항목이 남아 사용자 기대에 더 가깝습니다.'],
          cons: ['저장된 데모 데이터가 다음 발표에 남을 수 있어 초기화 UX와 예외 처리가 필요합니다.']
        },
        {
          label: '내보내기/가져오기 JSON 제공',
          pros: ['브라우저 저장소에 묶이지 않고 사용자가 데이터를 명시적으로 관리할 수 있습니다.'],
          cons: ['첫 버전 TODO 앱에는 과한 기능이고 파일 처리 UX 설명이 길어집니다.']
        }
      ],
      optionA: {
        label: '세션 안에서만 유지',
        pros: ['상태 흐름이 단순해서 첫 구현과 데모 검증이 빠릅니다.'],
        cons: ['새로고침하면 데이터가 사라져 실제 앱처럼 느껴지지 않을 수 있습니다.']
      },
      optionB: {
        label: 'localStorage에 자동 저장',
        pros: ['백엔드 없이도 새로고침 후 항목이 남아 사용자 기대에 더 가깝습니다.'],
        cons: ['저장된 데모 데이터가 다음 발표에 남을 수 있어 초기화 UX와 예외 처리가 필요합니다.']
      },
      human_review_level: 'REVIEW_REQUIRED',
      review_categories: ['Data / Persistence', 'User Intent / Stakeholder Judgment', 'Reversibility Cost'],
      reason: '데이터 보존은 사용자 기대와 구현 복잡도를 동시에 바꾸는 결정입니다.',
      default_if_skipped: '세션 안에서만 유지',
      risk_if_wrong: '저장을 안 하면 앱이 가벼워 보이고, 저장을 넣으면 데모 상태가 다음 실행에 영향을 줄 수 있습니다.',
      risk_categories: ['data_loss', 'user_intent', 'ripple_effect'],
      decision_topic: 'demo_todo_persistence',
      related_files: [DEMO_HTML_PATH],
      target_files: [DEMO_HTML_PATH],
      can_auto_apply: false
    },
    {
      id: 'demo-q3-screen-order',
      impact: 'MEDIUM',
      topic: '화면 구성 방식',
      question: 'TODO 화면은 어떤 정보 구조로 보여줄까요?',
      options: [
        {
          label: '입력창과 단일 리스트 중심',
          pros: ['화면이 단순해서 추가와 삭제 흐름이 바로 보입니다.'],
          cons: ['할 일의 상태나 우선순위를 비교하기 어렵습니다.']
        },
        {
          label: '상단 필터와 완료 카운트 포함',
          pros: ['active/done 상태를 빠르게 확인할 수 있어 실제 TODO 앱에 가깝습니다.'],
          cons: ['상태 전환과 필터 검증이 추가되어 첫 구현이 길어집니다.']
        },
        {
          label: '오늘 / 나중 버킷으로 분리',
          pros: ['작업 우선순위를 드러낼 수 있어 생산성 도구처럼 보입니다.'],
          cons: ['짧은 todoapp 요청에는 제품 방향을 과하게 해석한 결과가 될 수 있습니다.']
        }
      ],
      optionA: {
        label: '입력창과 단일 리스트 중심',
        pros: ['화면이 단순해서 추가와 삭제 흐름이 바로 보입니다.'],
        cons: ['할 일의 상태나 우선순위를 비교하기 어렵습니다.']
      },
      optionB: {
        label: '상단 필터와 완료 카운트 포함',
        pros: ['active/done 상태를 빠르게 확인할 수 있어 실제 TODO 앱에 가깝습니다.'],
        cons: ['상태 전환과 필터 검증이 추가되어 첫 구현이 길어집니다.']
      },
      human_review_level: 'REVIEW_RECOMMENDED',
      review_categories: ['User Intent / Stakeholder Judgment', 'Learning / Reflection Value'],
      reason: '화면 구성은 TODO 앱의 성격을 단순 메모 도구로 둘지, 상태 관리 도구로 볼지에 영향을 줍니다.',
      default_if_skipped: '입력창과 단일 리스트 중심',
      risk_if_wrong: '사용자 요청보다 과하게 복잡하거나, 반대로 너무 단순해 앱 완성도가 낮아 보일 수 있습니다.',
      risk_categories: ['user_intent', 'learning_value'],
      decision_topic: 'demo_todo_screen_structure',
      related_files: [DEMO_HTML_PATH, `.ai-tutorials/${DEMO_TUTORIAL_TITLE}.md`],
      target_files: [DEMO_HTML_PATH, `.ai-tutorials/${DEMO_TUTORIAL_TITLE}.md`],
      can_auto_apply: false
    }
  ]
};

export const DEMO_TUTORIAL_MARKDOWN = [
  '# 제목',
  '웹 TODO 앱 선택 기록 분석',
  '',
  '## 선택 기록',
  '- [사용자 결정] 첫 버전 구현 범위는 빠른 MVP로 두고 추가와 삭제만 구현하기로 했습니다.',
  '- [사용자 결정] TODO 항목은 세션 안에서만 유지하고 새로고침 후 저장은 다음 결정으로 미뤘습니다.',
  '- [사용자 결정] 화면 구성은 입력창과 단일 리스트 중심으로 선택했습니다.',
  '',
  '## 선택 근거',
  '- [AI 추론] 짧은 todoapp 요청에서는 기능 범위를 추정해야 하므로 첫 버전 구현 범위가 REVIEW_REQUIRED로 기록되었습니다.',
  '- [AI 추론] 세션 기반 상태는 구현과 검증이 단순하지만, 실제 앱 기대치와는 거리가 있습니다.',
  '',
  '## 이전 선택과의 연결',
  '- [확인 필요] demo seed에서는 하나의 흐름만 학습 자료에 포함하므로 이전 선택과의 반복 패턴은 단정하지 않습니다.',
  '',
  '## 사용자 선택 성향',
  '- [사용자 결정] 선택 라벨에는 빠른 MVP, 세션 상태, 단일 리스트가 포함됩니다.',
  '- [AI 추론] 이 demo 기록만 기준으로는 장기적 성향을 단정하지 않고, 현재 선택이 안정적인 첫 버전 구현을 택했다는 점만 정리합니다.',
  '',
  '## 관련 결정 로그',
  '- [사용자 결정] demo first version scope',
  '- [사용자 결정] demo todo persistence',
  '- [사용자 결정] demo todo screen structure',
  '',
  '## 관련 파일',
  `- [코드 근거] ${DEMO_HTML_PATH}`,
  `- [코드 근거] .ai-tutorials/${DEMO_TUTORIAL_TITLE}.md`,
  '',
  '## 검증 상태',
  '- [검증 결과] demo mode에서는 제품 구현 파일 typecheck를 실행하지 않고, 선택된 decision log 기반 markdown 생성 흐름만 확인합니다.',
  '',
  '## 다음 작업에서 확인할 점',
  '- [확인 필요] 실제 제품 기능으로 확장할 때는 완료 체크, localStorage, 필터를 다시 판단합니다.',
  '',
  '## 생성 검증 결과',
  '- required_sections: pass',
  '- related_decision_log: pass',
  '- related_files: pass',
  '- validation_result_included: pass',
  '- unsupported_strong_claims: 0',
  '- final_status: generated'
].join('\n');

export const DEMO_HTML_DOCUMENT = [
  '<!DOCTYPE html>',
  '<html lang="ko">',
  '<head>',
  '  <meta charset="UTF-8" />',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  '  <title>Demo TODO App</title>',
  '  <style>',
  '    :root { color-scheme: light; --ink: #17212b; --muted: #64717d; --line: #d8e1e7; --paper: #f6f8fb; --panel: #ffffff; --blue: #2563eb; --green: #0f8f63; --red: #c2410c; }',
  '    * { box-sizing: border-box; }',
  '    body { margin: 0; min-height: 100vh; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: var(--paper); }',
  '    main { max-width: 760px; margin: 0 auto; padding: 42px 22px; }',
  '    header { display: flex; align-items: end; justify-content: space-between; gap: 20px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }',
  '    h1 { margin: 0; font-size: 32px; line-height: 1.1; letter-spacing: 0; }',
  '    .sub { margin: 10px 0 0; color: var(--muted); font-size: 14px; }',
  '    .badge { border: 1px solid #bad7c9; background: #effaf4; color: var(--green); font-weight: 800; font-size: 12px; border-radius: 6px; padding: 7px 10px; white-space: nowrap; }',
  '    .panel { margin-top: 20px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 1px 2px rgba(23, 33, 43, 0.05); }',
  '    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px; border-bottom: 1px solid var(--line); }',
  '    .entry { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }',
  '    input { width: min(360px, 100%); height: 40px; border: 1px solid var(--line); border-radius: 6px; padding: 0 11px; font: inherit; color: var(--ink); background: #fff; }',
  '    input:focus { outline: 2px solid rgba(37, 99, 235, 0.22); border-color: var(--blue); }',
  '    .count { color: var(--muted); font-size: 13px; }',
  '    button { border: 0; border-radius: 6px; font: inherit; font-weight: 800; cursor: pointer; }',
  '    .add { background: var(--blue); color: white; padding: 10px 14px; }',
  '    .add:hover { background: #1d4ed8; }',
  '    ul { list-style: none; margin: 0; padding: 0; }',
  '    li { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 12px; min-height: 58px; padding: 12px 14px; border-bottom: 1px solid var(--line); }',
  '    li:last-child { border-bottom: 0; }',
  '    .todo-title { font-size: 15px; font-weight: 750; overflow-wrap: anywhere; }',
  '    .todo-meta { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; font-weight: 500; }',
  '    .delete { background: #fff3ed; color: var(--red); border: 1px solid #fed7c2; padding: 8px 10px; }',
  '    .empty { padding: 28px 14px; color: var(--muted); text-align: center; }',
  '    footer { margin-top: 14px; color: var(--muted); font-size: 12px; }',
  '    @media (max-width: 560px) { header, .toolbar, .entry { align-items: stretch; flex-direction: column; } input { width: 100%; } li { grid-template-columns: 1fr; } .delete { justify-self: start; } }',
  '  </style>',
  '</head>',
  '<body>',
  '  <main>',
  '    <header>',
  '      <div>',
  '        <h1>Demo TODO App</h1>',
  '        <p class="sub">입력창에 내용을 쓰고 추가 버튼을 누르면 항목이 생기며, 삭제 버튼으로 제거합니다.</p>',
  '      </div>',
  '      <span class="badge">HTML Result</span>',
  '    </header>',
  '    <section class="panel" aria-label="TODO 앱">',
  '      <div class="toolbar">',
  '        <div class="entry"><input id="todoInput" type="text" placeholder="할 일을 입력하세요" /><button class="add" type="button" id="addBtn">추가</button></div>',
  '        <span class="count" id="countLabel">0개</span>',
  '      </div>',
  '      <ul id="todoList"></ul>',
  '    </section>',
  '    <footer>Generated by Debtcrasher demo mode. Product source files were not changed.</footer>',
  '  </main>',
  '  <script>',
  '    const todos = ["시연 전에 Step View 열기", "markdown 정리본 확인", "HTML 결과 화면에서 항목 추가해보기"];',
  '    const list = document.getElementById("todoList");',
  '    const countLabel = document.getElementById("countLabel");',
  '    const addBtn = document.getElementById("addBtn");',
  '    const todoInput = document.getElementById("todoInput");',
  '',
  '    function render() {',
  '      countLabel.textContent = todos.length + "개";',
  '      if (todos.length === 0) {',
  '        list.innerHTML = "<li class=\\"empty\\">아직 할 일이 없습니다.</li>";',
  '        return;',
  '      }',
  '      list.innerHTML = todos.map(function(todo, index) {',
  '        return "<li><span><span class=\\"todo-title\\">" + escapeHtml(todo) + "</span><span class=\\"todo-meta\\">demo item #" + (index + 1) + "</span></span><button class=\\"delete\\" type=\\"button\\" data-index=\\"" + index + "\\">삭제</button></li>";',
  '      }).join("");',
  '      Array.from(document.querySelectorAll(".delete")).forEach(function(button) {',
  '        button.addEventListener("click", function() {',
  '          const index = Number(button.getAttribute("data-index"));',
  '          todos.splice(index, 1);',
  '          render();',
  '        });',
  '      });',
  '    }',
  '',
  '    function escapeHtml(value) {',
  '      return String(value).replace(/[&<>"\\\']/g, function(char) {',
  '        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;", "\\\'": "&#39;" }[char];',
  '      });',
  '    }',
  '',
  '    function addTodo() {',
  '      const text = todoInput.value.trim();',
  '      if (!text) {',
  '        todoInput.focus();',
  '        return;',
  '      }',
  '      todos.push(text);',
  '      todoInput.value = "";',
  '      todoInput.focus();',
  '      render();',
  '    }',
  '',
  '    addBtn.addEventListener("click", addTodo);',
  '    todoInput.addEventListener("keydown", function(event) {',
  '      if (event.key === "Enter") addTodo();',
  '    });',
  '',
  '    render();',
  '  </script>',
  '</body>',
  '</html>'
].join('\n');
