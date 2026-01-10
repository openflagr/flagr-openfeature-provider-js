import * as z from 'zod';

/**
 * Defined in https://openflagr.github.io/flagr/api_docs/#operation/postEvaluation
 */
export const FlagrEvalDebugLog = z.object({
  segmentDebugLogs: z.array(
    z.object({
      segmentID: z.number(),
      msg: z.string().optional(),
    })
  ),
  msg: z.string().optional(),
});

export type FlagrEvalDebugLog = z.infer<typeof FlagrEvalDebugLog>;
