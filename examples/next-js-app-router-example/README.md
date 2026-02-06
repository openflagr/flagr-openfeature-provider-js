# Next.js App Router Example — Flagr OpenFeature Provider

Demonstrates the Flagr OpenFeature provider in a Next.js App Router project. All flag evaluations happen server-side in an async Server Component — no client components needed.

## Quick Start

```bash
# 1. Start Flagr and seed example flags
docker compose -f examples/docker-compose.yml up -d

# 2. Install dependencies (from this directory)
npm install

# 3. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the flag demo dashboard.

## Example Flags

The seed script creates four flags that cover every OpenFeature evaluation type:

| Flag Key | Type | Method | Default Variant | Description |
|---|---|---|---|---|
| `example-dark-mode` | boolean | `getBooleanDetails` | `on` (100%) | Toggles a dark/light card |
| `example-greeting` | string | `getStringDetails` | `hello` (100%) | Maps variant to greeting text |
| `example-items-per-page` | number | `getNumberDetails` | `25` (100%) | Controls skeleton row count |
| `example-ui-config` | object | `getObjectDetails` | `default` (100%) | Returns JSON attachment |

Change distributions in the [Flagr UI](http://localhost:18000) and refresh the page to see updated values.

## Architecture

```
src/
  lib/flags.ts    — Configures OpenFeature with the FlagrProvider, exports getOpenFeatureClient()
  app/
    layout.tsx    — Root layout with metadata
    page.tsx      — Async Server Component that evaluates flags and renders the dashboard
```

- **Provider setup** happens once in `flags.ts` via `OpenFeature.setProvider()`.
- **Flag evaluation** uses the standard OpenFeature client (`getBooleanDetails`, `getStringDetails`, etc.).
- **Error handling**: Each detail result is checked for `reason === 'ERROR'` to show an error banner if Flagr is unreachable, with default values still displayed.

## Configuration

The provider defaults to `http://localhost:18000` (matching the docker-compose setup). Override with:

```bash
FLAGR_URL=http://your-flagr-host:18000 npm run dev
```
