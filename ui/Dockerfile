# ui/Dockerfile
# Builds the page with Vite and serves the result from nginx. The second stage is
# nginx rather than node because the built page is static files plus a proxy to the
# api, and that is a job nginx does in configuration instead of in code.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY services/api/package.json services/api/
COPY services/egress-gate/package.json services/egress-gate/
COPY services/extractor/package.json services/extractor/
COPY services/ledger/package.json services/ledger/
COPY services/mailer/package.json services/mailer/
COPY services/mcp/package.json services/mcp/
COPY services/mediator/package.json services/mediator/
COPY ui/package.json ui/
# The full install here: Vite is a devDependency and this stage is thrown away.
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY ui ./ui
RUN npm run build --workspace @ngl/ui

FROM nginx:1.27-alpine
COPY ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/ui/dist /usr/share/nginx/html
# Serving static files needs no privileges. Port 8080 instead of 80 and the writable
# paths handed to the nginx user is all it takes to drop root; compose publishes it
# on 5173 either way, so nothing outside this file notices.
RUN sed -i '/^user /d' /etc/nginx/nginx.conf \
  && touch /run/nginx.pid \
  && chown -R nginx:nginx /run/nginx.pid /var/cache/nginx /var/log/nginx
USER nginx
EXPOSE 8080
