#!/bin/sh

set -eu

IMAGE=${1:-macroflow-deployer:test}
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT
mkdir -p "$TEST_ROOT/host/deployer/preview" "$TEST_ROOT/host/deployer/production" "$TEST_ROOT/host/deployer/shared"
touch "$TEST_ROOT/production.secrets.env"

grep -Fq -- '--project-name' "$ROOT/infrastructure/deployer/start-controllers.sh"
grep -Fq -- 'macroflow-deployer' "$ROOT/infrastructure/deployer/start-controllers.sh"

run_controller() {
  channel=$1
  state=$2
  shift 2
  docker run --rm \
    --entrypoint /usr/local/bin/macroflow-deploy \
    -e CHANNEL="$channel" \
    -e RUN_ONCE=1 \
    -e HEALTH_ATTEMPTS=1 \
    -e FAKE_DOCKER_LOG=/test-state/docker.log \
    -e PATH=/test:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    "$@" \
    -v "$ROOT/infrastructure/deployer/tests/fake-docker:/test/docker:ro" \
    -v "$ROOT/infrastructure/deployer/tests/fake-cosign:/test/cosign:ro" \
    -v "$TEST_ROOT:/test-state" \
    -v "$TEST_ROOT/host/deployer:/controller-states:ro" \
    -v "$TEST_ROOT/host/deployer/shared:/shared-state" \
    -v "$state:/state" \
    "$IMAGE"
}

if docker run --rm --entrypoint /usr/local/bin/macroflow-deploy -e CHANNEL=staging "$IMAGE"; then
  echo "Controller accepted an invalid channel" >&2
  exit 1
fi

if docker run --rm \
  --entrypoint /usr/local/bin/macroflow-deploy \
  -e CHANNEL=preview \
  -v "$ROOT/infrastructure/deployer/production.environment.example:/config/environment.env:ro" \
  "$IMAGE"; then
  echo "Preview controller accepted production configuration" >&2
  exit 1
fi

# A preview descriptor carrying an API digest must be rejected before Compose is invoked.
: > "$TEST_ROOT/docker.log"
run_controller preview "$TEST_ROOT/host/deployer/preview" \
  -e FAKE_API_LABEL=ghcr.io/allen141/macroflow-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  -v "$ROOT/infrastructure/deployer/preview.environment.example:/config/environment.env:ro"
if grep -Fq compose "$TEST_ROOT/docker.log"; then
  echo "Preview controller acted on an API-bearing release" >&2
  exit 1
fi

# A valid preview release may only replace preview-web and must not touch backup or API services.
: > "$TEST_ROOT/docker.log"
run_controller preview "$TEST_ROOT/host/deployer/preview" \
  -v "$ROOT/infrastructure/deployer/preview.environment.example:/config/environment.env:ro"
grep -Fq 'up --detach --no-deps preview-web' "$TEST_ROOT/docker.log"
if grep -Eq 'compose .* (api|production-web|backup)( |$)' "$TEST_ROOT/docker.log"; then
  echo "Preview controller crossed the production service boundary" >&2
  exit 1
fi
grep -Fq 'image rm sha256:4444444444444444444444444444444444444444444444444444444444444444' "$TEST_ROOT/docker.log"
if grep -Fq 'image rm sha256:6666666666666666666666666666666666666666666666666666666666666666' "$TEST_ROOT/docker.log"; then
  echo "Cleanup attempted to remove an unrelated image" >&2
  exit 1
fi

# Production must back up, migrate, and only then update API and production web.
: > "$TEST_ROOT/docker.log"
mkdir -p "$TEST_ROOT/data"
touch "$TEST_ROOT/data/macroflow.db"
run_controller production "$TEST_ROOT/host/deployer/production" \
  -e FAKE_CHANNEL=production \
  -e FAKE_API_LABEL=ghcr.io/allen141/macroflow-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  -e FAKE_PR_NUMBER= \
  -v "$ROOT/infrastructure/deployer/production.environment.example:/config/environment.env:ro" \
  -v "$TEST_ROOT/production.secrets.env:/config/secrets.env:ro" \
  -v "$TEST_ROOT:/mnt/user/appdata/macroflow"
backup_line=$(grep -n 'compose .*profile backup run .*RUN_ONCE=1 backup' "$TEST_ROOT/docker.log" | head -1 | cut -d: -f1)
migrate_line=$(grep -n "compose .*run --rm --no-deps api node migrate.js" "$TEST_ROOT/docker.log" | head -1 | cut -d: -f1)
deploy_line=$(grep -n 'compose .*up --detach api production-web' "$TEST_ROOT/docker.log" | head -1 | cut -d: -f1)
test "$backup_line" -lt "$migrate_line" && test "$migrate_line" -lt "$deploy_line"
if grep -Fq preview-web "$TEST_ROOT/docker.log"; then
  echo "Production controller replaced preview web" >&2
  exit 1
fi

docker run --rm \
  --entrypoint sh \
  -v "$ROOT/infrastructure/deployer/preview.environment.example:/config/environment.env:ro" \
  "$IMAGE" -c '
    set -a; . /config/environment.env; set +a
    export API_IMAGE=ghcr.io/allen141/macroflow-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    export WEB_IMAGE=ghcr.io/allen141/macroflow-web@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    export BUILD_VERSION=test
    docker compose --env-file /config/environment.env -f /opt/macroflow/deploy.compose.yaml config --quiet
  '

docker run --rm \
  --entrypoint sh \
  -v "$ROOT/infrastructure/deployer/production.environment.example:/config/environment.env:ro" \
  -v "$TEST_ROOT/production.secrets.env:/mnt/user/appdata/macroflow/production.secrets.env:ro" \
  "$IMAGE" -c '
    set -a; . /config/environment.env; set +a
    export API_IMAGE=ghcr.io/allen141/macroflow-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    export WEB_IMAGE=ghcr.io/allen141/macroflow-web@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    export BUILD_VERSION=test
    docker compose --env-file /config/environment.env -f /opt/macroflow/deploy.compose.yaml --profile backup config --quiet
  '

echo "Deployment controller policy tests passed"
