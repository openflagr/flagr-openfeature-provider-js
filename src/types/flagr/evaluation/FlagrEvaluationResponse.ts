import * as z from 'zod';
import { FlagrEvalContextSchema } from './FlagrEvalContext';
import { FlagrEvalDebugLog } from './FlagrEvalDebugLog';

/**
 * Defined in https://openflagr.github.io/flagr/api_docs/#operation/postEvaluation
 */
export const FlagrEvaluationResponse = z.object({
  flagID: z.number(),
  flagKey: z.string(),
  flagSnapshotID: z.number(),
  segmentID: z.number().optional(),
  variantID: z.number().optional(),
  variantKey: z.string().optional(),
  variantAttachment: z.record(z.string(), z.unknown()).optional(),
  evalContext: FlagrEvalContextSchema,
  timestamp: z.string(),
  evalDebugLog: FlagrEvalDebugLog,
});

export type FlagrEvaluationResponse = z.infer<typeof FlagrEvaluationResponse>;
