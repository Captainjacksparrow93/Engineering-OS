/**
 * Formatting helpers for the platform audit trail.
 *
 * Provides human-readable sentences for known actions, clean entity labels,
 * and robust fallback key-value formatting without leaking sensitive data or nulls.
 */

import { formatDate } from '@/core/utils/dates';

function formatSingleValue(val: unknown, nameMap: Map<string, string>): string {
  if (val === null || val === undefined || val === '') return 'None';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') {
    if (nameMap.has(val)) return nameMap.get(val)!;
    // Check if it's an ISO date string
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/.test(val)) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        return formatDate(d, { forceYear: true });
      }
    }
    // Check if it's an uppercase enum like IN_REVIEW, ON_HOLD, etc.
    if (/^[A-Z][A-Z0-9_]+$/.test(val)) {
      const lower = val.replace(/_/g, ' ').toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }
    // Unknown cuid or uuid ID
    if (/^c[a-z0-9]{20,}$/i.test(val) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
      return 'Unknown';
    }
    return val.replace(/_/g, ' ');
  }
  if (Array.isArray(val)) {
    return val.map((x) => formatSingleValue(x, nameMap)).join(', ');
  }
  if (typeof val === 'object') {
    return Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${formatSingleValue(v, nameMap)}`)
      .join(', ');
  }
  return String(val);
}

export function formatAuditAction(module: string, action: string): string {
  const fullKey = `${module}.${action}`;
  const map: Record<string, string> = {
    'core.auth.signed_in': 'Signed in',
    'core.auth.signed_out': 'Signed out',
    'core.auth.failed_login': 'Sign in failed',
    'admin.user.created': 'Employee added',
    'admin.user.status_changed': 'Status changed',
    'admin.user.updated': 'Employee updated',
    'admin.user.password_reset': 'Password reset',
    'admin.role.assigned': 'Role granted',
    'admin.role.revoked': 'Role removed',
    'admin.role.permissions_set': 'Permissions updated',
    'pm.project.created': 'Project created',
    'pm.project.updated': 'Project updated',
    'pm.project.deleted': 'Project deleted',
    'pm.project.member.added': 'Member added',
    'pm.project.member.removed': 'Member removed',
    'pm.project.tasks.bulk_reassigned': 'Tasks bulk reassigned',
    'pm.task.created': 'Task created',
    'pm.task.updated': 'Task updated',
    'pm.task.status_changed': 'Task status changed',
    'pm.task.assigned': 'Task assigned',
    'pm.task.reassigned': 'Task reassigned',
    'pm.task.handover': 'Task handed over',
    'pm.wbs.created': 'WBS created',
    'pm.milestone.created': 'Milestone created',
    'pm.document.uploaded': 'Document uploaded',
  };

  if (map[fullKey]) return map[fullKey];

  // Fallback: strip any module prefix if present in action, sentence case
  const clean = action.replace(/^[a-z]+\./i, '').replace(/_/g, ' ').replace(/\./g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export interface AuditItemDescriptor {
  label: string;
  href?: string;
}

export function formatAuditItem(
  entry: { module: string; action: string; entityType: string; entityId: string },
  nameMap: Map<string, string>
): AuditItemDescriptor {
  const { module, action, entityType, entityId } = entry;

  // Auth actions touch the account
  if (module === 'core' && action.startsWith('auth.')) {
    return { label: 'Account' };
  }
  if (action === 'user.password_reset') {
    return { label: 'Account' };
  }

  // Admin actions targeting an employee
  if (entityType === 'User') {
    const employeeName = nameMap.get(entityId);
    if (employeeName) {
      return { label: `Employee: ${employeeName}` };
    }
    return { label: 'Employee' };
  }

  if (entityType === 'Project') {
    const projName = nameMap.get(entityId);
    return {
      label: projName ? `Project: ${projName}` : 'Project',
      href: `/pm/projects/${entityId}`,
    };
  }

  if (entityType === 'Task') {
    const taskName = nameMap.get(entityId);
    return {
      label: taskName ? `Task: ${taskName}` : 'Task',
      href: `/pm/tasks/${entityId}`,
    };
  }

  const map: Record<string, string> = {
    RoleAssignment: 'Access Role',
    TaskAssignment: 'Assignment',
    TaskHandover: 'Handover',
    WbsNode: 'WBS item',
    Milestone: 'Milestone',
    Document: 'Document',
    Department: 'Department',
    Company: 'Company',
    Role: 'Role',
  };

  return { label: map[entityType] ?? entityType.replace(/([A-Z])/g, ' $1').trim() };
}

export function formatAuditDetails(
  entry: { module: string; action: string; entityType: string; diff: unknown },
  nameMap: Map<string, string>
): string {
  const { module, action, diff } = entry;
  const fullKey = `${module}.${action}`;

  if (!diff || typeof diff !== 'object') {
    return typeof diff === 'string' ? diff : '-';
  }

  const d = diff as Record<string, unknown>;

  // 1. Task reassigned: "Hitesh → Agastya Patel (owner) · <taskTitle>"
  if (fullKey === 'pm.task.reassigned' || action === 'task.reassigned') {
    const fromName = nameMap.get(String(d.fromUserId ?? '')) ?? String(d.fromUserId ?? 'Unassigned');
    const toName = nameMap.get(String(d.toUserId ?? '')) ?? String(d.toUserId ?? 'Unassigned');
    const roleStr = d.role ? ` (${String(d.role).toLowerCase()})` : '';
    const taskPart = d.taskTitle ? ` · ${d.taskTitle}` : '';
    return `${fromName} → ${toName}${roleStr}${taskPart}`;
  }

  // 2. Project tasks bulk reassigned: "27 tasks: Yogi Patel → Paras Prajapati"
  if (fullKey === 'pm.project.tasks.bulk_reassigned' || action === 'project.tasks.bulk_reassigned') {
    const count = d.count ?? d.taskCount ?? '';
    const fromName = nameMap.get(String(d.fromUserId ?? '')) ?? String(d.fromUserId ?? '');
    const toName = nameMap.get(String(d.toUserId ?? '')) ?? String(d.toUserId ?? '');
    return `${count} tasks: ${fromName} → ${toName}`;
  }

  // 3. Project deleted: "WO 123123 · gggg · 42 tasks"
  if (fullKey === 'pm.project.deleted' || action === 'project.deleted') {
    const parts: string[] = [];
    if (d.workOrderNo) parts.push(`WO ${d.workOrderNo}`);
    else if (d.code) parts.push(String(d.code));
    if (d.clientName) parts.push(String(d.clientName));
    if (d.taskCount !== undefined) parts.push(`${d.taskCount} tasks`);
    if (parts.length > 0) return parts.join(' · ');
  }

  // 4. Project created: "WO 7096 · PM Dhrupin Vaghasiya"
  if (fullKey === 'pm.project.created' || action === 'project.created') {
    const parts: string[] = [];
    if (d.workOrderNo) parts.push(`WO ${d.workOrderNo}`);
    else if (d.code) parts.push(String(d.code));
    if (d.projectManagerId) {
      const pmName = nameMap.get(String(d.projectManagerId)) ?? String(d.projectManagerId);
      parts.push(`PM ${pmName}`);
    } else if (d.clientName) {
      parts.push(String(d.clientName));
    }
    if (parts.length > 0) return parts.join(' · ');
  }

  // 5. Project member removed: "Removed Abbasali Sunasara"
  if (
    fullKey === 'pm.project.member.removed' ||
    action === 'project.member.removed' ||
    action === 'project.member_removed'
  ) {
    const removedId = d.removedUserId ?? d.userId;
    const name = nameMap.get(String(removedId ?? '')) ?? String(removedId ?? '');
    return `Removed ${name}`.trim();
  }

  // 6. Fallback: clean key/value list, resolving names and hiding null/empty
  const entries = Object.entries(d);
  const formattedPairs: string[] = [];

  for (const [k, v] of entries) {
    if (v === null || v === undefined || v === '') continue;

    let keyName = k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim().toLowerCase();

    // Check for transition object { from, to }
    if (
      typeof v === 'object' &&
      v !== null &&
      !Array.isArray(v) &&
      ('from' in v || 'to' in v)
    ) {
      const trans = v as { from?: unknown; to?: unknown };
      const fromStr = formatSingleValue(trans.from, nameMap);
      const toStr = formatSingleValue(trans.to, nameMap);
      const labelKey = keyName.charAt(0).toUpperCase() + keyName.slice(1);
      formattedPairs.push(`${labelKey}: ${fromStr} → ${toStr}`);
      continue;
    }

    const valStr = formatSingleValue(v, nameMap);

    if (keyName === 'user id' || keyName === 'userid') keyName = 'employee';
    if (keyName === 'actor id' || keyName === 'actorid') keyName = 'by';
    if (keyName === 'manager id' || keyName === 'managerid') keyName = 'manager';
    if (keyName === 'scope id' || keyName === 'scopeid') keyName = 'scope';
    if (keyName === 'role key' || keyName === 'rolekey') keyName = 'role';
    if (keyName === 'project id' || keyName === 'projectid') keyName = 'project';
    if (keyName === 'task id' || keyName === 'taskid') keyName = 'task';
    if (keyName === 'to user id' || keyName === 'touserid') keyName = 'to';
    if (keyName === 'from user id' || keyName === 'fromuserid') keyName = 'from';

    formattedPairs.push(`${keyName}: ${valStr}`);
  }

  return formattedPairs.length > 0 ? formattedPairs.join(', ') : '-';
}
