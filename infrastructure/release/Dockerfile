FROM scratch

ARG CHANNEL
ARG API_IMAGE
ARG WEB_IMAGE
ARG BUILD_VERSION
ARG BUILD_PR_NUMBER

LABEL net.tylerallen.macroflow.channel=$CHANNEL \
      net.tylerallen.macroflow.api=$API_IMAGE \
      net.tylerallen.macroflow.web=$WEB_IMAGE \
      net.tylerallen.macroflow.pr=$BUILD_PR_NUMBER \
      org.opencontainers.image.revision=$BUILD_VERSION
