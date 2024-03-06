#!/bin/bash

set -euo pipefail

docker run --rm --name redis-cluster-ioredis-test -e "INITIAL_PORT=30000" -e "IP=0.0.0.0" -p 30000-30005:30000-30005 grokzen/redis-cluster:latest &
trap 'docker stop redis-cluster-ioredis-test' EXIT

npm install

sleep 15

for port in {30000..30005}; do
  docker exec redis-cluster-ioredis-test /bin/bash -c "redis-cli -p $port CONFIG SET protected-mode no"
done

npm run test:js:cluster || npm run test:js:cluster || npm run test:js:cluster
