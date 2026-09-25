/**
 * Formatting helpers for the platform audit trail.
 *
 * Provides human-readable sentences for known actions, clean entity labels,
 * and robust fallback key-value formatting without leaking sensitive data or nulls.
 */

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
    return {
      label: 'Project',
      href: `/pm/projects/${entityId}`,
    };
  }

  if (entityType === 'Task') {
    return {
      label: 'Task',
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
    let valStr = '';

    if (typeof v === 'string') {
      if (nameMap.has(v)) {
        valStr = nameMap.get(v)!;
      } else {
        valStr = v.replace(/_/g, ' ');
      }
    } else if (typeof v === 'object') {
      valStr = JSON.stringify(v);
    } else {
      valStr = String(v);
    }

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
