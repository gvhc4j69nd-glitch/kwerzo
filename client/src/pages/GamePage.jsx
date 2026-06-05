import React, { useEffect, useState, useRef } from 'react';
import KwerzoTile from '../components/KwerzoTile';

const CELL = 64;

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

  // Board pan/zoom state
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const panRef = useRef(pan);
  const zoomRef = useRef(1);
  const dragging = useRef(false);
  const dragStart = useRef(null);
  const lastTouchDist = useRef(null);
  const touchMoved = useRef(false);
  const boardRef = useRef(null);

  panRef.current = pan;
  zoomRef.current = zoom;

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

  // Mobile detection — mirrors CSS breakpoint + touch capability
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

  // Auto-center board on first tiles
  useEffect(() => {
    if (!gameState?.board || !boardRef.current) return;
    const keys = Object.keys(gameState.board);
    if (keys.length === 0) return;
    const xs = keys.map(k => parseInt(k.split(',')[0]));
    const ys = keys.map(k => parseInt(k.split(',')[1]));
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const rect = boardRef.current.getBoundingClientRect();
    setPan({ x: rect.width / 2 - cx * CELL, y: rect.height / 2 - cy * CELL });
  }, [!!gameState?.board && Object.keys(gameState.board || {}).length > 0]);

  // Touch pan + pinch-zoom (non-passive touchmove to allow preventDefault)
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    let startX = 0, startY = 0;

    function onTouchStart(e) {
      if (e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        dragStart.current = {
          x: e.touches[0].clientX - panRef.current.x,
          y: e.touches[0].clientY - panRef.current.y
        };
        touchMoved.current = false;
        lastTouchDist.current = null;
      } else if (e.touches.length === 2) {
        dragging.current = false;
        touchMoved.current = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist.current = Math.sqrt(dx * dx + dy * dy);
      }
    }

    function onTouchMove(e) {
      if (e.touches.length === 1 && dragStart.current) {
        const mdx = e.touches[0].clientX - startX;
        const mdy = e.touches[0].clientY - startY;
        if (!touchMoved.current && Math.sqrt(mdx * mdx + mdy * mdy) > 6) {
          touchMoved.current = true;
          dragging.current = true;
        }
        if (touchMoved.current) {
          e.preventDefault();
          setPan({
            x: e.touches[0].clientX - dragStart.current.x,
            y: e.touches[0].clientY - dragStart.current.y
          });
        }
      } else if (e.touches.length === 2 && lastTouchDist.current !== null) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const oldZoom = zoomRef.current;
        const newZoom = Math.min(2.5, Math.max(0.3, oldZoom * (dist / lastTouchDist.current)));
        const rect = el.getBoundingClientRect();
        const pcx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const pcy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        setPan(p => ({
          x: pcx + (p.x - pcx) * newZoom / oldZoom,
          y: pcy + (p.y - pcy) * newZoom / oldZoom
        }));
        setZoom(newZoom);
        lastTouchDist.current = dist;
      }
    }

    function onTouchEnd() {
      dragging.current = false;
      touchMoved.current = false;
      lastTouchDist.current = null;
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  // Mouse pan handlers
  function onMouseDown(e) {
    if (e.button !== 0) return;
    dragging.current = true;
    dragStart.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
  }
  function onMouseMove(e) {
    if (!dragging.current) return;
    setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  }
  function onMouseUp() { dragging.current = false; }

  function handleZoom(delta) {
    const oldZoom = zoomRef.current;
    const newZoom = Math.min(2.5, Math.max(0.3, oldZoom + delta));
    if (boardRef.current) {
      const rect = boardRef.current.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      setPan(p => ({
        x: cx + (p.x - cx) * newZoom / oldZoom,
        y: cy + (p.y - cy) * newZoom / oldZoom
      }));
    }
    setZoom(newZoom);
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

  function handleLeave() {
    socket.emit('leave_room', { roomId });
    onLeave();
  }

  const validDropCells = getValidDropCells();

  const allKeys = new Set([...Object.keys(displayBoard), ...validDropCells]);
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (const k of allKeys) {
    const [x, y] = k.split(',').map(Number);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  minX -= 1; maxX += 1; minY -= 1; maxY += 1;

  const boardW = (maxX - minX + 1) * CELL;
  const boardH = (maxY - minY + 1) * CELL;

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
    <div className={`game-page${isMobile ? ' game-page-mobile' : ''}`}>

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
                Swap Tiles
              </button>
              <button className="btn-ghost" onClick={handlePass}>Pass</button>
              {staged.length > 0 && <button className="btn-ghost" onClick={() => setStaged([])}>Clear</button>}
            </div>
          )}

          {myTurn && swapMode && (
            <div className="game-actions">
              <p className="swap-hint">Select tiles to swap, then confirm:</p>
              <button className="btn-primary" onClick={handleSwapSubmit} disabled={swapSelection.length === 0}>
                Swap {swapSelection.length > 0 ? `(${swapSelection.length})` : ''}
              </button>
              <button className="btn-ghost" onClick={() => { setSwapMode(false); setSwapSelection([]); }}>Cancel</button>
            </div>
          )}

          {!myTurn && gameState && (
            <div className="waiting-msg">Waiting for {currentTurnPlayer?.username}…</div>
          )}

          {!gameState && (
            <div className="waiting-msg">
              {room?.players.length < 2
                ? 'Waiting for more players…'
                : room?.hostId === user.id
                  ? <button className="btn-primary" onClick={() => socket.emit('start_game', { roomId })}>Start Game</button>
                  : 'Waiting for host to start…'
              }
            </div>
          )}

          <button className="btn-ghost leave-btn" onClick={handleLeave}>Leave Room</button>
        </aside>
      )}

      {/* ── Board ── */}
      <main
        className="board-viewport"
        ref={boardRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <div
          className="board-container"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            width: boardW,
            height: boardH
          }}
        >
          {myTurn && selectedHandIdx !== null && [...validDropCells].map(k => {
            const [x, y] = k.split(',').map(Number);
            if (displayBoard[k]) return null;
            return (
              <div
                key={`drop-${k}`}
                className="drop-target"
                style={{ left: (x - minX) * CELL, top: (y - minY) * CELL, width: CELL, height: CELL }}
                onClick={(e) => { e.stopPropagation(); handleCellClick(x, y); }}
              />
            );
          })}

          {staged.map(({ x, y, tile }) => (
            <div
              key={`staged-${x},${y}`}
              className="board-cell-wrapper staged-cell"
              style={{ left: (x - minX) * CELL, top: (y - minY) * CELL }}
              onClick={(e) => { e.stopPropagation(); handleCellClick(x, y); }}
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
                style={{ left: (x - minX) * CELL, top: (y - minY) * CELL }}
              >
                <KwerzoTile shape={tile.shape} color={tile.color} size={CELL} />
              </div>
            );
          })}
        </div>

        <div className="zoom-controls">
          <button className="zoom-btn" onMouseDown={e => e.stopPropagation()} onClick={() => handleZoom(0.15)} title="Zoom in">+</button>
          <button className="zoom-btn" onMouseDown={e => e.stopPropagation()} onClick={() => handleZoom(-0.15)} title="Zoom out">−</button>
        </div>

        <div className="board-hint">{isMobile ? 'Drag · pinch to zoom' : 'Drag to pan · +/− to zoom'}</div>
      </main>

      {/* ── Mobile controls (actions + status, shown above hand bar) ── */}
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

      {/* ── Hand ── */}
      <div className={`hand-bar${isMobile ? ' hand-bar-mobile' : ''}`}>
        <div className="hand-label">Your tiles:</div>
        <div className="hand-tiles">
          {myHand.map((tile, i) => {
            const isUsedInStage = staged.some(s => s.handIdx === i);
            const isSwapSelected = swapSelection.includes(i);
            return (
              <div
                key={i}
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
                  size={isMobile ? 48 : 56}
                  selected={selectedHandIdx === i}
                  className={isUsedInStage ? 'tile-ghost' : ''}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
