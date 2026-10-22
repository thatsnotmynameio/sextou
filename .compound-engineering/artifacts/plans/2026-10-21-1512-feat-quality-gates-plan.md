---
title: Quality Gates - Plan
type: feat
date: 2026-10-21
topic: quality-gates
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Quality Gates - Plan

## Goal Capsule

- **Objective:** A pull request on sextou fails when its code breaks one of the lint rules that most large open-source TypeScript and React projects enforce. No rule takes effect before the user has seen what it finds in sextou's code and decided, for each finding, whether it is fixed or kept as an exception.
- **Means:** A lint job in sextou's own workflow runs a chosen set of native oxlint rules at `error` with a configuration of its own (R1–R6).
- **Product authority:** The brainstorm dialogue of 2026-10-21, in draft PR #58, stacked on #56 (stack #57). It follows #55's pattern of checks that start in sextou's own workflow and move to the organization's later.
- **Open blockers:** None.

---

## Product Contract

### Summary

A new check in sextou's own workflow lints every pull request with 37 native oxlint rules at `error` and fails the pull request on any finding. The rules are the ones more than 10 surveyed projects enable. Before the check takes effect, every rule is turned on over the code as #56 leaves it, every finding is reported to the user with its cause, and the user decides what is fixed and what becomes an exception.

### Problem Frame

No lint rule blocks a pull request on sextou today. `.oxlintrc.json` sets the `correctness` category to `warn`, and only the organization's `tnmn.io: typescript` run lints, where a warning does not fail the job. That run adds `typescript/ban-ts-comment` and `typescript/no-explicit-any` as errors on its command line, so sextou's own configuration enforces nothing.

Rules that most large projects turn on are off here. Three surveys of 2026-10-21 read the lint configurations of 26 repositories with a stack like sextou's, 59 repositories that lint with oxlint, and 32 open-source products. Rules such as `typescript/consistent-type-imports`, `eslint/eqeqeq` and the React hooks rules are on in most of them and off in sextou. The React plugin is not loaded at all, while `packages/ui` is React and #56 brings TanStack's hooks to `apps/web`.

Nobody knows yet what these rules would find in sextou's code, so turning them on blind would either block every pull request or hide the cost of each rule.

### Key Decisions

