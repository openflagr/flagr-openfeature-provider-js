import * as z from 'zod';

/**
 * A single entity in a batch evaluation request.
 */
const FlagrBatchEntity = z.object({
  entityID: z.string(),
  entityType: z.string().optional(),
  entityContext: z.record(z.string(), z.unknown()).optional(),
});

export type FlagrBatchEntity = z.infer<typeof FlagrBatchEntity>;

/**
 * Request body for Flagr's batch evaluation endpoint.
 * @see https://openflagr.github.io/flagr/api_docs/#operation/postEvaluationBatch
 */
export const FlagrBatchEvaluationRequest = z.object({
  entities: z.array(FlagrBatchEntity).min(1),
  flagKeys: z.array(z.string()).min(1).optional(),
  flagIDs: z.array(z.number()).min(1).optional(),
  flagTags: z.array(z.string()).min(1).optional(),
  flagTagsOperator: z.enum(['ANY', 'ALL']).optional(),
  enableDebug: z.boolean().optional(),
});

export type FlagrBatchEvaluationRequest = z.infer<typeof FlagrBatchEvaluationRequest>;
