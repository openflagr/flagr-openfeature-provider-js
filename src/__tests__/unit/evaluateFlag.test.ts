import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { FlagNotFoundError, GeneralError } from '@openfeature/server-sdk';
import { evaluateFlag } from '../../evaluateFlag';
import type { FlagrProviderConfig } from '../../types/FlagrProviderConfig';
import { server } from '../mocks/server';
import {
  createVariantHandler,
  createNoMatchHandler,
  createNotFoundHandler,
  createServerErrorHandler,
  createTimeoutHandler,
  createMalformedResponseHandler,
  createAttachmentHandler,
} from '../mocks/handlers';

const BASE_URL = 'http://localhost:18000';

const defaultConfig: FlagrProviderConfig = {
  baseUrl: BASE_URL,
  truthyVariants: new Set(['on', 'true', 'enabled']),
  timeout: 5000,
};

// Create a silent logger for tests
// noinspection JSUnusedGlobalSymbols
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

describe('evaluateFlag', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  describe('successful evaluations', () => {
    it('should return evaluation response with variant', async () => {
      server.use(createVariantHandler('on'));

      const result = await evaluateFlag(
        'test-flag',
        { targetingKey: 'user-123' },
        defaultConfig,
        silentLogger
      );

      expect(result).not.toBeNull();
      expect(result?.variantKey).toBe('on');
      expect(result?.flagKey).toBe('test-flag');
    });

    it('should return evaluation response with variant attachment', async () => {
      const attachment = { value: 42, message: 'test' };
      server.use(createAttachmentHandler(attachment));

      const result = await evaluateFlag(
        'test-flag',
        { targetingKey: 'user-123' },
        defaultConfig,
        silentLogger
      );

      expect(result).not.toBeNull();
      expect(result?.variantAttachment).toEqual(attachment);
    });

    it('should pass entityContext to Flagr', async () => {
      server.use(createVariantHandler('on'));

      const result = await evaluateFlag(
        'test-flag',
        {
          targetingKey: 'user-123',
          region: 'us-east',
          tier: 'premium',
        },
        defaultConfig,
        silentLogger
      );

      expect(result).not.toBeNull();
    });
  });

  describe('no segment match', () => {
    it('should return null when no segment matches', async () => {
      server.use(createNoMatchHandler());

      const result = await evaluateFlag(
        'test-flag',
        { targetingKey: 'user-123' },
        defaultConfig,
        silentLogger
      );

      expect(result).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should throw FlagNotFoundError for 404 response', async () => {
      server.use(createNotFoundHandler());

      await expect(
        evaluateFlag('non-existent-flag', { targetingKey: 'user-123' }, defaultConfig, silentLogger)
      ).rejects.toThrow(FlagNotFoundError);
    });

    it('should throw GeneralError for 500 response', async () => {
      server.use(createServerErrorHandler());

      await expect(
        evaluateFlag('test-flag', { targetingKey: 'user-123' }, defaultConfig, silentLogger)
      ).rejects.toThrow(GeneralError);
    });

    it('should throw GeneralError for malformed response', async () => {
      server.use(createMalformedResponseHandler());

      await expect(
        evaluateFlag('test-flag', { targetingKey: 'user-123' }, defaultConfig, silentLogger)
      ).rejects.toThrow(GeneralError);
    });

    it('should throw GeneralError on timeout', async () => {
      // Handler delays 10 seconds, config timeout is 100ms
      server.use(createTimeoutHandler(10000));

      await expect(
        evaluateFlag(
          'test-flag',
          { targetingKey: 'user-123' },
          { ...defaultConfig, timeout: 100 },
          silentLogger
        )
      ).rejects.toThrow(GeneralError);
    }, 10000); // Increase test timeout
  });

  describe('context handling', () => {
    it('should use "anonymous" as default entityID when targetingKey is missing', async () => {
      server.use(createVariantHandler('on'));

      const result = await evaluateFlag('test-flag', {}, defaultConfig, silentLogger);

      expect(result).not.toBeNull();
    });

    it('should use "user" as default entityType', async () => {
      server.use(createVariantHandler('on'));

      const result = await evaluateFlag(
        'test-flag',
        { targetingKey: 'user-123' },
        defaultConfig,
        silentLogger
      );

      expect(result).not.toBeNull();
    });

    it('should use custom entityType from context', async () => {
      server.use(createVariantHandler('on'));

      const result = await evaluateFlag(
        'test-flag',
        { targetingKey: 'org-456', entityType: 'organization' },
        defaultConfig,
        silentLogger
      );

      expect(result).not.toBeNull();
    });
  });

  describe('different variant keys', () => {
    it.each([
      ['on', 'on'],
      ['off', 'off'],
      ['control', 'control'],
      ['treatment', 'treatment'],
      ['variant-a', 'variant-a'],
    ])('should return variantKey "%s"', async (variant) => {
      server.use(createVariantHandler(variant));

      const result = await evaluateFlag(
        'test-flag',
        { targetingKey: 'user-123' },
        defaultConfig,
        silentLogger
      );

      expect(result?.variantKey).toBe(variant);
    });
  });
});
