# Deployment operations

MacroFlow uses a shared-backend production and pull-request preview deployment on the Unraid Docker node.

| Site | URL | Release source | Backend |
| --- | --- | --- | --- |
| Production | `https://macroflow.tylerallen.net` | Latest successful `main` commit | Shared API and SQLite database |
| Preview | `https://macroflow-preview.tylerallen.net` | Latest successful same-repository PR update | The same shared API and SQLite database |

The [deployment ADR](../decisions/0001-shared-backend-container-delivery.md) defines the trust boundary and database ownership model.

## Published artifacts

The Application workflow tests the source and containers before publishing. Production releases contain immutable API and web digests. Preview releases contain only an immutable web digest; the API label is deliberately empty. Each scratch release descriptor records its channel, commit, and optional PR number, and is signed with the workflow's GitHub OIDC identity. Fork pull requests cannot publish.

The controllers poll mutable `production` and `preview` descriptor tags, verify their signatures and provenance, and deploy the digest-pinned contents. Current and previous MacroFlow releases remain cached for rollback; cleanup is restricted to the three MacroFlow GHCR repositories.

## One-time host setup

### DNS, TLS, and SWAG

1. Point DNS for `macroflow.tylerallen.net` and `macroflow-preview.tylerallen.net` at the SWAG endpoint.
2. Add `macroflow,macroflow-preview` to SWAG's subdomain certificate configuration and restart SWAG to obtain the expanded certificate.
3. Copy `infrastructure/swag/*.subdomain.conf` to `/mnt/user/appdata/swag/nginx/proxy-confs/`.
4. Ensure SWAG and both web containers join the external `proxynet` network.
5. Validate and reload nginx:

```bash
docker network connect proxynet swag
docker exec swag nginx -t
docker exec swag nginx -s reload
```

### Read-only GHCR authentication

Create a GitHub credential with read-only access to the MacroFlow GHCR packages. Store its Docker client configuration outside this repository:

```bash
mkdir -p /mnt/user/appdata/macroflow/registry
DOCKER_CONFIG=/mnt/user/appdata/macroflow/registry docker login ghcr.io
chmod -R go-rwx /mnt/user/appdata/macroflow/registry
```

GitHub Actions publishes with `GITHUB_TOKEN`; the host credential does not need write access.

### Directories, configuration, and controllers

Create the persistent roots. The web and controller containers must not mount `data` or `backups`:

```bash
mkdir -p /mnt/user/appdata/macroflow/data
mkdir -p /mnt/user/appdata/macroflow/backups
mkdir -p /mnt/user/appdata/macroflow/deployer/production
mkdir -p /mnt/user/appdata/macroflow/deployer/preview
mkdir -p /mnt/user/appdata/macroflow/deployer/shared
chown 1000:1000 /mnt/user/appdata/macroflow/data
```

The API runs as the fixed, unprivileged `node` user (UID 1000), so the data directory must retain that ownership. Copy the preview and production environment examples to `/mnt/user/appdata/macroflow/preview.environment.env` and `/mnt/user/appdata/macroflow/production.environment.env`, then copy the production secret example to `/mnt/user/appdata/macroflow/production.secrets.env`. Replace its placeholder, restrict it to mode `0600`, and keep a stable, random `JWT_SECRET`; changing it signs every user out. Start or refresh the controllers with `infrastructure/deployer/start-controllers.sh`. They use `restart: unless-stopped` and resume polling after host restarts.

## Normal operation

When any same-repository pull request is updated, its successful workflow replaces the one shared preview web container. The most recently completed eligible pull request wins. Preview never changes the API image or runs a migration. Verify the candidate in the browser and check `/api/health/version` for the currently deployed backend commit.

A successful push to `main` updates the shared API and production web. The preview web stays in place and immediately uses the updated API. UI code published to preview is therefore required to remain compatible with the API currently on `main`.

Useful checks:

```bash
docker logs --tail 100 macroflow-deployer-preview
docker logs --tail 100 macroflow-deployer-production
docker inspect --format '{{.State.Health.Status}}' macroflow-api
docker inspect --format '{{.State.Health.Status}}' macroflow-production-web
docker inspect --format '{{.State.Health.Status}}' macroflow-preview-web
```

A failed candidate is recorded and skipped until a different signed descriptor is published. The previously healthy image stays running or is restored. Completed database migrations are not reversed.

## Backups, restore, and rollback

The backup container creates an online SQLite backup every 24 hours under `/mnt/user/appdata/macroflow/backups` and retains 14 days. Production deployment also creates an online backup immediately before migration.

Validate a backup by restoring it to an isolated temporary path and opening it with SQLite integrity checks or a temporary API container. Never test restoration over the live database. Record the source backup, validation result, and application commit. Complete one successful restore exercise before relying on the service for valuable data.

For an application-only rollback, repoint the production deployment to the previous signed descriptor/digests or use the controller's recorded previous release and verify all health endpoints. If the rollback also requires older data or incompatible schema, stop both controllers and the API, preserve the current database, restore the matching validated backup to `/mnt/user/appdata/macroflow/data/macroflow.db`, restore ownership with `chown 1000:1000 /mnt/user/appdata/macroflow/data/macroflow.db`, then restart production before preview.

There is intentionally no reset-preview command. Preview is a second interface to production data, so test records must be removed through the application or handled through a deliberate whole-database recovery.
