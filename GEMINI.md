# Mandatory Engineering & Development Protocol

All code changes, bug investigations, architectural designs, refactorings, and feature implementations in this project MUST strictly and unconditionally adhere to the protocols below:

---

## 0. MANDATORY: Explain in Simple Terms & Wait for User's "GO" (Golden Rule)
- **Plain-Language Summary First**: For EVERY change, request, feature, or bug fix described by the user, you MUST first describe the proposed change back in very simple, plain, everyday terms.
- **Strictly No Code Before Approval**: Absolutely DO NOT write, edit, generate, or delete any code until the user has reviewed the explanation and explicitly given their approval.
- **Wait for "Go"**: Always pause and prompt the user for confirmation. Only proceed with actual coding after the user says "go", confirms, or approves.

---

## 1. Graph Navigation & Impact Analysis: Code Review Graph (`code-review-graph`)
- **Fast Search by Default**: Use fast native search tools (`grep_search`, `find_by_name`, `view_file`) for direct, localized inspections.
- **On-Demand Graph Analysis**: Engage `code-review-graph` tools when handling large multi-file refactors, unknown architectural boundaries, or assessing blast-radius when modifying shared database models or foundational services.
  - Discover high-level structures via `get_architecture_overview_tool`, `list_flows_tool`, and `list_communities_tool`.
  - Check blast radius on shared components using `get_impact_radius_tool` and `get_affected_flows_tool`.

---

## 2. Surgical Precision & Editing (`replace_file_content` & `token-savior`)
- **Direct Surgical Edits**: Use direct, targeted file reading and `replace_file_content` as the primary, fast path for scoped edits.
- **AST-Aware Precision on Demand**: Use `token-savior` (`get_function_source`, `find_symbol`, `replace_symbol_source`) when dealing with massive files or complex symbol references to minimize token overhead.
- **Clean Diffs**: Ensure edits are minimal, scoped, and leave surrounding code pristine.

---

## 3. Senior Dev Restraint & Simplification: Ponytail (`ponytail`)
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

## 4. Engineering Rigor: Matt Pocock Principles & Impeccable Standards
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

## 5. Tiered Verification Quality Gate
- **Tier 1 (Fast Feedback for Local Changes)**:
  - For localized bug fixes, single-file edits, and UI adjustments: run fast compiler typechecks (`npx tsc --noEmit`) and relevant unit tests.
- **Tier 2 (Full Verification for System Changes)**:
  - For database migrations, multi-service refactors, and before production deployment: execute `npm run build` and the full test suite (`npm test`).
