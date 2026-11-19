import React, { useState } from 'react';

export function Brand() {
  return <div className="wordmark"><span className="logo-mark" aria-hidden="true">••</span> ChatAI</div>;
}

export default function Auth({ onAuth, api }) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError('');
    try {
      onAuth(await api('/api/auth/' + (register ? 'register' : 'login'), {
        method: 'POST', body: JSON.stringify(values),
      }));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="entry">
    <section className="entry-panel">
      <Brand />
      <div className="entry-form">
        <h1>{register ? 'Create an account' : 'Welcome back.'}</h1>
        <p>{register ? 'Choose a username for your conversations.' : 'Sign in to your chat workspace.'}</p>
        <form onSubmit={submit}>
          <label>Username<input name="username" required autoComplete="username" placeholder="Your username"
            pattern={register ? '[a-zA-Z0-9_\\-]{3,24}' : undefined} maxLength={24}
            title={register ? '3–24 letters, digits, underscores or hyphens' : undefined} /></label>
          <label>Password<input name="password" type="password" required minLength={register ? 6 : undefined}
            autoComplete={register ? 'new-password' : 'current-password'}
            placeholder={register ? 'At least 6 characters' : 'Your password'} /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'} <span>→</span></button>
        </form>
        <p className="switch-mode">{register ? 'Already have an account?' : 'New to ChatAI?'}{' '}
          <button disabled={busy} onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Sign in' : 'Create an account'}</button>
        </p>
      </div>
    </section>
    <div className="artboard" aria-hidden="true">
      <div className="orbit orbit-one" /><div className="orbit orbit-two" />
      <div className="bubble bubble-back">#</div><div className="bubble bubble-front"><i/><i/><i/></div>
      <div className="spark spark-one">✳</div><div className="spark spark-two">✦</div>
    </div>
  </main>;
}
