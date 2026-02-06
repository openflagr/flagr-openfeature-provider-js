# flagr-openfeature-provider-js

> [!NOTE]  
> The repository is still under development. The NPM package is not yet published.

[OpenFeature](https://openfeature.dev/) provider for [Flagr](https://openflagr.github.io/flagr/) feature flagging service.

## Quick Start

```typescript
import { OpenFeature } from '@openfeature/server-sdk';
import { FlagrProvider } from '@openflagr/flagr-openfeature-provider-js';

// Initialize the provider
OpenFeature.setProvider(
  new FlagrProvider({
    baseUrl: 'http://localhost:18000',
    truthyVariants: new Set(['on', 'true', 'enabled']),
  })
);

// Get a client and evaluate flags
const client = OpenFeature.getClient();
const isEnabled = await client.getBooleanValue('my-feature', false, {
  targetingKey: 'user-123',
});
```

## Configuration

| Option           | Type          | Required | Default | Description                                                                    |
| ---------------- | ------------- | -------- | ------- | ------------------------------------------------------------------------------ |
| `baseUrl`        | `string`      | Yes      | -       | Base URL of the Flagr server (e.g., `http://localhost:18000`)                  |
| `truthyVariants` | `Set<string>` | Yes      | -       | Variant keys that resolve to `true` for boolean evaluations (case-insensitive) |
| `timeout`        | `number`      | No       | `5000`  | Request timeout in milliseconds                                                |
| `batching`       | `object`      | No       | -       | Batch evaluation configuration (see [Batch Evaluation](#batch-evaluation))     |

## Evaluation Methods

### Boolean Evaluation

`resolveBooleanEvaluation` maps Flagr's `variantKey` to a boolean value using the `truthyVariants` configuration.

| variantKey  | truthyVariants            | Result                    |
| ----------- | ------------------------- | ------------------------- |
| `"on"`      | `new Set(["on", "true"])` | `true`                    |
| `"off"`     | `new Set(["on", "true"])` | `false`                   |
| `"ON"`      | `new Set(["on", "true"])` | `true` (case-insensitive) |
| `"enabled"` | `new Set(["on", "true"])` | `false` (not in set)      |

**Returns default value when:**

- Flag not found
- No segment matched (empty response)

```typescript
const isEnabled = await client.getBooleanValue('feature-flag', false);
```

**Design Notes:**

- **Case-insensitive matching**: `"ON"`, `"on"`, and `"On"` are all treated the same
- **Implicit falsy**: Any `variantKey` NOT in `truthyVariants` resolves to `false`
- **No attachment fallback**: Unlike number evaluation, boolean does NOT fall back to `variantAttachment.value` - the result is determined solely by `variantKey` membership in `truthyVariants`

### String Evaluation

`resolveStringEvaluation` returns the `variantKey` directly.

| Flagr Response            | OpenFeature Result |
| ------------------------- | ------------------ |
| `variantKey: "variant-a"` | `"variant-a"`      |
| `variantKey: "control"`   | `"control"`        |
| No match                  | `defaultValue`     |

```typescript
const variant = await client.getStringValue('experiment-flag', 'control');
```

### Number Evaluation

`resolveNumberEvaluation` uses a two-tier resolution strategy:

1. **Tier 1**: Parse `variantKey` as a number
2. **Tier 2**: Fall back to `variantAttachment.value` if tier 1 fails

| variantKey  | variantAttachment | Result                       |
| ----------- | ----------------- | ---------------------------- |
| `"42"`      | `{}`              | `42`                         |
| `"control"` | `{ value: 100 }`  | `100`                        |
| `"control"` | `{}`              | `defaultValue` + PARSE_ERROR |

```typescript
const limit = await client.getNumberValue('rate-limit', 100);
```

### Object Evaluation

`resolveObjectEvaluation` returns the `variantAttachment` directly.

| variantAttachment              | Result                         |
| ------------------------------ | ------------------------------ |
| `{ theme: "dark", limit: 10 }` | `{ theme: "dark", limit: 10 }` |
| `null` / missing               | `defaultValue`                 |

```typescript
const config = await client.getObjectValue('feature-config', { theme: 'light' });
```

## Context Mapping

OpenFeature context values are converted to strings for Flagr compatibility:

| OpenFeature Type | Flagr Conversion     |
| ---------------- | -------------------- |
| `string`         | Direct pass-through  |
| `number`         | `String(value)`      |
| `boolean`        | `"true"` / `"false"` |
| `Date`           | ISO 8601 string      |
| `object`         | `JSON.stringify()`   |
| `array`          | `JSON.stringify()`   |

**Special keys:**

- `targetingKey` → Flagr `entityID`

```typescript
await client.getBooleanValue('my-flag', false, {
  targetingKey: 'user-123', // → entityID
  plan: 'premium', // → entityContext.plan = "premium"
  age: 25, // → entityContext.age = "25"
  isAdmin: true, // → entityContext.isAdmin = "true"
});
```

## Resolution Reasons

| Reason            | When Used                                         |
| ----------------- | ------------------------------------------------- |
| `TARGETING_MATCH` | Flagr returned a matching segment with variant    |
| `DEFAULT`         | No segment matched (Flagr returns empty response) |
| `ERROR`           | Network failure, parse error, or type mismatch    |

## Error Codes

| ErrorCode        | Condition                                              |
| ---------------- | ------------------------------------------------------ |
| `FLAG_NOT_FOUND` | Flagr returns 404 or flag doesn't exist                |
| `PARSE_ERROR`    | Number evaluation fails to parse variantKey/attachment |
| `TYPE_MISMATCH`  | Number evaluation receives non-number attachment value |
| `GENERAL`        | Network errors, timeouts, unexpected failures          |

## Flag Metadata

When a flag evaluation succeeds with a match, the following metadata is returned:

```typescript
{
  segmentID: number; // Matched segment ID from Flagr
  flagSnapshotID: number; // Version/snapshot of the flag evaluated
}
```

Access via `ResolutionDetails`:

```typescript
const details = await client.getBooleanDetails('my-flag', false);
console.log(details.flagMetadata?.segmentID);
```

## Batch Evaluation

When evaluating multiple flags for the same user in a single request (common in Next.js server components), each `resolve*Evaluation()` call makes an individual HTTP request. Batch evaluation coalesces these into a single `POST` to Flagr's `/api/v1/evaluation/batch` endpoint.

### Enabling Batching

```typescript
OpenFeature.setProvider(
  new FlagrProvider({
    baseUrl: 'http://localhost:18000',
    truthyVariants: new Set(['on', 'true', 'enabled']),
    batching: { enabled: true },
  })
);
```

No changes to evaluation calls are needed — the provider automatically collects individual evaluations within the same microtask tick and sends them as a single batch request.

```typescript
const client = OpenFeature.getClient();

// These three calls are coalesced into one HTTP request
const [showBanner, variant, limit] = await Promise.all([
  client.getBooleanValue('show-banner', false, { targetingKey: 'user-123' }),
  client.getStringValue('experiment', 'control', { targetingKey: 'user-123' }),
  client.getNumberValue('rate-limit', 100, { targetingKey: 'user-123' }),
]);
```

### Batching Options

| Option         | Type       | Default          | Description                                                |
| -------------- | ---------- | ---------------- | ---------------------------------------------------------- |
| `enabled`      | `boolean`  | -                | Enable batch evaluation                                    |
| `maxBatchSize` | `number`   | `50`             | Max flag keys per batch request (splits into multiple requests if exceeded) |
| `scheduleFn`   | `function` | `queueMicrotask` | Custom scheduling function for flushing the batch          |

```typescript
batching: {
  enabled: true,
  maxBatchSize: 25,
  scheduleFn: (fn) => setTimeout(fn, 10), // flush after 10ms instead of microtask
}
```

### How It Works

1. Individual `resolve*Evaluation()` calls are queued instead of making HTTP requests
2. At the end of the current microtask (or custom schedule), all queued evaluations are flushed
3. Evaluations for the same entity (same `targetingKey` + context) are deduplicated into a single entity entry
4. Unique flag keys are collected and sent as one batch request
5. Results are mapped back to the original promises

### Error Handling

- If the batch HTTP request fails, all pending promises reject with `GeneralError`
- If a specific flag is missing from the batch response, that promise rejects with `FlagNotFoundError` (same as the single evaluation path returning a 404)

## Provider Lifecycle

### Initialisation

The provider performs a health check against Flagr's `/api/v1/health` endpoint during initialization. If the health check fails, a `PROVIDER_ERROR` event is emitted.

```typescript
await OpenFeature.setProviderAndWait(new FlagrProvider(config));
// Provider is ready, health check passed
```

### Shutdown

```typescript
await OpenFeature.close();
// Provider cleanup complete (no-op for Flagr, no persistent connections)
```

## Next.js Integration

### With Vercel Flags SDK

```typescript
// lib/flags.ts
import { createOpenFeatureAdapter } from '@flags-sdk/openfeature';
import { OpenFeature } from '@openfeature/server-sdk';
import { FlagrProvider } from 'openflagr/flagr-openfeature-provider-js';

OpenFeature.setProvider(
  new FlagrProvider({
    baseUrl: process.env.FLAGR_URL!,
    truthyVariants: new Set(['on', 'true', 'enabled']),
  })
);

export const flagrAdapter = createOpenFeatureAdapter(OpenFeature.getClient());
```


#### Pages Router
```typescript
// page.ts
import {flag} from 'flags/next';
import {flagrAdapter} from './lib/flags';

const EXAMPLE_BOOLEAN_FLAG_KEY = 'example-boolean-flag';

export const getServerSideProps = (async ({req}) => {
    const exampleFlag = await featureClient.getBooleanValue(EXAMPLE_BOOLEAN_FLAG_KEY, false);
    return {props: {example}};
}) satisfies GetServerSideProps<{ example: boolean }>;


export default async function Page() {
    return (
        <>
            Exampleflag is {exampleFlag : "enabled":"disabled"}
        </>
    );
}


```

### Direct SDK Usage (Server Components, API Routes)

```typescript
// app/page.tsx (Server Component)
import { OpenFeature } from '@openfeature/server-sdk';

export default async function Page() {
  const client = OpenFeature.getClient();
  const showBanner = await client.getBooleanValue('show-banner', false, {
    targetingKey: 'anonymous',
  });

  return showBanner ? <Banner /> : null;
}
```

## Limitations

- **Server-only**: This provider uses remote evaluation (HTTP calls), making it unsuitable for client-side usage
- **No push updates**: Flagr doesn't provide webhooks for flag changes, so `PROVIDER_CONFIGURATION_CHANGED` events are not emitted
- **Edge Runtime**: Not compatible with Edge Runtime (requires Node.js HTTP)
- **Batch window**: Batching coalesces calls within a single microtask tick — calls across separate ticks produce separate HTTP requests
