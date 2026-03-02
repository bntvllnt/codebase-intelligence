export interface ClusterForce {
  (alpha: number): void;
  initialize: (nodes: Array<Record<string, unknown>>) => void;
  strength: (s: number) => ClusterForce;
}

export function createClusterForce(
  getClusterId: (node: Record<string, unknown>) => string | undefined,
  strength: number,
): ClusterForce {
  let nodes: Array<Record<string, unknown>> = [];
  let currentStrength = strength;

  function force(alpha: number): void {
    if (currentStrength === 0) return;
    const centroids = new Map<string, { x: number; y: number; z: number; count: number }>();
    for (const node of nodes) {
      if (node.x === undefined) continue;
      const id = getClusterId(node);
      if (!id) continue;
      const c = centroids.get(id) ?? { x: 0, y: 0, z: 0, count: 0 };
      c.x += node.x as number;
      c.y += node.y as number;
      c.z += node.z as number;
      c.count++;
      centroids.set(id, c);
    }
    for (const c of centroids.values()) {
      c.x /= c.count;
      c.y /= c.count;
      c.z /= c.count;
    }
    const k = currentStrength * alpha;
    for (const node of nodes) {
      if (node.x === undefined) continue;
      const id = getClusterId(node);
      if (!id) continue;
      const c = centroids.get(id);
      if (!c || c.count < 2) continue;
      const dx = c.x - (node.x as number);
      const dy = c.y - (node.y as number);
      const dz = c.z - (node.z as number);
      if (dx * dx + dy * dy + dz * dz < 25) continue;
      node.vx = ((node.vx as number) || 0) + dx * k;
      node.vy = ((node.vy as number) || 0) + dy * k;
      node.vz = ((node.vz as number) || 0) + dz * k;
    }
  }

  force.initialize = function (n: Array<Record<string, unknown>>): void {
    nodes = n;
  };

  force.strength = function (s: number): ClusterForce {
    currentStrength = s;
    return force;
  };

  return force;
}
