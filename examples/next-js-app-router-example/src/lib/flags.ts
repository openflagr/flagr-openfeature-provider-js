import { OpenFeature } from '@openfeature/server-sdk';
import { FlagrProvider } from '@flagr/flagr-openfeature-provider-js';

OpenFeature.setProvider(
  new FlagrProvider({
    baseUrl: process.env.FLAGR_URL ?? 'http://localhost:18000',
    truthyVariants: new Set(['on', 'true', 'enabled']),
  }),
);

export function getOpenFeatureClient() {
  return OpenFeature.getClient();
}
