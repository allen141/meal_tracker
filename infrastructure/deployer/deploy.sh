#!/bin/sh

set -eu

CHANNEL=${CHANNEL:-}
STATE_DIR=${STATE_DIR:-/state}
SHARED_STATE_DIR=${SHARED_STATE_DIR:-/shared-state}
PROTECTED_STATE_DIR=${PROTECTED_STATE_DIR:-/controller-states}
CONFIG_FILE=${CONFIG_FILE:-/config/environment.env}
COMPOSE_FILE=${COMPOSE_FILE:-/opt/macroflow/deploy.compose.yaml}
POLL_SECONDS=${POLL_SECONDS:-60}
HEALTH_ATTEMPTS=${HEALTH_ATTEMPTS:-45}
RELEASE_REPOSITORY=${RELEASE_REPOSITORY:-ghcr.io/allen141/macroflow-release}
API_REPOSITORY=${API_REPOSITORY:-ghcr.io/allen141/macroflow-api}
WEB_REPOSITORY=${WEB_REPOSITORY:-ghcr.io/allen141/macroflow-web}
OIDC_ISSUER=https://token.actions.githubusercontent.com

case "$CHANNEL" in
  preview)
    IDENTITY_REGEXP='^https://github.com/allen141/meal_tracker/.github/workflows/application.yml@refs/pull/[0-9]+/merge$'
    ;;
  production)
    IDENTITY_REGEXP='^https://github.com/allen141/meal_tracker/.github/workflows/application.yml@refs/heads/main$'
    ;;
  *) echo "CHANNEL must be preview or production" >&2; exit 2 ;;
esac

test -r "$CONFIG_FILE" || { echo "Missing $CONFIG_FILE" >&2; exit 2; }
set -a
. "$CONFIG_FILE"
set +a

: "${CONTAINER_PREFIX:?CONTAINER_PREFIX is required}"
: "${ENV_ROOT:?ENV_ROOT is required}"
: "${DATA_DIR:?DATA_DIR is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"
: "${SECRETS_FILE:?SECRETS_FILE is required}"

case "$CHANNEL:$ENV_ROOT:$DATA_DIR:$BACKUP_DIR:$CONTAINER_PREFIX:$SECRETS_FILE" in
  preview:/mnt/user/appdata/macroflow:/mnt/user/appdata/macroflow/data:/mnt/user/appdata/macroflow/backups:macroflow-preview:/dev/null) ;;
  production:/mnt/user/appdata/macroflow:/mnt/user/appdata/macroflow/data:/mnt/user/appdata/macroflow/backups:macroflow-production:/mnt/user/appdata/macroflow/production.secrets.env) ;;
  *) echo "Configuration does not match the allowlisted environment" >&2; exit 2 ;;
esac

RELEASE_IMAGE="$RELEASE_REPOSITORY:$CHANNEL"
CURRENT_FILE="$STATE_DIR/current-release"
FAILED_FILE="$STATE_DIR/failed-release"
PREVIOUS_FILE="$STATE_DIR/previous-release"
LOCK_DIR="$STATE_DIR/check.lock"
DEPLOY_LOCK_FILE="$SHARED_STATE_DIR/deploy.lock"
LOG_FILE="$STATE_DIR/deploy.log"

mkdir -p "$STATE_DIR" "$SHARED_STATE_DIR"
if test "$CHANNEL" = production; then
  mkdir -p "$DATA_DIR" "$BACKUP_DIR"
  test -r "$SECRETS_FILE" || { echo "Missing $SECRETS_FILE" >&2; exit 2; }
fi

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" | tee -a "$LOG_FILE"
}

compose() {
  docker compose --project-name macroflow --env-file "$CONFIG_FILE" --file "$COMPOSE_FILE" "$@"
}

container_health() {
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || printf 'missing'
}

wait_for_health() {
  container=$1
  attempt=1
  while test "$attempt" -le "$HEALTH_ATTEMPTS"; do
    status=$(container_health "$container")
    case "$status" in
      healthy) return 0 ;;
      unhealthy|exited|dead|missing) log "$container entered terminal state: $status"; return 1 ;;
    esac
    sleep 2
    attempt=$((attempt + 1))
  done
  log "$container did not become healthy"
  return 1
}

label() {
  value=$(docker image inspect --format "{{index .Config.Labels \"$2\"}}" "$1" 2>/dev/null || true)
  case "$value" in '<no value>'|'null') printf '' ;; *) printf '%s' "$value" ;; esac
}

validate_api_image() {
  case "$1" in
    "$API_REPOSITORY"@sha256:*) return 0 ;;
    *) log "Refusing unmanaged API image: $1"; return 1 ;;
  esac
}

validate_web_image() {
  case "$1" in
    "$WEB_REPOSITORY"@sha256:*) return 0 ;;
    *) log "Refusing unmanaged web image: $1"; return 1 ;;
  esac
}

