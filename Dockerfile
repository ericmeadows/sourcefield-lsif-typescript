FROM node:18-alpine3.15

ARG TAG

RUN apk add --no-cache git curl

RUN yarn global add npm yarn

COPY . .

RUN yarn
RUN yarn link
RUN lsif-typescript --help

# RUN yarn pack
# RUN yarn global add ./sourcegraph-lsif-typescript-v0.2.9.tgz

# RUN yarn global add @sourcegraph/scip-typescript@${TAG} @sourcegraph/src

CMD ["/bin/sh"]
