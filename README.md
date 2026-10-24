<div align="center">


# Welcome to Snorlax's Cave!
Snorlax's Cave is a proxy and game site for local hosting and Replit deployments.

</div>

## We offer:
- Many unblocked apps & games
- Built-in web proxy
- Free emulator access
- Customizable settings and portal flow
- Replit-ready startup configuration

## Join our community!

# coming soon.
- Added chat section!!!!
## Local hosting

### 1) Clone the repository
```bash
git clone https://github.com/8hrwallah/fdetkv4.git
```

### 2) Navigate into the project folder
```bash
cd fdetkv4
```

### 3) Install dependencies
This project uses pnpm workspaces.

```bash
pnpm install
```

### 4) Configure and start the app
The chat requires PostgreSQL and a stable signing key. Copy `.env.example` to `.env`, set `DATABASE_URL`, and replace the `CHAT_SESSION_SECRET` placeholder with a generated secret:
```bash
cp .env.example .env
openssl rand -hex 32
```
The startup script loads the root `.env` automatically. Provision the tables using the existing Drizzle schema, then launch:
```bash
pnpm --filter @workspace/db run push
pnpm start:snorlax
```

Locally, the server defaults to port `5000`; browse to `http://localhost:5000/`.

To run the site and proxy without PostgreSQL, use:
```bash
pnpm start:snorlax-nodb
```
This keeps the static site, proxy engines, and `/api/healthz` available, but disables all database-backed `/api/chat` endpoints. The regular `pnpm start:snorlax` command continues to require the database for chat.

To initialize or recover the Owner, set both `CHAT_OWNER_USERNAME` and a strong `CHAT_OWNER_SETUP_SECRET` in the server environment. These are optional; ordinary visitors do not need an owner code. Keep the setup secret private and do not commit it.

Attachments default to `./storage/chat`. Set `CHAT_STORAGE_DIR` to a durable mounted path on a VPS. Replit autoscale's local filesystem may be ephemeral, so configure a persistent volume or external storage before relying on uploaded files across deployments.

### 5) Replit startup
The existing `.replit` config runs `pnpm run start:snorlax`. Set `DATABASE_URL` and `CHAT_SESSION_SECRET` in Replit Secrets; the platform supplies `PORT`. Do not check secrets into `.env` or source control.

## Important setup notes
- `DATABASE_URL` and `CHAT_SESSION_SECRET` are required. `CHAT_OWNER_USERNAME`, `CHAT_OWNER_SETUP_SECRET`, and `CHAT_STORAGE_DIR` are optional.
- The app serves the static site and proxy routes from the API server.
- Some sites like GeForce NOW and NVIDIA sign-in flows are intentionally treated as direct external links because UV rewriting breaks their browser/media requirements.
- Scramjet is the default proxy engine; Ultraviolet remains available as an explicit alternative in settings.
- Titan is not available as an independent engine yet; old saved Titan selections now fail clearly instead of silently routing through another engine.

## Proxy engine guides

- [Ultraviolet](./docs/UV.md)
- [Scramjet](./docs/SCRAMJET.md)
- [Titan status](./docs/TITAN.md)
- [Compatibility and verification status](./docs/COMPATIBILITY-STATUS.md)

See [CHANGELOG.md](./CHANGELOG.md) for recent runtime, service-worker, and hosting changes.

## Hosting / deployment
This repo is configured for a Node + pnpm runtime and is designed to run correctly in Replit, local development, and similar Node hosting platforms.

### Replit
- Open the project in Replit
- Run the project using the existing config
- Keep the workspace root as the project root
- Let Replit supply `PORT`

### Manual Node hosting
```bash
pnpm install
export PORT=5000
export DATABASE_URL='postgresql://user:password@host:5432/database'
export CHAT_SESSION_SECRET="$(openssl rand -hex 32)"
pnpm start:snorlax
```
For VPS deployments, set those variables with the service manager, keep `CHAT_SESSION_SECRET` stable across restarts, mount durable attachment storage, and reverse-proxy the app over HTTPS.

## Support us
**[SUPPORT US!](https://patreon.com/SnorlaxCave)**
