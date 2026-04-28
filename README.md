# DebtCrasher

DebtCrasher는 AI가 코드를 대신 작성하는 도구가 아니라, AI 협업 개발 중 사라지기 쉬운 설계 판단을 기록하고 회고 가능한 학습 자료로 전환하는 VS Code 확장 프로그램입니다.

## 1. What is DebtCrasher?

DebtCrasher is a VS Code extension for AI-assisted development.

Instead of letting an AI agent immediately generate code, DebtCrasher first asks the developer to review important design decisions, records those decisions in `DECISIONS.md`, maintains project context in `AGENT.md`, and turns selected decision logs into reviewable learning notes.

## 2. Why DebtCrasher?

AI coding agents are fast, but they can hide important design decisions. DebtCrasher keeps the developer inside the decision loop so choices like storage strategy, API shape, deletion policy, and file structure are reviewed and recorded instead of being silently automated.

## 3. Core Idea

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

The goal is not to prove that AI decisions are always correct. The goal is to prevent high-impact decisions from being silently automated.

## 4. Main Features

- Agent View for AI-assisted development
  - Runs a planning pass before implementation
  - Shows review-worthy design decisions
  - Continues into implementation only after decisions are confirmed

- Human Review Gate
  - Classifies decision candidates by review need
  - Uses `REVIEW_REQUIRED`, `REVIEW_RECOMMENDED`, and `AUTO_WITH_LOG`
  - Lets the developer choose question sensitivity

- Decision Logging
  - Records user decisions in `DECISIONS.md`
  - Stores reasons, options, related files, and validation results

- `AGENT.md` Context Memory
  - Maintains summarized project context
  - Reduces repeated explanations across AI sessions

- Step View
  - Parses decision logs into steps
  - Generates reviewable markdown tutorials

- Verification
  - Detects available build/typecheck/test scripts
  - Runs validation when possible
  - Shows failures instead of hiding them

## 5. Human Review Gate

DebtCrasher does not treat AI-generated question ranking as objective truth.

Human Review Gate is a workflow policy that decides whether a decision should be reviewed by the developer before implementation.

| Level | Meaning |
| --- | --- |
| `REVIEW_REQUIRED` | Must be reviewed by the developer |
| `REVIEW_RECOMMENDED` | Recommended to review depending on sensitivity mode |
| `AUTO_WITH_LOG` | Can be handled automatically, but logged as an assumption |

Question sensitivity controls how many review-worthy candidates are shown.

| Mode | Behavior |
| --- | --- |
| `Flow` | Ask only required review questions |
| `Balanced` | Ask required and important recommended questions |
| `Review` | Ask most review-worthy questions |
| `Strict` | Show all candidates and reasons |

## 6. Project Flow

1. Developer enters a task in Agent View.
2. DebtCrasher collects workspace context.
3. Planning Gate generates decision candidates.
4. Human Review Gate selects which decisions need developer review.
5. Developer chooses an option.
6. The decision is saved to `DECISIONS.md`.
7. `AGENT.md` is updated with summarized project context.
8. AI implementation runs.
9. Verification runs when available.
10. Step View turns selected decisions into markdown learning notes.

## 7. Output Files

| File / Directory | Purpose |
| --- | --- |
| `DECISIONS.md` | Full decision log |
| `AGENT.md` | Compact project context for future AI sessions |
| `.ai-tutorials/` | Generated markdown tutorials |
| `.ai-sessions/` | Session history and assumptions |

## 8. Installation & Run

```bash
git clone https://github.com/vividhyeok/debtcrasherfinal.git
cd debtcrasherfinal
npm install
npm run compile
```

Then open the project in VS Code and press `F5` to launch the Extension Development Host.

Before meaningful testing, configure the provider API key in VS Code settings.

## 9. Development Scripts

```bash
npm install
npm run compile
npm run watch
```

Check `package.json` for the exact script names available in the current branch.

## 10. Current Status

DebtCrasher is under active development.

Current focus:

- Human Review Gate
- Question sensitivity modes
- Decision logging
- Assumption log
- Step View tutorial generation
- Verification result exposure

## 11. Limitations

DebtCrasher does not claim that AI-generated questions, code, or tutorials are always correct.

Human Review Level is a workflow policy, not an objective truth label.

The goal is not full AI reliability proof. The goal is visible, reviewable, and reusable decision context.

## 12. Roadmap

- Improve Human Review Gate behavior
- Improve tutorial validation
- Improve Step View UX
- Package and publish as a VS Code extension
- Conduct user evaluation after distribution
  - question usefulness
  - interruption cost
  - decision recall
  - tutorial usefulness

## 13. References

- Continue: https://github.com/continuedev/continue
- Apache-2.0 license
- VS Code Extension API and Webview docs
