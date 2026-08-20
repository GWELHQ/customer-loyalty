# Multi-stage build for Cloud Run.
FROM node:20-slim AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY tsconfig.base.json tsconfig.base.json
# @loyalty/shared has a `prepare` script (tsc build) that npm runs off its
# full source even with --ignore-scripts skipping *other* lifecycle hooks —
# its package.json alone isn't enough at this stage, unlike apps/api below.
COPY packages/shared packages/shared
COPY apps/api/package.json apps/api/package.json
RUN npm install --workspaces --if-present --ignore-scripts

COPY apps/api apps/api
RUN npm run build --workspace=@loyalty/shared
RUN npm run build --workspace=@loyalty/api

FROM node:20-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY --from=build /repo/packages/shared packages/shared

EXPOSE 8080
CMD ["node", "apps/api/dist/main.js"]
