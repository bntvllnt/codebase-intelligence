---
title: Group Spatial Clustering
status: active
created: 2026-03-02
estimate: 3h
tier: standard
---

# Group Spatial Clustering

## Context

Groups in the 3D graph are hard to distinguish because the force-directed layout doesn't respect group boundaries. Nodes from different groups intermingle freely, and the sphere cloud overlays drawn on top don't help because they overlap heavily. The root cause: no group-aware forces exist — only global charge repulsion (-30) and link distance (120). Need to add cluster-attracting forces so nodes in the same group pull toward their shared centroid, creating visible spatial separation. Secondary: change cloud envelope from sphere to box for clearer visual boundaries.

## Codebase Impact (MANDATORY)

| Area | Impact | Detail |
|------|--------|--------|
| `components/graph-canvas.tsx` | MODIFY | Add cluster force via `fg.d3Force()`, change cloud geometry from SphereGeometry to BoxGeometry |
| `lib/types.ts` | MODIFY | Add `clusterStrength` to GraphConfig + DEFAULT_CONFIG |
| `components/settings-panel.tsx` | MODIFY | Add cluster strength slider to GROUPING section |
| `package.json` | MODIFY | Add `d3-force-clustering` dependency |
| `e2e/groups.spec.ts` | MODIFY | Add e2e test for cluster force effect |

**Files:** 0 create | 5 modify | 0 affected
**Reuse:** Existing `cloudGroup()` for cluster IDs, existing `handleEngineTick` for cloud rendering, existing settings panel pattern for new slider
**Breaking changes:** None — additive only, default behavior unchanged if strength=0
**New dependencies:** `d3-force-clustering` — official d3 force plugin by vasturiano (same author as react-force-graph). Compatible with d3-force-3d. Alternative: custom force function (more code, less tested).

## User Journey (MANDATORY)

### Primary Journey

ACTOR: Developer viewing their codebase graph
GOAL: See clearly separated groups in the 3D visualization
PRECONDITION: Graph loaded with Module Clouds enabled

1. User opens codebase visualizer
   → System applies cluster force (default strength 0.3) alongside existing charge/link forces
   → Nodes in same group drift toward shared centroid as simulation runs

2. User sees groups as spatially separated clusters with box-shaped envelopes
   → System renders BoxGeometry clouds around group bounding boxes
   → Groups are visually distinct with clear boundaries and minimal overlap

3. User adjusts "Cluster Strength" slider in Settings > GROUPING
   → System updates cluster force strength (0 = off, 1 = max)
   → Nodes reorganize: 0 = current scattered behavior, 1 = tight clusters

POSTCONDITION: Groups visible as distinct spatial regions, adjustable by user

### Error Journeys

E1. Cluster force causes graph instability (nodes oscillate)
   Trigger: High cluster strength + strong link forces between groups
   1. User sees nodes jittering
      → System has distanceMin=5 to prevent micro-oscillation
   2. User reduces cluster strength via slider
      → Graph stabilizes
   Recovery: Stable layout at lower strength

### Edge Cases

EC1. Single-file groups: Not clustered (no centroid to attract toward) — behave as before
EC2. All nodes in one group: Cluster force has no spatial effect — single centroid
EC3. Zero cluster strength: Equivalent to current behavior — no grouping force

## Acceptance Criteria (MANDATORY)

### Must Have (BLOCKING)

- [ ] AC-1: GIVEN graph loaded with groups WHEN simulation runs THEN nodes in same group are closer to each other than to nodes in other groups (measured: avg intra-group distance < avg inter-group distance)
- [ ] AC-2: GIVEN cluster strength slider at 0 WHEN simulation runs THEN layout matches current behavior (no clustering force)
- [ ] AC-3: GIVEN cluster strength slider adjusted WHEN value changes THEN simulation reheats and nodes reorganize according to new strength
- [ ] AC-4: GIVEN groups rendered WHEN clouds visible THEN envelope shape is box/cube (not sphere)

### Error Criteria (BLOCKING)

