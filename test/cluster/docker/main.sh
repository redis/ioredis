# --- Using 7.0.10 because it contains the fix for the protected-mode:no error
docker run -e "INITIAL_PORT=30000" -e "IP=0.0.0.0" -p 30000-30005:30000-30005 grokzen/redis-cluster:7.0.10 &
# --- For v4 we only want the docker container to run to start
# npm install
# sleep 15
# npm run test:js:cluster || npm run test:js:cluster || npm run test:js:cluster
