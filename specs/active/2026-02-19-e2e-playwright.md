---
title: E2E Playwright Test Suite
status: active
created: 2026-02-19
estimate: 2h
tier: standard
---

# E2E Playwright Test Suite

## Context

Add comprehensive Playwright e2e tests covering the entire Next.js UI, all API routes, and all MCP tools. Create a realistic test fixture repo with edge cases for reliable test data.

## Codebase Impact

| Area | Impact | Detail |
|------|--------|--------|
| `e2e/` | CREATE | Playwright test files, config, fixtures |
| `e2e/fixture-project/` | CREATE | Fake TS codebase with edge cases |
| `playwright.config.ts` | CREATE | Playwright config with webServer |
| `package.json` | MODIFY | Add playwright deps + scripts |
| `app/globals.css` | AFFECTED | CSS cascade fix must be verified |

**Files:** 8+ create | 1 modify | 1 affected
**Reuse:** Existing graph-store singleton, existing API routes
**New dependencies:** @playwright/test

## User Journey

ACTOR: Developer
GOAL: Run `pnpm playwright test` and verify all UI + API + MCP behavior

1. Dev runs `pnpm exec playwright test`
   -> Server starts via webServer config
   -> All e2e tests execute against live app
   -> Dev sees pass/fail for every test

Error: E1 - Server fails to start
   -> Playwright reports webServer startup failure
   -> Dev sees clear error message

## Acceptance Criteria

### Must Have

- [ ] AC-1: GIVEN fixture project WHEN parsed THEN contains files with: circular deps, deep nesting, dead exports, high complexity, re-exports, type-only files, empty files
- [ ] AC-2: GIVEN running app WHEN visiting / THEN redirects to /galaxy
- [ ] AC-3: GIVEN galaxy view WHEN loaded THEN shows ProjectBar with stats, ViewTabs, SearchInput, Legend, SettingsPanel, and 3D canvas
- [ ] AC-4: GIVEN any view tab WHEN clicked THEN navigates to /<view> and canvas re-renders
- [ ] AC-5: GIVEN search input WHEN typing filename THEN matching node highlights
- [ ] AC-6: GIVEN a node WHEN clicked THEN DetailPanel shows with correct file metrics
- [ ] AC-7: GIVEN all 8 API routes WHEN called THEN return correct status + shape
- [ ] AC-8: GIVEN MCP POST /api/mcp WHEN calling each of 7 tools THEN returns valid response
- [ ] AC-9: GIVEN settings sliders WHEN adjusted THEN config values update (verified via DOM)

### Error Criteria

- [ ] AC-E1: GIVEN invalid view path WHEN navigating to /invalid THEN redirects to /galaxy
- [ ] AC-E2: GIVEN /api/file/nonexistent WHEN called THEN returns 404 JSON
- [ ] AC-E3: GIVEN /api/mcp with invalid tool WHEN called THEN returns error

## Scope

- [ ] 1. Install Playwright + config -> AC-2
- [ ] 2. Create fixture-project with all edge cases -> AC-1
- [ ] 3. E2E: page load, redirect, view navigation -> AC-2, AC-3, AC-4, AC-E1
- [ ] 4. E2E: search, node click, detail panel -> AC-5, AC-6
- [ ] 5. E2E: settings panel interaction -> AC-9
- [ ] 6. E2E: API routes (all 8) -> AC-7, AC-E2
- [ ] 7. E2E: MCP tools (all 7) -> AC-8, AC-E3
- [ ] 8. Quality gates pass

### Out of Scope

- Visual regression / screenshot comparison
- Performance benchmarks
- WebGL canvas pixel testing

## Quality Checklist

- [ ] All ACs passing
- [ ] No regressions in existing 74 vitest tests
- [ ] Playwright tests run headless in CI
- [ ] Fixture project covers all analyzer edge cases

## Notes

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
