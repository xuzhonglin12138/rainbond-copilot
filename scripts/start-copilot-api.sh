#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${HOME}/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "${HOME}/.nvm/nvm.sh"
  nvm use 20.20.0 >/dev/null || true
fi

cd "${ROOT_DIR}"

export COPILOT_STORE_MODE="${COPILOT_STORE_MODE:-file}"
export COPILOT_DATA_DIR="${COPILOT_DATA_DIR:-${ROOT_DIR}/.copilot-data}"
export COPILOT_API_HOST="${COPILOT_API_HOST:-127.0.0.1}"
export COPILOT_API_PORT="${COPILOT_API_PORT:-8787}"

mkdir -p "${COPILOT_DATA_DIR}"

echo "Building Rainbond Copilot API server..."
npm run build:server

echo "Starting Rainbond Copilot API server on ${COPILOT_API_HOST}:${COPILOT_API_PORT}"
echo "Store mode: ${COPILOT_STORE_MODE}"
echo "Data dir: ${COPILOT_DATA_DIR}"

exec node dist-server/server/index.js
