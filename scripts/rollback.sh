#!/usr/bin/env bash
set -e; cd /root/engos-docker
PREV=$(cat .previous-sha)
export APP_IMAGE=ghcr.io/n8nmonk-wq/engineering-os:$PREV
docker compose pull app && docker compose up -d --no-build app
echo "$PREV" > .deployed-sha
