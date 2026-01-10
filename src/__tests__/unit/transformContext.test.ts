import { describe, it, expect } from 'vitest';
import { transformContext } from '../../evaluateFlag';

describe('transformContext', () => {
  it('should pass string values through unchanged', () => {
    const context = {
      targetingKey: 'user-123',
      region: 'us-east',
      tier: 'premium',
    };

    const result = transformContext(context);

    expect(result).toEqual({
      region: 'us-east',
      tier: 'premium',
    });
  });

  it('should convert numbers to strings', () => {
    const context = {
      targetingKey: 'user-123',
      age: 25,
      score: 99.5,
      zero: 0,
    };

    const result = transformContext(context);

    expect(result).toEqual({
      age: '25',
      score: '99.5',
      zero: '0',
    });
  });

  it('should convert booleans to strings', () => {
    const context = {
      targetingKey: 'user-123',
      isActive: true,
      hasSubscription: false,
    };

    const result = transformContext(context);

    expect(result).toEqual({
      isActive: 'true',
      hasSubscription: 'false',
    });
  });

  it('should JSON stringify objects', () => {
    const context = {
      targetingKey: 'user-123',
      preferences: { theme: 'dark', language: 'en' },
    };

    const result = transformContext(context);

    expect(result).toEqual({
      preferences: '{"theme":"dark","language":"en"}',
    });
  });

  it('should JSON stringify arrays', () => {
    const context = {
      targetingKey: 'user-123',
      roles: ['admin', 'user'],
      scores: [1, 2, 3],
    };

    const result = transformContext(context);

    expect(result).toEqual({
      roles: '["admin","user"]',
      scores: '[1,2,3]',
    });
  });

  it('should skip null values', () => {
    const context = {
      targetingKey: 'user-123',
      region: 'us-east',
      optionalField: null,
    };

    const result = transformContext(context);

    expect(result).toEqual({
      region: 'us-east',
    });
    expect(result).not.toHaveProperty('optionalField');
  });

  it('should skip targetingKey', () => {
    const context = {
      targetingKey: 'user-123',
      region: 'us-east',
    };

    const result = transformContext(context);

    expect(result).not.toHaveProperty('targetingKey');
    expect(result).toEqual({
      region: 'us-east',
    });
  });

  it('should skip entityType', () => {
    const context = {
      targetingKey: 'user-123',
      entityType: 'organization',
      region: 'us-east',
    };

    const result = transformContext(context);

    expect(result).not.toHaveProperty('entityType');
    expect(result).toEqual({
      region: 'us-east',
    });
  });

  it('should return empty object for context with only targetingKey', () => {
    const context = {
      targetingKey: 'user-123',
    };

    const result = transformContext(context);

    expect(result).toEqual({});
  });

  it('should handle empty context', () => {
    const context = {};

    const result = transformContext(context);

    expect(result).toEqual({});
  });

  it('should handle nested objects', () => {
    const context = {
      targetingKey: 'user-123',
      metadata: {
        nested: {
          deeply: {
            value: 'test',
          },
        },
      },
    };

    const result = transformContext(context);

    expect(result).toEqual({
      metadata: '{"nested":{"deeply":{"value":"test"}}}',
    });
  });

  it('should handle mixed types in arrays', () => {
    const context = {
      targetingKey: 'user-123',
      mixedArray: [1, 'two', true, { key: 'value' }],
    };

    const result = transformContext(context);

    expect(result).toEqual({
      mixedArray: '[1,"two",true,{"key":"value"}]',
    });
  });
});
