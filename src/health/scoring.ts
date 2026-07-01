import type { FileMetrics } from "../types/index.js";

export interface HealthScoreInput {
  loc: number;
  coverage: number;
  metrics: FileMetrics;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalize(value: number, ceiling: number): number {
  if (ceiling <= 0) return 0;
  return clamp(value / ceiling, 0, 1);
}

export function roundHealthScore(value: number): number {
  return Math.round(clamp(value, 0, 100) * 100) / 100;
}

export function roundCrapScore(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}

export function computeMaintainabilityIndex(input: HealthScoreInput): number {
  const { coverage, loc, metrics } = input;
  const penalty =
    normalize(metrics.cyclomaticComplexity, 20) * 35
    + normalize(loc, 500) * 20
    + normalize(metrics.churn, 20) * 15
    + normalize(metrics.coupling, 20) * 15
    + normalize(metrics.blastRadius, 50) * 10
    + (1 - clamp(coverage, 0, 1)) * 5;

  return roundHealthScore(100 - penalty);
}

export function computeCrapScore(complexity: number, coverage: number): number {
  const gap = 1 - clamp(coverage, 0, 1);
  return roundCrapScore((complexity ** 2 * gap ** 3) + complexity);
}

export function computeRiskScore(input: HealthScoreInput): number {
  const { loc, metrics } = input;
  const maintainability = computeMaintainabilityIndex(input);
  const risk =
    (100 - maintainability) * 0.45
    + normalize(metrics.cyclomaticComplexity, 20) * 20
    + normalize(metrics.churn, 20) * 12
    + normalize(metrics.coupling, 20) * 10
    + normalize(loc, 500) * 8
    + normalize(metrics.blastRadius, 50) * 5;

  return roundHealthScore(risk);
}

export function averageHealth(values: readonly number[]): number {
  if (values.length === 0) return 100;
  return roundHealthScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function componentHealth(values: readonly number[], ceiling: number): number {
  if (values.length === 0) return 100;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return roundHealthScore(100 - normalize(avg, ceiling) * 100);
}
