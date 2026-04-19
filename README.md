# Chem-E-Car Control Team File Management System

A full-stack team file collaboration platform with file upload/download/preview, nested folder management, per-file annotations, announcements, and a message board. Built with React + Express + SQLite — zero external database dependencies, ready to run out of the box.

---

## Features

- **Authentication** — Registration/login with JWT, invite-code-based signup, admin/member roles
- **File Management** — Unlimited nested folders, multi-file upload, in-browser preview, single & batch download
- **File Annotations** — Dedicated discussion thread per file for recording experiment parameters and feedback
- **Announcements** — Admin-published posts with pinning support and file attachments
- **Message Board** — Team-wide discussion with threaded replies
- **Modern UI** — Glassmorphism design, light/dark theme toggle, pure CSS with no framework dependencies

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | Vite 8 · React 19 · React Router v7 · Vanilla CSS |
| Backend | Node.js · Express 5 · better-sqlite3 · multer · JWT · bcryptjs |

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher

### 1. Clone and Install

```bash
git clone https://github.com/your-username/Controler.git
cd Controler
npm install
```

### 2. Configure Environment Variables (Optional)

Copy the provided template and edit as needed:

```bash
cp .env.example .env
```

Available options:

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | JWT signing secret | `change-me-to-a-secure-random-string` |
| `INVITE_CODE` | Registration invite code | `change-me` |
| `ADMIN_PASSWORD` | Initial admin password (only used on first DB creation) | `admin123` |
| `PORT` | Backend port | `3001` |
| `DB_PATH` | Database file path | `server/data.db` |
| `UPLOAD_DIR` | Upload storage path | `server/uploads/` |

> For local development you can skip this step — defaults work out of the box.

### 3. Start the Services

Run both frontend and backend in separate terminals:

```bash
# Terminal A — Backend
node server/index.js

# Terminal B — Frontend
npm run dev
```

Backend listens on `http://localhost:3001`, frontend on `http://localhost:5173`.

On first launch, the backend automatically creates the database and upload directory.

### 4. Log In

Open `http://localhost:5173` in your browser.

- Admin username: `admin`
- Default password: `admin123` (or the value of `ADMIN_PASSWORD`)

Other team members can register via the signup page using the invite code.

---

## Project Structure

```
Controler/
├── server/                     # Backend
│   ├── index.js                # Express entry point
│   ├── db.js                   # SQLite schema & initialization
│   ├── middleware/
│   │   └── auth.js             # JWT auth middleware
│   └── routes/
│       ├── auth.js             # Registration / login
│       ├── files.js            # File upload / download / preview
│       ├── folders.js          # Folder CRUD
│       ├── comments.js         # File annotations
│       ├── announcements.js    # Announcements
│       └── messages.js         # Message board
├── src/                        # Frontend
│   ├── App.jsx                 # Route configuration
│   ├── main.jsx                # Entry point
│   ├── api.js                  # API request helpers
│   ├── AuthContext.jsx         # Auth context provider
│   ├── index.css               # Global styles
│   ├── pages/                  # Login / register pages
│   └── components/             # Business components
├── public/                     # Static assets
├── .env.example                # Environment variable template
├── .gitignore
├── package.json
└── vite.config.js
```

---

## Production Deployment

Example using Ubuntu + Nginx.

### 1. Install Server Dependencies

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs build-essential python3 nginx
npm install -g pm2
```

### 2. Deploy the Code

```bash
cd /var/www
git clone https://github.com/your-username/Controler.git chemecar
cd chemecar
npm install
npm run build

mkdir -p /var/www/chemecar-data/uploads
```

### 3. Start the Backend

```bash
export JWT_SECRET="$(openssl rand -hex 32)"
export INVITE_CODE="your-invite-code"
export ADMIN_PASSWORD="your-admin-password"
export NODE_ENV="production"
export PORT=3001
export DB_PATH="/var/www/chemecar-data/data.db"
export UPLOAD_DIR="/var/www/chemecar-data/uploads"

pm2 start server/index.js --name chemecar
pm2 save
pm2 startup
```

### 4. Configure Nginx

Create `/etc/nginx/sites-available/chemecar`:

```nginx
server {
    listen 80;
    server_name your-domain-or-ip;

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

### 5. HTTPS (Optional)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

---

## Updating

Database and uploads are stored in `/var/www/chemecar-data/`, separate from the code directory. Updates do not affect data.

```bash
cd /var/www/chemecar
pm2 stop chemecar
git pull
npm install
npm run build
pm2 restart chemecar
```

---

## Operations Reference

| Action | Command |
|--------|---------|
| Check status | `pm2 status` |
| View logs | `pm2 logs chemecar` |
| Restart service | `pm2 restart chemecar` |
| Reload Nginx | `systemctl reload nginx` |
| Backup database | `cp /var/www/chemecar-data/data.db ~/backup.db` |
| Backup uploads | `tar czf ~/uploads.tar.gz /var/www/chemecar-data/uploads/` |

---

## Security Notes

1. **Must** change `JWT_SECRET` and `INVITE_CODE` before deploying to production
2. Change the default admin password immediately after first login
3. Back up `data.db` and the `uploads/` directory regularly

---

## License

[MIT](LICENSE)
