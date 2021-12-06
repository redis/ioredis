#!/bin/bash -u

# 1. Lint files
npm run lint || exit 1
# 2. Build typescript files (needed to run tests)
npm run build || exit 1
# 3. Run tests with mock redis server
redis-server --port 6379 &
REDIS_PID=$?
sleep 1
echo "Started redis as process $REDIS_PID"
trap "trap - SIGINT SIGTERM EXIT && kill $REDIS_PID" SIGINT SIGTERM EXIT
# Retry failed tests up to 3 times in case of spurious failures.
npm run test || npm run test || npm run test || exit 1
