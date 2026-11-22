#!/usr/bin/env bash
# Entry point for Dockerfile.render: Redis + Temporal dev server + API/worker in one container.
# If any of the three processes exits, the container exits so the platform restarts it.
set -euo pipefail

export PORT="${PORT:-10000}"
export REDIS_URL="redis://127.0.0.1:6379"
export TEMPORAL_ADDRESS="127.0.0.1:7233"
export SUPPLIER_BASE_URL="http://127.0.0.1:${PORT}"
export SERVICE_NAME="${SERVICE_NAME:-hotel-offer-orchestrator}"

pids=()
shutdown() {
  echo "[start] stopping processes" >&2
  kill -TERM "${pids[@]}" 2>/dev/null || true
  wait || true
  exit 0
}
trap shutdown TERM INT

echo "[start] starting redis" >&2
redis-server --bind 127.0.0.1 --port 6379 --save "" --appendonly no \
  --maxmemory 32mb --maxmemory-policy volatile-lru --dir /tmp --loglevel warning &
pids+=($!)

echo "[start] starting temporal dev server" >&2
temporal server start-dev --ip 127.0.0.1 --port 7233 --headless --namespace default &
pids+=($!)

for i in $(seq 1 90); do
  if temporal operator cluster health --address 127.0.0.1:7233 >/dev/null 2>&1; then
    echo "[start] temporal is ready after ${i}s" >&2
    break
  fi
  sleep 1
done

echo "[start] starting API + worker on port ${PORT}" >&2
node dist/allInOne.js &
pids+=($!)

# Exit as soon as any process dies.
set +e
wait -n
status=$?
echo "[start] a process exited with status ${status}; stopping container" >&2
kill -TERM "${pids[@]}" 2>/dev/null
exit 1
