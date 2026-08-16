#!/bin/sh

set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
IMAGE=${DEPLOYER_IMAGE:-macroflow-deployer:local}

docker build \
  --tag "$IMAGE" \
  --file "$ROOT/infrastructure/deployer/Dockerfile" \
  "$ROOT"

# The controller image carries pinned Docker Compose and Cosign binaries. The
# containers use the host daemon through its socket; GitHub Actions never does.
docker run --rm \
  --entrypoint docker \
  --volume /var/run/docker.sock:/var/run/docker.sock \
  --volume "$ROOT:/workspace:ro" \
  --workdir /workspace \
  "$IMAGE" \
  compose \
  --file infrastructure/deployer/controllers.compose.yaml \
  up \
  --detach \
  --no-build
