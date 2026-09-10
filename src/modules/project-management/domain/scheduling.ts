import { addWorkingDays, startOfDay } from '@/core/utils/dates';

/**
 * The scheduling engine.
 *
 * Pure functions over a plain graph so the hard parts - cycle detection, blocking
 * rules, the critical path - are unit-testable without a database. Services load
 * rows, hand them here, and write the result back.
 */

export type DependencyType = 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH' | 'START_TO_FINISH';
export type TaskStatus = 'DRAFT' | 'BLOCKED' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED' | 'CANCELLED';

export interface GraphTask {
  id: string;
  code: string;
  title: string;
  status: TaskStatus;
  estimatedHours: number;
  percentComplete: number;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  parentId?: string | null;
}

export interface GraphEdge {
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
}

export interface Graph {
  tasks: GraphTask[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

/**
 * Returns the cycle as a list of task ids if adding `candidate` would create one.
 *
 * Dependencies are the single most common way a project plan becomes unsolvable, and
 * a cycle in production means tasks that can never unblock. This runs before every
 * dependency insert.
 */
export function findCycle(edges: GraphEdge[], candidate?: GraphEdge): string[] | null {
  const all = candidate ? [...edges, candidate] : edges;
  const adjacency = new Map<string, string[]>();
  for (const edge of all) {
    const list = adjacency.get(edge.predecessorId) ?? [];
    list.push(edge.successorId);
    adjacency.set(edge.predecessorId, list);
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  const stack: string[] = [];

  const visit = (node: string): string[] | null => {
    colour.set(node, GREY);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const state = colour.get(next) ?? WHITE;
      if (state === GREY) {
        // Found a back edge: slice the cycle out of the current DFS stack.
        const start = stack.indexOf(next);
        return [...stack.slice(start), next];
      }
      if (state === WHITE) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }
    colour.set(node, BLACK);
    stack.pop();
    return null;
  };

  for (const node of adjacency.keys()) {
    if ((colour.get(node) ?? WHITE) === WHITE) {
      const cycle = visit(node);
      if (cycle) return cycle;
    }
  }
  return null;
}

/** Dependency-order traversal. Throws only if the graph is already cyclic. */
export function topologicalOrder(graph: Graph): GraphTask[] {
  const indegree = new Map<string, number>();
  const byId = new Map(graph.tasks.map((t) => [t.id, t]));
  for (const task of graph.tasks) indegree.set(task.id, 0);
  for (const edge of graph.edges) {
    if (!byId.has(edge.successorId) || !byId.has(edge.predecessorId)) continue;
    indegree.set(edge.successorId, (indegree.get(edge.successorId) ?? 0) + 1);
  }

  const queue = graph.tasks.filter((t) => (indegree.get(t.id) ?? 0) === 0).map((t) => t.id);
  const order: GraphTask[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    const task = byId.get(id);
    if (task) order.push(task);
    for (const edge of graph.edges) {
      if (edge.predecessorId !== id) continue;
      const next = (indegree.get(edge.successorId) ?? 0) - 1;
      indegree.set(edge.successorId, next);
      if (next === 0) queue.push(edge.successorId);
    }
  }

  if (order.length !== graph.tasks.length) {
    throw new Error('Dependency graph contains a cycle; cannot order tasks.');
  }
  return order;
}

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

export interface BlockingReason {
  predecessorId: string;
  predecessorCode: string;
  predecessorTitle: string;
  type: DependencyType;
  lagDays: number;
  reason: string;
}

const isDone = (status: TaskStatus) => status === 'COMPLETED' || status === 'CANCELLED';
const hasStarted = (task: GraphTask) =>
  task.status === 'IN_PROGRESS' || task.status === 'IN_REVIEW' || task.status === 'COMPLETED';

/**
 * Which dependencies currently stop a task from being worked on.
 *
 * The rule differs per precedence type - a start-to-start dependency only requires the
 * predecessor to have started, so treating everything as finish-to-start would idle
 * engineers who could legitimately be working in parallel.
 */
export function blockingReasons(taskId: string, graph: Graph): BlockingReason[] {
  const byId = new Map(graph.tasks.map((t) => [t.id, t]));
  const reasons: BlockingReason[] = [];

  for (const edge of graph.edges) {
    if (edge.successorId !== taskId) continue;
    const predecessor = byId.get(edge.predecessorId);
    if (!predecessor) continue;

    let blocked = false;
    let reason = '';
    switch (edge.type) {
      case 'FINISH_TO_START':
        blocked = !isDone(predecessor.status);
        reason = 'must finish before this task can start';
        break;
      case 'START_TO_START':
        blocked = !hasStarted(predecessor);
        reason = 'must start before this task can start';
        break;
      case 'FINISH_TO_FINISH':
        // Work may proceed; it just cannot be closed out first. Not a start blocker.
        blocked = false;
        reason = 'must finish before this task can be closed';
        break;
      case 'START_TO_FINISH':
        blocked = false;
        reason = 'must start before this task can be closed';
        break;
    }

    if (blocked) {
      reasons.push({
        predecessorId: predecessor.id,
        predecessorCode: predecessor.code,
        predecessorTitle: predecessor.title,
        type: edge.type,
        lagDays: edge.lagDays,
        reason,
      });
    }
  }
  return reasons;
}

/** Dependencies that prevent a task from being marked COMPLETED. */
export function completionBlockers(taskId: string, graph: Graph): BlockingReason[] {
  const byId = new Map(graph.tasks.map((t) => [t.id, t]));
  const reasons: BlockingReason[] = [];
  for (const edge of graph.edges) {
    if (edge.successorId !== taskId) continue;
    const predecessor = byId.get(edge.predecessorId);
    if (!predecessor) continue;
    const mustFinishFirst = edge.type === 'FINISH_TO_START' || edge.type === 'FINISH_TO_FINISH';
    const mustStartFirst = edge.type === 'START_TO_FINISH';
    if ((mustFinishFirst && !isDone(predecessor.status)) || (mustStartFirst && !hasStarted(predecessor))) {
      reasons.push({
        predecessorId: predecessor.id,
        predecessorCode: predecessor.code,
        predecessorTitle: predecessor.title,
        type: edge.type,
        lagDays: edge.lagDays,
        reason: mustFinishFirst ? 'must finish first' : 'must start first',
      });
    }
  }
  return reasons;
}

/** Ids of every task reachable downstream. Used to warn "delaying this hits N tasks". */
export function downstreamTaskIds(taskId: string, edges: GraphEdge[]): string[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.predecessorId) ?? [];
    list.push(edge.successorId);
    adjacency.set(edge.predecessorId, list);
  }
  const seen = new Set<string>();
  const queue = [...(adjacency.get(taskId) ?? [])];
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(adjacency.get(next) ?? []));
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// Forward / backward pass - earliest dates, float and the critical path
// ---------------------------------------------------------------------------

