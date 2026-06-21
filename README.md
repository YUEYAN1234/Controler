# Tianjin University Chem-E-Car Experimental Data Platform

This is an internal experimental data collaboration platform for the Tianjin University Chem-E-Car team. It supports file archiving, Excel data plotting, lab reservations, announcements, team discussion, AI-assisted Q&A, and game leaderboards for both the Control Group and the Power Group. The project uses a React + Vite frontend, an Express backend, and a local SQLite database file powered by `sql.js`, so it can run without a separate database service.

## Features

### Accounts and Permissions

- Registration, login, JWT authentication, and password changes.
- Invite-code-based registration controlled by `INVITE_CODE`.
- A default `admin` account is created automatically during first database initialization.
- Admins can manage announcements. Messages, replies, and reservations can be maintained by their owners or admins. File deletion actions are shown in the frontend only to admins or the uploader.

### File Management

- Separate file spaces for the Control Group and Power Group.
- Nested folders with create, rename, delete, and drag-and-drop move support.
- Multi-file upload, drag-and-drop upload, single-file download, and batch ZIP download.
- File search by file name, folder name, uploader, MIME type, and comment content.
- In-browser preview for images, PDF, Word, Excel, CSV, text, and code files.
- Excel preview parses sheets and attempts to extract embedded charts or images.
- Each file has its own record/comment area for experiment parameters, issues, and feedback.
- Excel files can be sent directly into the Data Plotting workspace from single-file actions or batch selection.

### Data Plotting

- Dedicated Data Plotting tab for `.xlsx` and `.xls` experiment files.
- Supports adding multiple Excel files to one plotting page and comparing their curves together.
- Keeps loaded data, page tabs, grouping, and plotted charts mounted when switching to other platform features and back.
- Automatically detects data groups from columns whose headers include `time`.
- Manual column configuration is available when files use non-standard X/Y column names or layouts.
- Supports metric switching for `R`, `G`, `B`, `Sum`, and `AvgSum`.
- Provides condition grouping, group colors, trace assignment, draggable Plotly legend positioning, and a legend show/hide control to avoid covering the chart.
- Uses responsive, theme-aware Plotly rendering with light and dark mode support, range slider navigation, group filtering, hover inspection, and PNG export.

### Lab Reservations

- Calendar view for monthly reservation records.
- Independent reservation calendars for the Control Group and Power Group.
- Time-conflict checks for reservations within the same group and date.
- Reservation owners and admins can edit or cancel reservations.
- Experiment purpose and conclusion fields help keep the experiment record complete.

### Announcements and Message Board

- Admins can create, edit, delete, pin, and attach files to announcements.
- Members can post messages and replies on the message board.
- Messages and replies can be deleted by their owners or admins.

### Conter AI Assistant

- Built-in Conter AI assistant with streaming responses and chat history.
- Supports Control Group, Power Group, and shared modes.
- The backend injects platform context according to the selected mode.
- Can read recent announcements, upcoming reservations, file lists, and uploaded file content when needed.
- Supports user-uploaded chat attachments, including images, PDF, Word, Excel, CSV, text, Markdown, JSON, HTML, CSS, JS, and XML.
- Image attachments are processed with Tesseract OCR. The root-level `eng.traineddata` and `chi_sim.traineddata` files are used for English and Simplified Chinese OCR.

### Mini Game

- Built-in snake game.
- Tracks personal best score, play count, and leaderboard.
- Scores are stored in the local database.

## Tech Stack

| Layer | Technologies |
| --- | --- |
| Frontend | Vite 8, React 19, React Router 7, Vanilla CSS, Plotly, Chart.js, SheetJS, Mammoth |
| Backend | Node.js, Express 5, JWT, bcryptjs, multer, archiver |
| Data | `sql.js` persisted to a local `data.db` file |
| AI and Parsing | DeepSeek API, pdf-parse, mammoth, word-extractor, xlsx, tesseract.js |

