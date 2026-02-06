import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getOpenFeatureClient } from '@/lib/flags';

interface UiConfig {
  theme: string;
  showBanner: boolean;
  maxItems: number;
  [key: string]: string | boolean | number;
}

const DEFAULT_UI_CONFIG: UiConfig = {
  theme: 'light',
  showBanner: true,
  maxItems: 10,
};

function isUiConfig(value: unknown): value is UiConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'theme' in value &&
    'showBanner' in value &&
    'maxItems' in value
  );
}

function FlagCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

/* eslint-disable @typescript-eslint/require-await */
async function evaluateWithEntity(formData: FormData) {
  'use server';
  const entityId = (formData.get('entityId') as string | null) ?? '';
  redirect(entityId ? `/?entityId=${encodeURIComponent(entityId)}` : '/');
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ entityId?: string }>;
}) {
  const { entityId } = await searchParams;
  const client = getOpenFeatureClient();
  const context = entityId ? { targetingKey: entityId } : undefined;

  let darkMode = false;
  let greeting = 'fallback greeting';
  let itemsPerPage = 25;
  let uiConfig: UiConfig = DEFAULT_UI_CONFIG;
  let error: string | null = null;

  const [darkModeDetails, greetingDetails, itemsPerPageDetails, uiConfigDetails] =
    await Promise.all([
      client.getBooleanDetails('example-dark-mode', darkMode, context),
      client.getStringDetails('example-greeting', greeting, context),
      client.getNumberDetails('example-items-per-page', itemsPerPage, context),
      client.getObjectDetails<UiConfig>('example-ui-config', uiConfig, context),
    ]);

  darkMode = darkModeDetails.value;
  greeting = greetingDetails.value;
  itemsPerPage = itemsPerPageDetails.value;
  uiConfig = isUiConfig(uiConfigDetails.value) ? uiConfigDetails.value : DEFAULT_UI_CONFIG;

  const firstError = [darkModeDetails, greetingDetails, itemsPerPageDetails, uiConfigDetails].find(
    (d) => d.reason === 'ERROR'
  );
  if (firstError) {
    error = firstError.errorMessage ?? 'Could not evaluate flags';
  }

  const greetingMap: Record<string, string> = {
    hello: 'Hello, world!',
    welcome: 'Welcome aboard!',
    'hey-there': 'Hey there, friend!',
  };

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-12 font-sans dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl">
        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Flagr OpenFeature Provider
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Next.js Server Component example — all flag evaluations happen server-side.
          </p>
          <form action={evaluateWithEntity} className="mt-4 flex items-end gap-3">
            <div>
              <label
                htmlFor="entityId"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Entity ID
              </label>
              <input
                id="entityId"
                name="entityId"
                type="text"
                defaultValue={entityId ?? ''}
                placeholder="anonymous"
                className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Evaluate flags
            </button>
          </form>
          {entityId && (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Evaluating as: <span className="font-mono">{entityId}</span>
            </p>
          )}
        </header>

        {error && (
          <div className="mb-8 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
            <p className="font-medium text-red-800 dark:text-red-200">Could not reach Flagr</p>
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              Start Flagr with:{' '}
              <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-xs dark:bg-red-900">
                docker compose -f examples/docker-compose.yml up -d && ./examples/seed-flags.sh
              </code>
            </p>
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              Showing default values below.
            </p>
          </div>
        )}

        <div className="grid gap-6 sm:grid-cols-2">
          {/* Boolean flag */}
          <FlagCard title="example-dark-mode" subtitle="getBooleanDetails → boolean">
            <div
              className={`flex items-center justify-center rounded-lg p-6 text-sm font-medium ${
                darkMode
                  ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
              }`}
            >
              {darkMode ? 'Dark mode is ON' : 'Dark mode is OFF'}
            </div>
            <p className="mt-3 text-center font-mono text-sm text-zinc-600 dark:text-zinc-400">
              {String(darkMode)}
            </p>
          </FlagCard>

          {/* String flag */}
          <FlagCard title="example-greeting" subtitle="getStringDetails → string">
            <div className="flex items-center justify-center rounded-lg bg-blue-50 p-6 dark:bg-blue-950">
              <span className="text-xl font-semibold text-blue-800 dark:text-blue-200">
                {greetingMap[greeting] ?? greeting}
              </span>
            </div>
            <p className="mt-3 text-center font-mono text-sm text-zinc-600 dark:text-zinc-400">
              &quot;{greeting}&quot;
            </p>
          </FlagCard>

          {/* Number flag */}
          <FlagCard title="example-items-per-page" subtitle="getNumberDetails → number">
            <div className="space-y-1">
              {Array.from({ length: Math.min(itemsPerPage, 5) }).map((_, i) => (
                <div
                  key={`item-${String(i)}`}
                  className="flex items-center gap-2 rounded bg-zinc-100 px-3 py-1.5 text-xs dark:bg-zinc-800"
                >
                  <span className="font-mono text-zinc-400 dark:text-zinc-500">{i + 1}</span>
                  <span className="text-zinc-600 dark:text-zinc-300">Item {i + 1}</span>
                </div>
              ))}
              {itemsPerPage > 5 && (
                <p className="pt-1 text-center text-xs text-zinc-400">
                  +{itemsPerPage - 5} more items
                </p>
              )}
            </div>
            <p className="mt-3 text-center font-mono text-sm text-zinc-600 dark:text-zinc-400">
              {itemsPerPage}
            </p>
          </FlagCard>

          {/* Object flag */}
          <FlagCard title="example-ui-config" subtitle="getObjectDetails → object">
            <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-4 font-mono text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
              {JSON.stringify(uiConfig, null, 2)}
            </pre>
            <div className="mt-3 space-y-1">
              {Object.entries(uiConfig).map(([key, value]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-zinc-500 dark:text-zinc-400">{key}</span>
                  <span className="font-mono text-zinc-800 dark:text-zinc-200">
                    {String(value)}
                  </span>
                </div>
              ))}
            </div>
          </FlagCard>
        </div>
      </div>
    </div>
  );
}
