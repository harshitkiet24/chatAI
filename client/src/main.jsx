import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import Auth, { Brand } from './Auth';
import './styles.css';

async function api(path, options = {}, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { status: response.status });
  return data;
}

function mergeById(first, second) {
  return [...new Map([...first, ...second].map(item => [item.id, item])).values()];
}

function NewChannel({ token, close, created }) {
  const dialog = useRef(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { dialog.current.showModal(); }, []);
  async function submit(event) {
    event.preventDefault();
    const body = JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)));
    setSaving(true);
    try {
      created(await api('/api/rooms', { method: 'POST', body }, token));
    } catch (cause) { setError(cause.message); setSaving(false); }
  }
  return <dialog ref={dialog} onCancel={close} aria-labelledby="dialog-title">
    <form onSubmit={submit}><h2 id="dialog-title">Create a channel</h2>
      <label>Channel name<input name="name" autoFocus required minLength={2} maxLength={32} placeholder="design-team" /></label>
      <label>Description (optional)<input name="description" maxLength={140} /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="flex justify-end gap-4"><button type="button" onClick={close}>Cancel</button>
        <button className="primary" disabled={saving}>Create channel</button></div>
    </form>
  </dialog>;
}

function Conversation({ active, session, socket, online, connected }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState({});
  const typingTimer = useRef(null);
  const bottom = useRef(null);
  const room = active.type === 'room';
  const title = room ? '#' + active.name : active.username;
  const target = { type: active.type, targetId: active.id };

  useEffect(() => {
    let current = true;
    const timers = new Map();
    function append(message) {
      const matches = room ? message.roomId === active.id : message.roomId == null &&
        (message.senderId === active.id || message.recipientId === active.id);
      if (matches) setMessages(old => mergeById(old, [message]));
    }
    function onTyping(item) {
      if (item.type !== active.type || item.targetId !== active.id) return;
      const update = value => setTyping(old => ({ ...old, [item.userId]: value }));
      clearTimeout(timers.get(item.userId));
      update(item.isTyping && item.username);
      if (item.isTyping) timers.set(item.userId, setTimeout(() => update(false), 2500));
    }
    async function sync() {
      if (socket.connected) socket.emit(room ? 'join_room' : 'join_dm', active.id);
      try {
        const history = await api('/api/' + (room ? 'rooms/' : 'dms/') + active.id + '/messages', {}, session.token);
        if (current) {
          setMessages(old => mergeById(history, old).sort((a, b) => a.id - b.id));
          setError('');
        }
      } catch (cause) { if (current) setError(cause.message); }
      finally { if (current) setLoading(false); }
    }
    socket.on('message', append).on('typing', onTyping).on('connect', sync);
    sync();
    return () => {
      current = false;
      clearTimeout(typingTimer.current);
      timers.forEach(clearTimeout);
      socket.off('message', append).off('typing', onTyping).off('connect', sync);
      if (socket.connected) {
        socket.emit('typing', { ...target, isTyping: false });
        socket.emit(room ? 'leave_room' : 'leave_dm', active.id);
      }
    };
  }, [socket, active.id, active.type, session.token]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [messages]);
  function changeDraft(value) {
    setDraft(value);
    if (!connected) return;
    socket.volatile.emit('typing', { ...target, isTyping: Boolean(value) });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socket.volatile.emit('typing', { ...target, isTyping: false }), 800);
  }
  function send(event) {
    event.preventDefault();
    if (!draft.trim() || !connected || sending) return;
    setSending(true);
    socket.timeout(6000).emit('send_message', { ...target, body: draft }, (failure, result) => {
      setSending(false);
      if (failure || result?.error) return setError(result?.error || 'Delivery unconfirmed. Check the conversation before retrying.');
      setError('');
      setMessages(old => mergeById(old, [result.message]));
      changeDraft('');
    });
  }
  const names = Object.values(typing).filter(Boolean);
  return <main className="conversation">
    <header><div><h1>{title}</h1><p>{room ? active.description || 'Public channel' : 'Private conversation'}</p></div>
      <span className="status">{connected ? room ? online.length + ' online' : online.includes(active.id) ? 'Online' : 'Offline' : 'Connecting…'}</span></header>
    <section className="timeline" role="log" aria-label="Messages">
      {loading && <p>Loading history…</p>}
      {!loading && !error && !messages.length && <div className="empty"><span aria-hidden="true">{room ? '#' : '@'}</span>
        <h2>{room ? 'Welcome to ' + title : 'Chat with ' + title}</h2><p>Send the first message.</p></div>}
      {messages.map(message => {
        const date = new Date(message.createdAt.replace(' ', 'T') + 'Z');
        return <article key={message.id}><div className="initial" style={{ '--hue': (message.senderId * 77 + 148) % 360 }}>{message.senderName[0].toUpperCase()}</div>
          <div><strong>{message.senderName}</strong><time title={date.toLocaleString()} dateTime={date.toISOString()}>{date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
          <p>{message.body}</p></div></article>;
      })}<div ref={bottom}/>
    </section>
    <footer><div className="typing" role="status">{names.length > 0 && names.join(', ') + (names.length === 1 ? ' is typing…' : ' are typing…')}</div>
      {error && <p role="alert" className="error">{error}</p>}
      <form className="composer" onSubmit={send}><input aria-label="Message" maxLength={2000} value={draft} readOnly={sending}
        onChange={event => changeDraft(event.target.value)} placeholder={'Message ' + title} />
        <button className="primary" disabled={!connected || !draft.trim() || sending}>Send ↑</button></form>
    </footer>
  </main>;
}