## Local Development

### Requirements

- Node.js 18 or later
- npm

### Install Dependencies

```bash
npm install
```

### Configure Environment Variables

Copy `.env.example` to `.env` and edit it as needed:

```bash
copy .env.example .env
```

On Linux or macOS:

```bash
cp .env.example .env
```

Common variables:

| Variable | Description | Default |
| --- | --- | --- |
| `JWT_SECRET` | JWT signing secret. Must be set to a strong random value in production. | `dev-jwt-secret-change-me` in development |
| `INVITE_CODE` | Invite code for member registration | `dev-invite-code` in development |
| `ADMIN_PASSWORD` | Password used when the initial admin account is created | `admin123` in development |
| `PORT` | Backend service port | `3001` |
| `DB_PATH` | Database file path | `server/data.db` |
| `UPLOAD_DIR` | Uploaded file directory | `server/uploads` |
| `NODE_ENV` | Runtime environment. Use `production` for deployment. | unset |
| `DEEPSEEK_API_KEY` | API key used by Conter to call DeepSeek | Recommended to set explicitly |
| `CHAT_OCR_LANGS` | OCR languages, separated by commas | `eng,chi_sim` |

> In production, `JWT_SECRET`, `INVITE_CODE`, and `ADMIN_PASSWORD` must be set explicitly. `ADMIN_PASSWORD` only takes effect during first database initialization when the admin account does not exist. After the database has been created, changing this variable will not update the admin password automatically.

### Start the Development Services

Run the backend and frontend in separate terminals:

```bash
# Terminal A: backend
node server/index.js
```

```bash
# Terminal B: frontend
npm run dev
```

Default URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

On first backend startup, the database file and default admin account are created automatically:

- Username: `admin`
- Password: `admin123`, or the value of `ADMIN_PASSWORD` in `.env`

## Common Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `node server/index.js` | Start the Express backend |
| `npm run build` | Build the frontend into `dist/` |
| `npm run preview` | Preview the frontend production build locally |

## Project Structure

