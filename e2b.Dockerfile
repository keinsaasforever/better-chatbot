FROM node:22.17.0-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash user

WORKDIR /home/user/app

COPY e2b/template/package.json e2b/template/package-lock.json ./
RUN npm ci --ignore-scripts \
    && npm cache clean --force

COPY e2b/template/ ./
RUN chown -R user:user /home/user/app

USER user
EXPOSE 3000

CMD ["npm", "run", "dev"]
