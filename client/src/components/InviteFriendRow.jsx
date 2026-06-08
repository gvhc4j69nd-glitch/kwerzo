import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function InviteFriendRow({ socket, roomId, room, style }) {
  const [friends, setFriends] = useState(null);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState(null); // 'sending' | 'sent' | <error message>

  useEffect(() => {
    api.getFriends()
      .then(d => setFriends((d.friends || []).filter(f => f.online)))
      .catch(() => setFriends([]));
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onSent  = () => setStatus('sent');
    const onError = ({ message }) => setStatus(message);
    socket.on('game_invite_sent',  onSent);
    socket.on('game_invite_error', onError);
    return () => {
      socket.off('game_invite_sent',  onSent);
      socket.off('game_invite_error', onError);
    };
  }, [socket]);

  if (friends === null) return null;

  const inRoomIds = new Set((room?.players || []).map(p => p.id));
  const available = friends.filter(f => !inRoomIds.has(f.userId));

  if (available.length === 0) {
    return (
      <div className="invite-friend-row" style={style}>
        <span className="invite-empty-msg">No online friends to invite right now</span>
      </div>
    );
  }

  function invite() {
    if (!selected) return;
    setStatus('sending');
    socket.emit('invite_to_game', { roomId, friendUserId: Number(selected) });
  }

  return (
    <div className="invite-friend-row" style={style}>
      <select
        className="bot-diff-select"
        style={{ flex: 1 }}
        value={selected}
        onChange={e => { setSelected(e.target.value); setStatus(null); }}
      >
        <option value="">Invite a friend…</option>
        {available.map(f => (
          <option key={f.userId} value={f.userId}>{f.username}</option>
        ))}
      </select>
      <button
        className="btn-secondary"
        disabled={!selected || status === 'sending' || (room?.players?.length ?? 0) >= 4}
        onClick={invite}
      >
        Invite
      </button>
      {status === 'sent' && <span className="invite-status">Invite sent ✓</span>}
      {status && status !== 'sending' && status !== 'sent' && <span className="invite-status invite-status-error">{status}</span>}
    </div>
  );
}
