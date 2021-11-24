ARG NODE_VERSION=16
FROM node:$NODE_VERSION

RUN apt-get update -y && apt-get install -y redis-server
RUN mkdir /code
WORKDIR /code
ADD package.json package-lock.json ./
#RUN npm install --no-save
RUN npm install

