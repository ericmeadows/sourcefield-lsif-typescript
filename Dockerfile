FROM node:18-alpine3.15

ARG TAG

RUN apk add --no-cache git curl

RUN yarn global add npm yarn

COPY . .

RUN yarn && yarn link

CMD ["/bin/sh"]
