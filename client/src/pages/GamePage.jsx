import React, { useEffect, useState, useRef } from 'react';
import KwerzoTile from '../components/KwerzoTile';

const CELL   = 48;
const WORLD  = 4000;
const ORIGIN = WORLD / 2;

export default function GamePage({ socket, user, roomId, initialRoom, onLeave }) {
  const [room,            setRoom]            = useState(initialRoom);
  const [gameState,       setGameState]       = useState(null);
  const [staged,          setStaged]          = useState([]);
  const [selectedHandIdx, setSelectedHandIdx] = useState(null);
  const [swapMode,        setSwapMode]        = useState(false);
  const [swapSelection,   setSwapSelection]   = useState([]);
  const [lastMsg,         setLastMsg]         = useState('');
  const [moveError,       setMoveError]       = useState('');
  const [gameOver,        setGameOver]        = useState(null);
  const scrollRef = useRef(null);

  const myTurn   = gameState && gameState.players[gameState.currentPlayerIndex]?.id === user.id;
  const myPlayer = gameState?.players.find(p => p.id === user.id);
  const myHand   = myPlayer?.hand || [];

  const displayBoard = { ...(gameState?.board || {}) };
  for (const { x, y, tile } of staged) displayBoard[`${x},${y}`] = { ...tile, _staged: true };

  // ── Socket ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    socket.on('room_update', setRoom);
    socket.on('game_started', () => setLastMsg('Game started!'));
    socket.on('game_update', ({ state }) => {
      setGameState(state);
      setStaged([]);
      setSelectedHandIdx(null);
      setSwapMode(false);
      setSwapSelection([]);
      setMoveError('');
    });
    socket.on('move_made', ({ username, points, type, count }) => {
      if      (type === 'swap') setLastMsg(`${username} swapped ${count} tile${count !== 1 ? 's' : ''}`);
      else if (type === 'pass') setLastMsg(`${username} passed`);
      else                      setLastMsg(`${username} scored ${points} pt${points !== 1 ? 's' : ''}`);
    });
    socket.on('move_error', (err) => { setMoveError(err); setStaged([]); });
    socket.on('game_over',  (data) => setGameOver(data));
    return () => {
      socket.off('room_update');
      socket.off('game_started');
      socket.off('game_update');
      socket.off('move_made');
      socket.off('move_error');
      socket.off('game_over');
    };
  }, [socket]);

  // ── Auto-center on game update ───────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const keys = Object.keys(gameState?.board || {});
    let cx = 0, cy = 0;
    if (keys.length > 0) {
      const xs = keys.map(k => parseInt(k.split(',')[0]));
      const ys = keys.map(k => parseInt(k.split(',')[1]));
      cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    el.scrollLeft = ORIGIN + (cx + 0.5) * CELL - el.clientWidth  / 2;
    el.scrollTop  = ORIGIN + (cy + 0.5) * CELL - el.clientHeight / 2;
  }, [gameState?.board]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function centerBoard() {
    const el = scrollRef.current;
    if (!el) return;
    const keys = Object.keys(gameState?.board || {});
    let cx = 0, cy = 0;
    if (keys.length > 0) {
      const xs = keys.map(k => parseInt(k.split(',')[0]));
      const ys = keys.map(k => parseInt(k.split(',')[1]));
      cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    el.scrollTo({
      left:     ORIGIN + (cx + 0.5) * CELL - el.clientWidth  / 2,
      top:      ORIGIN + (cy + 0.5) * CELL - el.clientHeight / 2,
      behavior: 'smooth',
    });
  }

  function getValidDropCells() {
    if (!myTurn || selectedHandIdx === null) return new Set();
    const occupied = new Set(Object.keys(displayBoard));
    const adjacent = new Set();
    if (occupied.size === 0) {
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          if (dx === 0 || dy === 0) adjacent.add(`${dx},${dy}`);
      return adjacent;
    }
    for (const k of occupied) {
      const [x, y] = k.split(',').map(Number);
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nk = `${x+dx},${y+dy}`;
        if (!occupied.has(nk)) adjacent.add(nk);
      }
    }
    return adjacent;
  }

  function handleCellClick(x, y) {
    if (!myTurn) return;
    setMoveError('');
    const stagedIdx = staged.findIndex(s => s.x === x && s.y === y);
    if (stagedIdx !== -1) { setStaged(prev => prev.filter((_, i) => i !== stagedIdx)); return; }
    if (selectedHandIdx === null) return;
    const tile = myHand[selectedHandIdx];
    if (!tile) return;
    if (staged.some(s => s.handIdx === selectedHandIdx)) { setMoveError('Already placed'); return; }
    setStaged(prev => [...prev, { x, y, tile, handIdx: selectedHandIdx }]);
    setSelectedHandIdx(null);
  }

  function handleSubmit() {
    if (staged.length === 0) { setMoveError('Place at least one tile'); return; }
    socket.emit('place_tiles', { roomId, placements: staged.map(({ x, y, tile }) => ({ x, y, tile })) });
  }
  function handleSwapSubmit() {
    if (swapSelection.length === 0) { setMoveError('Select tiles to swap'); return; }
    socket.emit('swap_tiles', { roomId, tiles: swapSelection.map(i => myHand[i]) });
  }
  function handlePass()  { socket.emit('pass_turn', { roomId }); }
  function handleLeave() { socket.emit('leave_room', { roomId }); onLeave(); }

  const validDropCells    = getValidDropCells();
  const currentTurnPlayer = gameState
    ? room?.players.find(p => p.id === gameState.players[gameState.currentPlayerIndex]?.id)
    : null;

  // ── Game Over ─────────────────────────────────────────────────────────────────
  if (gameOver) {
    return (
      <div className="game-over-screen">
        <div className="game-over-card">
          <h2>Game Over!</h2>
          <div className="final-scores">
            {[...gameOver.players].sort((a, b) => b.score - a.score).map((p, i) => (
              <div key={p.id} className={`score-row ${gameOver.winners.includes(p.id) ? 'winner' : ''}`}>
                <span className="rank">{i + 1}</span>
                <span className="pname">{p.username}</span>
                <span className="pscore">{p.score} pts</span>
                {gameOver.winners.includes(p.id) && <span className="crown">👑</span>}
              </div>
            ))}
          </div>
          <button className="btn-primary" onClick={handleLeave}>Back to Lobby</button>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="game-page">

      {/* ════ MOBILE HEADER (hidden on desktop via CSS) ════ */}
      <header className="mob-header">
        <span className="mob-logo"><span className="logo-k">K</span>wer<span className="logo-z">z</span>o</span>
        <div className="mob-scores">
          {room?.players.map(rp => {
            const gp     = gameState?.players.find(p => p.id === rp.id);
            const active = gameState?.players[gameState.currentPlayerIndex]?.id === rp.id;
            return (
              <span key={rp.id} className={`mob-score-chip${active ? ' active' : ''}`}>
                {active ? '▶ ' : ''}{rp.username} {gp?.score ?? 0}
              </span>
            );
          })}
          {gameState && <span className="mob-bag">🎒{gameState.bag}</span>}
        </div>
        <button className="mob-leave-btn" onClick={handleLeave}>✕</button>
      </header>

      {/* ════ MAIN BODY: sidebar + board ════ */}
      <div className="game-body">

        {/* ── Desktop sidebar (hidden on mobile via CSS) ── */}
        <aside className="game-sidebar">
          <div className="sidebar-logo"><span className="logo-k">K</span>wer<span className="logo-z">z</span>o</div>

          <div className="players-panel">
            {room?.players.map(rp => {
              const gp            = gameState?.players.find(p => p.id === rp.id);
              const isCurrentTurn = gameState?.players[gameState.currentPlayerIndex]?.id === rp.id;
              return (
                <div key={rp.id} className={`player-row ${isCurrentTurn ? 'active-turn' : ''} ${rp.id === user.id ? 'me' : ''}`}>
                  <div className="player-name">
                    {isCurrentTurn && <span className="turn-arrow">▶</span>}
                    {rp.username}{rp.id === user.id ? ' (you)' : ''}
                  </div>
                  <div className="player-score">{gp?.score ?? 0} pts</div>
                  {gp && rp.id !== user.id && <div className="hand-size">{gp.handSize} tiles</div>}
                </div>
              );
            })}
          </div>

          {gameState && <div className="bag-count">🎒 {gameState.bag} tile{gameState.bag !== 1 ? 's' : ''}</div>}
          {lastMsg   && <div className="last-msg">{lastMsg}</div>}
          {moveError && <div className="move-error">{moveError}</div>}

          <div className="game-actions">
            {!gameState && (
              room?.players.length < 2
                ? <div className="waiting-msg">Waiting for players…</div>
                : room?.hostId === user.id
                  ? <button className="btn-primary" onClick={() => socket.emit('start_game', { roomId })}>Start Game</button>
                  : <div className="waiting-msg">Waiting for host…</div>
            )}
            {gameState && !myTurn && (
              <div className="waiting-msg">Waiting for {currentTurnPlayer?.username}…</div>
            )}
            {myTurn && !swapMode && <>
              <button className="btn-primary"    onClick={handleSubmit}  disabled={staged.length === 0}>Place {staged.length > 0 ? `(${staged.length})` : ''}</button>
              <button className="btn-secondary"  onClick={() => { setSwapMode(true); setStaged([]); setSelectedHandIdx(null); }}>Swap</button>
              <button className="btn-ghost"      onClick={handlePass}>Pass</button>
              {staged.length > 0 && <button className="btn-ghost" onClick={() => setStaged([])}>Clear</button>}
            </>}
            {myTurn && swapMode && <>
              <p className="swap-hint">Select tiles to swap:</p>
              <button className="btn-primary"   onClick={handleSwapSubmit} disabled={swapSelection.length === 0}>Confirm {swapSelection.length > 0 ? `(${swapSelection.length})` : ''}</button>
              <button className="btn-ghost"     onClick={() => { setSwapMode(false); setSwapSelection([]); }}>Cancel</button>
            </>}
            <button className="btn-ghost" style={{ marginTop: 4 }} onClick={handleLeave}>Leave</button>
          </div>
        </aside>

        {/* ── Board ── */}
        <main className="board-viewport">
          <div className="board-scroll" ref={scrollRef}>
            <div className="board-world" style={{ width: WORLD, height: WORLD }}>

              {myTurn && selectedHandIdx !== null && [...validDropCells].map(k => {
                const [x, y] = k.split(',').map(Number);
                if (displayBoard[k]) return null;
                return (
                  <div
                    key={`drop-${k}`}
                    className="drop-target"
                    style={{ position: 'absolute', left: ORIGIN + x * CELL, top: ORIGIN + y * CELL, width: CELL, height: CELL }}
                    onClick={() => handleCellClick(x, y)}
                  />
                );
              })}

              {staged.map(({ x, y, tile }) => (
                <div
                  key={`staged-${x},${y}`}
                  className="board-cell-wrapper staged-cell"
                  style={{ left: ORIGIN + x * CELL, top: ORIGIN + y * CELL }}
                  onClick={() => handleCellClick(x, y)}
                >
                  <KwerzoTile shape={tile.shape} color={tile.color} size={CELL} staged />
                </div>
              ))}

              {Object.entries(displayBoard).map(([k, tile]) => {
                if (tile._staged) return null;
                const [x, y] = k.split(',').map(Number);
                return (
                  <div key={`tile-${k}`} className="board-cell-wrapper" style={{ left: ORIGIN + x * CELL, top: ORIGIN + y * CELL }}>
                    <KwerzoTile shape={tile.shape} color={tile.color} size={CELL} />
                  </div>
                );
              })}

            </div>
          </div>
          <button className="center-board-btn" onClick={centerBoard}>⊙ Center</button>
        </main>

      </div>{/* end game-body */}

      {/* ════ MOBILE STATUS + ACTIONS (hidden on desktop via CSS) ════ */}
      <div className="mob-status">
        {moveError && <span className="mob-err">{moveError}</span>}
        {!moveError && lastMsg && <span className="mob-ok">{lastMsg}</span>}
        {!moveError && !lastMsg && gameState && !myTurn && (
          <span className="mob-wait">Waiting for {currentTurnPlayer?.username}…</span>
        )}
        {!gameState && (
          room?.players.length < 2
            ? <span className="mob-wait">Waiting for players…</span>
            : room?.hostId === user.id
              ? <button className="btn-primary btn-sm" onClick={() => socket.emit('start_game', { roomId })}>Start Game</button>
              : <span className="mob-wait">Waiting for host…</span>
        )}
      </div>

      {myTurn && (
        <div className="mob-actions">
          {!swapMode && <>
            <button className="btn-primary btn-sm"   onClick={handleSubmit}  disabled={staged.length === 0}>Place{staged.length > 0 ? ` (${staged.length})` : ''}</button>
            <button className="btn-secondary btn-sm" onClick={() => { setSwapMode(true); setStaged([]); setSelectedHandIdx(null); }}>Swap</button>
            <button className="btn-ghost btn-sm"     onClick={handlePass}>Pass</button>
            {staged.length > 0 && <button className="btn-ghost btn-sm" onClick={() => setStaged([])}>✕</button>}
          </>}
          {swapMode && <>
            <button className="btn-primary btn-sm" onClick={handleSwapSubmit} disabled={swapSelection.length === 0}>Confirm{swapSelection.length > 0 ? ` (${swapSelection.length})` : ''}</button>
            <button className="btn-ghost btn-sm"   onClick={() => { setSwapMode(false); setSwapSelection([]); }}>Cancel</button>
          </>}
        </div>
      )}

      {/* ════ TILE TRAY — always full width, single row ════ */}
      <div className="tile-tray">
        {myHand.length === 0 && gameState && (
          <span className="tray-empty">No tiles</span>
        )}
        {myHand.map((tile, i) => {
          const used        = staged.some(s => s.handIdx === i);
          const swapSel     = swapSelection.includes(i);
          return (
            <div
              key={i}
              className={`hand-slot${used ? ' used' : ''}${swapSel ? ' swap-selected' : ''}${selectedHandIdx === i ? ' selected-slot' : ''}`}
              onClick={() => {
                if (swapMode) { setSwapSelection(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]); return; }
                if (!myTurn || used) return;
                setSelectedHandIdx(prev => prev === i ? null : i);
                setMoveError('');
              }}
            >
              <KwerzoTile shape={tile.shape} color={tile.color} size={CELL} selected={selectedHandIdx === i} />
            </div>
          );
        })}
      </div>

    </div>
  );
}
