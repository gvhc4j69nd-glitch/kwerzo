import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';

export default function FriendsPanel({ socket, user }) {
  const [friends,  setFriends]  = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [error,    setError]    = useState(null);
  const [loading,  setLoading]  = useState(true);

  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [pending, setPending] = useState({}); // username -> 'sending' | 'sent' | 'error'

  const refresh = useCallback(() => {
    api.getFriends()
      .then(data => {
        setFriends(data.friends || []);
        setIncoming(data.incoming || []);
        setOutgoing(data.outgoing || []);
        setError(null);
      })
      .catch(err => setError(err.message || 'Failed to load friends'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Live updates via socket
  useEffect(() => {
    if (!socket) return;

    const onOnline  = ({ userId }) => setFriends(prev => prev.map(f => f.userId === userId ? { ...f, online: true } : f));
    const onOffline = ({ userId }) => setFriends(prev => prev.map(f => f.userId === userId ? { ...f, online: false } : f));
    const onReceived = () => refresh();
    const onAccepted = () => refresh();
    const onDeclined = () => refresh();
    const onRemoved  = () => refresh();

    socket.on('friend_online',  onOnline);
    socket.on('friend_offline', onOffline);
    socket.on('friend_request_received', onReceived);
    socket.on('friend_request_accepted', onAccepted);
    socket.on('friend_request_declined', onDeclined);
    socket.on('friend_removed',          onRemoved);

    return () => {
      socket.off('friend_online',  onOnline);
      socket.off('friend_offline', onOffline);
      socket.off('friend_request_received', onReceived);
      socket.off('friend_request_accepted', onAccepted);
      socket.off('friend_request_declined', onDeclined);
      socket.off('friend_removed',          onRemoved);
    };
  }, [socket, refresh]);

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearchError(null); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(() => {
      api.searchUsers(q)
        .then(data => { setResults(data.results || []); setSearchError(null); })
        .catch(err => setSearchError(err.message || 'Search failed'))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  function sendRequest(username) {
    setPending(prev => ({ ...prev, [username]: 'sending' }));
    api.sendFriendRequest(username)
      .then(() => { setPending(prev => ({ ...prev, [username]: 'sent' })); refresh(); })
      .catch(err => {
        setPending(prev => ({ ...prev, [username]: 'error' }));
        setSearchError(err.message || 'Failed to send request');
      });
  }

  function respond(id, action) {
    api.respondFriendReq(id, action).then(refresh).catch(err => setError(err.message));
  }

  function cancelOrRemove(id) {
    api.removeFriend(id).then(refresh).catch(err => setError(err.message));
  }

  const friendIds = new Set(friends.map(f => f.userId));
  const outgoingNames = new Set(outgoing.map(o => o.username.toLowerCase()));
  const onlineCount = friends.filter(f => f.online).length;

  return (
    <div className="friends-panel">
      {error && <div className="error-state">⚠️ {error}</div>}

      <div className="friends-search">
        <input
          type="text"
          placeholder="Search by username…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {searching && <div className="friends-search-status">Searching…</div>}
        {searchError && <div className="error-state">⚠️ {searchError}</div>}
        {results.length > 0 && (
          <div className="friends-search-results">
            {results.map(r => {
              const already = friendIds.has(r.id);
              const sentOut = outgoingNames.has(r.username.toLowerCase());
              const state   = pending[r.username];
              return (
                <div key={r.id} className="friend-row">
                  <span className="friend-name">
                    <span className={`presence-dot ${r.online ? 'online' : 'offline'}`} />
                    {r.username}
                  </span>
                  {already ? (
                    <span className="friend-tag">already friends</span>
                  ) : sentOut || state === 'sent' ? (
                    <span className="friend-tag">request sent</span>
                  ) : (
                    <button
                      className="btn-secondary"
                      disabled={state === 'sending'}
                      onClick={() => sendRequest(r.username)}
                    >
                      + Add
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {incoming.length > 0 && (
        <div className="friends-section">
          <h3>Friend Requests</h3>
          {incoming.map(req => (
            <div key={req.id} className="friend-row">
              <span className="friend-name">{req.username}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-primary" onClick={() => respond(req.id, 'accept')}>Accept</button>
                <button className="btn-ghost" onClick={() => respond(req.id, 'decline')}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="friends-section">
          <h3>Sent Requests</h3>
          {outgoing.map(req => (
            <div key={req.id} className="friend-row">
              <span className="friend-name">{req.username}</span>
              <button className="btn-ghost" onClick={() => cancelOrRemove(req.id)}>Cancel</button>
            </div>
          ))}
        </div>
      )}

      <div className="friends-section">
        <h3>Your Friends {friends.length > 0 && <span className="friends-online-count">({onlineCount} online)</span>}</h3>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : friends.length === 0 ? (
          <div className="empty-state">No friends yet — search for a username above to add one!</div>
        ) : (
          [...friends]
            .sort((a, b) => (b.online - a.online) || a.username.localeCompare(b.username))
            .map(f => (
              <div key={f.id} className="friend-row">
                <span className="friend-name">
                  <span className={`presence-dot ${f.online ? 'online' : 'offline'}`} />
                  {f.username}
                  <span className="friend-status">{f.online ? 'Online' : 'Offline'}</span>
                </span>
                <button className="btn-ghost btn-danger" onClick={() => cancelOrRemove(f.id)}>Remove</button>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
