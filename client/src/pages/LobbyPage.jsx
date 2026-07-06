import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import FriendsPanel from '../components/FriendsPanel';
import NotificationCenter from '../components/NotificationCenter';
import KwerzoDemo from '../components/KwerzoDemo';
import AdUnit from '../components/AdUnit';

export default function LobbyPage({ socket, user, onJoinRoom, onLogout }) {
  const [rooms, setRooms] = useState([]);
  const [leaderboard, setLeaderboard] = useState({ top: [], me: null, topBots: [], meBots: null });
  const [lbMode, setLbMode] = useState('human');
  const [lbError, setLbError] = useState(null);
  const [friendIds, setFriendIds] = useState(new Set());
  const [outgoingNames, setOutgoingNames] = useState(new Set());
  const [friendPending, setFriendPending] = useState({}); // username -> 'sending' | 'sent' | 'error'
  const [tab, setTab] = useState('rooms');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!socket) return;
    socket.emit('list_rooms');
    socket.on('rooms_list', setRooms);

    socket.on('room_joined', ({ roomId, room }) => {
      onJoinRoom(roomId, room);
    });

    return () => {
      socket.off('rooms_list', setRooms);
      socket.off('room_joined');
    };
  }, [socket]);

  function deleteRoom(roomId) {
    socket.emit('delete_room', { roomId });
  }

  function enterRoom(roomId) {
    socket.emit('join_room', { roomId });
  }

  useEffect(() => {
    if (tab === 'leaderboard') {
      setLbError(null);
      api.leaderboard()
        .then(data => { setLeaderboard(data); setLbError(null); })
        .catch(err => setLbError(err.message || 'Failed to load leaderboard'));
      api.getFriends()
        .then(data => {
          setFriendIds(new Set((data.friends || []).map(f => f.userId)));
          setOutgoingNames(new Set((data.outgoing || []).map(o => o.username.toLowerCase())));
        })
        .catch(() => {});
    }
  }, [tab]);

  function addFriend(username) {
    setFriendPending(prev => ({ ...prev, [username]: 'sending' }));
    api.sendFriendRequest(username)
      .then(() => setFriendPending(prev => ({ ...prev, [username]: 'sent' })))
      .catch(() => setFriendPending(prev => ({ ...prev, [username]: 'error' })));
  }

  function renderFriendCell(username, userId) {
    if (username === user.username) return null;
    if (friendIds.has(userId)) return <span className="friend-tag">friends</span>;
    const state = friendPending[username];
    if (outgoingNames.has(username.toLowerCase()) || state === 'sent') {
      return <span className="friend-tag">sent</span>;
    }
    return (
      <button
        className="btn-secondary btn-small"
        disabled={state === 'sending'}
        onClick={() => addFriend(username)}
      >
        + Add
      </button>
    );
  }

  function createRoom() {
    if (creating) return;
    setCreating(true);
    socket.emit('create_room');
    setTimeout(() => setCreating(false), 2000);
  }

  function joinRoom(roomId) {
    socket.emit('join_room', { roomId });
  }

  return (
    <div className="lobby-page">
      <header className="lobby-header">
        <div className="logo-small">
          <span className="logo-k">K</span>wer<span className="logo-z">z</span>o
        </div>
        <div className="header-right">
          <NotificationCenter socket={socket} user={user} />
          <span className="username-badge">👤 {user.username}</span>
          <button className="btn-ghost" onClick={onLogout}>Sign Out</button>
        </div>
      </header>

      <div className="lobby-tabs">
        <button className={tab === 'rooms' ? 'active' : ''} onClick={() => setTab('rooms')}>
          Game Rooms
        </button>
        <button className={tab === 'leaderboard' ? 'active' : ''} onClick={() => setTab('leaderboard')}>
          Leaderboard
        </button>
        <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}>
          Friends
        </button>
        <button className={tab === 'howtoplay' ? 'active' : ''} onClick={() => setTab('howtoplay')}>
          How to Play
        </button>
      </div>

      {tab === 'rooms' && (
        <div className="lobby-content">
          <div className="lobby-demo-wrap">
            <KwerzoDemo />
          </div>
          <div className="lobby-actions">
            <button className="btn-primary" onClick={createRoom} disabled={creating}>
              + Create Room
            </button>
          </div>
          <div className="rooms-list">
            {rooms.length === 0 ? (
              <div className="empty-state">No open rooms — create one to get started!</div>
            ) : (
              rooms.map(room => {
                const isHost = String(room.hostId) === String(user.id);
                const isIn   = room.players.includes(user.username);
                return (
                  <div key={room.id} className="room-card">
                    <div className="room-info">
                      <span className="room-id">
                        Room #{room.id}
                        {isHost && <span className="room-host-badge">host</span>}
                      </span>
                      <span className="room-players">
                        {room.players.join(', ')} ({room.playerCount}/4)
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {isHost && (
                        <button
                          className="btn-ghost btn-danger"
                          onClick={() => deleteRoom(room.id)}
                        >
                          Delete
                        </button>
                      )}
                      <button
                        className="btn-secondary"
                        onClick={() => isIn ? enterRoom(room.id) : joinRoom(room.id)}
                        disabled={!isIn && room.playerCount >= 4}
                      >
                        {isIn ? 'Enter' : 'Join'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <AdUnit />
        </div>
      )}

      {tab === 'leaderboard' && (
        <div className="lobby-content">
          {lbError && (
            <div className="error-state">⚠️ {lbError}</div>
          )}
          <div className="lb-mode-toggle">
            <button
              className={lbMode === 'human' ? 'active' : ''}
              onClick={() => setLbMode('human')}
            >
              Human ELO
            </button>
            <button
              className={lbMode === 'bots' ? 'active' : ''}
              onClick={() => setLbMode('bots')}
            >
              vs Bots
            </button>
          </div>

          {lbMode === 'human' && (
            <>
              {leaderboard.me && (
                <div className="my-stats">
                  <h3>Your Stats</h3>
                  <div className="stats-grid">
                    <div className="stat"><span>{leaderboard.me.wins}</span>Wins</div>
                    <div className="stat"><span>{leaderboard.me.losses}</span>Losses</div>
                    <div className="stat"><span>{leaderboard.me.games_played}</span>Games</div>
                    <div className="stat"><span>{leaderboard.me.elo_rating}</span>ELO</div>
                  </div>
                </div>
              )}
              <table className="leaderboard-table">
                <thead>
                  <tr><th>#</th><th>Player</th><th>ELO</th><th>W</th><th>L</th><th></th></tr>
                </thead>
                <tbody>
                  {leaderboard.top.map((row, i) => (
                    <tr key={row.username} className={row.username === user.username ? 'highlight' : ''}>
                      <td>{i + 1}</td>
                      <td>
                        {row.username}
                        {i === 0 && <span className="grand-master-tag">Grand Master</span>}
                      </td>
                      <td>{row.elo_rating}</td>
                      <td>{row.wins}</td>
                      <td>{row.losses}</td>
                      <td>{renderFriendCell(row.username, row.user_id)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {lbMode === 'bots' && (
            <>
              {leaderboard.meBots && (
                <div className="my-stats">
                  <h3>Your Stats (vs Bots)</h3>
                  <div className="stats-grid">
                    <div className="stat"><span>{leaderboard.meBots.bot_wins}</span>Wins</div>
                    <div className="stat"><span>{leaderboard.meBots.bot_losses}</span>Losses</div>
                    <div className="stat"><span>{leaderboard.meBots.bot_games_played}</span>Games</div>
                    <div className="stat"><span>{leaderboard.meBots.bot_rating}</span>Rating</div>
                  </div>
                </div>
              )}
              <p className="lb-bots-hint">
                Beating tougher bots earns more rating than beating easy ones — take on Hard and Expert bots to climb faster.
              </p>
              <table className="leaderboard-table">
                <thead>
                  <tr><th>#</th><th>Player</th><th>Rating</th><th>W</th><th>L</th></tr>
                </thead>
                <tbody>
                  {leaderboard.topBots.map((row, i) => (
                    <tr key={row.username} className={row.username === user.username ? 'highlight' : ''}>
                      <td>{i + 1}</td>
                      <td>
                        {row.username}
                        {i === 0 && <span className="grand-master-tag">Grand Master</span>}
                      </td>
                      <td>{row.bot_rating}</td>
                      <td>{row.bot_wins}</td>
                      <td>{row.bot_losses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {tab === 'friends' && (
        <div className="lobby-content">
          <FriendsPanel socket={socket} user={user} />
        </div>
      )}

      {tab === 'howtoplay' && (
        <div className="lobby-content how-to-play">
          <h2>How to Play Kwerzo</h2>

          <h3>Tiles</h3>
          <p>
            There are <strong>108 tiles</strong> — 6 shapes × 6 colors × 3 copies each.
            Every tile has a unique combination of one shape and one color.
          </p>
          <div className="shape-legend">
            {[
              { sym: '☽', name: 'Moon', color: '#F5F5F5' },
              { sym: '⚡', name: 'Bolt', color: '#FB8C00' },
              { sym: '★', name: 'Star', color: '#43A047' },
              { sym: '🍃', name: 'Leaf', color: '#1E88E5' },
              { sym: '⬡', name: 'Hex', color: '#8E24AA' },
              { sym: '♥', name: 'Heart', color: '#E91E63' },
            ].map(s => (
              <div key={s.name} className="shape-item" style={{ color: s.color }}>
                <span>{s.sym}</span>
                <small>{s.name}</small>
              </div>
            ))}
          </div>

          <h3>Goal</h3>
          <p>Score the most points by placing tiles on the shared board.</p>

          <h3>On Your Turn</h3>
          <ul>
            <li><strong>Place tiles</strong> — one or more from your hand, in the same row or column. They must all share the same shape OR the same color.</li>
            <li><strong>Swap tiles</strong> — put any tiles from your hand back in the bag and draw the same number.</li>
            <li><strong>Pass</strong> — if you truly cannot play (rare).</li>
          </ul>
          <p>After placing, draw back up to 6 tiles.</p>

          <h3>Valid Lines</h3>
          <ul>
            <li>All tiles in a line share the same <strong>shape</strong> (different colors), OR</li>
            <li>All tiles in a line share the same <strong>color</strong> (different shapes).</li>
            <li>No duplicate tile (same shape + color) in the same line.</li>
            <li>Max 6 tiles in any line.</li>
          </ul>

          <h3>Scoring</h3>
          <ul>
            <li>Score 1 point for each tile in every line you create or extend.</li>
            <li>A tile at the intersection of two lines scores in both lines.</li>
            <li><strong>Kwerzo!</strong> Complete a line of 6 → +6 bonus points (12 total for that line).</li>
            <li>Empty out your hand when the bag is empty → +6 bonus points.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
