import { describe, expect, it } from 'vitest';
import {
  blockingReasons,
  completionBlockers,
  computeSchedule,
  criticalPath,
  downstreamTaskIds,
  findCycle,
  rollUpProgress,
  topologicalOrder,
  type Graph,
  type GraphEdge,
  type GraphTask,
} from './scheduling';

const task = (id: string, overrides: Partial<GraphTask> = {}): GraphTask => ({
  id,
  code: id.toUpperCase(),
  title: `Task ${id}`,
  status: 'TODO',
  estimatedHours: 8,
  percentComplete: 0,
  plannedStart: null,
  plannedEnd: null,
  parentId: null,
  ...overrides,
});

const edge = (from: string, to: string, overrides: Partial<GraphEdge> = {}): GraphEdge => ({
  predecessorId: from,
  successorId: to,
  type: 'FINISH_TO_START',
  lagDays: 0,
  ...overrides,
});

describe('findCycle', () => {
  it('accepts a chain', () => {
    expect(findCycle([edge('a', 'b'), edge('b', 'c')])).toBeNull();
  });

  it('accepts a diamond, which is not a cycle', () => {
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
    expect(findCycle(edges)).toBeNull();
  });

  it('rejects an edge that would close a loop', () => {
    const existing = [edge('a', 'b'), edge('b', 'c')];
    const cycle = findCycle(existing, edge('c', 'a'));
    expect(cycle).not.toBeNull();
    expect(cycle).toContain('a');
    expect(cycle).toContain('c');
  });

  it('rejects a self-loop', () => {
    expect(findCycle([], edge('a', 'a'))).not.toBeNull();
  });
});

