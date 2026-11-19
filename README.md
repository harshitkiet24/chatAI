# ChatAI

A full-stack, real-time chat app with public channels, direct messages, authentication, presence, typing status, and persistent SQLite history.

## Run it

Prerequisite: Node.js 20 or later.

```bash
git clone https://github.com/harshitkiet24/chatAI.git
cd chatAI
npm run install:all
npm run dev
```

Open http://localhost:5173. The API runs at http://localhost:3001 and the database is created automatically at `server/data/chatai.db`.

No external services or API keys are needed. Defaults work as-is. To customize them, copy `server/.env.example` to `server/.env`:

```env
PORT=3001
JWT_SECRET=change-this-secret-for-production
CLIENT_URL=http://localhost:5173
```

## Structure

- `client/` — Vite, React, Tailwind CSS, and Socket.io client UI.
- `server/` — Express REST API, Socket.io server, JWT authentication, and SQLite database setup.

## Features

- Register/login with JWT persisted in `localStorage`
- Seeded `#general`, `#random`, and `#tech` channels plus public channel creation
- Real-time channel messages and 1:1 direct messages
- Online presence, typing notifications, timestamps, auto-scroll, and persistent history

## Deploy on Render

Connect this GitHub repository to Render and create a Blueprint from `render.yaml`. When Render prompts for `CLIENT_URL`, enter the public service URL, such as `https://your-service.onrender.com`.

For a manual web-service setup, use `npm run build` as the build command, `npm start` as the start command, and `/api/health` as the health check path.

Set `NODE_ENV=production`, a strong random `JWT_SECRET`, and `CLIENT_URL` to the service's public origin (for example, `https://your-service.onrender.com`). The server listens on Render's `PORT` and serves the built React app, REST API, and Socket.io on that port. Leave `VITE_API_URL` unset for this deployment. Setting it at build time overrides the Socket.io origin.

To keep SQLite users and chat history across restarts and deploys, attach a persistent disk at `/opt/render/project/src/server/data`. This requires a paid web service. [Render persistent disks](https://render.com/docs/disks)
