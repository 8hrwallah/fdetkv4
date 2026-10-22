# Mockup API Sandbox

The **Mockup API Sandbox** is a development platform designed to run an Express-based API server alongside a sandbox interface, allowing users to prototype, mock, and test API specs backed by a relational database schema.

## Run & Operate

* `PORT=5000 pnpm --filter @workspace/api-server run dev` — Run the API server on port 5000 (requires explicit `PORT`).
* `pnpm run typecheck` — Run a full TypeScript typecheck across all workspace packages.
* `PORT=3000 pnpm run build` — Run a full typecheck and build all workspace packages.
* `pnpm --filter @workspace/api-spec run codegen` — Regenerate frontend API hooks and Zod validation schemas directly from the OpenAPI specification.
* `pnpm --filter @workspace/db run push` — Push schema migrations and changes directly to the database instance (development mode only).

### Required Environment Variables
* `DATABASE_URL` — PostgreSQL database connection string.
* `PORT` — The network port for binding servers during execution and workspace compilation stages.

## Tech Stack

* **Package Management**: pnpm workspaces
* **Runtime & Language**: Node.js 24, TypeScript 5.9
* **API Layer**: Express 5
* **Database & ORM**: PostgreSQL paired with Drizzle ORM
* **Data Validation**: Zod (zod/v4), drizzle-zod
* **Code Generation**: Orval (generates client endpoints from OpenAPI specifications)
* **Bundler & Build Tooling**: esbuild (produces a unified CJS bundle), Vite (powers the mockup sandbox environment)

# Snorlax's Cave

Snorlax's Cave is a static game and proxy site served by the API server. The workspace uses pnpm and Node.js 24.
* `artifacts/mockup-sandbox/` — Frontend workspace for sandbox interaction and visual testing.
## Run on Replit
* `scripts/` — Infrastructure, environment configuration automation, and helper routines.
The root `.replit` config runs `corepack pnpm run start:snorlax`. This builds the static site and API server, then starts the API server using Replit's `PORT` environment variable.
* **Unified Workspace Typing**: Global compilation checking ensures cross-package boundary synchronization, forcing internal libraries and external endpoints to maintain unified TypeScript compatibility.
## Local Run

```bash
 pnpm install
 pnpm run start:snorlax
```
* **Synchronized Type Validation**: Inbound HTTP parameters are instantly checked against persistent relational models using runtime Zod validation objects.
## Project Layout

— and for the firewall problem in replit:

```bash
pnpm install --registry=https://registry.npmjs.org/
```

* **Enforced Build Port Environment**: You must explicitly prepend `PORT=[number]` ahead of commands executing `pnpm build`. The Vite framework configured in `artifacts/mockup-sandbox` strictly intercepts compilation pipelines and halts if a port fallback is missing from `process.env`.
- `artifacts/snorlax-cave/` — Site UI, proxy pages, and static assets.
- `artifacts/api-server/` — HTTP server, Bare proxy, and Wisp transport.
- `scripts/start-snorlax.mjs` — Builds the site and API server before starting the app.
- `pnpm-workspace.yaml` — Workspace packages and dependency policies.
* *To be populated dynamically as explicit instructions and configuration presets are saved across workspaces.*
