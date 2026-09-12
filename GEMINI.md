# Mandatory Engineering & Development Protocol

All code changes, bug investigations, architectural designs, refactorings, and feature implementations in this project MUST strictly and unconditionally adhere to the protocols below:

---

## 0. MANDATORY: Explain in Simple Terms & Wait for User's "GO" (Golden Rule)
- **Plain-Language Summary First**: For EVERY change, request, feature, or bug fix described by the user, you MUST first describe the proposed change back in very simple, plain, everyday terms.
- **Strictly No Code Before Approval**: Absolutely DO NOT write, edit, generate, or delete any code until the user has reviewed the explanation and explicitly given their approval.
- **Wait for "Go"**: Always pause and prompt the user for confirmation. Only proceed with actual coding after the user says "go", confirms, or approves.

---

## 1. Structured Step-by-Step Reasoning: Sequential Thinking (`sequentialthinking`)
- **Mandatory First Step**: Before touching, creating, or modifying any code, invoke and engage in structured sequential thinking (`sequentialthinking` MCP / deep multi-step reasoning).
- **Explicit Lifecycle Mapping**:
  1. Break the task or problem into numbered logical steps.
  2. Map the complete execution flow from entry point to exit point across interacting components, state mutations, background tasks, API boundaries, and database storage.
  3. Hypothesize all failure modes and edge cases (race conditions, stale cache, auth/CORS boundaries, network failures, malformed input).
  4. Formulate testable assumptions and validate them before writing code.

---

## 2. Graph Navigation & Impact Analysis: Code Review Graph (`code-review-graph`)
- **Graph-First Exploration**: ALWAYS navigate and inspect codebases using the Code Review Knowledge Graph before using raw regex/grep searches.
  - Discover architectural structure using `get_architecture_overview_tool`, `list_flows_tool`, and `list_communities_tool`.
  - Search symbols and logic using `semantic_search_nodes_tool` and `query_graph_tool`.
- **Blast Radius & Dependent Analysis**:
  - Before modifying any shared function, model, resolver, or interface, execute `get_impact_radius_tool` and `get_affected_flows_tool`.
  - Ensure zero unintended side effects across downstream callers.
- **Diff & Change Review**:
  - Use `detect_changes_tool` and `get_review_context_tool` for token-efficient, risk-scored reviews.

---

## 3. Surgical AST Extraction & Editing: Token Savior (`token-savior`)
- **Targeted Symbol Inspection**:
  - Never dump massive multi-thousand-line files into context.
  - Use `get_function_source`, `find_symbol`, `get_full_context`, and `get_call_chain` to inspect exact functions, classes, and call hierarchies with minimal token overhead.
- **AST-Aware Precision Edits**:
  - Use `replace_symbol_source` and `add_field_to_model` for clean, syntax-aware refactoring.
  - Ensure edits are surgical, scoped, and leave surrounding code pristine.

---

## 4. Senior Dev Restraint & Simplification: Ponytail (`ponytail`)
- **The Ladder of Restraint** (stop at the first rung that holds):
  1. *YAGNI*: Does this actually need to be built, or is it speculative? If unneeded, do not build it.
  2. *Reuse*: Does a helper, utility, pattern, or component already exist in this codebase? Reuse it.
  3. *Standard Library*: Does JavaScript / TypeScript / Node.js / Browser standard library provide it? Use stdlib.
  4. *Native Platform*: Does a modern Web / CSS / React / Ant Design platform feature handle it? Use native.
  5. *Existing Dependency*: Does an already-installed package in `package.json` solve it? Use it.
  6. *Simplicity*: Can this logic be written in 1 clean line? Make it 1 line.
  7. *Minimum Code*: Only then write custom logic.
- **Core Rules**:
  - Fix the root cause in the shared function once; never scatter redundant patches across callers.
  - Deletion over addition. Boring over clever. Fewest files modified.
  - Shortest working diff wins (once the problem and lifecycle are fully understood).
  - Mark deliberate shortcuts with `ponytail:` comments stating the ceiling and upgrade path.

---

## 5. Engineering Rigor: Matt Pocock Principles & Impeccable Standards
- **Deep Modules & Clean Interfaces**:
  - Design deep modules with simple, intuitive interfaces that hide internal complexity.
  - Avoid shallow abstractions, leaky internals, and unnecessary glue code.
- **Strict Type-Level Precision**:
  - Absolute TypeScript strictness. Zero `any` or loose type assertions (`as unknown as ...`).
  - Explicit domain types, validated schemas (Zod/TypeBox), and strict generic contracts.
  - Type transformations, discriminated unions, and exhaustiveness checking for state machines.
- **Domain Modeling & Ubiquitous Language**:
  - Align all symbol names, variables, and API fields with core domain entities (`PLAN.md`, `CONTEXT.md`, business rules). Never introduce conflicting terms for the same concept.
- **Bug Diagnosis & TDD Discipline**:
  1. Formulate hypothesis -> inspect traces/data -> isolate root cause.
  2. Write minimal failing test / assert check (Red).
  3. Implement minimal fix (Green).
  4. Refactor and ensure all test suites pass.
- **Impeccable UI/UX**:
  - Accessible, responsive, beautiful typography, crisp spacing, intuitive micro-interactions, and zero generic boilerplate slop.

---

## 6. Build Artifact & Verification Quality Gate
- Never assume code works purely from source inspection.
- Always execute `npm run build` / `npm run lint` / compiler checks to verify 0 errors.
- Run all test suites (`npm test`, vitest, self-checks) to guarantee 100% pass rate before finishing any task.