```text
Controler/
|-- server/                         # Backend service
|   |-- index.js                     # Express entry point, API routes, production static serving
|   |-- db.js                        # sql.js initialization, schema, and persistence
|   |-- middleware/
|   |   `-- auth.js                  # JWT authentication and admin checks
|   `-- routes/
|       |-- auth.js                  # Register, login, current user, password change
|       |-- folders.js               # Folder CRUD and move operations
|       |-- files.js                 # Upload, preview, download, search, batch download, ordering
|       |-- comments.js              # File records/comments
|       |-- announcements.js         # Announcements and announcement attachments
|       |-- reservations.js          # Lab reservations
|       |-- messages.js              # Message board and replies
|       |-- games.js                 # Game scores and leaderboard
|       `-- chat.js                  # Conter AI assistant, streaming, attachment parsing
|-- src/                             # Frontend source
|   |-- App.jsx                      # Routing and protected routes
|   |-- AuthContext.jsx              # Auth state management
|   |-- api.js                       # Frontend API wrapper
|   |-- index.css                    # Global styles
|   |-- pages/
|   |   |-- Login.jsx                # Login page
|   |   |-- Register.jsx             # Register page
|   |   `-- Dashboard.jsx            # Main dashboard and top navigation
|   `-- components/
|       |-- FileManager.jsx          # File management
|       |-- FilePreview.jsx          # File preview
|       |-- FileComments.jsx         # File records
|       |-- DataPlotter.jsx          # Multi-file Excel data plotting
|       |-- LabReservation.jsx       # Lab reservation calendar
|       |-- Announcements.jsx        # System announcements
|       |-- MessageBoard.jsx         # Message board
|       |-- AiChat.jsx               # Conter AI assistant frontend
|       `-- SnakeGame.jsx            # Mini game
|-- public/                          # Static assets such as logo and avatar
|-- background-previews/             # Login/dashboard background design previews
|-- server/uploads/                  # Default local upload directory; move outside code in production
|-- eng.traineddata                  # Tesseract English OCR language data
|-- chi_sim.traineddata              # Tesseract Simplified Chinese OCR language data
|-- .env.example                     # Environment variable example
|-- package.json
`-- vite.config.js
```

## Data Storage and Backups

The platform has two critical data locations:

- Database file: stores users, file indexes, folders, comments, announcements, messages, reservations, game scores, and AI chat history.
- Upload directory: stores original uploaded files and AI chat attachments.

Default local paths:

- Database: `server/data.db`
- Uploads: `server/uploads/`

In production, these should be stored outside the code directory:

```bash
DB_PATH=/var/www/chemecar-data/data.db
UPLOAD_DIR=/var/www/chemecar-data/uploads
```

This keeps users, uploaded files, announcements, messages, reservations, invite codes, and other runtime data safe when code is updated, the deployment package is extracted again, or the frontend is rebuilt.

## Production Deployment Example

The example below uses Ubuntu, PM2, and Nginx. Adjust domain names, directories, and secrets for your server.

### 1. Build the Frontend

Run this in the project directory, either locally or on the server:

```bash
npm install
npm run build
```

### 2. Prepare the Production Data Directory

```bash
mkdir -p /var/www/chemecar-data/uploads
```

### 3. Start the Backend with PM2

Create `ecosystem.config.js`:

```js
module.exports = {
  apps: [{
    name: 'chemecar-api',
    script: './server/index.js',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      JWT_SECRET: 'replace-with-a-secure-random-string',
      INVITE_CODE: 'replace-with-your-invite-code',
      ADMIN_PASSWORD: 'replace-before-first-init',
      DEEPSEEK_API_KEY: 'replace-with-your-deepseek-api-key',
      DB_PATH: '/var/www/chemecar-data/data.db',
      UPLOAD_DIR: '/var/www/chemecar-data/uploads'
    }
  }]
};
```

Start and save the PM2 process:

```bash
pm2 start ecosystem.config.js
pm2 save
```

If the PM2 app already exists, restart it after updates:

```bash
pm2 restart chemecar-api
```

### 4. Configure Nginx Reverse Proxy

Example configuration:

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
        client_max_body_size 100M;
    }
}
```

Validate and reload Nginx:

```bash
nginx -t
systemctl reload nginx
```

## Update and Deployment Notes

When updating the project, only overwrite code, `dist/`, `public/`, `server/`, and dependency manifests. Do not overwrite the production data directory.

Recommended flow:

```bash
npm run build
# Package the code and build output, upload it to the server, then extract it into /var/www/chemecar
pm2 restart chemecar-api
```

Do not include or delete these production data locations during deployment:

- `/var/www/chemecar-data/data.db`
- `/var/www/chemecar-data/uploads/`
- The server-side `.env` file or PM2 environment configuration

The project `.gitignore` already excludes local `server/data.db`, `server/uploads/*`, `dist/`, `node_modules/`, and `deploy.zip` to avoid committing runtime data and build artifacts.

## Backup Recommendations

Back up the database and upload directory regularly:

```bash
cp /var/www/chemecar-data/data.db ~/chemecar-data-$(date +%F).db
tar czf ~/chemecar-uploads-$(date +%F).tar.gz /var/www/chemecar-data/uploads
```

To restore, stop the backend service, replace the database file and upload directory, then restart PM2.

## Security Notes

1. Change `JWT_SECRET`, `INVITE_CODE`, and the default admin password before production use.
2. Inject `DEEPSEEK_API_KEY` through environment variables or PM2 configuration instead of hardcoding it in source code.
3. Change the admin password immediately after the first login.
4. Back up `data.db` and the upload directory regularly.
5. If the platform is exposed to the public internet, enable HTTPS and restrict SSH and administrative port access.
