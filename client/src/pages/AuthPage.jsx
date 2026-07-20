import React, { useState } from 'react';
import { api } from '../lib/api';
import KwerzoDemoPlay from '../components/KwerzoDemoPlay';

function EyeIcon({ open }) {
  return open ? (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export default function AuthPage({ onAuth }) {
  const [mode,    setMode]    = useState('login');
  const [form,    setForm]    = useState({ username: '', email: '', password: '' });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw,  setShowPw]  = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = mode === 'login'
        ? await api.login({ username: form.username, password: form.password })
        : await api.register(form);
      localStorage.setItem('kwerzo_token', data.token);
      onAuth(data.user, data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  return (
    <div className="auth-page">
      <div className="auth-page-stack">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="logo-k">K</span>wer<span className="logo-z">z</span>o
        </div>
        <p className="auth-tagline">The cosmic tile-matching game</p>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>
            Sign In
          </button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <input
            type="text"
            placeholder="Username"
            value={form.username}
            onChange={set('username')}
            autoComplete="username"
            required
          />
          {mode === 'register' && (
            <input
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={set('email')}
              autoComplete="email"
              required
            />
          )}
          <div className="password-field">
            <input
              type={showPw ? 'text' : 'password'}
              placeholder="Password"
              value={form.password}
              onChange={set('password')}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
            <button
              type="button"
              className="pw-toggle"
              onClick={() => setShowPw(v => !v)}
              tabIndex={-1}
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              <EyeIcon open={showPw} />
            </button>
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="auth-shapes">
          {['☽', '⚡', '★', '🍃', '⬡', '♥'].map((s, i) => (
            <span key={i} className="deco-shape" style={{ animationDelay: `${i * 0.3}s` }}>{s}</span>
          ))}
        </div>
      </div>

      </div>

      {/* Demonstration of Play — wider section outside the 400px stack */}
      <div className="kdp-section">
        <div className="kdp-title">Demonstration of Play</div>
        <KwerzoDemoPlay />
      </div>

      {/* Iberzo cross-promo */}
      <a href="https://www.iberzo.com" target="_blank" rel="noopener noreferrer" className="iberzo-promo-card">
        <div className="iberzo-promo-inner">
          <img src="https://www.iberzo.com/iberzo-logo.png" alt="Iberzo" className="iberzo-promo-logo" />
          <p className="iberzo-promo-text">Love tile games? Try our other game — the classic strategy tile challenge you can play with friends or solo!</p>
          <span className="iberzo-promo-cta">Play free at iberzo.com →</span>
        </div>
      </a>
    </div>
  );
}
