# MacroFlow Meal Tracker

MacroFlow supports both:

- **Local browser mode** with device-local state, and
- **Full backend mode** with users + SQLite database + JWT auth.

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

## Frontend architecture

The browser application is a React/Vite single-page app with three hash-addressable sections:

- `#/planner` — weekly calendar, macro goals, progress, and quick scheduling.
- `#/meals` — searchable meal library and CRUD.
- `#/prep` — meal-prep blocks and weekday selection.

Anonymous changes are written to `macroflow-state-v1` in localStorage. Sessions are stored under `macroflow-session-v1`. Signing in enables the existing API sync contract without changing the persisted state shape. The optional `window.MACROFLOW_API_BASE` override lives in `public/config.js` and remains empty for hosted same-origin deployments.

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

Install dependencies and start the combined local API plus Vite development server:

```bash
npm ci
npm run dev
```

Open <http://localhost:5173>. The Vite server proxies `/api` to the API on port 3000.

For a production-style local run, `npm start` builds the frontend into `dist/` and serves it with Express on port 3000. `npm run start:api` runs only the API. `DB_PATH` defaults to `./macroflow.db`; set a stable `JWT_SECRET` of at least 32 characters for any non-throwaway environment.

Useful validation commands:

```bash
npm run check
npm test
npm run test:browser
npm run build:web
```

The browser tests use an isolated temporary SQLite database. Do not point them at the shared preview.

## Frontend behavior

- If you are **not logged in**, the app runs in local mode using localStorage.
- If you **log in/register**, the app syncs planner state to the backend database for that user.
- You can switch users and each user gets isolated persisted data.
- Planner drag-and-drop remains available on desktop; the Schedule/Move dialog provides a keyboard- and touch-friendly path.
