# Chem-E-Car 控制组文件管理系统

一个前后端分离的团队文件协作平台，支持文件上传/下载/预览、树形文件夹、文件注释、系统公告、留言板等功能。基于 React + Express + SQLite 构建，零外部数据库依赖，开箱即用。

---

## 功能特性

- **用户认证** — 注册/登录、JWT 鉴权、邀请码注册机制、管理员/成员角色区分
- **文件管理** — 无限层级文件夹、多文件上传、在线预览、单文件及批量下载
- **文件注释** — 为每个文件开设独立讨论区，记录实验参数与反馈
- **系统公告** — 管理员发布/置顶公告，支持附件上传
- **留言板** — 团队成员自由交流，支持多级回复
- **界面设计** — 玻璃拟态风格，亮/暗主题切换，纯 CSS 无框架依赖

---

## 技术栈

| 端 | 技术 |
|----|------|
| 前端 | Vite 8 · React 19 · React Router v7 · 原生 CSS |
| 后端 | Node.js · Express 5 · better-sqlite3 · multer · JWT · bcryptjs |

---

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) v18 或更高版本

### 1. 克隆并安装

```bash
git clone https://github.com/你的用户名/Controler.git
cd Controler
npm install
```

### 2. 配置环境变量（可选）

项目根目录提供了 `.env.example` 模板，复制并按需修改：

```bash
cp .env.example .env
```

可配置项如下：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `JWT_SECRET` | JWT 签名密钥 | `change-me-to-a-secure-random-string` |
| `INVITE_CODE` | 注册邀请码 | `change-me` |
| `ADMIN_PASSWORD` | 初始管理员密码（仅首次建库生效） | `admin123` |
| `PORT` | 后端端口 | `3001` |
| `DB_PATH` | 数据库文件路径 | `server/data.db` |
| `UPLOAD_DIR` | 上传文件存储路径 | `server/uploads/` |

> 本地开发可跳过此步骤，全部使用默认值即可运行。

### 3. 启动服务

需要同时运行前后端，推荐开两个终端：

```bash
# 终端 A — 后端
node server/index.js

# 终端 B — 前端
npm run dev
```

后端默认监听 `http://localhost:3001`，前端默认监听 `http://localhost:5173`。

首次启动时，后端会自动创建数据库和上传目录。

### 4. 登录

浏览器访问 `http://localhost:5173`。

- 管理员账号：`admin`
- 默认密码：`admin123`（或 `ADMIN_PASSWORD` 环境变量的值）

其他成员可在登录页点击「注册」，输入邀请码完成注册。

---

## 项目结构

```
Controler/
├── server/                     # 后端
│   ├── index.js                # Express 入口
│   ├── db.js                   # SQLite 建表与初始化
│   ├── middleware/
│   │   └── auth.js             # JWT 鉴权中间件
│   └── routes/
│       ├── auth.js             # 注册 / 登录
│       ├── files.js            # 文件上传 / 下载 / 预览
│       ├── folders.js          # 文件夹 CRUD
│       ├── comments.js         # 文件注释
│       ├── announcements.js    # 系统公告
│       └── messages.js         # 留言板
├── src/                        # 前端
│   ├── App.jsx                 # 路由配置
│   ├── main.jsx                # 入口
│   ├── api.js                  # API 请求封装
│   ├── AuthContext.jsx         # 认证上下文
│   ├── index.css               # 全局样式
│   ├── pages/                  # 登录 / 注册页
│   └── components/             # 业务组件
├── public/                     # 静态资源
├── .env.example                # 环境变量模板
├── .gitignore
├── package.json
└── vite.config.js
```

---

## 生产部署

以 Ubuntu + Nginx 为例。

### 1. 安装服务器环境

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs build-essential python3 nginx
npm install -g pm2
```

### 2. 部署代码

```bash
cd /var/www
git clone https://github.com/你的用户名/Controler.git chemecar
cd chemecar
npm install
npm run build

mkdir -p /var/www/chemecar-data/uploads
```

### 3. 启动后端

```bash
export JWT_SECRET="$(openssl rand -hex 32)"
export INVITE_CODE="你的邀请码"
export ADMIN_PASSWORD="你的管理员密码"
export NODE_ENV="production"
export PORT=3001
export DB_PATH="/var/www/chemecar-data/data.db"
export UPLOAD_DIR="/var/www/chemecar-data/uploads"

pm2 start server/index.js --name chemecar
pm2 save
pm2 startup
```

### 4. 配置 Nginx

创建 `/etc/nginx/sites-available/chemecar`：

```nginx
server {
    listen 80;
    server_name 你的域名或IP;

    root /var/www/chemecar/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 50M;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/chemecar /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

### 5. HTTPS（可选）

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

---

## 更新代码

数据库和上传文件存放在 `/var/www/chemecar-data/`，与代码目录分离，更新不影响数据。

```bash
cd /var/www/chemecar
pm2 stop chemecar
git pull
npm install
npm run build
pm2 restart chemecar
```

---

## 常用运维命令

| 操作 | 命令 |
|------|------|
| 查看状态 | `pm2 status` |
| 查看日志 | `pm2 logs chemecar` |
| 重启服务 | `pm2 restart chemecar` |
| 重载 Nginx | `systemctl reload nginx` |
| 备份数据库 | `cp /var/www/chemecar-data/data.db ~/backup.db` |
| 备份上传文件 | `tar czf ~/uploads.tar.gz /var/www/chemecar-data/uploads/` |

---

## 安全注意事项

1. 部署前**必须**修改 `JWT_SECRET` 和 `INVITE_CODE`
2. 首次登录后立即更改管理员密码
3. 定期备份 `data.db` 和 `uploads/` 目录

---

## License

[MIT](LICENSE)
