FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --maxsockets=2
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev --maxsockets=2
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
RUN mkdir -p /app/var/uploads && chown -R node:node /app
USER node
EXPOSE 8787
CMD ["node", "dist/src/server.js"]
