import { describe, it, expect } from 'vitest';
import {
  formatAuditAction,
  formatAuditItem,
  formatAuditDetails,
} from './audit-format';

describe('Audit Formatting (#10)', () => {
  const nameMap = new Map<string, string>([
    ['user-1', 'Hitesh'],
    ['user-2', 'Agastya Patel'],
    ['user-3', 'Yogi Patel'],
    ['user-4', 'Paras Prajapati'],
    ['user-5', 'Abbasali Sunasara'],
    ['user-6', 'Dhrupin Vaghasiya'],
    ['user-7', 'Aakash Panchal'],
    ['proj-1', 'ACS-0004-0001 · WO 7096'],
    ['task-1', 'DI Mapping · WO 6924'],
  ]);

  describe('formatAuditAction', () => {
    it('formats action in sentence case without PM prefix', () => {
      expect(formatAuditAction('pm', 'project.created')).toBe('Project created');
      expect(formatAuditAction('pm', 'task.reassigned')).toBe('Task reassigned');
      expect(formatAuditAction('pm', 'project.deleted')).toBe('Project deleted');
      expect(formatAuditAction('core', 'auth.signed_in')).toBe('Signed in');
      expect(formatAuditAction('admin', 'user.password_reset')).toBe('Password reset');
    });
  });

  describe('formatAuditItem', () => {
    it('sets item to "Account" for auth actions', () => {
      expect(
        formatAuditItem(
          { module: 'core', action: 'auth.signed_in', entityType: 'User', entityId: 'user-1' },
          nameMap
        ).label
      ).toBe('Account');

      expect(
        formatAuditItem(
          { module: 'core', action: 'auth.signed_out', entityType: 'User', entityId: 'user-1' },
          nameMap
        ).label
      ).toBe('Account');
    });

    it('sets item to "Employee: <name>" for admin actions on users', () => {
      const item = formatAuditItem(
        { module: 'admin', action: 'user.created', entityType: 'User', entityId: 'user-7' },
        nameMap
      );
      expect(item.label).toBe('Employee: Aakash Panchal');
    });

    it('names the project with code and WO and provides link', () => {
      const projectItem = formatAuditItem(
        { module: 'pm', action: 'project.updated', entityType: 'Project', entityId: 'proj-1' },
        nameMap
      );
      expect(projectItem.label).toBe('Project: ACS-0004-0001 · WO 7096');
      expect(projectItem.href).toBe('/pm/projects/proj-1');

      const fallback = formatAuditItem(
        { module: 'pm', action: 'project.updated', entityType: 'Project', entityId: 'unknown-id' },
        nameMap
      );
      expect(fallback.label).toBe('Project');
    });

    it('names the task with project and provides link', () => {
      const taskItem = formatAuditItem(
        { module: 'pm', action: 'task.updated', entityType: 'Task', entityId: 'task-1' },
        nameMap
      );
      expect(taskItem.label).toBe('Task: DI Mapping · WO 6924');
      expect(taskItem.href).toBe('/pm/tasks/task-1');

      const fallback = formatAuditItem(
        { module: 'pm', action: 'task.updated', entityType: 'Task', entityId: 'unknown-id' },
        nameMap
      );
      expect(fallback.label).toBe('Task');
    });
  });

  describe('formatAuditDetails', () => {
    it('formats status change in sentence case without JSON or raw keys', () => {
      const diff = {
        status: { from: 'IN_REVIEW', to: 'COMPLETED' },
      };
      const formatted = formatAuditDetails(
        { module: 'pm', action: 'task.status_changed', entityType: 'Task', diff },
        nameMap
      );
      expect(formatted).toBe('Status: In review → Completed');
    });

    it('formats priority change in sentence case', () => {
      const diff = {
        priority: { from: 'MEDIUM', to: 'HIGH' },
      };
      const formatted = formatAuditDetails(
        { module: 'pm', action: 'task.updated', entityType: 'Task', diff },
        nameMap
      );
      expect(formatted).toBe('Priority: Medium → High');
    });

    it('formats date change without raw timestamps or JSON', () => {
      const diff = {
        targetEndDate: { from: '2026-03-01T00:00:00.000Z', to: '2026-03-15T00:00:00.000Z' },
      };
      const formatted = formatAuditDetails(
        { module: 'pm', action: 'project.updated', entityType: 'Project', diff },
        nameMap
      );
      expect(formatted).toBe('Target end date: 1 Mar 2026 → 15 Mar 2026');
    });
    it('formats REASSIGNED TASK with previous and new assignee', () => {
      const diff = {
        fromUserId: 'user-1',
        toUserId: 'user-2',
        role: 'OWNER',
        taskTitle: 'Control Wiring Drawing',
      };
      const formatted = formatAuditDetails(
        { module: 'pm', action: 'task.reassigned', entityType: 'Task', diff },
        nameMap
      );
      expect(formatted).toBe('Hitesh → Agastya Patel (owner) · Control Wiring Drawing');
    });

    it('formats PROJECT TASKS BULK REASSIGNED', () => {
      const diff = {
        count: 27,
        fromUserId: 'user-3',
        toUserId: 'user-4',
      };
      const formatted = formatAuditDetails(
        { module: 'pm', action: 'project.tasks.bulk_reassigned', entityType: 'Project', diff },
        nameMap
      );
      expect(formatted).toBe('27 tasks: Yogi Patel → Paras Prajapati');
    });

    it('formats PM PROJECT DELETED', () => {
      const diff = {
        workOrderNo: '123123',
        clientName: 'gggg',
        taskCount: 42,
      };
      const formatted = formatAuditDetails(
        { module: 'pm', action: 'project.deleted', entityType: 'Project', diff },
        nameMap
      );
      expect(formatted).toBe('WO 123123 · gggg · 42 tasks');
    });

    it('formats AUTOMATION PROJECT CREATED', () => {
      const diff = {
        workOrderNo: '7096',
        projectManagerId: 'user-6',
      };
      const formatted = formatAuditDetails(
        { module: 'pm', action: 'project.created', entityType: 'Project', diff },
        nameMap
      );
      expect(formatted).toBe('WO 7096 · PM Dhrupin Vaghasiya');
    });

    it('formats PROJECT MEMBER REMOVED', () => {
      const diff = {
        removedUserId: 'user-5',
      };
      const formatted = formatAuditDetails(
        { module: 'pm', action: 'project.member.removed', entityType: 'Project', diff },
        nameMap
      );
      expect(formatted).toBe('Removed Abbasali Sunasara');
    });

    it('falls back to key/value list, resolving names and hiding null/empty values', () => {
      const diff = {
        note: null,
        empty: '',
        toUserId: 'user-2',
        fromUserId: 'user-1',
        role: 'OWNER',
      };
      const formatted = formatAuditDetails(
        { module: 'custom', action: 'custom.action', entityType: 'Custom', diff },
        nameMap
      );
      expect(formatted).not.toContain('note');
      expect(formatted).not.toContain('empty');
      expect(formatted).toContain('to: Agastya Patel');
      expect(formatted).toContain('from: Hitesh');
      expect(formatted).toContain('role: Owner');
    });

    it('formats plain string enums in sentence case and unknown cuid/uuid as Unknown', () => {
      const diff = {
        status: 'IN_PROGRESS',
        unknownUser: 'cly1234567890123456789012',
      };
      const formatted = formatAuditDetails(
        { module: 'pm', action: 'task.updated', entityType: 'Task', diff },
        nameMap
      );
      expect(formatted).toContain('status: In progress');
      expect(formatted).toContain('unknown user: Unknown');
    });
  });
});
