FROM ghcr.io/sigstore/cosign/cosign:v3.1.2 AS cosign

FROM docker:27.5.1-cli

RUN apk add --no-cache sqlite util-linux

COPY --from=cosign /ko-app/cosign /usr/local/bin/cosign
COPY infrastructure/deployer/deploy.sh /usr/local/bin/macroflow-deploy
COPY infrastructure/deployer/backup.sh /usr/local/bin/macroflow-backup
COPY infrastructure/deployer/deploy.compose.yaml /opt/macroflow/deploy.compose.yaml

RUN chmod 0555 /usr/local/bin/macroflow-deploy /usr/local/bin/macroflow-backup /usr/local/bin/cosign \
    && chmod 0444 /opt/macroflow/deploy.compose.yaml

ENTRYPOINT ["/usr/local/bin/macroflow-deploy"]
