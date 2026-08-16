# Deployment operations

MacroFlow uses a shared-backend production and pull-request preview deployment on the Unraid Docker node.

| Site | URL | Release source | Backend |
| --- | --- | --- | --- |
| Production | https://macroflow.tylerallen.net | Latest successful main commit | Shared API and SQLite database |
| Preview | https://macroflow-preview.tylerallen.net | Latest successful same-repository PR update | The same shared API and SQLite database |

Preview is fully read/write against production data. Accounts and application records are shared, although users sign in separately on the two browser origins. There is intentionally no preview database reset. The [deployment ADR](../decisions/0001-shared-backend-container-delivery.md) defines the trust boundary and database ownership model.

## Release and controller model

The Application workflow tests source and containers before publishing:

- pull_request: same-repository PRs publish a web-only preview release; fork PRs only run checks.
- push to main: publishes API and web images plus a production release.
- workflow_dispatch: publishes production only when run against main.

All PRs share one preview channel. Channel concurrency cancels an older in-progress preview workflow when a newer one starts. The most recently completed eligible PR publication wins, and closing or merging a PR does not clear preview.

PR web code is checked for readiness against the API from main, but that smoke test does not prove every payload contract. Candidate UI code must use the current main contract. A later main deployment updates the API without replacing preview, so API changes must also support the currently deployed preview UI. Breaking contracts require additive, phased rollout.

Release descriptors are scratch OCI images containing immutable image digests, channel, commit, and optional PR number. GitHub OIDC signs each descriptor and image. Host controllers poll mutable discovery tags, verify workflow identity and provenance, and deploy only recorded digests. Current and previous MacroFlow images are retained; cleanup is restricted to the three MacroFlow repositories.

The controller Compose project is macroflow-deployer. Both controllers deliberately operate the shared application project macroflow and serialize changes through /mnt/user/appdata/macroflow/deployer/shared/deploy.lock. Do not run deploy.compose.yaml under another project name.

## One-time host setup

Run these commands from a trusted checkout on the Unraid host.

### DNS, TLS, network, and SWAG

1. Point macroflow.tylerallen.net and macroflow-preview.tylerallen.net at the SWAG endpoint.
2. Confirm the external ingress network exists:

       docker network inspect proxynet

3. Persist proxynet as SWAG's network in its Unraid template. The two web services join it through deploy.compose.yaml; the API does not.
4. Copy the proxy configurations:

       cp infrastructure/swag/macroflow.subdomain.conf /mnt/user/appdata/swag/nginx/proxy-confs/
       cp infrastructure/swag/macroflow-preview.subdomain.conf /mnt/user/appdata/swag/nginx/proxy-confs/

5. Add macroflow,macroflow-preview to SWAG's SUBDOMAINS template value and recreate SWAG through Unraid so the setting persists. A one-off docker network connect is not a substitute for updating the template.
6. Verify nginx, certificate coverage, and both routes:

       docker exec swag nginx -t
       docker exec swag openssl x509 -in /config/keys/letsencrypt/fullchain.pem -noout -dates -ext subjectAltName
       curl -fsS https://macroflow.tylerallen.net/api/health/ready
       curl -fsS https://macroflow-preview.tylerallen.net/api/health/ready

### GHCR access

The three MacroFlow GHCR packages are currently public, so the controllers can pull anonymously. Keep the mounted Docker configuration directory present but empty:

    mkdir -p /mnt/user/appdata/macroflow/registry
    DOCKER_CONFIG=/mnt/user/appdata/macroflow/registry docker pull ghcr.io/allen141/macroflow-release:production

If the packages are later made private, log this directory into GHCR with a dedicated credential that has package-read access only; it never needs package-write or repository-write access. Both controllers mount it at /root/.docker. Confirm a descriptor pull before restarting them. Repeated Release pull failed messages usually indicate registry reachability or authentication trouble.

