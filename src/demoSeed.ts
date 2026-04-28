import type { PlanningResponse } from './aiClient';

export const DEMO_TASK = 'TODO 저장 기능 추가';

export const DEMO_PLANNING_RESPONSE: PlanningResponse = {
  summary: 'TODO 항목을 VS Code workspace 안에서 저장하고 다시 불러오는 기능을 추가하는 demo flow입니다. 실제 파일 변경 없이 Planning Gate, Decision Log, Validation, Tutorial 흐름을 안정적으로 보여줍니다.',
  assumptions: [
    'demo mode: 실제 구현 파일은 생성하거나 수정하지 않습니다.',
    '저장 대상은 workspace 내부 파일로 제한한다고 가정합니다.'
  ],
  assumption_log: [
    {
      topic: 'demo mode safety',
      default_value: '실제 파일 변경 없음',
      reason: '발표 시연 안정성을 위해 demo seed는 preview flow만 보여줍니다.',
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
      id: 'demo-q1-storage',
      impact: 'HIGH',
      topic: 'TODO 저장 위치',
      question: 'TODO 데이터를 어디에 저장할까요?',
      options: [
        {
          label: 'workspace 내부 JSON 파일',
          pros: ['구현과 검증이 단순하고 demo에서 확인하기 쉽습니다.'],
          cons: ['팀 공유나 동시 편집에는 한계가 있습니다.']
        },
        {
          label: 'VS Code globalState',
          pros: ['사용자별 설정처럼 다루기 쉽습니다.'],
          cons: ['프로젝트 파일로 추적하기 어렵습니다.']
        },
        {
          label: '외부 DB 또는 API',
          pros: ['공유와 확장성이 좋습니다.'],
          cons: ['인증, 비용, 네트워크 실패 처리가 필요합니다.']
        }
      ],
      optionA: {
        label: 'workspace 내부 JSON 파일',
        pros: ['구현과 검증이 단순하고 demo에서 확인하기 쉽습니다.'],
        cons: ['팀 공유나 동시 편집에는 한계가 있습니다.']
      },
      optionB: {
        label: 'VS Code globalState',
        pros: ['사용자별 설정처럼 다루기 쉽습니다.'],
        cons: ['프로젝트 파일로 추적하기 어렵습니다.']
      },
      human_review_level: 'REVIEW_REQUIRED',
      review_categories: ['Risk Impact', 'Reversibility Cost'],
      leverage_score: 5,
      reason: '저장 위치는 데이터 지속성, 파일 경로 안전성, 이후 tutorial 근거에 직접 영향을 줍니다.',
      default_if_skipped: 'workspace 내부 JSON 파일',
      risk_if_wrong: '데이터가 사라지거나 사용자가 예상한 프로젝트 단위 저장 방식과 달라질 수 있습니다.',
      risk_categories: ['data_loss', 'user_intent', 'learning_value'],
      decision_topic: 'todo_storage_location',
      related_files: ['src/storage/todoStorage.ts', '.debtcrasher/todos.json'],
      target_files: ['src/storage/todoStorage.ts', '.debtcrasher/todos.json'],
      can_auto_apply: false
    },
    {
      id: 'demo-q2-contract',
      impact: 'HIGH',
      topic: 'TODO 명령 public contract',
      question: 'TODO 기능을 어떤 VS Code 명령 단위로 노출할까요?',
      options: [
        {
          label: 'add/list/toggle 최소 명령',
          pros: ['시연 흐름이 짧고 사용자가 결과를 빠르게 확인할 수 있습니다.'],
          cons: ['삭제나 검색 같은 편의 기능은 빠집니다.']
        },
        {
          label: 'CRUD 전체 명령',
          pros: ['사용자가 기대하는 조작을 폭넓게 제공합니다.'],
          cons: ['명령과 상태 검증 범위가 커집니다.']
        }
      ],
      optionA: {
        label: 'add/list/toggle 최소 명령',
        pros: ['시연 흐름이 짧고 사용자가 결과를 빠르게 확인할 수 있습니다.'],
        cons: ['삭제나 검색 같은 편의 기능은 빠집니다.']
      },
      optionB: {
        label: 'CRUD 전체 명령',
        pros: ['사용자가 기대하는 조작을 폭넓게 제공합니다.'],
        cons: ['명령과 상태 검증 범위가 커집니다.']
      },
      human_review_level: 'REVIEW_REQUIRED',
      review_categories: ['Architecture Impact', 'User Intent / Stakeholder Judgment'],
      leverage_score: 4,
      reason: '명령 이름과 동작은 public contract로 남아 이후 사용법과 tutorial 설명에 영향을 줍니다.',
      default_if_skipped: 'add/list/toggle 최소 명령',
      risk_if_wrong: '사용자가 기대한 명령 UX와 실제 확장 동작이 어긋날 수 있습니다.',
      risk_categories: ['public_contract', 'user_intent', 'ripple_effect'],
      decision_topic: 'todo_command_contract',
      related_files: ['package.json', 'src/extension.ts'],
      target_files: ['package.json', 'src/extension.ts'],
      can_auto_apply: false
    },
    {
      id: 'demo-q3-validation',
      impact: 'MEDIUM',
      topic: '검증 범위',
      question: '자동 검증은 어느 수준까지 실행할까요?',
      options: [
        {
          label: '가능한 스크립트만 실행',
          pros: ['개발 흐름을 덜 방해합니다.'],
          cons: ['테스트가 없으면 검증 근거가 제한됩니다.']
        },
        {
          label: 'typecheck/build/test/lint 모두 요구',
          pros: ['추적성이 강해집니다.'],
          cons: ['없는 스크립트 때문에 demo 흐름이 느려질 수 있습니다.']
        }
      ],
      optionA: {
        label: '가능한 스크립트만 실행',
        pros: ['개발 흐름을 덜 방해합니다.'],
        cons: ['테스트가 없으면 검증 근거가 제한됩니다.']
      },
      optionB: {
        label: 'typecheck/build/test/lint 모두 요구',
        pros: ['추적성이 강해집니다.'],
        cons: ['없는 스크립트 때문에 demo 흐름이 느려질 수 있습니다.']
      },
      human_review_level: 'REVIEW_RECOMMENDED',
      review_categories: ['Learning / Reflection Value'],
      leverage_score: 3,
      reason: '검증 범위는 AI 결과를 성공처럼 포장하지 않는 방식과 직접 연결됩니다.',
      default_if_skipped: '가능한 스크립트만 실행',
      risk_if_wrong: '검증 실패 또는 미실행 상태가 tutorial에 충분히 드러나지 않을 수 있습니다.',
      risk_categories: ['code_evidence_lack', 'learning_value'],
      decision_topic: 'validation_scope',
      related_files: ['package.json'],
      target_files: ['package.json'],
      can_auto_apply: false
    }
  ]
};