protected_images() {
  candidate_release=${1:-}
  test -n "$candidate_release" && printf '%s\n' "$candidate_release"
  for state_file in \
    "$PROTECTED_STATE_DIR/preview/current-release" \
    "$PROTECTED_STATE_DIR/preview/previous-release" \
    "$PROTECTED_STATE_DIR/production/current-release" \
    "$PROTECTED_STATE_DIR/production/previous-release"; do
    test -r "$state_file" || continue
    sed -n '1,3p' "$state_file"
  done
}

reclaim_image_storage() {
  candidate_release=${1:-}
  protected=$(protected_images "$candidate_release")
  protected_ids=$(printf '%s\n' "$protected" | while IFS= read -r protected_image; do
    test -n "$protected_image" || continue
    docker image inspect --format '{{.Id}}' "$protected_image" 2>/dev/null || true
  done)

  log "Reclaiming stale MacroFlow image storage"
  docker image ls --digests --no-trunc --format '{{.Repository}}@{{.Digest}} {{.ID}}' | while IFS= read -r record; do
    image=${record%% *}
    image_id=${record#* }
    case "$image" in
      "$API_REPOSITORY"@sha256:*|"$WEB_REPOSITORY"@sha256:*|"$RELEASE_REPOSITORY"@sha256:*) ;;
      *) continue ;;
    esac
    case "$image_id" in sha256:*) ;; *) continue ;; esac
    printf '%s\n' "$protected" | grep -Fqx "$image" && continue
    printf '%s\n' "$protected_ids" | grep -Fqx "$image_id" && continue
    docker image rm "$image_id" >/dev/null 2>&1 || true
  done
  log "Stale MacroFlow image cleanup completed"
}

record_failed() {
  printf '%s\n' "$1" > "$FAILED_FILE"
}

rollback_preview() {
  test -r "$CURRENT_FILE" || { log "No preview release is available for rollback"; return 1; }
  previous_web=$(sed -n '3p' "$CURRENT_FILE")
  previous_version=$(sed -n '4p' "$CURRENT_FILE")
  validate_web_image "$previous_web" || return 1
  log "Restoring preview web release $previous_version"
  WEB_IMAGE=$previous_web BUILD_VERSION=$previous_version compose up --detach --no-deps preview-web
  wait_for_health macroflow-preview-web
}

rollback_production() {
  test -r "$CURRENT_FILE" || { log "No production release is available for rollback"; return 1; }
  previous_api=$(sed -n '2p' "$CURRENT_FILE")
  previous_web=$(sed -n '3p' "$CURRENT_FILE")
  previous_version=$(sed -n '4p' "$CURRENT_FILE")
  validate_api_image "$previous_api" && validate_web_image "$previous_web" || return 1
  log "Restoring production release $previous_version"
  API_IMAGE=$previous_api WEB_IMAGE=$previous_web BUILD_VERSION=$previous_version \
    compose up --detach api production-web
  wait_for_health macroflow-api && wait_for_health macroflow-production-web
}

proxy_ready() {
  web_container=$1
  docker exec "$web_container" wget -q -O /dev/null http://127.0.0.1:8080/api/health/ready
}

deploy_preview() {
  release_digest=$1
  web_image=$2
  version=$3
  pr_number=$4

  docker pull "$web_image" >/dev/null || { log "Preview web image pull failed"; return 1; }
  export WEB_IMAGE="$web_image" BUILD_VERSION="$version"
  if ! compose up --detach --no-deps preview-web || ! wait_for_health macroflow-preview-web || ! proxy_ready macroflow-preview-web; then
    log "Preview health gate failed"
    docker logs --tail 100 macroflow-preview-web 2>&1 | tee -a "$LOG_FILE" || true
    record_failed "$release_digest"
    rollback_preview || true
    return 1
  fi

  test -r "$CURRENT_FILE" && cp "$CURRENT_FILE" "$PREVIOUS_FILE"
  {
    printf '%s\n' "$release_digest"
    printf '%s\n' '-'
    printf '%s\n' "$web_image"
    printf '%s\n' "$version"
    printf '%s\n' "$pr_number"
  } > "$CURRENT_FILE"
}

