docker run -e "INITIAL_PORT=30000" -e "IP=0.0.0.0" -p 30000-30005:30000-30005 grokzen/redis-cluster:latest &
npm install
sleep 15
npm run test:js:cluster || npm run test:js:cluster || npm run test:js:cluster
