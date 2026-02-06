import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  ErrorCode,
  OpenFeatureEventEmitter,
  StandardResolutionReasons,
} from '@openfeature/server-sdk';
import { FlagrProvider } from '../../FlagrProvider';
import type { FlagrProviderConfig } from '../../types/FlagrProviderConfig';
import { server } from '../mocks/server';
import {
  createVariantHandler,
  createNoMatchHandler,
  createNotFoundHandler,
  createServerErrorHandler,
  createAttachmentHandler,
  createFlagrResponse,
  createHealthCheckHandler,
  createHealthCheckErrorHandler,
  createHealthCheckTimeoutHandler,
  createHealthCheckNetworkErrorHandler,
  createBatchHandler,
  createBatchServerErrorHandler,
} from '../mocks/handlers';
import { http, HttpResponse } from 'msw';

const BASE_URL = 'http://localhost:18000';

const defaultConfig: FlagrProviderConfig = {
  baseUrl: BASE_URL,
  truthyVariants: new Set(['on', 'true', 'enabled']),
  timeout: 5000,
};

const silentLogger = {
  debug: () => {
    /* empty */
  },
  info: () => {
    /* empty */
  },
  warn: () => {
    /* empty */
  },
  error: () => {
    /* empty */
  },
};

describe('FlagrProvider', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  describe('metadata', () => {
    it('should have correct provider name', () => {
      const provider = new FlagrProvider(defaultConfig);
      expect(provider.metadata.name).toBe('Flagr Provider');
    });

    it('should run on server', () => {
      const provider = new FlagrProvider(defaultConfig);
      expect(provider.runsOn).toBe('server');
    });
  });

  describe('lifecycle', () => {
    describe('events', () => {
      it('should have an OpenFeatureEventEmitter instance', () => {
        const provider = new FlagrProvider(defaultConfig);
        expect(provider.events).toBeInstanceOf(OpenFeatureEventEmitter);
      });
    });

    describe('initialize', () => {
      it('should resolve when health check succeeds', async () => {
        server.use(createHealthCheckHandler());
        const provider = new FlagrProvider(defaultConfig);

        await expect(provider.initialize()).resolves.toBeUndefined();
      });

      it('should reject when health check returns non-2xx status', async () => {
        server.use(createHealthCheckErrorHandler(503));
        const provider = new FlagrProvider(defaultConfig);

        await expect(provider.initialize()).rejects.toThrow(
          'Flagr health check failed with status 503'
        );
      });

      it('should reject on network error', async () => {
        server.use(createHealthCheckNetworkErrorHandler());
        const provider = new FlagrProvider(defaultConfig);

        await expect(provider.initialize()).rejects.toThrow();
      });

      it('should reject on timeout', async () => {
        server.use(createHealthCheckTimeoutHandler(200));
        const provider = new FlagrProvider({
          ...defaultConfig,
          timeout: 50, // Short timeout to trigger abort
        });

        await expect(provider.initialize()).rejects.toThrow(
          'Flagr health check timed out after 50ms'
        );
      });

      it('should use default timeout of 5000ms when not configured', async () => {
        const configWithoutTimeout: FlagrProviderConfig = {
          baseUrl: BASE_URL,
          truthyVariants: new Set(['on']),
        };
        server.use(createHealthCheckHandler());
        const provider = new FlagrProvider(configWithoutTimeout);

        // Should resolve quickly since health check succeeds
        await expect(provider.initialize()).resolves.toBeUndefined();
      });
    });

    describe('onClose', () => {
      it('should resolve without error', async () => {
        const provider = new FlagrProvider(defaultConfig);

        await expect(provider.onClose()).resolves.toBeUndefined();
      });
    });
  });

  describe('resolveBooleanEvaluation', () => {
    it('should return true when variantKey is in truthyVariants', async () => {
      server.use(createVariantHandler('on'));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveBooleanEvaluation(
        'test-flag',
        false,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(true);
      expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
      expect(result.variant).toBe('on');
    });

    it('should return false when variantKey is not in truthyVariants', async () => {
      server.use(createVariantHandler('off'));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveBooleanEvaluation(
        'test-flag',
        false,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(false);
      expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
      expect(result.variant).toBe('off');
    });

    it('should match truthyVariants case-insensitively', async () => {
      server.use(createVariantHandler('ON'));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveBooleanEvaluation(
        'test-flag',
        false,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(true);
    });

    it('should match truthyVariants with mixed case variants', async () => {
      // Test various mixed case patterns to verify case-insensitivity
      const mixedCaseVariants = ['On', 'oN', 'TrUe', 'TRUE', 'EnAbLeD'];

      for (const variant of mixedCaseVariants) {
        server.use(createVariantHandler(variant));
        const provider = new FlagrProvider(defaultConfig);

        const result = await provider.resolveBooleanEvaluation(
          'test-flag',
          false,
          { targetingKey: 'user-123' },
          silentLogger
        );

        expect(result.value).toBe(true);
      }
    });

    it('should return false for any variant NOT in truthyVariants (implicit falsy)', async () => {
      // Design decision: Any variantKey not in truthyVariants resolves to false
      // This is different from number evaluation which has a fallback to variantAttachment
      server.use(createVariantHandler('custom-variant'));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveBooleanEvaluation(
        'test-flag',
        false,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(false);
      expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
      expect(result.variant).toBe('custom-variant');
    });

    it('should return defaultValue when no segment matches', async () => {
      server.use(createNoMatchHandler());
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveBooleanEvaluation(
        'test-flag',
        true,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(true);
      expect(result.reason).toBe(StandardResolutionReasons.DEFAULT);
    });

    it('should return FLAG_NOT_FOUND error for missing flag', async () => {
      server.use(createNotFoundHandler());
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveBooleanEvaluation(
        'non-existent-flag',
        false,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(false);
      expect(result.reason).toBe(StandardResolutionReasons.ERROR);
      expect(result.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND);
      expect(result.errorMessage).toContain('not found');
    });

    it('should return GENERAL error for server errors', async () => {
      server.use(createServerErrorHandler());
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveBooleanEvaluation(
        'test-flag',
        false,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(false);
      expect(result.reason).toBe(StandardResolutionReasons.ERROR);
      expect(result.errorCode).toBe(ErrorCode.GENERAL);
    });

    it('should include flagMetadata with flagSnapshotID', async () => {
      server.use(createVariantHandler('on'));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveBooleanEvaluation(
        'test-flag',
        false,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.flagMetadata).toBeDefined();
      expect(result.flagMetadata?.flagSnapshotID).toBe(123);
    });

    it('should include segmentID in flagMetadata when present', async () => {
      server.use(createVariantHandler('on'));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveBooleanEvaluation(
        'test-flag',
        false,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.flagMetadata?.segmentID).toBe(1);
    });

    it.each([
      ['on', true],
      ['true', true],
      ['enabled', true],
      ['off', false],
      ['false', false],
      ['disabled', false],
      ['control', false],
      ['treatment', false],
    ])('should evaluate variant "%s" as %s', async (variant, expected) => {
      server.use(createVariantHandler(variant));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveBooleanEvaluation(
        'test-flag',
        false,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(expected);
    });
  });

  describe('resolveNumberEvaluation', () => {
    it('should parse numeric variantKey', async () => {
      // Create handler that returns a numeric variantKey
      server.use(
        http.post(`${BASE_URL}/api/v1/evaluation`, () => {
          return HttpResponse.json(
            createFlagrResponse({
              variantKey: '42',
            })
          );
        })
      );
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveNumberEvaluation(
        'test-flag',
        0,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(42);
      expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
      expect(result.variant).toBe('42');
    });

    it('should parse float variantKey', async () => {
      server.use(
        http.post(`${BASE_URL}/api/v1/evaluation`, () => {
          return HttpResponse.json(
            createFlagrResponse({
              variantKey: '3.14',
            })
          );
        })
      );
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveNumberEvaluation(
        'test-flag',
        0,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(3.14);
    });

    it('should fallback to variantAttachment.value when variantKey is non-numeric', async () => {
      server.use(createAttachmentHandler({ value: 99 }));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveNumberEvaluation(
        'test-flag',
        0,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(99);
      expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
    });

    it('should return TYPE_MISMATCH when variantAttachment.value is not a number', async () => {
      server.use(createAttachmentHandler({ value: 'not-a-number' }));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveNumberEvaluation(
        'test-flag',
        0,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(0);
      expect(result.reason).toBe(StandardResolutionReasons.ERROR);
      expect(result.errorCode).toBe(ErrorCode.TYPE_MISMATCH);
    });

    it('should return PARSE_ERROR when variantKey is non-numeric and no attachment', async () => {
      server.use(createVariantHandler('not-a-number'));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveNumberEvaluation(
        'test-flag',
        0,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(0);
      expect(result.reason).toBe(StandardResolutionReasons.ERROR);
      expect(result.errorCode).toBe(ErrorCode.PARSE_ERROR);
    });

    it('should return defaultValue when no segment matches', async () => {
      server.use(createNoMatchHandler());
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveNumberEvaluation(
        'test-flag',
        42,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(42);
      expect(result.reason).toBe(StandardResolutionReasons.DEFAULT);
    });

    it('should return FLAG_NOT_FOUND error for missing flag', async () => {
      server.use(createNotFoundHandler());
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveNumberEvaluation(
        'non-existent-flag',
        0,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(0);
      expect(result.reason).toBe(StandardResolutionReasons.ERROR);
      expect(result.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND);
    });
  });

  describe('resolveStringEvaluation', () => {
    it('should return variantKey as string value', async () => {
      server.use(createVariantHandler('variant-a'));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveStringEvaluation(
        'test-flag',
        'default',
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe('variant-a');
      expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
      expect(result.variant).toBe('variant-a');
    });

    it('should return defaultValue when no segment matches', async () => {
      server.use(createNoMatchHandler());
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveStringEvaluation(
        'test-flag',
        'default-value',
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe('default-value');
      expect(result.reason).toBe(StandardResolutionReasons.DEFAULT);
    });

    it('should return FLAG_NOT_FOUND error for missing flag', async () => {
      server.use(createNotFoundHandler());
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveStringEvaluation(
        'non-existent-flag',
        'default',
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe('default');
      expect(result.reason).toBe(StandardResolutionReasons.ERROR);
      expect(result.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND);
      expect(result.errorMessage).toContain('not found');
    });

    it('should return GENERAL error for server errors', async () => {
      server.use(createServerErrorHandler());
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveStringEvaluation(
        'test-flag',
        'default',
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe('default');
      expect(result.reason).toBe(StandardResolutionReasons.ERROR);
      expect(result.errorCode).toBe(ErrorCode.GENERAL);
    });

    it('should include flagMetadata with flagSnapshotID and segmentID', async () => {
      server.use(createVariantHandler('variant-b'));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveStringEvaluation(
        'test-flag',
        'default',
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.flagMetadata).toBeDefined();
      expect(result.flagMetadata?.flagSnapshotID).toBe(123);
      expect(result.flagMetadata?.segmentID).toBe(1);
    });
  });

  describe('resolveObjectEvaluation', () => {
    it('should return variantAttachment when present', async () => {
      const attachment = {
        config: { theme: 'dark', maxItems: 10 },
        features: ['a', 'b', 'c'],
      };
      server.use(createAttachmentHandler(attachment));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveObjectEvaluation(
        'test-flag',
        { default: 'object' },
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toEqual(attachment);
      expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
      expect(result.variant).toBe('variant-with-attachment');
    });

    it('should return defaultValue when variantAttachment is missing', async () => {
      server.use(createVariantHandler('some-variant'));
      const provider = new FlagrProvider(defaultConfig);
      const defaultObj = { fallback: true };

      const result = await provider.resolveObjectEvaluation(
        'test-flag',
        defaultObj,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toEqual(defaultObj);
      expect(result.reason).toBe(StandardResolutionReasons.DEFAULT);
    });

    it('should return defaultValue when no segment matches', async () => {
      server.use(createNoMatchHandler());
      const provider = new FlagrProvider(defaultConfig);
      const defaultObj = { noMatch: true };

      const result = await provider.resolveObjectEvaluation(
        'test-flag',
        defaultObj,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toEqual(defaultObj);
      expect(result.reason).toBe(StandardResolutionReasons.DEFAULT);
    });

    it('should return FLAG_NOT_FOUND error for missing flag', async () => {
      server.use(createNotFoundHandler());
      const provider = new FlagrProvider(defaultConfig);
      const defaultObj = { error: 'fallback' };

      const result = await provider.resolveObjectEvaluation(
        'non-existent-flag',
        defaultObj,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toEqual(defaultObj);
      expect(result.reason).toBe(StandardResolutionReasons.ERROR);
      expect(result.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND);
      expect(result.errorMessage).toContain('not found');
    });

    it('should return GENERAL error for server errors', async () => {
      server.use(createServerErrorHandler());
      const provider = new FlagrProvider(defaultConfig);
      const defaultObj = { server: 'error' };

      const result = await provider.resolveObjectEvaluation(
        'test-flag',
        defaultObj,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toEqual(defaultObj);
      expect(result.reason).toBe(StandardResolutionReasons.ERROR);
      expect(result.errorCode).toBe(ErrorCode.GENERAL);
    });

    it('should include flagMetadata with flagSnapshotID and segmentID', async () => {
      server.use(createAttachmentHandler({ meta: 'data' }));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveObjectEvaluation(
        'test-flag',
        {},
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.flagMetadata).toBeDefined();
      expect(result.flagMetadata?.flagSnapshotID).toBe(123);
      expect(result.flagMetadata?.segmentID).toBe(1);
    });

    it('should handle nested object attachments', async () => {
      const nestedAttachment = {
        level1: {
          level2: {
            level3: { value: 'deep' },
          },
        },
        array: [1, 2, { nested: true }],
      };
      server.use(createAttachmentHandler(nestedAttachment));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveObjectEvaluation(
        'test-flag',
        {},
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toEqual(nestedAttachment);
    });

    it('should handle empty object attachment', async () => {
      server.use(createAttachmentHandler({}));
      const provider = new FlagrProvider(defaultConfig);

      const result = await provider.resolveObjectEvaluation(
        'test-flag',
        { default: true },
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toEqual({});
      expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
    });
  });

  describe('with batching enabled', () => {
    const batchConfig: FlagrProviderConfig = {
      ...defaultConfig,
      batching: { enabled: true },
    };

    it('should resolve boolean evaluation via batch endpoint', async () => {
      server.use(
        createHealthCheckHandler(),
        createBatchHandler({ 'test-flag': { variantKey: 'on' } })
      );

      const provider = new FlagrProvider(batchConfig);

      const result = await provider.resolveBooleanEvaluation(
        'test-flag',
        false,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(true);
      expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
      expect(result.variant).toBe('on');
    });

    it('should resolve string evaluation via batch endpoint', async () => {
      server.use(
        createHealthCheckHandler(),
        createBatchHandler({ 'test-flag': { variantKey: 'variant-a' } })
      );

      const provider = new FlagrProvider(batchConfig);

      const result = await provider.resolveStringEvaluation(
        'test-flag',
        'default',
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe('variant-a');
      expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
    });

    it('should resolve number evaluation via batch endpoint', async () => {
      server.use(
        createHealthCheckHandler(),
        createBatchHandler({ 'test-flag': { variantKey: '42' } })
      );

      const provider = new FlagrProvider(batchConfig);

      const result = await provider.resolveNumberEvaluation(
        'test-flag',
        0,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(42);
      expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
    });

    it('should resolve object evaluation via batch endpoint', async () => {
      const attachment = { theme: 'dark' };
      server.use(
        createHealthCheckHandler(),
        createBatchHandler({ 'test-flag': { variantKey: 'v1', variantAttachment: attachment } })
      );

      const provider = new FlagrProvider(batchConfig);

      const result = await provider.resolveObjectEvaluation(
        'test-flag',
        {},
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toEqual(attachment);
      expect(result.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
    });

    it('should return default value when no segment matches via batch', async () => {
      server.use(
        createHealthCheckHandler(),
        createBatchHandler({ 'test-flag': { variantKey: undefined } })
      );

      const provider = new FlagrProvider(batchConfig);

      const result = await provider.resolveBooleanEvaluation(
        'test-flag',
        true,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(true);
      expect(result.reason).toBe(StandardResolutionReasons.DEFAULT);
    });

    it('should return GENERAL error on batch server failure', async () => {
      server.use(createHealthCheckHandler(), createBatchServerErrorHandler());

      const provider = new FlagrProvider(batchConfig);

      const result = await provider.resolveBooleanEvaluation(
        'test-flag',
        false,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(false);
      expect(result.reason).toBe(StandardResolutionReasons.ERROR);
      expect(result.errorCode).toBe(ErrorCode.GENERAL);
    });

    it('should return FLAG_NOT_FOUND error for missing flag via batch', async () => {
      server.use(
        createHealthCheckHandler(),
        createBatchHandler({ 'other-flag': { variantKey: 'on' } })
      );

      const provider = new FlagrProvider(batchConfig);

      const result = await provider.resolveBooleanEvaluation(
        'non-existent-flag',
        false,
        { targetingKey: 'user-123' },
        silentLogger
      );

      expect(result.value).toBe(false);
      expect(result.reason).toBe(StandardResolutionReasons.ERROR);
      expect(result.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND);
      expect(result.errorMessage).toContain('not found');
    });
  });
});
