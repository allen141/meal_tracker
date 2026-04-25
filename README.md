# MacroFlow Meal Tracker

MacroFlow supports both:

- **Local static mode** (browser-only), and
- **Full backend mode** with **users + SQLite database + JWT auth**.

## Can this be hosted on GitHub Pages?

**Partially.**

- ✅ The frontend (`index.html`, `styles.css`, `app.js`) can auto-deploy to GitHub Pages.
- ❌ The backend (`server.js` + SQLite DB) cannot run on GitHub Pages because Pages is static hosting only.

This repo includes a GitHub Actions workflow that deploys the frontend automatically on pushes to `main`.

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

For full-stack hosting, use:

1. **GitHub Pages** for frontend auto-deploy, and
2. A backend host (Render, Fly.io, Railway, VPS, etc.) for the Node/SQLite API.

Set `window.MACROFLOW_API_BASE` in `config.js` to your backend URL in production.

## Run locally

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

## Frontend behavior

- If you are **not logged in**, the app runs in local mode using `localStorage`.
- If you **log in/register**, the app syncs planner state to the backend database for that user.
- You can switch users and each user gets isolated persisted data.