deploy_production() {
  release_digest=$1
  api_image=$2
  web_image=$3
  version=$4

  if ! docker pull "$api_image" >/dev/null || ! docker pull "$web_image" >/dev/null; then
    log "Production application image pull failed"
    return 1
  fi
  export API_IMAGE="$api_image" WEB_IMAGE="$web_image" BUILD_VERSION="$version"

  if test -f "$DATA_DIR/macroflow.db"; then
    if ! compose --profile backup run --rm --no-deps -e RUN_ONCE=1 backup; then
      log "Pre-deployment SQLite backup failed"
      record_failed "$release_digest"
      return 1
    fi
  else
    log "No existing database; initial deployment does not require a pre-deployment backup"
  fi

  if ! compose run --rm --no-deps api node migrate.js; then
    log "Database migration failed"
    record_failed "$release_digest"
    return 1
  fi

  if ! compose up --detach api production-web || \
     ! wait_for_health macroflow-api || \
     ! wait_for_health macroflow-production-web || \
     ! proxy_ready macroflow-production-web; then
    log "Production health gate failed"
    docker logs --tail 100 macroflow-api 2>&1 | tee -a "$LOG_FILE" || true
    docker logs --tail 100 macroflow-production-web 2>&1 | tee -a "$LOG_FILE" || true
    record_failed "$release_digest"
    rollback_production || true
    return 1
  fi

  compose --profile backup up --detach --no-deps backup
  test -r "$CURRENT_FILE" && cp "$CURRENT_FILE" "$PREVIOUS_FILE"
  {
    printf '%s\n' "$release_digest"
    printf '%s\n' "$api_image"
    printf '%s\n' "$web_image"
    printf '%s\n' "$version"
    printf '%s\n' '-'
  } > "$CURRENT_FILE"
}

deploy_once() {
  log "Checking $RELEASE_IMAGE"
  if ! docker pull "$RELEASE_IMAGE" >/dev/null; then
    log "Release pull failed; reclaiming image storage before one retry"
    reclaim_image_storage
    docker pull "$RELEASE_IMAGE" >/dev/null || { log "Release pull failed after cleanup; current deployment was not changed"; return 0; }
  fi

  release_digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$RELEASE_IMAGE" 2>/dev/null || true)
  case "$release_digest" in "$RELEASE_REPOSITORY"@sha256:*) ;; *) log "Release did not resolve to the allowlisted repository"; return 0 ;; esac
  test ! -r "$CURRENT_FILE" || test "$(sed -n '1p' "$CURRENT_FILE")" != "$release_digest" || return 0
  if test -r "$FAILED_FILE" && test "$(cat "$FAILED_FILE")" = "$release_digest"; then
    log "Skipping release previously marked unhealthy: $release_digest"
    return 0
  fi

  if ! cosign verify --certificate-identity-regexp "$IDENTITY_REGEXP" --certificate-oidc-issuer "$OIDC_ISSUER" "$release_digest" >/dev/null; then
    log "Release signature or provenance verification failed"
    return 0
  fi

  release_channel=$(label "$RELEASE_IMAGE" net.tylerallen.macroflow.channel)
  api_image=$(label "$RELEASE_IMAGE" net.tylerallen.macroflow.api)
  web_image=$(label "$RELEASE_IMAGE" net.tylerallen.macroflow.web)
  version=$(label "$RELEASE_IMAGE" org.opencontainers.image.revision)
  pr_number=$(label "$RELEASE_IMAGE" net.tylerallen.macroflow.pr)
  test "$release_channel" = "$CHANNEL" || { log "Release channel mismatch"; return 0; }
  test -n "$version" || { log "Release version is missing"; return 0; }
  validate_web_image "$web_image" || return 0

  case "$CHANNEL" in
    preview)
      test -z "$api_image" || { log "Preview release attempted to select an API image"; return 0; }
      case "$pr_number" in ''|*[!0-9]*) log "Preview PR number is invalid"; return 0 ;; esac
      ;;
    production)
      validate_api_image "$api_image" || return 0
      test -z "$pr_number" || { log "Production release unexpectedly names a PR"; return 0; }
      ;;
  esac

  reclaim_image_storage "$release_digest"
  if test "$CHANNEL" = preview; then
    deploy_preview "$release_digest" "$web_image" "$version" "$pr_number" || return 0
  else
    deploy_production "$release_digest" "$api_image" "$web_image" "$version" || return 0
  fi
  rm -f "$FAILED_FILE"
  log "Deployment succeeded: $version${pr_number:+ (PR $pr_number)}"
  reclaim_image_storage "$release_digest"
}

run_with_locks() {
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    log "Another channel check holds the lock"
    return 0
  fi
  exec 9>"$DEPLOY_LOCK_FILE"
  if ! flock -n 9; then
    log "The other deployment channel is active"
    rmdir "$LOCK_DIR" 2>/dev/null || true
    return 0
  fi
  deploy_once
  result=$?
  flock -u 9
  exec 9>&-
  rmdir "$LOCK_DIR" 2>/dev/null || true
  return "$result"
}

rmdir "$LOCK_DIR" 2>/dev/null || true
if test "${RUN_ONCE:-0}" = 1; then
  run_with_locks
  exit
fi

while true; do
  run_with_locks || true
  sleep "$POLL_SECONDS"
done
