import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Server } from 'socket.io';
import { db } from './db.js';

const port = Number(process.env.PORT || 3001);
const jwtSecret = process.env.JWT_SECRET || 'change-this-secret-for-production';
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: clientUrl, methods: ['GET', 'POST'] } });
app.use(cors({ origin: clientUrl }));
app.use(express.json());

const publicUser = (user) => ({ id: user.id, username: user.username, createdAt: user.created_at });
const tokenFor = (user) => jwt.sign({ id: user.id, username: user.username }, jwtSecret, { expiresIn: '7d' });
const messageSelect = `SELECT m.id, m.body, m.room_id AS roomId, m.sender_id AS senderId, m.recipient_id AS recipientId,
  m.created_at AS createdAt, u.username AS senderName FROM messages m JOIN users u ON u.id = m.sender_id`;

function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  try { req.user = jwt.verify(token, jwtSecret); next(); }
  catch { res.status(401).json({ error: 'Authentication required' }); }
}
function cleanBody(body) { return typeof body === 'string' ? body.trim().slice(0, 2000) : ''; }

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/auth/register', async (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username) || password.length < 6) return res.status(400).json({ error: 'Use a 3–24 character username and a password of at least 6 characters.' });
  try {
    const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, await bcrypt.hash(password, 12));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ token: tokenFor(user), user: publicUser(user) });
  } catch (error) { res.status(409).json({ error: 'That username is already taken.' }); }
});
app.post('/api/auth/login', async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.body.username || '').trim());
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) return res.status(401).json({ error: 'Invalid username or password.' });
  res.json({ token: tokenFor(user), user: publicUser(user) });
});
app.get('/api/users', auth, (_req, res) => res.json(db.prepare('SELECT id, username, created_at FROM users ORDER BY username').all().map(publicUser)));
app.get('/api/rooms', auth, (_req, res) => res.json(db.prepare('SELECT id, name, description, created_at AS createdAt FROM rooms ORDER BY name').all()));
app.post('/api/rooms', auth, (req, res) => {
  const name = String(req.body.name || '').trim().toLowerCase().replace(/^#/, '');
  const description = String(req.body.description || '').trim().slice(0, 140);
  if (!/^[a-z0-9_-]{2,32}$/.test(name)) return res.status(400).json({ error: 'Room names use 2–32 lowercase letters, numbers, hyphens, or underscores.' });
  try {
    const result = db.prepare('INSERT INTO rooms (name, description, created_by) VALUES (?, ?, ?)').run(name, description, req.user.id);
    const room = db.prepare('SELECT id, name, description, created_at AS createdAt FROM rooms WHERE id = ?').get(result.lastInsertRowid);
    io.emit('room_created', room); res.status(201).json(room);
  } catch { res.status(409).json({ error: 'A room with that name already exists.' }); }
});
app.get('/api/rooms/:roomId/messages', auth, (req, res) => {
  res.json(db.prepare(`${messageSelect} WHERE m.room_id = ? ORDER BY m.id DESC LIMIT 100`).all(req.params.roomId).reverse());
});
app.get('/api/dms/:userId/messages', auth, (req, res) => {
  const otherId = Number(req.params.userId);
  res.json(db.prepare(`${messageSelect} WHERE (m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?) ORDER BY m.id DESC LIMIT 100`).all(req.user.id, otherId, otherId, req.user.id).reverse());
});

if (process.env.NODE_ENV === 'production') {
  const clientDist = fileURLToPath(new URL('../client/dist/', import.meta.url));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(join(clientDist, 'index.html')));
}

const connections = new Map();
const onlineIds = () => [...connections.entries()].filter(([, sockets]) => sockets.size).map(([id]) => Number(id));
const emitPresence = () => io.emit('presence', onlineIds());
const dmKey = (a, b) => `dm:${[Number(a), Number(b)].sort((x, y) => x - y).join(':')}`;
io.use((socket, next) => {
  try { socket.user = jwt.verify(socket.handshake.auth?.token, jwtSecret); next(); }
  catch { next(new Error('Unauthorized')); }
});
io.on('connection', (socket) => {
  const id = socket.user.id;
  if (!connections.has(id)) connections.set(id, new Set());
  connections.get(id).add(socket.id); emitPresence();
  socket.on('join_room', (roomId) => socket.join(`room:${Number(roomId)}`));
  socket.on('leave_room', (roomId) => socket.leave(`room:${Number(roomId)}`));
  socket.on('join_dm', (userId) => socket.join(dmKey(id, userId)));
  socket.on('leave_dm', (userId) => socket.leave(dmKey(id, userId)));
  socket.on('typing', ({ type, targetId, isTyping }) => {
    const scope = type === 'room' ? `room:${Number(targetId)}` : dmKey(id, targetId);
    // In a DM, recipients have the sender selected as their active contact.
    const visibleTargetId = type === 'dm' ? id : Number(targetId);
    socket.to(scope).emit('typing', { type, targetId: visibleTargetId, userId: id, username: socket.user.username, isTyping: Boolean(isTyping) });
  });
  socket.on('send_message', ({ type, targetId, body }, acknowledge = () => {}) => {
    const text = cleanBody(body); if (!text) return acknowledge({ error: 'Message cannot be empty.' });
    let result, message, scope;
    if (type === 'room') {
      const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(Number(targetId));
      if (!room) return acknowledge({ error: 'Room not found.' });
      result = db.prepare('INSERT INTO messages (body, room_id, sender_id) VALUES (?, ?, ?)').run(text, room.id, id);
      scope = `room:${room.id}`;
    } else if (type === 'dm') {
      const recipient = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(targetId));
      if (!recipient || recipient.id === id) return acknowledge({ error: 'Recipient not found.' });
      result = db.prepare('INSERT INTO messages (body, sender_id, recipient_id) VALUES (?, ?, ?)').run(text, id, recipient.id);
      scope = dmKey(id, recipient.id);
    } else return acknowledge({ error: 'Invalid message type.' });
    message = db.prepare(`${messageSelect} WHERE m.id = ?`).get(result.lastInsertRowid);
    io.to(scope).emit('message', message); acknowledge({ ok: true, message });
  });
  socket.on('disconnect', () => { connections.get(id)?.delete(socket.id); if (!connections.get(id)?.size) connections.delete(id); emitPresence(); });
});
server.listen(port, () => console.log(`ChatAI server listening on http://localhost:${port}`));
