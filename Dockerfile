FROM node:20-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY scripts ./scripts
RUN npm ci
COPY src ./src
COPY samples ./samples
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY static ./static
EXPOSE 8080
CMD ["node", "dist/src/main.js"]