export const DEMO_TUTORIAL_MARKDOWN = [
  '# 제목',
  'TODO 저장 기능 결정 기록',
  '',
  '## 선택한 결정',
  '- [사용자 결정] `D-demo-todo-storage`는 workspace 내부 JSON 파일 저장을 선택한 demo decision입니다.',
  '',
  '## Human Review Level',
  '- [사용자 결정] REVIEW_REQUIRED',
  '',
  '## Review Categories',
  '- [사용자 결정] Risk Impact',
  '- [사용자 결정] Reversibility Cost',
  '',
  '## 당시 맥락',
  '- [AI 추론] 발표 시연에서는 실제 파일 변경보다 흐름의 안정성이 더 중요합니다.',
  '',
  '## 선택하지 않은 대안',
  '- [사용자 결정] globalState와 외부 DB/API는 이번 demo seed에서 선택하지 않았습니다.',
  '',
  '## 이 결정이 구현에 준 영향',
  '- [코드 근거] demo seed는 `src/storage/todoStorage.ts`와 `.debtcrasher/todos.json`을 관련 파일 예시로 남깁니다.',
  '',
  '## 관련 결정 로그',
  '- [사용자 결정] D-demo-todo-storage',
  '',
  '## 관련 파일',
  '- [코드 근거] src/storage/todoStorage.ts',
  '- [코드 근거] .debtcrasher/todos.json',
  '',
  '## 검증 결과',
  '- [검증 결과] typecheck: passed',
  '- [검증 결과] build: not available',
  '- [검증 결과] test: not available',
  '- [검증 결과] lint: not available',
  '',
  '## 나중에 다시 확인할 점',
  '- [확인 필요] 팀 공유나 동시 편집이 필요해지면 SQLite 또는 외부 저장소로 변경할지 다시 판단합니다.',
  '',
  '## 생성 검증 결과',
  '- required_sections: pass',
  '- related_decision_log: pass',
  '- related_files: pass',
  '- validation_result_included: pass',
  '- unsupported_strong_claims: 0',
  '- final_status: generated'
].join('\n');