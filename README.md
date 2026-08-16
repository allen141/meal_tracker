# MacroFlow Meal Tracker

MacroFlow supports both:

- **Local static mode** (browser-only), and
- **Full backend mode** with **users + SQLite database + JWT auth**.

## Hosted environments

- Production: <https://macroflow.tylerallen.net>
- Shared pull-request preview: <https://macroflow-preview.tylerallen.net>

Both sites use the same API and persistent SQLite database. Preview is a fully read/write view of production data, not an isolated test environment. Browser authentication is origin-specific, so sign in separately on each hostname.

## Backend features

- User registration/login with hashed passwords (`bcryptjs`).
- JWT-based authenticated API.
- SQLite database (`macroflow.db`) with tables for users, user state, and meals.
- Per-user persisted planner state (`/api/state`).
- Per-user meal CRUD endpoints (`/api/meals`).

## API overview

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/state`
- `PUT /api/state`
- `GET /api/meals`
- `POST /api/meals`
- `PUT /api/meals/:id`
- `DELETE /api/meals/:id`

All `/api/state` and `/api/meals*` endpoints require `Authorization: Bearer <token>`.

Unauthenticated operational endpoints:

- `GET /api/health/live`
- `GET /api/health/ready`
- `GET /api/health/version`

## Deployment architecture

GitHub Actions tests and publishes signed, immutable container releases to GHCR. Trusted pull-based controllers on the Unraid host deploy them:

- a successful `main` workflow updates the shared API and production web interface;
- a successful same-repository pull-request workflow updates the single preview web interface only;
- fork pull requests run checks but cannot publish; and
- neither web container can access the database volume.

Both web containers proxy `/api` to the same internal API, so `window.MACROFLOW_API_BASE` stays empty in hosted builds. See [deployment operations](docs/operations/deployment.md) for host setup, recovery, and the shared-data warning. The architectural trust and rollback decisions are recorded in [ADR 0001](docs/decisions/0001-shared-backend-container-delivery.md).

## Contributor workflow

- Treat preview as production: do not create destructive fixtures, reset accounts, or enter sensitive test data. Every preview mutation immediately affects production and there is no preview reset.
- Same-repository PRs replace the one shared preview UI after checks pass. A newer eligible publication supersedes an older preview; closing or merging a PR does not clear it.
- PRs never deploy backend code. Candidate UI code runs against the API from `main` and must remain compatible with it.
- A later `main` deployment changes the API without replacing preview, so API changes must also support the currently deployed preview UI. Use additive, phased changes for breaking contracts.
- A push to `main`, or a manual workflow run on `main`, publishes a signed production release. The host normally notices it within 60 seconds, backs up SQLite before migration, and health-gates the rollout.
- Database migrations must be ordered, transactional, and compatible with the previous API image.

Agents and automated contributors must follow [AGENTS.md](AGENTS.md). Operators should use the [deployment runbook](docs/operations/deployment.md) before clearing controller state, rolling back, or restoring SQLite.

## Run locally

```bash
npm ci
npm start
```

Then open <http://localhost:3000>.

`npm start` serves the browser application and API together on port 3000. `npm run start:api` runs the API only. `DB_PATH` defaults to `./macroflow.db`; set a stable `JWT_SECRET` of at least 32 characters for any non-throwaway environment. Run migrations with `npm run migrate`, API tests with `npm test`, and browser tests with `npm run test:browser`.

For browser-only static development, serve the repository files with a local static server. Leave `window.MACROFLOW_API_BASE` empty for local-only browser state, or set it in `config.js` to an explicitly selected API while developing.

## Frontend behavior

- If you are **not logged in**, the app runs in local mode using `localStorage`.
- If you **log in/register**, the app syncs planner state to the backend database for that user.
- You can switch users and each user gets isolated persisted data.
