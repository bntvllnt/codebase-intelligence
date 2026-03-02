import { describe, it, expect } from "vitest";
import { createClusterForce } from "@/lib/cluster-force";

function dist(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const dx = (a.x as number) - (b.x as number);
  const dy = (a.y as number) - (b.y as number);
  const dz = (a.z as number) - (b.z as number);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function avgPairwiseDistance(nodes: Array<Record<string, unknown>>): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      sum += dist(nodes[i], nodes[j]);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

function makeNodes(groups: Record<string, number>, spread: number): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  for (const [group, count] of Object.entries(groups)) {
    for (let i = 0; i < count; i++) {
      nodes.push({
        id: `${group}-${i}`,
        group,
        x: (Math.random() - 0.5) * spread,
        y: (Math.random() - 0.5) * spread,
        z: (Math.random() - 0.5) * spread,
        vx: 0, vy: 0, vz: 0,
      });
    }
  }
  return nodes;
}

function simulateTicks(
  force: { (alpha: number): void; initialize: (nodes: Array<Record<string, unknown>>) => void },
  nodes: Array<Record<string, unknown>>,
  ticks: number,
): void {
  force.initialize(nodes);
  for (let t = 0; t < ticks; t++) {
    const alpha = 1 - t / ticks;
    force(alpha);
    for (const node of nodes) {
      (node.x as number) += (node.vx as number);
      (node.y as number) += (node.vy as number);
      (node.z as number) += (node.vz as number);
      node.vx = (node.vx as number) * 0.6;
      node.vy = (node.vy as number) * 0.6;
      node.vz = (node.vz as number) * 0.6;
    }
  }
}

describe("createClusterForce", () => {
  it("produces intra-group distance < inter-group distance after simulation", () => {
    const nodes = makeNodes({ services: 5, models: 5, utils: 5 }, 200);
    const force = createClusterForce((n) => n.group as string, 0.5);

    simulateTicks(force, nodes, 100);

    const groups: Record<string, Array<Record<string, unknown>>> = {};
    for (const n of nodes) {
      const g = n.group as string;
      (groups[g] ??= []).push(n);
    }

    const intraDistances: number[] = [];
    for (const groupNodes of Object.values(groups)) {
      intraDistances.push(avgPairwiseDistance(groupNodes));
    }
    const avgIntra = intraDistances.reduce((a, b) => a + b, 0) / intraDistances.length;

    const interNodes: Array<Record<string, unknown>> = [];
    const groupNames = Object.keys(groups);
    for (let i = 0; i < groupNames.length; i++) {
      for (let j = i + 1; j < groupNames.length; j++) {
        for (const a of groups[groupNames[i]]) {
          for (const b of groups[groupNames[j]]) {
            interNodes.push(a, b);
          }
        }
      }
    }
    let interSum = 0;
    let interCount = 0;
    for (let i = 0; i < groupNames.length; i++) {
      for (let j = i + 1; j < groupNames.length; j++) {
        for (const a of groups[groupNames[i]]) {
          for (const b of groups[groupNames[j]]) {
            interSum += dist(a, b);
            interCount++;
          }
        }
      }
    }
    const avgInter = interSum / interCount;

    expect(avgIntra).toBeLessThan(avgInter);
  });

  it("strength=0 applies no force (nodes unchanged)", () => {
    const nodes = makeNodes({ a: 4, b: 4 }, 200);
    const snapshotBefore = nodes.map((n) => ({ x: n.x, y: n.y, z: n.z }));
    const force = createClusterForce((n) => n.group as string, 0);

    simulateTicks(force, nodes, 50);

    for (let i = 0; i < nodes.length; i++) {
      expect(nodes[i].x).toBe(snapshotBefore[i].x);
      expect(nodes[i].y).toBe(snapshotBefore[i].y);
      expect(nodes[i].z).toBe(snapshotBefore[i].z);
    }
  });

  it("strength() method updates force behavior", () => {
    const nodes = makeNodes({ a: 5, b: 5 }, 200);
    const force = createClusterForce((n) => n.group as string, 0);

    simulateTicks(force, nodes, 20);
    const afterZero = nodes.map((n) => ({ x: n.x, y: n.y, z: n.z }));

    force.strength(0.8);
    simulateTicks(force, nodes, 50);

    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      if (
        nodes[i].x !== afterZero[i].x ||
        nodes[i].y !== afterZero[i].y ||
        nodes[i].z !== afterZero[i].z
      ) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
  });

  it("single-node clusters are skipped (count < 2)", () => {
    const nodes: Array<Record<string, unknown>> = [
      { id: "lone", group: "solo", x: 100, y: 100, z: 100, vx: 0, vy: 0, vz: 0 },
      { id: "a1", group: "team", x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      { id: "a2", group: "team", x: 50, y: 50, z: 50, vx: 0, vy: 0, vz: 0 },
    ];
    const force = createClusterForce((n) => n.group as string, 0.5);

    simulateTicks(force, nodes, 30);

    expect(nodes[0].x).toBe(100);
    expect(nodes[0].y).toBe(100);
    expect(nodes[0].z).toBe(100);
  });

  it("distanceMin=5 prevents jitter when nodes converge near centroid", () => {
    const nodes: Array<Record<string, unknown>> = [
      { id: "a1", group: "g", x: 1, y: 1, z: 1, vx: 0, vy: 0, vz: 0 },
      { id: "a2", group: "g", x: 3, y: 3, z: 3, vx: 0, vy: 0, vz: 0 },
    ];
    const force = createClusterForce((n) => n.group as string, 1.0);
    force.initialize(nodes);

    force(1.0);

    expect(nodes[0].vx).toBe(0);
    expect(nodes[1].vx).toBe(0);
  });
});
