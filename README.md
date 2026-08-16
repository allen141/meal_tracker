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

## Deployment architecture

GitHub Actions tests and publishes signed, immutable container releases to GHCR. Trusted pull-based controllers on the Unraid host deploy them:

- a successful `main` workflow updates the shared API and production web interface;
- a successful same-repository pull-request workflow updates the single preview web interface only;
- fork pull requests run checks but cannot publish; and
- neither web container can access the database volume.

Both web containers proxy `/api` to the same internal API, so `window.MACROFLOW_API_BASE` stays empty in hosted builds. See [deployment operations](docs/operations/deployment.md) for host setup, recovery, and the shared-data warning. The architectural trust and rollback decisions are recorded in [ADR 0001](docs/decisions/0001-shared-backend-container-delivery.md).

## Run locally

```bash
npm ci
npm start
```

Then open <http://localhost:3000>.

## Frontend behavior

- If you are **not logged in**, the app runs in local mode using `localStorage`.
- If you **log in/register**, the app syncs planner state to the backend database for that user.
- You can switch users and each user gets isolated persisted data.