- [ ] AC-E1: GIVEN cluster strength at max (1.0) WHEN simulation runs THEN no nodes oscillate indefinitely (distanceMin prevents jitter)

### Should Have

- [ ] AC-5: GIVEN group selected in legend WHEN cluster force active THEN selected group cluster is still spatially distinct

## Scope

- [x] 1. ~~Add `d3-force-clustering` dependency~~ Custom `createClusterForce` (kill criteria triggered — custom force used) → AC-1, AC-2, AC-3
- [x] 2. Add cluster force to ForceGraph3D via `fg.d3Force("cluster", ...)` using `cloudGroup(node.module)` as cluster ID → AC-1, AC-E1
- [x] 3. Add `clusterStrength` to GraphConfig (default 0.3, range 0-1) → AC-2, AC-3
- [x] 4. Add cluster strength slider in Settings panel GROUPING section → AC-3
- [x] 5. Change cloud geometry from SphereGeometry to BoxGeometry in handleEngineTick → AC-4
- [x] 6. Unit test: verify cluster force produces intra-group < inter-group distance → AC-1
- [x] 7. (Spec review) Fix cluster force registration on initial mount (registered in handleEngineTick)
- [x] 8. (Spec review) Fix WireframeGeometry → EdgesGeometry for clean box outline
- [x] 9. (Spec review) Fix label aspect ratio (0.15 → 0.1875 matching 512×96 canvas)

### Out of Scope

- Convex hull rendering (complex geometry, future enhancement)
- Per-group force strength (all groups share one strength value)
- Group collision/repulsion force (groups pushing each other apart — separate feature)

## Quality Checklist

### Blocking

- [x] All Must Have ACs passing
- [x] All Error Criteria ACs passing
- [x] All scope items implemented
- [x] No regressions in existing tests
- [x] Error states handled (jitter prevention via distanceMin=5)
- [x] No hardcoded secrets or credentials
- [x] Cloud cleanup/disposal still works (no memory leaks from new geometry)
- [x] Visual verification on both small (codebase-visualizer, 19 files) and large (the-forge, 500+ files) projects

### Advisory

- [ ] All Should Have ACs passing
- [ ] Cluster force integrates with existing dagMode (depflow view)
- [ ] Performance acceptable on 500+ node graphs (no frame drop below 30fps)

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Cluster force fights link force (inter-group edges pull nodes apart) | MED | HIGH | Default strength 0.3 is gentle; user can tune via slider |
| `d3-force-clustering` not compatible with ForceGraph3D's d3-force-3d | HIGH | LOW | Same author (vasturiano), documented compatibility |
| Box clouds look bad with scattered nodes (before sim converges) | LOW | MED | Clouds already fade in based on zoom; nodes settle within seconds |
| Performance regression from extra force calculations | MED | LOW | d3-force-clustering is O(n) per tick per cluster — negligible |

**Kill criteria:** If `d3-force-clustering` doesn't work with react-force-graph-3d's internal d3-force-3d, fall back to a custom force function (forceX/Y/Z toward centroids).

## State Machine

**Status**: N/A — Stateless feature

**Rationale**: Cluster force is a continuous physics parameter, not a state machine. User adjusts a slider → force recalculates per tick. No discrete states or transitions.

## Analysis

### Assumptions Challenged

| Assumption | Evidence For | Evidence Against | Verdict |
|------------|-------------|-----------------|---------|
| `d3-force-clustering` works with react-force-graph-3d | Same author, docs say "compatible with d3-force-3d" | Kill criteria triggered — used custom force instead | RESOLVED (custom `createClusterForce` works, extracted to `lib/cluster-force.ts`) |
| Box geometry improves group visibility over sphere | Visual verification: boxes have clear edges, labels sit above | Boxes can clip when groups are close | VALID (visually confirmed on both small and large projects) |
| Default strength 0.3 produces good results | Visible clustering on codebase-visualizer (19 files) | Inter-group links may dominate on dense graphs | VALID (slider allows tuning; 0.3 is a safe default) |
| distanceMin=5 prevents oscillation | Nodes within 5 units of centroid skip force | Centroid shifts each tick — boundary jitter possible | RISKY (mitigated by velocity decay; not observed in practice) |
| WireframeGeometry produces clean box outline | — | WireframeGeometry triangulates → diagonal lines | FIXED (switched to EdgesGeometry for clean 12-edge box) |
| Label aspect ratio 0.15 matches canvas | — | Canvas 512×96 = 0.1875 ratio, not 0.15 | FIXED (updated to 0.1875) |

