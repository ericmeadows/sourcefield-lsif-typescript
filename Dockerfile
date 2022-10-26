#makePublic
FROM node:18-buster

ARG TAG

RUN apt-get update && \
    apt-get install -yq git curl

RUN npm install -g \
    yarn \
    pnpm

COPY . .

RUN yarn
RUN yarn build

RUN npm link
RUN lsif-typescript index --help

CMD ["/bin/sh"]