export interface ScheduleEntry {
  taskId: string;
  earliestStart: Date;
  earliestFinish: Date;
  latestStart: Date;
  latestFinish: Date;
  /** Working days of slack. Zero means any slip moves the project end date. */
  floatDays: number;
  isCritical: boolean;
}

function durationDays(task: GraphTask, hoursPerDay = 8): number {
  if (task.plannedStart && task.plannedEnd) {
    const ms = startOfDay(task.plannedEnd).getTime() - startOfDay(task.plannedStart).getTime();
    return Math.max(1, Math.round(ms / 86_400_000) + 1);
  }
  return Math.max(1, Math.ceil(task.estimatedHours / hoursPerDay));
}

/**
 * CPM forward and backward pass over the dependency graph.
 *
 * Managers need to know which slipping task actually threatens the delivery date;
 * without float, every red task looks equally urgent and nothing gets prioritised.
 */
export function computeSchedule(graph: Graph, projectStart: Date): ScheduleEntry[] {
  const ordered = topologicalOrder(graph);
  const byId = new Map(graph.tasks.map((t) => [t.id, t]));
  const incoming = new Map<string, GraphEdge[]>();
  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    incoming.set(edge.successorId, [...(incoming.get(edge.successorId) ?? []), edge]);
    outgoing.set(edge.predecessorId, [...(outgoing.get(edge.predecessorId) ?? []), edge]);
  }

  const early = new Map<string, { start: Date; finish: Date }>();
  const base = startOfDay(projectStart);

  for (const task of ordered) {
    let start = task.plannedStart ? startOfDay(task.plannedStart) : base;
    for (const edge of incoming.get(task.id) ?? []) {
      const pred = early.get(edge.predecessorId);
      if (!pred) continue;
      let constraint: Date;
      switch (edge.type) {
        case 'FINISH_TO_START':
          constraint = addWorkingDays(pred.finish, 1 + edge.lagDays);
          break;
        case 'START_TO_START':
          constraint = addWorkingDays(pred.start, edge.lagDays);
          break;
        case 'FINISH_TO_FINISH':
          constraint = addWorkingDays(pred.finish, edge.lagDays - durationDays(task) + 1);
          break;
        case 'START_TO_FINISH':
          constraint = addWorkingDays(pred.start, edge.lagDays - durationDays(task) + 1);
          break;
      }
      if (constraint > start) start = constraint;
    }
    const finish = addWorkingDays(start, durationDays(task) - 1);
    early.set(task.id, { start, finish });
  }

  const projectFinish = [...early.values()].reduce(
    (latest, entry) => (entry.finish > latest ? entry.finish : latest),
    base,
  );

  const late = new Map<string, { start: Date; finish: Date }>();
  for (const task of [...ordered].reverse()) {
    let finish = projectFinish;
    const successors = outgoing.get(task.id) ?? [];
    for (const edge of successors) {
      const succ = late.get(edge.successorId);
      if (!succ) continue;
      let constraint: Date;
      switch (edge.type) {
        case 'FINISH_TO_START':
          constraint = addWorkingDays(succ.start, -(1 + edge.lagDays));
          break;
        case 'START_TO_START':
          constraint = addWorkingDays(succ.start, -edge.lagDays + durationDays(task) - 1);
          break;
        case 'FINISH_TO_FINISH':
          constraint = addWorkingDays(succ.finish, -edge.lagDays);
          break;
        case 'START_TO_FINISH':
          constraint = addWorkingDays(succ.finish, -edge.lagDays + durationDays(task) - 1);
          break;
      }
      if (constraint < finish) finish = constraint;
    }
    const start = addWorkingDays(finish, -(durationDays(task) - 1));
    late.set(task.id, { start, finish });
  }

  return ordered.map((task) => {
    const e = early.get(task.id)!;
    const l = late.get(task.id)!;
    const floatDays = Math.round((l.finish.getTime() - e.finish.getTime()) / 86_400_000);
    return {
      taskId: task.id,
      earliestStart: e.start,
      earliestFinish: e.finish,
      latestStart: l.start,
      latestFinish: l.finish,
      floatDays,
      isCritical: floatDays <= 0 && byId.get(task.id)?.status !== 'CANCELLED',
    };
  });
}