### Blind Spots

1. **[Force Registration]** Cluster force useEffect fired during dynamic() loading when fgRef was null; never re-ran after mount. **FIXED** — force now registered in handleEngineTick on first tick.

2. **[Inter-cluster Separation]** No repulsion force between clusters. Cluster force pulls inward but nothing pushes groups apart. Dense inter-group links keep centroids close. Out of scope — documented as future enhancement.

3. **[GPU Performance]** 33 groups × 3 objects (mesh + wireframe + label) = 99 transparent draw calls per frame. DoubleSide rendering doubles fragment invocations. Advisory — acceptable on test hardware, may need FrontSide optimization for low-end GPUs.

4. **[GC Pressure]** Two Map allocations per tick (force centroids + cloud groups). Acceptable for current graph sizes — optimize with pre-allocated maps if perf issues emerge.

### Failure Hypotheses

| IF | THEN | BECAUSE | Severity | Mitigation |
|----|------|---------|----------|------------|
| cluster strength > 0.5 with many inter-group edges | nodes oscillate between group pull and link pull | competing forces create unstable equilibrium | MED | distanceMin=5, default 0.3, slider lets user reduce |
| Dense inter-group edges at strength 0.3 | Groups remain intermingled | Link forces dominate near-settled alpha | MED | User can increase strength; inter-cluster repulsion is future work |
| box clouds clip through each other | visual confusion | bounding boxes overlap when groups are close | LOW | clustering reduces overlap; same issue existed with spheres |
| Slider dragged rapidly | 15s continuous reheat, frame drops | Each d3ReheatSimulation resets cooldown | LOW | Acceptable UX — debounce is future optimization |

### The Real Question

Confirmed — the right problem is spatial clustering, not envelope shape. Custom centroid-pull force creates meaningful spatial separation. Kill criteria correctly triggered (custom force > library dep). Spec review found and fixed: force registration bug, wireframe geometry, label aspect ratio.

### Open Items

- [improvement] Consider adding group-repulsion force to push clusters apart → no action (out of scope, future enhancement)
- [improvement] Pre-allocate Maps in force/cloud hot path → no action (optimize if perf issues emerge)
- [improvement] Debounce slider reheat → no action (acceptable UX currently)
- [improvement] Switch DoubleSide → FrontSide on cloud meshes for GPU perf → no action (optimize if needed on low-end hardware)

## Notes

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
| 1 | Custom cluster force (kill criteria: no d3-force-clustering) | DONE | 1 |
| 2 | fg.d3Force("cluster", ...) integration | DONE | 1 |
| 3 | clusterStrength in GraphConfig | DONE | 1 |
| 4 | Cluster strength slider | DONE | 1 |
| 5 | BoxGeometry clouds | DONE | 1 |
| 6 | Unit test (intra < inter group distance) | DONE | 2 |
| 7 | Fix force registration on mount | DONE | 2 (spec review) |
| 8 | Fix WireframeGeometry → EdgesGeometry | DONE | 2 (spec review) |
| 9 | Fix label aspect ratio | DONE | 2 (spec review) |

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-03-02T21:45:00Z | - | Created |
| ship (iter 1) | 2026-03-02T22:00:00Z | ~1h | Core implementation |
| spec-review | 2026-03-02T23:00:00Z | ~30m | 4 perspectives, found registration bug + 3 rendering fixes |
| ship (iter 2) | 2026-03-02T23:30:00Z | ~30m | Fixed all review findings, added unit tests |