### Directories and configuration

    mkdir -p /mnt/user/appdata/macroflow/data
    mkdir -p /mnt/user/appdata/macroflow/backups
    mkdir -p /mnt/user/appdata/macroflow/deployer/production
    mkdir -p /mnt/user/appdata/macroflow/deployer/preview
    mkdir -p /mnt/user/appdata/macroflow/deployer/shared
    mkdir -p /mnt/user/appdata/macroflow/registry
    chown 1000:1000 /mnt/user/appdata/macroflow/data

    cp infrastructure/deployer/preview.environment.example /mnt/user/appdata/macroflow/preview.environment.env
    cp infrastructure/deployer/production.environment.example /mnt/user/appdata/macroflow/production.environment.env
    cp infrastructure/deployer/production.secrets.example /mnt/user/appdata/macroflow/production.secrets.env

Replace the placeholder in production.secrets.env with a stable random secret of at least 32 characters. openssl rand -hex 32 produces a suitable value. Store it as JWT_SECRET=<value>, set mode 0600, and never commit it. Changing the secret signs every user out.

    chmod 0600 /mnt/user/appdata/macroflow/production.secrets.env
    test -r /mnt/user/appdata/macroflow/preview.environment.env
    test -r /mnt/user/appdata/macroflow/production.environment.env
    test -r /mnt/user/appdata/macroflow/production.secrets.env
    docker network inspect proxynet
    docker info >/dev/null

The API runs as UID 1000. Preserve that ownership on the data directory and any restored database. Neither web container nor the preview controller may receive the database volume.

### First deployment and controllers

Publish a successful main release before allowing preview to deploy. Preview health checks require macroflow-api; if preview runs first, that preview descriptor is recorded as failed and will not retry automatically.

For a fresh host, build the deployer and start production first using the controller Compose file, wait for the API, then start preview:

    docker build -t macroflow-deployer:local -f infrastructure/deployer/Dockerfile .

    docker run --rm --entrypoint docker \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -v "$PWD:/workspace:ro" -w /workspace macroflow-deployer:local \
      compose -p macroflow-deployer -f infrastructure/deployer/controllers.compose.yaml \
      up -d --no-build production

    docker inspect --format '{{.State.Health.Status}}' macroflow-api

    docker run --rm --entrypoint docker \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -v "$PWD:/workspace:ro" -w /workspace macroflow-deployer:local \
      compose -p macroflow-deployer -f infrastructure/deployer/controllers.compose.yaml \
      up -d --no-build preview

Wait until macroflow-api reports healthy before starting preview. On later controller-code changes, run infrastructure/deployer/start-controllers.sh; it always uses the isolated macroflow-deployer project name.

## Normal operation

A successful same-repository PR workflow replaces only macroflow-preview-web. Preview never chooses an API image, mounts the database, or runs migrations.

A successful push or manual run on main replaces macroflow-api and macroflow-production-web. The preview UI remains and immediately uses the updated shared API. Controllers normally poll every 60 seconds.

Useful checks:

    docker logs --tail 100 macroflow-deployer-preview
    docker logs --tail 100 macroflow-deployer-production
    docker inspect --format '{{.State.Health.Status}}' macroflow-api
    docker inspect --format '{{.State.Health.Status}}' macroflow-production-web
    docker inspect --format '{{.State.Health.Status}}' macroflow-preview-web
    curl -fsS https://macroflow.tylerallen.net/api/health/live
    curl -fsS https://macroflow.tylerallen.net/api/health/ready
    curl -fsS https://macroflow.tylerallen.net/api/health/version
    curl -fsS https://macroflow-preview.tylerallen.net/api/health/ready
    sed -n '1,5p' /mnt/user/appdata/macroflow/deployer/production/current-release
    sed -n '1,5p' /mnt/user/appdata/macroflow/deployer/preview/current-release

/api/health/version identifies the shared API commit. For preview UI identity, controller state line 4 is the UI commit and line 5 is the PR number.

## Failed candidates

A failed descriptor is recorded at /mnt/user/appdata/macroflow/deployer/<channel>/failed-release and skipped until the channel points to a different signed descriptor. Fixing host configuration alone does not retry the same digest.