/** Ordered list of task ids that form the longest zero-float chain. */
export function criticalPath(graph: Graph, projectStart: Date): string[] {
  const schedule = computeSchedule(graph, projectStart);
  return schedule
    .filter((entry) => entry.isCritical)
    .sort((a, b) => a.earliestStart.getTime() - b.earliestStart.getTime())
    .map((entry) => entry.taskId);
}

// ---------------------------------------------------------------------------
// Progress roll-up
// ---------------------------------------------------------------------------

/**
 * Rolls leaf progress up through the WBS, weighted by estimated hours.
 *
 * A phase that is "50% done" because two of four subtasks are ticked is misleading
 * when those two were the trivial ones; weighting by effort keeps the number honest.
 */
export function rollUpProgress(tasks: GraphTask[]): Map<string, number> {
  const childrenOf = new Map<string, GraphTask[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    childrenOf.set(task.parentId, [...(childrenOf.get(task.parentId) ?? []), task]);
  }

  const result = new Map<string, number>();

  const compute = (task: GraphTask): number => {
    if (result.has(task.id)) return result.get(task.id)!;
    const children = childrenOf.get(task.id) ?? [];
    if (children.length === 0) {
      const value = task.status === 'COMPLETED' ? 100 : task.percentComplete;
      result.set(task.id, value);
      return value;
    }
    const active = children.filter((c) => c.status !== 'CANCELLED');
    if (active.length === 0) {
      result.set(task.id, 0);
      return 0;
    }
    const totalWeight = active.reduce((sum, c) => sum + Math.max(c.estimatedHours, 0.5), 0);
    const weighted = active.reduce((sum, c) => sum + compute(c) * Math.max(c.estimatedHours, 0.5), 0);
    const value = Math.round(weighted / totalWeight);
    result.set(task.id, value);
    return value;
  };

  for (const task of tasks) compute(task);
  return result;
}
