ARG NODE_VERSION=16-bullseye
FROM node:$NODE_VERSION

RUN apt-get update -y && apt-get install -y redis-server && apt-get clean
RUN mkdir /code
WORKDIR /code
ADD package.json package-lock.json ./
# Install npm dependencies without converting the lockfile version in npm 7,
# and remove temporary files to save space when developing locally.
RUN npm install --no-save && npm cache clean --force

