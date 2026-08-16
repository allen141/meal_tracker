# ADR 0001: Signed container delivery with a shared backend

- Status: Accepted
- Date: 2026-08-16

## Context

MacroFlow needs one production site and one shared pull-request preview site on an Unraid Docker host. Application data must survive releases and be identical through either user interface. A pull request is untrusted deployment input and must not receive host credentials or control the Docker socket.

## Decision

GitHub Actions builds immutable `linux/amd64` images in GHCR after tests pass. A successful `main` build publishes API and web images and a signed `production` descriptor. A successful same-repository pull request publishes only a web image and a signed `preview` descriptor. Fork pull requests run tests but cannot publish.

The host runs two independent, least-authority polling controllers. Each verifies the release descriptor's GitHub OIDC workflow identity before acting. The production controller may migrate and replace the shared API and production web containers. The preview controller may replace only the preview web container. GitHub Actions never reaches the host and has no Docker-host credential.

Both nginx web containers proxy `/api` to the single production-owned Express API. Only that API mounts `/mnt/user/appdata/macroflow/data`; it is the only application process that opens SQLite. Preview is intentionally read/write against production data. Database migrations must be additive and backward-compatible with the previous API image because application rollback does not reverse a completed migration.

Before a production rollout, the controller creates an online SQLite backup, runs migrations with the candidate API, then health-gates the API and web containers. Current and previous digest-pinned images are retained for rollback. A failed candidate is recorded and skipped until the channel points to a different signed descriptor.

## Consequences

- The two sites share accounts and application state, although browser sessions remain origin-specific.
- A pull request cannot preview backend code. UI changes that require a new API contract must wait for a compatible API to reach `main`.
- Preview actions affect production data; there is no preview reset operation.
- Data rollback is a deliberate database restore, not an automatic consequence of an image rollback.
- Mutable `preview` and `production` tags are discovery pointers only. Controllers deploy the verified immutable digest and digest-pinned application images recorded by the descriptor.
