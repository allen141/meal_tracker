# MacroFlow agent guide

This file applies to the entire repository. Read it before changing application, database, CI, or deployment code.

## Deployment invariants

- Production is https://macroflow.tylerallen.net; the single shared PR preview is https://macroflow-preview.tylerallen.net.
- Both web interfaces proxy /api to the one macroflow-api container and read and write the same production SQLite database.
- Preview is not a sandbox. Do not create destructive fixtures, reset its database, or add preview-only migrations.
- A same-repository pull request publishes only its web image. PR backend code is never preview-deployed.
- Candidate UI code must use the API contract currently on main. Because a later production API deployment leaves the preview UI in place, API changes must also support the currently deployed preview UI. Breaking contracts require an additive, phased rollout.
- Only macroflow-api may mount /var/lib/macroflow or open SQLite. Never add data or backup mounts to a web container or the preview controller.
- Schema changes belong in ordered, transactional PRAGMA user_version migrations. Keep them compatible with the previous API image.
- GitHub Actions publishes signed images; it never connects to the host or receives the Docker socket. Host controllers verify provenance and pull immutable digests.

## Repository map

- API and health endpoints: server.js
- Database and migrations: db.js and migrate.js
- Browser application: index.html, styles.css, app.js, and config.js
- Images and web proxy: Dockerfile.api, Dockerfile.web, and nginx.conf
- CI and publication: .github/workflows/application.yml
- Host policy and rollout: infrastructure/deployer/
- Public ingress examples: infrastructure/swag/
- Operator runbook: docs/operations/deployment.md
- Trust boundary: docs/decisions/0001-shared-backend-container-delivery.md

Keep the runbook, README, tests, and this guide synchronized when these contracts change.

## Validation

Run checks relevant to the change. Before changing release or deployment policy, run the complete set:

    npm ci
    npm run check
    npm test
    npm run test:browser
    docker build -f Dockerfile.api -t macroflow-api:test .
    docker build -f Dockerfile.web -t macroflow-web:test .
    docker build -f infrastructure/deployer/Dockerfile -t macroflow-deployer:test .
    infrastructure/deployer/tests/controller-test.sh macroflow-deployer:test

CI also checks that a PR web image can reach the API from main; this readiness smoke test does not prove every payload contract, so compatibility still requires engineering judgment and tests.

## Release behavior

- A push or manual workflow run on main publishes production API, web, and release images.
- Eligible same-repository PR activity publishes a preview web image and release after checks pass; forks cannot publish.
- All PRs share one preview. The latest successful publication wins, and closing or merging a PR does not clear it.
- Channel concurrency cancels an older in-progress workflow when a newer workflow for that channel begins.
- /api/health/version identifies the shared API commit, not the preview UI. Use preview controller state or the signed descriptor for UI identity.

Do not push, deploy, clear controller state, restore data, or operate host containers unless the user explicitly requests that external action. Read the runbook before doing any of them.
