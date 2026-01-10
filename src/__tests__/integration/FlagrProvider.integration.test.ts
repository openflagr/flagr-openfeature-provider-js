import { describe, it, expect, beforeAll } from 'vitest';
import { OpenFeature, ErrorCode } from '@openfeature/server-sdk';
import { FlagrProvider } from '../../FlagrProvider';
import type { FlagrProviderConfig } from '../../types/FlagrProviderConfig';

/**
 * Integration tests for FlagrProvider against a real Flagr server.
 *
 * These tests only run when FLAGR_URL environment variable is set.
 * Example: FLAGR_URL=http://localhost:18000 npm run test:integration
 *
 * Prerequisites:
 * - A running Flagr server
 * - Test flags configured in the server
 *
 * Recommended test flags to create:
 * 1. "test-boolean-flag" - with variants "on" and "off"
 * 2. "test-number-flag" - with numeric variants like "100", "200"
 * 3. "test-object-flag" - with variantAttachment containing JSON data
 */

const FLAGR_URL = process.env.FLAGR_URL;

const config: FlagrProviderConfig = {
  baseUrl: FLAGR_URL ?? 'http://localhost:18000',
  truthyVariants: new Set(['on', 'true', 'enabled', '1']),
  timeout: 5000,
};

describe.skipIf(!FLAGR_URL)('FlagrProvider Integration Tests', () => {
  let provider: FlagrProvider;

  beforeAll(() => {
    provider = new FlagrProvider(config);
    OpenFeature.setProvider(provider);
  });

  describe('real Flagr API connectivity', () => {
    it('should connect to Flagr server', async () => {
      const client = OpenFeature.getClient();

      // This test verifies connectivity - it should either succeed or fail with FLAG_NOT_FOUND
      // (not with network/connection errors)
      const result = await client.getBooleanDetails('connectivity-test-flag', false, {
        targetingKey: 'test-user',
      });

      // Either we get a value, or we get FLAG_NOT_FOUND (flag doesn't exist)
      // Both are valid connectivity confirmations
      const isConnected =
        result.errorCode === undefined || result.errorCode === ErrorCode.FLAG_NOT_FOUND;

      expect(isConnected).toBe(true);
    });
  });

  describe('boolean flag evaluation', () => {
    it('should evaluate boolean flag from Flagr', async () => {
      const client = OpenFeature.getClient();

      const result = await client.getBooleanDetails('test-boolean-flag', false, {
        targetingKey: 'user-123',
      });

      // We expect either a successful evaluation or FLAG_NOT_FOUND
      // This validates the full round-trip works
      expect(result).toBeDefined();
      expect(typeof result.value).toBe('boolean');
    });

    it('should pass context to Flagr', async () => {
      const client = OpenFeature.getClient();

      const result = await client.getBooleanDetails('test-boolean-flag', false, {
        targetingKey: 'user-with-context',
        region: 'us-east',
        tier: 'premium',
        isActive: true,
        score: 100,
      });

      expect(result).toBeDefined();
    });
  });

  describe('number flag evaluation', () => {
    it('should evaluate number flag from Flagr', async () => {
      const client = OpenFeature.getClient();

      const result = await client.getNumberDetails('test-number-flag', 0, {
        targetingKey: 'user-123',
      });

      expect(result).toBeDefined();
      expect(typeof result.value).toBe('number');
    });
  });

  describe('concurrent evaluations', () => {
    it('should handle concurrent flag evaluations', async () => {
      const client = OpenFeature.getClient();

      const evaluations = Array.from({ length: 10 }, (_, i) =>
        client.getBooleanDetails('test-boolean-flag', false, {
          targetingKey: `concurrent-user-${i.toString()}`,
        })
      );

      const results = await Promise.all(evaluations);

      expect(results).toHaveLength(10);
      results.forEach((result) => {
        expect(result).toBeDefined();
        expect(typeof result.value).toBe('boolean');
      });
    });
  });

  describe('error scenarios', () => {
    it('should handle non-existent flag gracefully', async () => {
      const client = OpenFeature.getClient();

      const result = await client.getBooleanDetails(
        'this-flag-definitely-does-not-exist-12345',
        false,
        { targetingKey: 'user-123' }
      );

      expect(result.value).toBe(false); // default value
      expect(result.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND);
    });
  });

  describe('OpenFeature SDK integration', () => {
    it('should work with OpenFeature client getBooleanValue', async () => {
      const client = OpenFeature.getClient();

      const value = await client.getBooleanValue('test-boolean-flag', false, {
        targetingKey: 'sdk-test-user',
      });

      expect(typeof value).toBe('boolean');
    });

    it('should work with OpenFeature client getNumberValue', async () => {
      const client = OpenFeature.getClient();

      const value = await client.getNumberValue('test-number-flag', 0, {
        targetingKey: 'sdk-test-user',
      });

      expect(typeof value).toBe('number');
    });
  });
});
