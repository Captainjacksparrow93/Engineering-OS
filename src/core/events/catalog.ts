/**
 * Every event the platform publishes, in one place.
 *
 * This file is the integration contract for modules that do not exist yet. Keeping it
 * explicit means a future HRMS author can see exactly what PM emits without reading
 * PM's internals - and PM can change its internals freely as long as these hold.
 */
export const EVENTS = {
  // Project Management -> anyone
  PROJECT_CREATED: 'pm.project.created',
  PROJECT_STATUS_CHANGED: 'pm.project.status_changed',
  TASK_CREATED: 'pm.task.created',
  TASK_ASSIGNED: 'pm.task.assigned',
  TASK_STATUS_CHANGED: 'pm.task.status_changed',
  TASK_COMPLETED: 'pm.task.completed',
  TASK_BLOCKED: 'pm.task.blocked',
  PROGRESS_LOGGED: 'pm.progress.logged',
  HANDOVER_REQUESTED: 'pm.handover.requested',
  HANDOVER_ACCEPTED: 'pm.handover.accepted',
  HANDOVER_REJECTED: 'pm.handover.rejected',

  // Reserved for modules on the roadmap. Declared now so PM can already listen.
  HRMS_LEAVE_APPROVED: 'hrms.leave.approved',
  HRMS_EMPLOYEE_EXITED: 'hrms.employee.exited',
  ERP_PO_RELEASED: 'erp.purchase_order.released',
  ERP_MATERIAL_RECEIVED: 'erp.material.received',
  GATE_VISITOR_CHECKED_IN: 'gate.visitor.checked_in',
  PRODUCTION_PANEL_DISPATCHED: 'production.panel.dispatched',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
