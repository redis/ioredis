#!/bin/bash
if [ $# != 1 ]; then
    echo "Usage: $0 NODE_VERSION" 1>&2
    echo "e.g. $0 16-bullseye" 1>&2
    exit 1
fi
NODE_VERSION=$1
IMAGE_NAME=ioredis-ci-runner:$NODE_VERSION
# Build the image with the dependency versions from package.json and package-lock.json
docker build -t $IMAGE_NAME --build-arg=NODE_VERSION=$NODE_VERSION -f test/docker/Dockerfile .
# Run the image, mounting ./lib and ./test as read-only volumes.
# In github actions, trying to simulate a tty would result in an error "the input device is not a TTY"
docker run --rm  \
    -v $PWD/lib:/code/lib:ro \
    -v $PWD/test:/code/test:ro \
    -v $PWD/tsconfig.json:/code/tsconfig.json:ro \
    -v $PWD/.eslintignore:/code/.eslintignore:ro \
    -v $PWD/.eslintrc.yml:/code/.eslintrc.yml:ro \
    --entrypoint=/bin/bash \
    $IMAGE_NAME \
    test/docker/worker.sh
