FROM node:20-alpine AS build
WORKDIR /app
COPY package.json .
COPY yarn.lock .
RUN yarn install
COPY . .
RUN yarn run build

FROM node:20-alpine AS production
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json .
COPY yarn.lock .
RUN yarn install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
