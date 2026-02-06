import { http, HttpResponse, delay } from 'msw';
import type { FlagrEvaluationResponse } from '../../types/flagr/evaluation/FlagrEvaluationResponse';
import type { FlagrBatchEvaluationRequest } from '../../types/flagr/evaluation/FlagrBatchEvaluationRequest';

const BASE_URL = 'http://localhost:18000';

/**
 * Creates a valid Flagr evaluation response
 */
export function createFlagrResponse(
  overrides: Partial<FlagrEvaluationResponse> = {}
): FlagrEvaluationResponse {
  return {
    flagID: 1,
    flagKey: 'test-flag',
    flagSnapshotID: 123,
    segmentID: 1,
    variantID: 1,
    variantKey: 'on',
    evalContext: {
      entityID: 'test-user',
      entityType: 'user',
    },
    timestamp: new Date().toISOString(),
    evalDebugLog: {
      segmentDebugLogs: [],
      msg: 'success',
    },
    ...overrides,
  };
}

/**
 * Default handlers for Flagr API
 */
export const handlers = [
  // Health check endpoint
  http.get(`${BASE_URL}/api/v1/health`, () => {
    return HttpResponse.json({ status: 'ok' });
  }),

  // Success response with variant
  http.post(`${BASE_URL}/api/v1/evaluation`, async ({ request }) => {
    const body = (await request.json()) as { flagKey?: string };
    return HttpResponse.json(
      createFlagrResponse({
        flagKey: body.flagKey ?? 'test-flag',
      })
    );
  }),
];

/**
 * Handler that returns a specific variant
 */
export function createVariantHandler(variantKey: string, baseUrl = BASE_URL) {
  return http.post(`${baseUrl}/api/v1/evaluation`, async ({ request }) => {
    const body = (await request.json()) as { flagKey?: string };
    return HttpResponse.json(
      createFlagrResponse({
        flagKey: body.flagKey ?? 'test-flag',
        variantKey,
      })
    );
  });
}

/**
 * Handler that returns no variant (no segment match)
 */
export function createNoMatchHandler(baseUrl = BASE_URL) {
  return http.post(`${baseUrl}/api/v1/evaluation`, async ({ request }) => {
    const body = (await request.json()) as { flagKey?: string };
    return HttpResponse.json(
      createFlagrResponse({
        flagKey: body.flagKey ?? 'test-flag',
        variantKey: undefined,
        variantID: undefined,
        segmentID: undefined,
      })
    );
  });
}

/**
 * Handler that returns a 404 (flag not found)
 */
export function createNotFoundHandler(baseUrl = BASE_URL) {
  return http.post(`${baseUrl}/api/v1/evaluation`, () => {
    return new HttpResponse(null, { status: 404 });
  });
}

/**
 * Handler that returns a 500 (server error)
 */
export function createServerErrorHandler(baseUrl = BASE_URL) {
  return http.post(`${baseUrl}/api/v1/evaluation`, () => {
    return new HttpResponse('Internal Server Error', { status: 500 });
  });
}

/**
 * Handler that times out
 */
export function createTimeoutHandler(delayMs: number, baseUrl = BASE_URL) {
  return http.post(`${baseUrl}/api/v1/evaluation`, async () => {
    await delay(delayMs);
    return HttpResponse.json(createFlagrResponse());
  });
}

/**
 * Handler that returns invalid JSON
 */
export function createMalformedResponseHandler(baseUrl = BASE_URL) {
  return http.post(`${baseUrl}/api/v1/evaluation`, () => {
    return HttpResponse.json({ invalid: 'response' });
  });
}

/**
 * Handler that returns a response with variant attachment
 */
export function createAttachmentHandler(attachment: Record<string, unknown>, baseUrl = BASE_URL) {
  return http.post(`${baseUrl}/api/v1/evaluation`, async ({ request }) => {
    const body = (await request.json()) as { flagKey?: string };
    return HttpResponse.json(
      createFlagrResponse({
        flagKey: body.flagKey ?? 'test-flag',
        variantKey: 'variant-with-attachment',
        variantAttachment: attachment,
      })
    );
  });
}

/**
 * Handler for successful health check
 */
export function createHealthCheckHandler(baseUrl = BASE_URL) {
  return http.get(`${baseUrl}/api/v1/health`, () => {
    return HttpResponse.json({ status: 'ok' });
  });
}

/**
 * Handler for failed health check (non-2xx status)
 */
export function createHealthCheckErrorHandler(status: number, baseUrl = BASE_URL) {
  return http.get(`${baseUrl}/api/v1/health`, () => {
    return new HttpResponse(null, { status });
  });
}

/**
 * Handler for health check timeout
 */
export function createHealthCheckTimeoutHandler(delayMs: number, baseUrl = BASE_URL) {
  return http.get(`${baseUrl}/api/v1/health`, async () => {
    await delay(delayMs);
    return HttpResponse.json({ status: 'ok' });
  });
}

/**
 * Handler for health check network error
 */
export function createHealthCheckNetworkErrorHandler(baseUrl = BASE_URL) {
  return http.get(`${baseUrl}/api/v1/health`, () => {
    return HttpResponse.error();
  });
}

/**
 * Handler for batch evaluation that returns results for given flag configurations.
 * Each entry in flagResults maps a flagKey to its variant and optional attachment.
 */
export function createBatchHandler(
  flagResults: Record<string, { variantKey?: string; variantAttachment?: Record<string, unknown> }>,
  baseUrl = BASE_URL
) {
  return http.post(`${baseUrl}/api/v1/evaluation/batch`, async ({ request }) => {
    const body = (await request.json()) as FlagrBatchEvaluationRequest;
    const evaluationResults: FlagrEvaluationResponse[] = [];

    for (const entity of body.entities) {
      for (const flagKey of body.flagKeys ?? []) {
        if (!(flagKey in flagResults)) continue;
        const result = flagResults[flagKey];
        evaluationResults.push(
          createFlagrResponse({
            flagKey,
            variantKey: result.variantKey,
            variantAttachment: result.variantAttachment,
            variantID: result.variantKey ? 1 : undefined,
            segmentID: result.variantKey ? 1 : undefined,
            evalContext: {
              entityID: entity.entityID,
              entityType: entity.entityType ?? 'user',
            },
          })
        );
      }
    }

    return HttpResponse.json({ evaluationResults });
  });
}

/**
 * Handler for batch evaluation that returns a 500 server error.
 */
export function createBatchServerErrorHandler(baseUrl = BASE_URL) {
  return http.post(`${baseUrl}/api/v1/evaluation/batch`, () => {
    return new HttpResponse('Internal Server Error', { status: 500 });
  });
}

/**
 * Handler for batch evaluation that times out.
 */
export function createBatchTimeoutHandler(delayMs: number, baseUrl = BASE_URL) {
  return http.post(`${baseUrl}/api/v1/evaluation/batch`, async () => {
    await delay(delayMs);
    return HttpResponse.json({ evaluationResults: [] });
  });
}
