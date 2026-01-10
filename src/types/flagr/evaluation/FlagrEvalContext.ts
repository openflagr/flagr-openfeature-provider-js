import * as z from 'zod';

export const FlagrEvalContextSchema = z.object({
  entityID: z.string(),
  entityType: z.string(),
  entityContext: z.object({}).optional(),
  enableDebug: z.boolean().optional(),
  flagID: z.number().optional(),
  flagKey: z.string().optional(),
  flagTags: z.array(z.string()).optional(),
  flagTagsOperator: z.enum(['ANY', 'ALL']).optional(),
});

export type FlagrEvalContext = z.infer<typeof FlagrEvalContextSchema>;
