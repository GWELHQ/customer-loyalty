# Builds the SPA and serves it statically via nginx on Cloud Run.
# (Alternative: skip this entirely and deploy the `dist/` output to
# Firebase Hosting or a Cloud Storage + Cloud CDN bucket instead — see
# infra/google-cloud/DEPLOYMENT.md for all three options.)
FROM node:20-slim AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install --workspaces --if-present --ignore-scripts

COPY packages/shared packages/shared
COPY packages/api-client packages/api-client
COPY apps/web apps/web
COPY tsconfig.base.json tsconfig.base.json
ARG VITE_API_BASE_URL
ARG VITE_MS_ENTRA_TENANT_ID
ARG VITE_MS_ENTRA_CLIENT_ID
ARG VITE_MS_ENTRA_REDIRECT_URI
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_MS_ENTRA_TENANT_ID=$VITE_MS_ENTRA_TENANT_ID \
    VITE_MS_ENTRA_CLIENT_ID=$VITE_MS_ENTRA_CLIENT_ID \
    VITE_MS_ENTRA_REDIRECT_URI=$VITE_MS_ENTRA_REDIRECT_URI \
    VITE_DATA_MODE=api
RUN npm run build --workspace=@loyalty/web

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