function Workspace({ session, logout }) {
  const [socket] = useState(() => io(import.meta.env.VITE_API_URL || window.location.origin, {
    autoConnect: false,
    auth: { token: session.token },
  }));
  const [connected, setConnected] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [users, setUsers] = useState([]);
  const [online, setOnline] = useState([]);
  const [active, setActive] = useState(null);
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const fail = cause => {
      if (!live) return;
      if (cause.status === 401 || cause.message === 'Unauthorized') logout();
      else setError(cause.message);
    };
    function refreshUsers() {
      api('/api/users', {}, session.token).then(list => { if (live) setUsers(list); }).catch(fail);
    }
    function refreshRooms() {
      api('/api/rooms', {}, session.token).then(list => {
        if (!live) return;
        setRooms(old => mergeById(list, old));
        const initial = list.find(item => item.name === 'general') || list[0];
        if (initial) setActive(old => old || { ...initial, type: 'room' });
      }).catch(fail);
    }
    refreshRooms();
    refreshUsers();
    socket.on('presence', ids => { setOnline(ids); refreshUsers(); });
    socket.on('room_created', item => setRooms(old => mergeById(old, [item])));
    socket.on('connect', () => { setConnected(true); setError(''); refreshRooms(); });
    socket.on('disconnect', () => { setConnected(false); setOnline([]); });
    socket.on('connect_error', fail);
    socket.connect();
    return () => { live = false; socket.removeAllListeners(); socket.disconnect(); };
  }, [session, socket]);
  function choose(item, type) { setActive({ ...item, type }); setMenu(false); }
  function navItem(item, type) {
    const selected = active?.type === type && active.id === item.id;
    const isRoom = type === 'room';
    return <button key={item.id} className={'nav-item' + (selected ? ' selected' : '')} aria-current={selected || undefined}
      onClick={() => choose(item, type)}>
      {isRoom ? <span aria-hidden="true">#</span> : <i className={'dot ' + (online.includes(item.id) ? 'on' : '')} aria-label={online.includes(item.id) ? 'Online' : 'Offline'} />}
      {item.name || item.username}
    </button>;
  }
  return <div className="workspace">
    <div className="mobile-nav"><Brand/><button aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? 'Close ×' : 'Conversations ☰'}</button></div>
    <aside className={menu ? 'open' : ''}><Brand/>
      <nav aria-label="Conversations"><div className="nav-title">Channels<button aria-label="Create channel" onClick={() => setModal(true)}>+</button></div>
        {rooms.map(item => navItem(item, 'room'))}
        <div className="nav-title">Direct messages</div>
        {users.filter(item => item.id !== session.user.id).map(item => navItem(item, 'dm'))}
        {users.length === 1 && <p className="nav-hint">Other members will appear here.</p>}
      </nav>
      <div className="profile"><i className={'dot ' + (connected ? 'on' : '')}/><strong>{session.user.username}</strong><button onClick={logout}>Sign out</button></div>
    </aside>
    {active && <Conversation key={active.type + active.id} {...{ active, session, socket, online, connected }}/>}
    {modal && <NewChannel token={session.token} close={() => setModal(false)} created={room => {
      setRooms(old => mergeById(old, [room])); choose(room, 'room'); setModal(false);
    }}/>}
    {error && <div className="notice" role="alert">{error}</div>}
  </div>;
}

function App() {
  const [session, setSession] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem('chatai-session'));
      return value?.token && value.user?.username ? value : null;
    } catch { return null; }
  });
  function auth(value) { localStorage.setItem('chatai-session', JSON.stringify(value)); setSession(value); }
  function logout() { localStorage.removeItem('chatai-session'); setSession(null); }
  return session ? <Workspace session={session} logout={logout}/> : <Auth onAuth={auth} api={api}/>;
}
createRoot(document.getElementById('root')).render(<App/>);
