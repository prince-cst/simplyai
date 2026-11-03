import { z } from "zod";

const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

export const TriggerWindowConditionSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("daysUntil"),
      minDays: z.number().int().min(0).max(3650),
      maxDays: z.number().int().min(0).max(3650)
    }),
    z.object({
      kind: z.literal("onOrBefore"),
      date: DateOnlySchema
    }),
    z.object({
      kind: z.literal("onOrAfter"),
      date: DateOnlySchema
    }),
    z.object({
      kind: z.literal("between"),
      fromDate: DateOnlySchema,
      toDate: DateOnlySchema
    }),
    z.object({
      kind: z.literal("newDocuments")
    })
  ])
  .superRefine((c, ctx) => {
    if (c.kind === "daysUntil" && c.minDays > c.maxDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "minDays must be <= maxDays",
        path: ["minDays"]
      });
    }
    if (c.kind === "between" && c.fromDate > c.toDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fromDate must be <= toDate",
        path: ["fromDate"]
      });
    }
  });

export const TriggerWindowSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().min(1).max(200),
  condition: TriggerWindowConditionSchema,
  schedule: z.object({
    cron: z.string().min(1).max(120),
    timezone: z.string().min(1).max(80).optional()
  }),
  dedupeBucket: z.enum(["minute", "hour", "day", "week", "month"]).optional()
});

export const TriggerTargetSchema = z.object({
  engine: z.enum(["mongodb", "mysql", "mssql"]),
  collectionOrTable: z.string().min(1).max(200),
  dateField: z.string().min(1).max(200),
  extraFilter: z.union([z.record(z.unknown()), z.string()]).optional()
});

export const TriggerEmailSchema = z.object({
  to: z.array(z.string().email()).min(1).max(20),
  subjectTemplate: z.string().min(1).max(300),
  bodyTemplate: z.string().min(1).max(8000),
  displayFields: z.array(z.string().min(1).max(80)).max(20).optional()
});

export const TriggerProposalSchema = z.object({
  name: z.string().min(1).max(200),
  explanation: z.string().min(1).max(2000),
  target: TriggerTargetSchema,
  windows: z.array(TriggerWindowSchema).min(1).max(12),
  email: z
    .object({
      to: z.array(z.string()).optional(),
      subjectTemplate: z.string().min(1).max(300),
      bodyTemplate: z.string().min(1).max(8000),
      displayFields: z.array(z.string().min(1).max(80)).max(20).optional()
    })
    .optional()
});

export const ProposeTriggerBodySchema = z.object({
  prompt: z.string().min(3).max(4000),
  connectionId: z.string().min(1).optional()
});

export const CreateTriggerBodySchema = z.object({
  name: z.string().min(1).max(200),
  connectionId: z.string().min(1).optional(),
  userPrompt: z.string().min(1).max(4000),
  explanation: z.string().min(1).max(2000),
  target: TriggerTargetSchema,
  windows: z.array(TriggerWindowSchema).min(1).max(12),
  email: TriggerEmailSchema,
  status: z.enum(["draft", "active", "paused"]).optional()
});

export const PatchTriggerBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  explanation: z.string().min(1).max(2000).optional(),
  target: TriggerTargetSchema.optional(),
  windows: z.array(TriggerWindowSchema).min(1).max(12).optional(),
  email: TriggerEmailSchema.optional(),
  status: z.enum(["draft", "active", "paused"]).optional()
});

export const TestTriggerBodySchema = z.object({
  windowId: z.string().min(1).optional(),
  sendEmail: z.boolean().optional(),
  dryRun: z.boolean().optional()
});
