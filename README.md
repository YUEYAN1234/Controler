# Chem-E-Car 控制组文件管理系统 🚗🧪

一个前后端分离的团队文件协作平台，支持文件上传/下载/预览、树形文件夹、文件注释、系统公告、留言板等功能。基于 React + Express + SQLite，零外部数据库依赖，开箱即用。

![Tech Stack](https://img.shields.io/badge/React-19-blue?logo=react) ![Tech Stack](https://img.shields.io/badge/Express-5-green?logo=express) ![Tech Stack](https://img.shields.io/badge/SQLite-3-blue?logo=sqlite) ![Tech Stack](https://img.shields.io/badge/Vite-8-purple?logo=vite)

---

## ✨ 功能特性

| 模块 | 说明 |
|------|------|
| 🔒 用户认证 | 注册/登录，JWT 令牌鉴权，邀请码注册机制，管理员/成员角色 |
| 📁 文件管理 | 无限层级文件夹、多文件上传、在线预览、单文件/批量下载 |
| 💬 文件注释 | 为每个文件开设独立讨论区，记录实验参数与反馈 |
| 📢 系统公告 | 管理员发布/置顶公告，支持附件 |
| 💬 留言板 | 团队成员自由交流，支持多级回复 |
| 🎨 现代UI | 玻璃拟态设计，亮/暗主题切换，纯 CSS 无框架依赖 |

---

## 🛠️ 技术栈

**前端**: Vite + React 19 + React Router v7 + 原生 CSS

**后端**: Node.js + Express 5 + better-sqlite3 + multer + JWT + bcryptjs

---

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) v18+

### 1. 克隆项目

```bash
git clone https://github.com/你的用户名/Controler.git
cd Controler
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量（可选）

复制环境变量模板并按需修改：

```bash
cp .env.example .env
```

`.env` 文件中的可配置项：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `JWT_SECRET` | JWT 签名密钥 | `change-me-to-a-secure-random-string` |
| `INVITE_CODE` | 注册邀请码 | `change-me` |
| `ADMIN_PASSWORD` | 初始管理员密码（仅首次建库生效） | `admin123` |
| `PORT` | 后端服务端口 | `3001` |
| `DB_PATH` | 数据库文件路径 | `server/data.db` |
| `UPLOAD_DIR` | 上传文件存储路径 | `server/uploads/` |

> 💡 本地开发可以不创建 `.env`，全部使用默认值即可直接运行。

### 4. 启动服务

打开**两个终端**：

**终端 A — 启动后端**
```bash
node server/index.js
```
后端默认运行在 `http://localhost:3001`，首次启动会自动创建数据库和上传目录。

**终端 B — 启动前端**
```bash
npm run dev
```
前端默认运行在 `http://localhost:5173`。

### 5. 登录使用

打开浏览器访问 `http://localhost:5173`：

- **管理员账号**: `admin`
- **默认密码**: `admin123`（或你在 `ADMIN_PASSWORD` 中设置的值）

其他团队成员可在登录页点击「注册」，输入邀请码完成注册。

> ⚠️ **部署到公网时**，请务必修改 `JWT_SECRET` 和 `INVITE_CODE`，并在首次登录后更改管理员密码。

---

## 📂 项目结构

```text
Controler/
├── server/                     # 后端
│   ├── index.js                # Express 入口
│   ├── db.js                   # SQLite 建表与初始化
│   ├── middleware/
│   │   └── auth.js             # JWT 鉴权中间件
│   └── routes/
│       ├── auth.js             # 注册/登录
│       ├── files.js            # 文件上传/下载/预览
│       ├── folders.js          # 文件夹 CRUD
│       ├── comments.js         # 文件注释
│       ├── announcements.js    # 系统公告
│       └── messages.js         # 留言板
├── src/                        # 前端
│   ├── App.jsx                 # 路由配置
│   ├── main.jsx                # 入口
│   ├── api.js                  # API 请求封装
│   ├── AuthContext.jsx         # 用户认证上下文
│   ├── index.css               # 全局样式
│   ├── pages/                  # 登录/注册页
│   └── components/             # 文件管理器、留言板等组件
├── public/                     # 静态资源
├── .env.example                # 环境变量模板
├── .gitignore
├── package.json
└── vite.config.js
```

---

## ☁️ 生产部署（Linux 服务器）

以下以 Ubuntu + Nginx 为例。

### 1. 服务器环境准备

```bash
# 安装 Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs build-essential python3

# 安装 Nginx 和 PM2
apt install -y nginx
npm install -g pm2
```

### 2. 部署代码

```bash
cd /var/www
git clone https://github.com/你的用户名/Controler.git chemecar
cd chemecar

# 安装全部依赖并构建前端
npm install
npm run build

# 创建外部数据目录（更新代码时数据不丢失）
mkdir -p /var/www/chemecar-data/uploads
```

### 3. 配置环境变量并启动后端

```bash
# 设置环境变量
export JWT_SECRET="$(openssl rand -hex 32)"
export INVITE_CODE="你的团队邀请码"
export ADMIN_PASSWORD="你的管理员密码"
export NODE_ENV="production"
export PORT=3001
export DB_PATH="/var/www/chemecar-data/data.db"
export UPLOAD_DIR="/var/www/chemecar-data/uploads"

# 用 PM2 启动
pm2 start server/index.js --name chemecar
pm2 save
pm2 startup
```

### 4. 配置 Nginx

```bash
nano /etc/nginx/sites-available/chemecar
```

写入：

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

启用并重载：

```bash
ln -s /etc/nginx/sites-available/chemecar /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

访问 `http://你的IP` 即可使用 🎉

### 5. 可选：HTTPS

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

---

## 🔄 更新代码（不丢数据）

只要数据库和上传文件存放在 `/var/www/chemecar-data/`，更新代码不会影响数据。

```bash
cd /var/www/chemecar
pm2 stop chemecar

git pull                    # 拉取最新代码
npm install                 # 更新依赖
npm run build               # 重新构建前端

pm2 restart chemecar
```

---

## 📌 运维速查

| 操作 | 命令 |
|------|------|
| 查看状态 | `pm2 status` |
| 查看日志 | `pm2 logs chemecar` |
| 重启服务 | `pm2 restart chemecar` |
| 重载 Nginx | `systemctl reload nginx` |
| 备份数据库 | `cp /var/www/chemecar-data/data.db ~/backup.db` |
| 备份上传文件 | `tar czf ~/uploads.tar.gz /var/www/chemecar-data/uploads/` |

---

## 📄 License

[MIT](LICENSE)
