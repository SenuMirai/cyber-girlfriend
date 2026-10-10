# 赛博女友 · 公网部署镜像
#
# 两段构建：
#   第一段装开发依赖，把前端 src/main.js 打成 public/app.js
#   第二段只装生产依赖，镜像里不带 esbuild 这类构建工具
#
# 跑起来默认就是「公网模式」：数据按浏览器隔离，API Key 由每位使用者自带。

# ---------- 构建阶段 ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- 运行阶段 ----------
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production \
    CG_PUBLIC=1 \
    CG_DATA_DIR=/data \
    PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server.mjs ./
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public
COPY --from=build /app/defaults ./defaults
# 程序自带的默认形象图（大肥鱼，同时用作首屏占位图）
COPY --from=build /app/assets/1791525005312.jpg ./assets/1791525005312.jpg

# 数据目录（平台挂持久磁盘时指向这里）
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 3000

# 平台用这个判断服务是否活着
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
