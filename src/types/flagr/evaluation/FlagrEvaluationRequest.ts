import * as z from 'zod';

/**
 * Object as defined in https://openflagr.github.io/flagr/api_docs/#operation/postEvaluation
 */
const FlagrEvaluationRequest = z.object({
  entityID: z.string(),
  entityType: z.string().optional(),
  entityContext: z.record(z.string(), z.unknown()).optional(),
  enableDebug: z.boolean().optional(),
  flagID: z.number().min(0).optional(),
  flagKey: z.string().optional(),
  flagTags: z.array(z.string()).optional(),
  flagTagsOperator: z.enum(['ANY', 'ALL']).optional(),
});

export type FlagrEvaluationRequest = z.infer<typeof FlagrEvaluationRequest>;