describe('topologicalOrder', () => {
  it('puts predecessors before successors', () => {
    const graph: Graph = {
      tasks: [task('c'), task('a'), task('b')],
      edges: [edge('a', 'b'), edge('b', 'c')],
    };
    expect(topologicalOrder(graph).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('throws when the graph is cyclic', () => {
    const graph: Graph = { tasks: [task('a'), task('b')], edges: [edge('a', 'b'), edge('b', 'a')] };
    expect(() => topologicalOrder(graph)).toThrow(/cycle/i);
  });
});

describe('blockingReasons', () => {
  it('blocks a finish-to-start successor while the predecessor is open', () => {
    const graph: Graph = { tasks: [task('a', { status: 'IN_PROGRESS' }), task('b')], edges: [edge('a', 'b')] };
    expect(blockingReasons('b', graph)).toHaveLength(1);
  });

  it('clears once the predecessor completes', () => {
    const graph: Graph = { tasks: [task('a', { status: 'COMPLETED' }), task('b')], edges: [edge('a', 'b')] };
    expect(blockingReasons('b', graph)).toHaveLength(0);
  });

  it('treats a cancelled predecessor as settled rather than blocking forever', () => {
    const graph: Graph = { tasks: [task('a', { status: 'CANCELLED' }), task('b')], edges: [edge('a', 'b')] };
    expect(blockingReasons('b', graph)).toHaveLength(0);
  });

  it('lets start-to-start work proceed in parallel once the predecessor has started', () => {
    const graph: Graph = {
      tasks: [task('a', { status: 'IN_PROGRESS' }), task('b')],
      edges: [edge('a', 'b', { type: 'START_TO_START' })],
    };
    expect(blockingReasons('b', graph)).toHaveLength(0);
  });

  it('does not treat finish-to-finish as a start blocker', () => {
    const graph: Graph = {
      tasks: [task('a'), task('b')],
      edges: [edge('a', 'b', { type: 'FINISH_TO_FINISH' })],
    };
    expect(blockingReasons('b', graph)).toHaveLength(0);
    expect(completionBlockers('b', graph)).toHaveLength(1);
  });
});

describe('downstreamTaskIds', () => {
  it('walks the whole downstream cone', () => {
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('b', 'd')];
    expect(downstreamTaskIds('a', edges).sort()).toEqual(['b', 'c', 'd']);
  });
});

describe('computeSchedule', () => {
  const start = new Date('2026-01-05T00:00:00.000Z'); // a Monday

  it('pushes a successor past its predecessor', () => {
    const graph: Graph = {
      tasks: [task('a', { estimatedHours: 16 }), task('b', { estimatedHours: 8 })],
      edges: [edge('a', 'b')],
    };
    const schedule = computeSchedule(graph, start);
    const a = schedule.find((s) => s.taskId === 'a')!;
    const b = schedule.find((s) => s.taskId === 'b')!;
    expect(b.earliestStart.getTime()).toBeGreaterThan(a.earliestFinish.getTime());
  });

  it('gives the longer parallel branch zero float and the shorter one slack', () => {
    const graph: Graph = {
      tasks: [
        task('start', { estimatedHours: 8 }),
        task('long', { estimatedHours: 40 }),
        task('short', { estimatedHours: 8 }),
        task('end', { estimatedHours: 8 }),
      ],
      edges: [edge('start', 'long'), edge('start', 'short'), edge('long', 'end'), edge('short', 'end')],
    };
    const schedule = computeSchedule(graph, start);
    expect(schedule.find((s) => s.taskId === 'long')!.floatDays).toBe(0);
    expect(schedule.find((s) => s.taskId === 'short')!.floatDays).toBeGreaterThan(0);
  });

  it('reports the critical path through the longest chain', () => {
    const graph: Graph = {
      tasks: [
        task('start', { estimatedHours: 8 }),
        task('long', { estimatedHours: 40 }),
        task('short', { estimatedHours: 8 }),
        task('end', { estimatedHours: 8 }),
      ],
      edges: [edge('start', 'long'), edge('start', 'short'), edge('long', 'end'), edge('short', 'end')],
    };
    const path = criticalPath(graph, start);
    expect(path).toContain('long');
    expect(path).not.toContain('short');
  });

  it('skips Sundays when laying out durations', () => {
    // 48h at 8h/day is 6 working days: Mon-Sat, finishing Saturday rather than crossing
    // into Sunday.
    const graph: Graph = { tasks: [task('a', { estimatedHours: 48 })], edges: [] };
    const [entry] = computeSchedule(graph, start);
    expect(entry!.earliestFinish.getUTCDay()).not.toBe(0);
    expect(entry!.earliestFinish.toISOString().slice(0, 10)).toBe('2026-01-10');
  });
});

describe('rollUpProgress', () => {
  it('weights children by estimated hours, not by count', () => {
    const tasks = [
      task('phase', { estimatedHours: 0 }),
      task('big', { parentId: 'phase', estimatedHours: 90, percentComplete: 0 }),
      task('small', { parentId: 'phase', estimatedHours: 10, percentComplete: 100 }),
    ];
    expect(rollUpProgress(tasks).get('phase')).toBe(10);
  });

  it('ignores cancelled children', () => {
    const tasks = [
      task('phase'),
      task('done', { parentId: 'phase', estimatedHours: 10, percentComplete: 100 }),
      task('dropped', { parentId: 'phase', estimatedHours: 90, status: 'CANCELLED' }),
    ];
    expect(rollUpProgress(tasks).get('phase')).toBe(100);
  });

  it('rolls up through more than one level', () => {
    const tasks = [
      task('top'),
      task('mid', { parentId: 'top', estimatedHours: 20 }),
      task('leaf-a', { parentId: 'mid', estimatedHours: 10, percentComplete: 50 }),
      task('leaf-b', { parentId: 'mid', estimatedHours: 10, percentComplete: 100 }),
    ];
    const rolled = rollUpProgress(tasks);
    expect(rolled.get('mid')).toBe(75);
    expect(rolled.get('top')).toBe(75);
  });

  it('treats a completed leaf as 100 even if its percent lags', () => {
    const tasks = [task('leaf', { status: 'COMPLETED', percentComplete: 80 })];
    expect(rollUpProgress(tasks).get('leaf')).toBe(100);
  });
});