- **The rules are the native oxlint rules that more than 10 surveyed projects enable, in at least one of the three surveys.** (session-settled: user-directed — chosen over a list picked by fit to sextou's code and plans, which the surveys showed few projects use, and over the shared configs companies publish: "De empresa não. Vamo começar com os nativos.") Governs R1.
- **`eslint/no-undef` and `eslint/no-redeclare` are left out.** (session-settled: user-directed — chosen over keeping every rule above the threshold: TypeScript already checks both, `no-undef` flags globals such as `process` in TypeScript code, and `no-redeclare` flags the value-and-type pattern `packages/tasks` uses on purpose in `Status` and `Reason`.) Governs R1.
- **`eslint/no-console` is left out.** (session-settled: user-directed — decided on the report of R7, chosen over an exception for the server's `main.ts` and its test: its findings were the server's own output, which the web app's integration test reads, and the tests that check it.) Governs R1.
- **Every rule reports at `error` and fails the pull request.** (session-settled: user-directed — chosen over `warn`, which shows in code scanning and blocks nothing, and over `error` only for rules with no finding today.) Governs R2, R4.
- **The check runs in sextou's own workflow, not through the organization's.** (session-settled: user-directed — "Falha. E é aqui. Não é em outro repo.": chosen over relying on `tnmn.io: typescript`; the check moves to the organization later, as #55's checks will.) Governs R4, R5.
- **Every rule is turned on first and every finding goes to the user, who decides what is fixed.** (session-settled: user-directed — "O plano é ligar tudo. Ver o que acontece. E me falar os motivos. Aí eu decido o que corrigir e o que não corrigir.": chosen over fixing every finding up front, over exempting tests and stories, and over excepting every current finding so the rules apply only to new code.) Governs R7, R8, R9.
- **This work covers oxlint rules only.** (session-settled: user-directed — chosen over the other gates weighed in the same brainstorm: hosted analysis services, a duplication and complexity gate, a pull request title check, property-based tests and a bundle gate.)

### Requirements

**The rules**

- R1. The check enforces these 37 native oxlint rules. The counts are the projects that enable each rule, out of 26 repositories with a stack like sextou's, 59 repositories that lint with oxlint, and 32 products; a dash means the survey did not list it among its top rules.

  | Rule                                                                                                                                                   | Stack | oxlint | Products |
  | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------ | -------- |
  | `typescript/consistent-type-imports`                                                                                                                   | 18    | 29     | 19       |
  | `eslint/no-var`                                                                                                                                        | 13    | 24     | 14       |
  | `eslint/no-fallthrough`                                                                                                                                | 16    | 24     | –        |
  | `eslint/no-array-constructor`                                                                                                                          | 16    | 24     | –        |
  | `eslint/no-prototype-builtins`                                                                                                                         | 15    | 24     | –        |
  | `typescript/no-unnecessary-type-constraint`                                                                                                            | 15    | 24     | –        |
  | `eslint/prefer-const`                                                                                                                                  | 13    | 23     | 16       |
  | `eslint/no-regex-spaces`                                                                                                                               | 17    | 23     | –        |
  | `eslint/no-empty`                                                                                                                                      | 13    | 22     | –        |
  | `import/no-duplicates`                                                                                                                                 | 15    | 21     | 14       |
  | `eslint/no-case-declarations`                                                                                                                          | 17    | 21     | –        |
  | `react/rules-of-hooks`                                                                                                                                 | 16    | 19     | 21       |
  | `react/exhaustive-deps`                                                                                                                                | 17    | 17     | 20       |
  | `eslint/prefer-spread`                                                                                                                                 | –     | 19     | –        |
  | `typescript/no-empty-object-type`                                                                                                                      | 13    | 19     | –        |
  | `typescript/no-unsafe-function-type`                                                                                                                   | 12    | 19     | –        |
  | `eslint/eqeqeq`                                                                                                                                        | 13    | 18     | 16       |
  | `eslint/prefer-rest-params`                                                                                                                            | 8     | 18     | –        |
  | `typescript/no-namespace`                                                                                                                              | 14    | 18     | –        |
  | `typescript/no-require-imports`                                                                                                                        | 11    | 16     | –        |
  | `eslint/no-restricted-globals`                                                                                                                         | 10    | 15     | 11       |
  | `eslint/curly`                                                                                                                                         | 13    | 14     | 13       |
  | `eslint/no-unexpected-multiline`                                                                                                                       | 14    | 14     | –        |
  | `unicorn/prefer-node-protocol`                                                                                                                         | 8     | 14     | 7        |
  | `react/jsx-key`, `react/jsx-no-duplicate-props`, `react/jsx-no-undef`, `react/no-direct-mutation-state`, `react/no-is-mounted`, `react/no-string-refs` | 11–13 | 10     | 15       |
  | `eslint/no-sequences`                                                                                                                                  | –     | –      | 14       |
  | `eslint/no-unneeded-ternary`                                                                                                                           | 6     | 11     | –        |
  | `react/self-closing-comp`                                                                                                                              | 8     | 9      | 11       |
  | `eslint/object-shorthand`                                                                                                                              | 8     | 9      | 11       |
  | `typescript/no-non-null-assertion`                                                                                                                     | 4     | –      | 11       |
  | `typescript/ban-ts-comment`                                                                                                                            | 15    | 22     | 19       |
  | `typescript/no-explicit-any`                                                                                                                           | 11    | 15     | 18       |

- R2. Every rule in R1 reports at `error`.
- R3. `eslint/no-restricted-globals` starts with no globals listed; which globals it bans is decided with the report (R7).

**Where it runs**

- R4. A job in sextou's own workflow runs the check on every pull request and fails it when any rule in R1 reports.
- R5. The check reads a configuration of its own, so the organization's `tnmn.io: typescript` run is unchanged by this work.
- R6. The check covers every lintable file of every package, tests and stories included, apart from the exceptions R8 records.

**The report and the user's decisions**

- R7. Before the check takes effect, every rule in R1 is run over the code as #56 leaves it, and every finding reaches the user grouped by rule, each with its file, its line and why the rule fires there.
- R8. The user decides each finding: the code is fixed, or the finding stays as an exception that records the user's reason.
- R9. The check takes effect only when every finding of R7 is fixed or excepted.

### Acceptance Examples

- AE1. **Covers R2, R4.** Given a pull request that adds `if (done) return;` without braces, when the check runs, it fails and names `eslint/curly`.
- AE2. **Covers R5.** Given the same pull request, `tnmn.io: typescript` reports nothing new about it.
- AE3. **Covers R7, R8, R9.** Given the first run finds 40 `eslint/curly` findings, the user sees them listed under `eslint/curly` with each file, line and cause, and the check takes effect only after each of the 40 is fixed or recorded as an exception with the user's reason.

### Success Criteria

- The user can decide every finding from the report alone, without running lint or opening the code to learn why a rule fired.

### Scope Boundaries

- The `correctness` category and its rules stay as they are, at `warn` in `.oxlintrc.json`.
- Moving the check to the organization's workflow, and making it a required check through `thatsnotmynameio/admin`'s rulesets, as #55's checks also wait to be.
- Rules enabled by 10 projects or fewer, including the candidates first weighed in this brainstorm: `typescript/no-misused-promises`, `typescript/return-await`, `typescript/switch-exhaustiveness-check`, `typescript/no-unsafe-*`, `typescript/no-import-type-side-effects`, `import/no-cycle`, `import/no-nodejs-modules`, `node/no-process-env`, `eslint/complexity`, `react/jsx-no-literals` and the `vitest` rules.
- Rule sets published by companies (Airbnb, Vercel, Shopify, Google, XO, eslint-config-love, antfu, Epic Web, Rushstack).
- Rules from JavaScript plugins.
- The other gates weighed in this brainstorm: hosted analysis services, duplication and complexity measurement, a pull request title check, property-based tests and a bundle size gate.

### Dependencies / Assumptions

- The report of R7 runs on the code after #56, which rebuilds `apps/web` and `apps/server` and removes `packages/contract`, `packages/core` and `packages/data`. The counts measured during the brainstorm came from `main` before #56 (for example 40 `eslint/curly` findings), so the report's numbers will differ.
- None of the rules in R1 needs type information, so the check runs without tsgolint.
- The organization's run uses oxlint 1.87.0 and the repository pins `^1.88.0`; the rule list was taken from oxlint 1.88.0.
- Every rule in R1 except `eslint/no-restricted-globals` works without options; R3 covers that one.

### Sources / Research

- The 88-project quality tooling survey on branch `research/quality-tools`, `tmp/quality-tools-research/README.md`.
- The organization's lint step and its rules for oxlint configuration: `thatsnotmynameio/github-actions`, `.github/workflows/typescript.yml`.
- #55's own workflow, the pattern this check follows: `.github/workflows/tests.yml`.
