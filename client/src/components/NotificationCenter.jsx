import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

let nextId = 1;
const genId = () => `n${Date.now()}_${nextId++}`;

export default function NotificationCenter({ socket, user, onAcceptGameInvite }) {
  const [items, setItems] = useState([]);
  const [open, setOpen]   = useState(false);
  const panelRef = useRef(null);

  function push(notif) {
    setItems(prev => [{ id: genId(), createdAt: Date.now(), ...notif }, ...prev].slice(0, 30));
  }
  function remove(id) {
    setItems(prev => prev.filter(n => n.id !== id));
  }

  useEffect(() => {
    if (!socket) return;

    const onFriendRequest = ({ id, userId, username }) => push({
      type: 'friend_request',
      title: 'Friend Request',
      message: `${username} wants to be your friend`,
      data: { requestId: id, userId, username },
    });
    const onFriendAccepted = ({ username }) => push({
      type: 'system',
      title: 'Friend Request Accepted',
      message: `${username} accepted your friend request`,
    });
    const onFriendDeclined = ({ username }) => push({
      type: 'system',
      title: 'Friend Request Declined',
      message: `${username} declined your friend request`,
    });
    const onFriendRemoved = ({ username }) => push({
      type: 'system',
      title: 'Friend Removed',
      message: `${username} removed you as a friend`,
    });
    const onGameInvite = ({ roomId, fromUserId, fromUsername, playerCount }) => push({
      type: 'game_invite',
      title: 'Game Invite',
      message: `${fromUsername} invited you to join their room (${playerCount}/4 players)`,
      data: { roomId, fromUserId, fromUsername },
    });
    const onInviteAccepted = ({ byUsername }) => push({
      type: 'system',
      title: 'Invite Accepted',
      message: `${byUsername} joined your room`,
    });
    const onInviteDeclined = ({ byUsername }) => push({
      type: 'system',
      title: 'Invite Declined',
      message: `${byUsername} declined your game invite`,
    });
    const onRoomExpired = () => push({
      type: 'system',
      title: 'Game Ended',
      message: 'Your game ended due to 72 hours of inactivity.',
    });

    socket.on('friend_request_received', onFriendRequest);
    socket.on('friend_request_accepted', onFriendAccepted);
    socket.on('friend_request_declined', onFriendDeclined);
    socket.on('friend_removed',          onFriendRemoved);
    socket.on('game_invite_received',    onGameInvite);
    socket.on('game_invite_accepted',    onInviteAccepted);
    socket.on('game_invite_declined',    onInviteDeclined);
    socket.on('room_expired',            onRoomExpired);

    return () => {
      socket.off('friend_request_received', onFriendRequest);
      socket.off('friend_request_accepted', onFriendAccepted);
      socket.off('friend_request_declined', onFriendDeclined);
      socket.off('friend_removed',          onFriendRemoved);
      socket.off('game_invite_received',    onGameInvite);
      socket.off('game_invite_accepted',    onInviteAccepted);
      socket.off('game_invite_declined',    onInviteDeclined);
      socket.off('room_expired',            onRoomExpired);
    };
  }, [socket]);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
    };
  }, [open]);

  function acceptFriendRequest(notif) {
    api.respondFriendReq(notif.data.requestId, 'accept').catch(() => {});
    remove(notif.id);
  }
  function declineFriendRequest(notif) {
    api.respondFriendReq(notif.data.requestId, 'decline').catch(() => {});
    remove(notif.id);
  }
  function acceptGameInvite(notif) {
    socket.emit('respond_game_invite', { roomId: notif.data.roomId, action: 'accept', fromUserId: notif.data.fromUserId });
    remove(notif.id);
    onAcceptGameInvite?.(notif.data.roomId);
  }
  function declineGameInvite(notif) {
    socket.emit('respond_game_invite', { roomId: notif.data.roomId, action: 'decline', fromUserId: notif.data.fromUserId });
    remove(notif.id);
  }

  const count = items.length;

  return (
    <div className="notif-center" ref={panelRef}>
      <button className="notif-bell" onClick={() => setOpen(o => !o)} aria-label="Notifications">
        🔔
        {count > 0 && <span className="notif-badge">{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <span>Notifications</span>
            {count > 0 && <button className="notif-clear" onClick={() => setItems([])}>Clear all</button>}
          </div>
          {items.length === 0 ? (
            <div className="notif-empty">You're all caught up!</div>
          ) : (
            items.map(n => (
              <div key={n.id} className={`notif-item notif-${n.type}`}>
                <div className="notif-item-title">{n.title}</div>
                <div className="notif-item-msg">{n.message}</div>
                {n.type === 'friend_request' && (
                  <div className="notif-actions">
                    <button className="btn-primary" onClick={() => acceptFriendRequest(n)}>Accept</button>
                    <button className="btn-ghost" onClick={() => declineFriendRequest(n)}>Decline</button>
                  </div>
                )}
                {n.type === 'game_invite' && (
                  <div className="notif-actions">
                    <button className="btn-primary" onClick={() => acceptGameInvite(n)}>Join</button>
                    <button className="btn-ghost" onClick={() => declineGameInvite(n)}>Decline</button>
                  </div>
                )}
                {n.type !== 'friend_request' && n.type !== 'game_invite' && (
                  <button className="notif-dismiss" onClick={() => remove(n.id)}>Dismiss</button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
