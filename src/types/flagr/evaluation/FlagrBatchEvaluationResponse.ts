import * as z from 'zod';
import { FlagrEvaluationResponse } from './FlagrEvaluationResponse';

/**
 * Response body from Flagr's batch evaluation endpoint.
 * @see https://openflagr.github.io/flagr/api_docs/#operation/postEvaluationBatch
 */
export const FlagrBatchEvaluationResponse = z.object({
  evaluationResults: z.array(FlagrEvaluationResponse),
});

export type FlagrBatchEvaluationResponse = z.infer<typeof FlagrBatchEvaluationResponse>;
