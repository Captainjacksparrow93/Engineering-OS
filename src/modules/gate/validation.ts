import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const visitor = {
  visitorName: z.string().trim().min(2, "Enter the visitor's name.").max(120),
  visitorPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 -]{6,18}[0-9]$/, 'Enter a phone number, like 98250 12345.'),
  visitorCompany: optionalText(120),
  purpose: z.string().trim().min(2, 'Say what the visit is for.').max(300),
};

export const scheduleSchema = z.object({
  ...visitor,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the visit date.'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick the visit time.'),
  /** Only the front desk names someone else; employees schedule visits to themselves. */
  hostId: optionalText(40),
});
export type ScheduleInput = z.input<typeof scheduleSchema>;

export const walkInSchema = z.object({
  ...visitor,
  hostId: z.string().trim().min(1, 'Pick who they have come to see.'),
});
export type WalkInInput = z.input<typeof walkInSchema>;

export const HOST_REPLIES = ['COMING', 'WAIT', 'UNAVAILABLE'] as const;
export const replySchema = z.object({
  reply: z.enum(HOST_REPLIES, { message: 'Pick a reply.' }),
  note: optionalText(200),
});
/** Raw form input; the schema checks the reply is one of `HOST_REPLIES`. */
export type ReplyInput = { reply: string; note?: string | null };

export const registerFilterSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  q: optionalText(80),
});
