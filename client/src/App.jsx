import React, { useState, useEffect } from 'react';
import { getSocket, disconnectSocket } from './lib/socket';
import AuthPage from './pages/AuthPage';
import LobbyPage from './pages/LobbyPage';
import GamePage from './pages/GamePage';
import './App.css';

export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kwerzo_user')); } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('kwerzo_token'));
  const [socket, setSocket] = useState(null);
  const [activeRoom, setActiveRoom] = useState(null);  // { roomId, room }

  useEffect(() => {
    if (!token || !user) return;
    const s = getSocket(token);
    s.connect();
    setSocket(s);
    return () => {};
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
    setUser(null);
    setToken(null);
    setSocket(null);
    setActiveRoom(null);
  }

  function handleJoinRoom(roomId, room) {
    setActiveRoom({ roomId, room });
  }

  function handleLeaveRoom() {
    setActiveRoom(null);
  }

  if (!user || !token) {
    return <AuthPage onAuth={handleAuth} />;
  }

  if (activeRoom) {
    return (
      <GamePage
        socket={socket}
        user={user}
        roomId={activeRoom.roomId}
        initialRoom={activeRoom.room}
        onLeave={handleLeaveRoom}
      />
    );
  }

  return (
    <LobbyPage
      socket={socket}
      user={user}
      onJoinRoom={handleJoinRoom}
      onLogout={handleLogout}
    />
  );
}
