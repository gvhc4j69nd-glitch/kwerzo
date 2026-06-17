import React, { useState, useEffect } from 'react';
import { getSocket, disconnectSocket } from './lib/socket';
import { api } from './lib/api';
import AuthPage from './pages/AuthPage';
import LobbyPage from './pages/LobbyPage';
import GamePage from './pages/GamePage';
import './App.css';

export default function App() {
  const [user,       setUser]       = useState(() => { try { return JSON.parse(localStorage.getItem('kwerzo_user')); } catch { return null; } });
  const [token,      setToken]      = useState(() => localStorage.getItem('kwerzo_token'));
  const [socket,     setSocket]     = useState(null);
  const [activeRoom, setActiveRoom] = useState(null);
  const [memoryMode, setMemoryMode] = useState(false);

  // Check server mode once on load
  useEffect(() => {
    api.health().then(h => setMemoryMode(h.mode === 'memory')).catch(() => {});
  }, []);

  useEffect(() => {
    if (!token || !user) return;
    const s = getSocket(token);
    s.connect();
    setSocket(s);

    s.on('connect_error', (err) => {
      if (/token/i.test(err.message)) {
        localStorage.removeItem('kwerzo_token');
        localStorage.removeItem('kwerzo_user');
        window.location.reload();
      }
    });
    s.on('session_restored', ({ roomId, room, state }) => {
      setActiveRoom({ roomId, room, initialState: state });
    });
    s.on('room_expired', ({ roomId }) => {
      setActiveRoom(prev => (prev?.roomId === roomId ? null : prev));
    });

    return () => { s.off('connect_error'); s.off('session_restored'); s.off('room_expired'); };
  }, [token]);

  function handleAuth(userData, tok) {
    localStorage.setItem('kwerzo_token', tok);
    localStorage.setItem('kwerzo_user', JSON.stringify(userData));
    setToken(tok);
    setUser(userData);
  }

  function handleLogout() {
    localStorage.removeItem('kwerzo_token');
    localStorage.removeItem('kwerzo_user');
    disconnectSocket();
    setUser(null); setToken(null); setSocket(null); setActiveRoom(null);
  }

  function handleJoinRoom(roomId, room) { setActiveRoom({ roomId, room }); }
  function handleLeaveRoom()            { setActiveRoom(null); }

  const MemBanner = memoryMode ? () => (
    <div style={{
      background: '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 600,
      textAlign: 'center', padding: '7px 12px', position: 'fixed',
      top: 0, left: 0, right: 0, zIndex: 9999, lineHeight: 1.4,
    }}>
      ⚠️ No database connected — accounts and scores reset on every server restart.
      Set DATABASE_URL in Railway to persist data.
    </div>
  ) : () => null;

  if (!user || !token) {
    return (
      <>
        <MemBanner />
        {memoryMode && <div style={{ height: 32 }} />}
        <AuthPage onAuth={handleAuth} />
      </>
    );
  }

  if (activeRoom) {
    return (
      <>
        <MemBanner />
        {memoryMode && <div style={{ height: 32 }} />}
        <GamePage
          socket={socket}
          user={user}
          roomId={activeRoom.roomId}
          initialRoom={activeRoom.room}
          initialState={activeRoom.initialState || null}
          onLeave={handleLeaveRoom}
        />
      </>
    );
  }

  return (
    <>
      <MemBanner />
      {memoryMode && <div style={{ height: 32 }} />}
      <LobbyPage
        socket={socket}
        user={user}
        onJoinRoom={handleJoinRoom}
        onLogout={handleLogout}
      />
    </>
  );
}
