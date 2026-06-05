import React, { useEffect, useState, useRef } from 'react';
import KwerzoTile from '../components/KwerzoTile';

const CELL = 48;              // smaller cell = more tiles visible at once
const WORLD = 4000;           // px — large scrollable canvas
const ORIGIN = WORLD / 2;     // grid (0,0) is at pixel (ORIGIN, ORIGIN)

export default function GamePage({ socket, user, roomId, initialRoom, onLeave }) {
  const [room, setRoom] = useState(initialRoom);
  const [gameState, setGameState] = useState(null);
  const [staged, setStaged] = useState([]);
  const [selectedHandIdx, setSelectedHandIdx] = useState(null);
  const [swapMode, setSwapMode] = useState(false);
  const [swapSelection, setSwapSelection] = useState([]);
  const [lastMsg, setLastMsg] = useState('');
  const [moveError, setMoveError] = useState('');
  const [gameOver, setGameOver] = useState(null);
  const [isMobile, setIsMobile] = useState(() =>
    window.matchMedia('(max-width: 768px)').matches ||
    (navigator.maxTouchPoints > 0 && window.innerWidth <= 1024)
  );

  const scrollRef = useRef(null);

  const myTurn = gameState &&
    gameState.players[gameState.currentPlayerIndex]?.id === user.id;

  const myPlayer = gameState?.players.find(p => p.id === user.id);
  const myHand = myPlayer?.hand || [];

  const displayBoard = { ...(gameState?.board || {}) };
  for (const { x, y, tile } of staged) displayBoard[`${x},${y}`] = { ...tile, _staged: true };

  // Socket events
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
      if (type === 'swap') setLastMsg(`${username} swapped ${count} tile${count !== 1 ? 's' : ''}`);
      else if (type === 'pass') setLastMsg(`${username} passed`);
      else setLastMsg(`${username} scored ${points} point${points !== 1 ? 's' : ''}`);
    });
    socket.on('move_error', (err) => { setMoveError(err); setStaged([]); });
    socket.on('game_over', (data) => setGameOver(data));
    return () => {
      socket.off('room_update');
      socket.off('game_started');
      socket.off('game_update');
      socket.off('move_made');
      socket.off('move_error');
      socket.off('game_over');
    };
  }, [socket]);

  // Mobile detection
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(
      mq.matches || (navigator.maxTouchPoints > 0 && window.innerWidth <= 1024)
    );
    mq.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  // Scroll board to center on all placed tiles whenever game state changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const allKeys = [
      ...Object.keys(gameState?.board || {}),
      ...staged.map(s => `${s.x},${s.y}`)
    ];

    let cx, cy;
    if (allKeys.length === 0) {
      cx = 0; cy = 0;
    } else {
      const xs = allKeys.map(k => parseInt(k.split(',')[0]));
      const ys = allKeys.map(k => parseInt(k.split(',')[1]));
      cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    }

    // pixel center of the tile group in world coords
    const px = ORIGIN + (cx + 0.5) * CELL;
    const py = ORIGIN + (cy + 0.5) * CELL;

    el.scrollLeft = px - el.clientWidth / 2;
    el.scrollTop  = py - el.clientHeight / 2;
  }, [gameState?.board]);

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
    if (stagedIdx !== -1) {
      setStaged(prev => prev.filter((_, i) => i !== stagedIdx));
      return;
    }
    if (selectedHandIdx === null) return;
    const tile = myHand[selectedHandIdx];
    if (!tile) return;
    if (staged.some(s => s.handIdx === selectedHandIdx)) { setMoveError('That tile is already placed'); return; }
    setStaged(prev => [...prev, { x, y, tile, handIdx: selectedHandIdx }]);
    setSelectedHandIdx(null);
  }

  function handleSubmit() {
    if (staged.length === 0) { setMoveError('Place at least one tile'); return; }
    socket.emit('place_tiles', { roomId, placements: staged.map(({ x, y, tile }) => ({ x, y, tile })) });
  }

  function handleSwapSubmit() {
    if (swapSelection.length === 0) { setMoveError('Select at least one tile to swap'); return; }
    socket.emit('swap_tiles', { roomId, tiles: swapSelection.map(i => myHand[i]) });
  }

  function handlePass() { socket.emit('pass_turn', { roomId }); }

  function centerBoard() {
    const el = scrollRef.current;
    if (!el) return;
    const allKeys = Object.keys(gameState?.board || {});
    let cx = 0, cy = 0;
    if (allKeys.length > 0) {
      const xs = allKeys.map(k => parseInt(k.split(',')[0]));
      const ys = allKeys.map(k => parseInt(k.split(',')[1]));
      cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    const px = ORIGIN + (cx + 0.5) * CELL;
    const py = ORIGIN + (cy + 0.5) * CELL;
    el.scrollTo({ left: px - el.clientWidth / 2, top: py - el.clientHeight / 2, behavior: 'smooth' });
  }

  function handleLeave() {
    socket.emit('leave_room', { roomId });
    onLeave();
  }

  const validDropCells = getValidDropCells();

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

  const currentTurnPlayer = gameState
    ? room?.players.find(p => p.id === gameState.players[gameState.currentPlayerIndex]?.id)
    : null;

  return (
    <div className="game-page">

      {/* ── Mobile top bar ── */}
      {isMobile && (
        <div className="mobile-top-bar">
          <div className="mobile-logo"><span className="logo-k">K</span>wer<span className="logo-z">z</span>o</div>
          <div className="mobile-scores">
            {room?.players.map(rp => {
              const gp = gameState?.players.find(p => p.id === rp.id);
              const active = gameState?.players[gameState.currentPlayerIndex]?.id === rp.id;
              return (
                <span key={rp.id} className={`mobile-pscore${active ? ' active' : ''}`}>
                  {active ? '▶ ' : ''}{rp.username} {gp?.score ?? 0}
                </span>
              );
            })}
            {gameState && <span className="mobile-bag">🎒{gameState.bag}</span>}
          </div>
          <button className="mobile-leave-btn" onClick={handleLeave}>✕</button>
        </div>
      )}

      <div className="game-body">

        {/* ── Desktop sidebar ── */}
        {!isMobile && (
          <aside className="game-sidebar">
            <div className="sidebar-logo">
              <span className="logo-k">K</span>wer<span className="logo-z">z</span>o
            </div>

            <div className="players-panel">
              {room?.players.map(rp => {
                const gp = gameState?.players.find(p => p.id === rp.id);
                const isCurrentTurn = gameState?.players[gameState.currentPlayerIndex]?.id === rp.id;
                return (
                  <div key={rp.id} className={`player-row ${isCurrentTurn ? 'active-turn' : ''} ${rp.id === user.id ? 'me' : ''}`}>
                    <div className="player-name">
                      {isCurrentTurn && <span className="turn-arrow">▶</span>}
                      {rp.username}{rp.id === user.id && ' (you)'}
                    </div>
                    <div className="player-score">{gp?.score ?? 0} pts</div>
                    {gp && rp.id !== user.id && <div className="hand-size">{gp.handSize} tiles</div>}
                  </div>
                );
              })}
            </div>

            {gameState && <div className="bag-count">🎒 {gameState.bag} tile{gameState.bag !== 1 ? 's' : ''} in bag</div>}
            {lastMsg && <div className="last-msg">{lastMsg}</div>}
            {moveError && <div className="move-error">{moveError}</div>}

            {myTurn && !swapMode && (
              <div className="game-actions">
                <button className="btn-primary" onClick={handleSubmit} disabled={staged.length === 0}>
                  Place {staged.length > 0 ? `(${staged.length})` : ''}
                </button>
                <button className="btn-secondary" onClick={() => { setSwapMode(true); setStaged([]); setSelectedHandIdx(null); }}>
                  Swap
                </button>
                <button className="btn-ghost" onClick={handlePass}>Pass</button>
                {staged.length > 0 && <button className="btn-ghost" onClick={() => setStaged([])}>Clear</button>}
                <button className="btn-ghost leave-btn" onClick={handleLeave}>Leave</button>
              </div>
            )}

            {myTurn && swapMode && (
              <div className="game-actions">
                <p className="swap-hint">Select tiles to swap:</p>
                <button className="btn-primary" onClick={handleSwapSubmit} disabled={swapSelection.length === 0}>
                  Confirm {swapSelection.length > 0 ? `(${swapSelection.length})` : ''}
                </button>
                <button className="btn-ghost" onClick={() => { setSwapMode(false); setSwapSelection([]); }}>Cancel</button>
                <button className="btn-ghost leave-btn" onClick={handleLeave}>Leave</button>
              </div>
            )}

            {!myTurn && gameState && (
              <div className="game-actions">
                <div className="waiting-msg">Waiting for {currentTurnPlayer?.username}…</div>
                <button className="btn-ghost leave-btn" onClick={handleLeave}>Leave</button>
              </div>
            )}

            {!gameState && (
              <div className="game-actions">
                {room?.players.length < 2
                  ? <div className="waiting-msg">Waiting for players…</div>
                  : room?.hostId === user.id
                    ? <button className="btn-primary" onClick={() => socket.emit('start_game', { roomId })}>Start Game</button>
                    : <div className="waiting-msg">Waiting for host…</div>
                }
                <button className="btn-ghost leave-btn" onClick={handleLeave}>Leave</button>
              </div>
            )}
          </aside>
        )}

        {/* ── Board (native scroll) ── */}
        <main className="board-viewport">
          <div className="board-scroll" ref={scrollRef} style={{ scrollbarWidth: 'none' }}>
            <div className="board-world" style={{ width: WORLD, height: WORLD }}>

              {myTurn && selectedHandIdx !== null && [...validDropCells].map(k => {
                const [x, y] = k.split(',').map(Number);
                if (displayBoard[k]) return null;
                return (
                  <div
                    key={`drop-${k}`}
                    className="drop-target"
                    style={{
                      left: ORIGIN + x * CELL,
                      top:  ORIGIN + y * CELL,
                      width: CELL,
                      height: CELL,
                      position: 'absolute'
                    }}
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
                  title="Tap to remove"
                >
                  <KwerzoTile shape={tile.shape} color={tile.color} size={CELL} staged />
                </div>
              ))}

              {Object.entries(displayBoard).map(([k, tile]) => {
                if (tile._staged) return null;
                const [x, y] = k.split(',').map(Number);
                return (
                  <div
                    key={`tile-${k}`}
                    className="board-cell-wrapper"
                    style={{ left: ORIGIN + x * CELL, top: ORIGIN + y * CELL }}
                  >
                    <KwerzoTile shape={tile.shape} color={tile.color} size={CELL} />
                  </div>
                );
              })}

            </div>
          </div>
          <button className="center-board-btn" onClick={centerBoard} title="Center on tiles">
            ⊙ Center
          </button>
        </main>

      </div>{/* end game-body */}

      {/* ── Mobile controls ── */}
      {isMobile && (
        <div className="mobile-controls">
          {(lastMsg || moveError) && (
            <div className="mobile-status-row">
              {lastMsg && <span className="mobile-msg-ok">{lastMsg}</span>}
              {moveError && <span className="mobile-msg-err">{moveError}</span>}
            </div>
          )}
          {myTurn && !swapMode && (
            <div className="mobile-actions">
              <button className="btn-primary btn-sm" onClick={handleSubmit} disabled={staged.length === 0}>
                Place{staged.length > 0 ? ` (${staged.length})` : ''}
              </button>
              <button className="btn-secondary btn-sm" onClick={() => { setSwapMode(true); setStaged([]); setSelectedHandIdx(null); }}>
                Swap
              </button>
              <button className="btn-ghost btn-sm" onClick={handlePass}>Pass</button>
              {staged.length > 0 && <button className="btn-ghost btn-sm" onClick={() => setStaged([])}>✕ Clear</button>}
            </div>
          )}
          {myTurn && swapMode && (
            <div className="mobile-actions">
              <button className="btn-primary btn-sm" onClick={handleSwapSubmit} disabled={swapSelection.length === 0}>
                Confirm Swap{swapSelection.length > 0 ? ` (${swapSelection.length})` : ''}
              </button>
              <button className="btn-ghost btn-sm" onClick={() => { setSwapMode(false); setSwapSelection([]); }}>Cancel</button>
            </div>
          )}
          {!myTurn && gameState && (
            <div className="mobile-waiting">Waiting for {currentTurnPlayer?.username}…</div>
          )}
          {!gameState && (
            <div className="mobile-waiting">
              {room?.players.length < 2
                ? 'Waiting for more players…'
                : room?.hostId === user.id
                  ? <button className="btn-primary btn-sm" onClick={() => socket.emit('start_game', { roomId })}>Start Game</button>
                  : 'Waiting for host to start…'
              }
            </div>
          )}
        </div>
      )}

      {/* ── Tile tray — full width, single row ── */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 10px',
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        msOverflowStyle: 'none',
        scrollbarWidth: 'none',
      }}>
        {myHand.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {gameState ? 'No tiles in hand' : 'Game not started'}
          </span>
        )}
        {myHand.map((tile, i) => {
          const isUsedInStage = staged.some(s => s.handIdx === i);
          const isSwapSelected = swapSelection.includes(i);
          return (
            <div
              key={i}
              style={{ flexShrink: 0 }}
              className={`hand-slot ${isUsedInStage ? 'used' : ''} ${isSwapSelected ? 'swap-selected' : ''}`}
              onClick={() => {
                if (swapMode) {
                  setSwapSelection(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);
                  return;
                }
                if (!myTurn) return;
                if (isUsedInStage) return;
                setSelectedHandIdx(prev => prev === i ? null : i);
                setMoveError('');
              }}
            >
              <KwerzoTile
                shape={tile.shape}
                color={tile.color}
                size={52}
                selected={selectedHandIdx === i}
                className={isUsedInStage ? 'tile-ghost' : ''}
              />
            </div>
          );
        })}
      </div>

    </div>
  );
}
