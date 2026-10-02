# Docker 部署拾花物语

本应用需要 Node.js 后端和 SQLite，不能只部署 `dist` 静态文件到 GitHub Pages。仓库上传不会自动发布网站。

## 首次启动

在服务器安装 Docker Engine / Docker Desktop 和 Compose v2，克隆仓库后在项目目录执行：

```sh
cp .env.example .env
```

Windows PowerShell 使用 `Copy-Item .env.example .env`。编辑 `.env`，至少填写 `ADMIN_PASSWORD`（8–128 字符）。默认管理员账号为 `poxiao`，可以在首次启动前修改 `ADMIN_USERNAME`。包含 `$`、`#` 等字符的密码建议使用单引号包裹。

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 app
```

浏览器打开 `http://服务器IP:5173`。需要其他端口时修改 `.env` 中的 `APP_PORT`，例如 `8080`，重新运行 `docker compose up -d`。

镜像采用官方 `node:24-bookworm-slim`，以非 root 用户运行。运行时代码仅使用 Node.js 内置模块，不需要 `npm install`。容器健康检查访问 `/api/health`，初始化完成后显示 `healthy`。

## 配置

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `ADMIN_USERNAME` | `poxiao` | 首次创建管理员时使用，3–24 位字母、数字或下划线 |
| `ADMIN_PASSWORD` | 必填 | 首次创建管理员密码，8–128 字符，不写入仓库 |
| `APP_PORT` | `5173` | 宿主机访问端口 |
| `BIND_ADDRESS` | `0.0.0.0` | 有宿主机反向代理时可改为 `127.0.0.1` |
| `COOKIE_SECURE` | `0` | 浏览器使用 HTTPS 访问时设置为 `1`；直接 HTTP 时保持 `0` |

初始化参数只创建管理员，不会在重启时覆盖已有账号、密码、玩家数据或奖池。修改 `.env` 密码不等于修改已有管理员密码。后端也支持 `ADMIN_PASSWORD_FILE` 读取挂载的密码文件；如用 Docker secrets，请在自己的 Compose 配置中挂载文件并设置该变量。

公网部署可通过 Nginx、Caddy 等反向代理配置 HTTPS，原样转发请求的 `Host`，让浏览器请求源与后端校验一致。应用是单实例 SQLite 服务，不要让多个容器共用同一数据库卷。

## 数据与更新

数据库位于容器 `/app/data/university.sqlite`。Compose 将整个目录保存到命名卷 `blossom-tales_blossom-data`，重建容器和普通 `docker compose down` 不会删除它。

```sh
git pull --ff-only
docker compose up -d --build
```

不要使用 `docker compose down -v`，该命令会删除玩家数据卷。

备份时先停止写入，再复制整个数据目录：

```sh
mkdir -p backups
docker compose stop app
docker compose cp app:/app/data ./backups/snapshot
docker compose start app
```

每次备份使用新的目标目录名。Windows 可用 `New-Item -ItemType Directory -Force backups` 创建目录。备份会包含账号与会话，请自行妥善保存，不要上传仓库。

如需将现有 Windows 玩家数据迁移到容器，先停止旧后台服务并备份整个 `data` 目录。创建容器后，将旧数据复制进卷，再修正容器用户权限并启动：

```sh
docker compose create app
docker compose cp ./data/. app:/app/data/
docker compose run --rm --no-deps --user root --cap-add CHOWN --entrypoint chown app -R node:node /app/data
docker compose up -d
```

恢复备份也使用这组步骤，将 `./data/.` 替换为备份路径；目标应为空数据卷。迁移旧数据库后使用原管理员账号密码登录。

## 不用 Docker 的本地启动

首次启动（PowerShell）：

```powershell
$env:ADMIN_USERNAME = 'poxiao'
$env:ADMIN_PASSWORD = '请替换为自己的密码'
npm start
```

Linux/macOS 可先 `export ADMIN_USERNAME=poxiao`，再设置 `ADMIN_PASSWORD` 并运行 `npm start`。本地进程也支持 `PORT`、`HOST`、`DESTINY_DATA_DIR`。`.env` 是 Compose 的配置文件，`npm start` 不会自动读取它。

## 验证

```sh
npm ci
npm test
npx playwright install --with-deps chromium
npm run test:browser
npm run test:audio
```

测试均使用临时数据库，不修改正式玩家数据；浏览器测试默认使用 Playwright Chromium，可用 `CHROMIUM_PATH` 指定已有浏览器。

参考：[官方 Node 镜像](https://hub.docker.com/_/node)、[Compose 服务配置](https://docs.docker.com/reference/compose-file/services/)。
