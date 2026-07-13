#!/usr/bin/env sh
set -eu

SCRCPY_SERVER_VERSION="${SCRCPY_SERVER_VERSION:-4.1}"
SCRCPY_SERVER_DIR="${1:-./AYLink.Agent/Scrcpy}"
SCRCPY_SERVER_URL="https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_SERVER_VERSION}/scrcpy-server-v${SCRCPY_SERVER_VERSION}"

mkdir -p "${SCRCPY_SERVER_DIR}"
curl -fL --retry 3 --retry-delay 2 -o "${SCRCPY_SERVER_DIR}/scrcpy-server" "${SCRCPY_SERVER_URL}"
chmod 0644 "${SCRCPY_SERVER_DIR}/scrcpy-server"

echo "Downloaded scrcpy-server ${SCRCPY_SERVER_VERSION} to ${SCRCPY_SERVER_DIR}/scrcpy-server"
