import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

const BOTS = [
  { difficulty: 'easy',   label: 'Easy Bot (Joe)' },
  { difficulty: 'medium', label: 'Medium Bot' },
  { difficulty: 'hard',   label: 'Hard Bot (John)' },
  { difficulty: 'expert',    label: 'Expert Bot (Ada)' },
  { difficulty: 'legendary', label: 'Legendary Bot (Nemesis)' },
];

// Combined list of online friends + bot options, each with a "+" to add,
// capped at 3 additional players (host + 3 = max room size of 4).
export default function AddPlayersPanel({ socket, roomId, room, style }) {
  const [friends, setFriends] = useState(null);
  const [pendingInvites, setPendingInvites] = useState(new Set());
  const [errors, setErrors] = useState({});

  useEffect(() => {
    api.getFriends()
      .then(d => setFriends((d.friends || []).filter(f => f.online)))
      .catch(() => setFriends([]));
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onSent = ({ friendUserId }) => {
      setPendingInvites(prev => {
        const next = new Set(prev);
        next.add(Number(friendUserId));
        return next;
      });
    };
    const onError = ({ friendUserId, message }) => {
      setErrors(prev => ({ ...prev, [Number(friendUserId)]: message }));
      setPendingInvites(prev => {
        const next = new Set(prev);
        next.delete(Number(friendUserId));
        return next;
      });
    };
    socket.on('game_invite_sent',  onSent);
    socket.on('game_invite_error', onError);
    return () => {
      socket.off('game_invite_sent',  onSent);
      socket.off('game_invite_error', onError);
    };
  }, [socket]);

  if (friends === null) return null;

  const playerCount  = room?.players?.length ?? 0;
  const slotsLeft    = Math.max(0, 4 - playerCount);
  const roomFull     = slotsLeft === 0;
  const inRoomIds    = new Set((room?.players || []).map(p => p.id));
  const available    = friends.filter(f => !inRoomIds.has(f.userId));

  function inviteFriend(friendUserId) {
    if (roomFull || pendingInvites.has(friendUserId)) return;
    setErrors(prev => { const next = { ...prev }; delete next[friendUserId]; return next; });
    setPendingInvites(prev => new Set(prev).add(friendUserId));
    socket.emit('invite_to_game', { roomId, friendUserId });
  }

  function addBot(difficulty) {
    if (roomFull) return;
    socket.emit('add_bot', { roomId, difficulty });
  }

  return (
    <div className="add-players-panel" style={style}>
      <div className="add-players-hint">
        {roomFull
          ? 'Room is full (4/4)'
          : `Add up to ${slotsLeft} more player${slotsLeft === 1 ? '' : 's'} — friends or bots`}
      </div>

      {available.length === 0 ? (
        <div className="invite-empty-msg">No online friends to invite right now</div>
      ) : (
        <div className="add-players-list">
          {available.map(f => {
            const invited = pendingInvites.has(f.userId);
            const err     = errors[f.userId];
            return (
              <div key={f.userId} className="add-players-row">
                <span className="add-players-name">
                  <span className="presence-dot online" />
                  {f.username}
                  <span className="add-players-tag">friend</span>
                </span>
                {invited ? (
                  <span className="invite-status">Invited ✓</span>
                ) : (
                  <button
                    className="add-players-plus"
                    disabled={roomFull}
                    title={`Invite ${f.username}`}
                    onClick={() => inviteFriend(f.userId)}
                  >+</button>
                )}
                {err && <span className="invite-status invite-status-error">{err}</span>}
              </div>
            );
          })}
        </div>
      )}

      <div className="add-players-list">
        {BOTS.map(b => (
          <div key={b.difficulty} className="add-players-row">
            <span className="add-players-name">
              <span className={`bot-badge ${b.difficulty}`}>{b.difficulty}</span>
              {b.label}
              <span className="add-players-tag">bot</span>
            </span>
            <button
              className="add-players-plus"
              disabled={roomFull}
              title={`Add ${b.label}`}
              onClick={() => addBot(b.difficulty)}
            >+</button>
          </div>
        ))}
      </div>
    </div>
  );
}
