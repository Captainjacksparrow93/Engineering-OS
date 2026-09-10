import { z } from 'zod';

/** Input contracts shared by route handlers, server actions and tests. */

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const optionalDate = z.union([isoDate, z.literal('').transform(() => null), z.null()]).optional();

export const createProjectSchema = z.object({
  name: z.string().trim().min(3, 'Project name is too short').max(160),
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9][A-Z0-9-]{2,19}$/, 'Use 3-20 uppercase letters, digits or dashes')
    .optional(),
  description: z.string().trim().max(4000).optional(),
  clientName: z.string().trim().min(2, 'Client name is required').max(160),
  poNumber: z.string().trim().max(60).optional(),
  orderValue: z.coerce.number().nonnegative().optional(),
  panelType: z.string().trim().max(120).optional(),
  panelCount: z.coerce.number().int().min(0).max(10_000).default(0),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  status: z.enum(['DRAFT', 'PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).default('PLANNING'),
  startDate: optionalDate,
  targetEndDate: optionalDate,
  managerId: z.string().min(1, 'Pick a project manager'),
  sponsorId: z.string().optional(),
  departmentId: z.string().optional(),
});

export const updateProjectSchema = createProjectSchema.partial().omit({ code: true });

export const createTaskSchema = z
  .object({
    projectId: z.string().min(1),
    parentId: z.string().optional().nullable(),
    milestoneId: z.string().optional().nullable(),
    title: z.string().trim().min(3, 'Task title is too short').max(200),
    description: z.string().trim().max(4000).optional(),
    type: z.enum(['PROJECT', 'ADHOC', 'PHASE']).default('PROJECT'),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
    estimatedHours: z.coerce.number().positive('Estimate must be greater than zero').max(2000).default(8),
    plannedStart: optionalDate,
    plannedEnd: optionalDate,
    requiredSkills: z.array(z.string().trim().min(1)).max(12).default([]),
    assigneeId: z.string().optional().nullable(),
    /** Predecessor task ids to wire up at creation time. */
    dependsOn: z.array(z.string()).max(20).default([]),
  })
  .refine(
    (data) => !data.plannedStart || !data.plannedEnd || data.plannedEnd >= data.plannedStart,
    { message: 'Planned end cannot be before planned start', path: ['plannedEnd'] },
  );

export const updateTaskSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  estimatedHours: z.coerce.number().positive().max(2000).optional(),
  plannedStart: optionalDate,
  plannedEnd: optionalDate,
  milestoneId: z.string().nullable().optional(),
  requiredSkills: z.array(z.string().trim().min(1)).max(12).optional(),
});

export const changeTaskStatusSchema = z.object({
  status: z.enum(['DRAFT', 'BLOCKED', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED', 'CANCELLED']),
  note: z.string().trim().max(500).optional(),
});

export const assignTaskSchema = z.object({
  userId: z.string().min(1, 'Pick an engineer'),
  role: z.enum(['OWNER', 'COLLABORATOR', 'REVIEWER']).default('OWNER'),
  allocatedHours: z.coerce.number().positive().max(2000).optional(),
  note: z.string().trim().max(500).optional(),
});

export const dependencySchema = z.object({
  predecessorId: z.string().min(1),
  successorId: z.string().min(1),
  type: z.enum(['FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH', 'START_TO_FINISH']).default('FINISH_TO_START'),
  lagDays: z.coerce.number().int().min(-60).max(180).default(0),
});

export const progressSchema = z.object({
  taskId: z.string().min(1),
  percentComplete: z.coerce.number().int().min(0).max(100),
  hoursSpent: z.coerce.number().min(0).max(24, 'More than 24 hours in one punch-in is not plausible').default(0),
  note: z.string().trim().min(3, 'Say what moved forward').max(2000),
  blocker: z.string().trim().max(1000).optional(),
  loggedFor: optionalDate,
});

export const handoverRequestSchema = z.object({
  taskId: z.string().min(1),
  toUserId: z.string().min(1, 'Pick the peer taking this over'),
  reason: z.string().trim().min(5, 'Explain why the work is moving').max(1000),
});

export const handoverDecisionSchema = z.object({
  decision: z.enum(['ACCEPTED', 'REJECTED']),
  note: z.string().trim().max(1000).optional(),
});

export const adhocTaskSchema = createTaskSchema;

export const availabilityQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  departmentId: z.string().optional(),
  skills: z.string().optional(),
  requiredHours: z.coerce.number().min(0).max(2000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type ProgressInput = z.infer<typeof progressSchema>;