The preferred recovery is to publish a different signed release: push another commit to the affected PR for preview, or correct/revert on main for production. To deliberately retry the exact digest, stop only the affected controller, inspect its deploy.log and exact failed-release marker, correct the cause, remove that one marker, then restart the controller. Never clear both channel state directories or remove current-release/previous-release as a generic retry step.

Controller logs also persist at /mnt/user/appdata/macroflow/deployer/<channel>/deploy.log. The other deployment channel is active is normal shared-lock contention and resolves on the next poll.

## Backups and validation

After the first successful production deployment, macroflow-backup creates an online backup every 24 hours and retains 14 days. Production also creates an online backup immediately before migration. Files are named macroflow-YYYYmmddTHHMMSSZ.db under /mnt/user/appdata/macroflow/backups.

List backups and validate one exact file without opening the live database:

    find /mnt/user/appdata/macroflow/backups -maxdepth 1 -type f -name 'macroflow-*.db' -printf '%TY-%Tm-%Td %TH:%TM:%TS %p\n' | sort

    docker run --rm --entrypoint sqlite3 \
      --mount type=bind,src=/mnt/user/appdata/macroflow/backups/REPLACE_WITH_EXACT_BACKUP.db,dst=/backup.db,readonly \
      macroflow-deployer:local -readonly /backup.db 'PRAGMA quick_check;'

Do not rely on backups until a restore drill has succeeded in an isolated temporary directory. Record the filename, integrity result, application commit, and drill date.

## Application rollback

Database migrations are not reversed automatically. The safest supported application rollback is a new commit on main that restores prior application code while retaining backward-compatible migrations. The normal workflow signs it as a new release, and the controller backs up, deploys, and health-gates it.

During a failed rollout, the controller automatically restores the healthy API/web images recorded in current-release. previous-release is retained for operator reference, but there is no controller command that deploys it. Do not manually retag the mutable production descriptor; signature and provenance are enforced.

An emergency digest-pinned Compose rollback requires stopping the production controller, reading the exact allowlisted API/web digests from controller state, and preventing polling from immediately reapplying the bad channel. Treat it as an incident and record all commands and versions.

## Whole-database restore

A restore affects preview and production together. Schedule downtime and identify one exact, previously validated backup. Do not restore over a running database and do not pair a restored .db with old -wal or -shm files.

1. Record the application commit and chosen backup. Stop, in order, macroflow-deployer-preview, macroflow-deployer-production, macroflow-backup, both web containers, and macroflow-api.
2. Copy the backup to a separate restore-candidate path, run PRAGMA quick_check, and confirm the result is ok.
3. Preserve the exact live macroflow.db, macroflow.db-wal, and macroflow.db-shm files under a timestamped incident directory. Do not delete them.
4. Install the validated candidate as /mnt/user/appdata/macroflow/data/macroflow.db, ensure no stale WAL/SHM files remain beside it, and set its owner to 1000:1000.
5. Start macroflow-deployer-production. Verify API readiness, production web, schema, and representative data before starting macroflow-deployer-preview and macroflow-backup.
6. Re-run public health checks through both hostnames and record the restored backup and deployed commit.

Have a second operator review the exact source and destination paths before moving database files. There is intentionally no reset-preview shortcut.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| proxynet missing or web unreachable | Inspect proxynet; SWAG and both web containers join it, but the API stays private |
| GHCR 401/403 or repeated pull failure | Package visibility and registry/config.json; public packages need no login |
| Cosign identity mismatch | Release came from application.yml on the expected main or PR ref; never bypass verification |
| API exits before readiness | JWT_SECRET is stable and at least 32 characters; data is writable by UID 1000 |
| Backup or migration failure | Production deploy.log, free space, database ownership, and backup integrity |
| Corrected candidate remains skipped | Inspect the exact failed-release; publish a new descriptor or use deliberate retry |
| Other channel is active | Normal shared deployment lock; wait for the next 60-second poll |
| SWAG returns 502 | Web health, proxynet, proxy filename, nginx config, and upstream container name |
| TLS or DNS failure | Both A records, SWAG SUBDOMAINS, certificate SANs, and ports 80/443 |
