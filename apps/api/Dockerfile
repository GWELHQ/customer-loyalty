# Multi-stage build for Cloud Run.
FROM node:20-slim AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm install --workspaces --if-present --ignore-scripts

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY tsconfig.base.json tsconfig.base.json
RUN npm run build --workspace=@loyalty/api

FROM node:20-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/apps/api/node_modules apps/api/node_modules
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY --from=build /repo/packages/shared packages/shared

EXPOSE 8080
CMD ["node", "apps/api/dist/main.js"]
