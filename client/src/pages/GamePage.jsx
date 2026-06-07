import React, { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import KwerzoTile from '../components/KwerzoTile';

const CELL = 56;
const PAD  = 3;   // empty cells of padding around tiles

export default function GamePage({ socket, user, roomId, initialRoom, initialState, onLeave }) {
  const [room,            setRoom]            = useState(initialRoom);
  const [gameState,       setGameState]       = useState(initialState || null);
  const [staged,          setStaged]          = useState([]);
  const [selectedHandIdx, setSelectedHandIdx] = useState(null);
  const [swapMode,        setSwapMode]        = useState(false);
  const [swapSelection,   setSwapSelection]   = useState([]);
  const [lastMsg,         setLastMsg]         = useState('');
  const [moveError,       setMoveError]       = useState('');
  const [gameOver,        setGameOver]        = useState(null);
  const [isMobile,        setIsMobile]        = useState(
    () => navigator.maxTouchPoints > 0 || window.innerWidth < 1024
  );
  const [trayOrder,       setTrayOrder]       = useState([]);
  const [dragTrayIdx,     setDragTrayIdx]     = useState(null);
  const [botDifficulty,   setBotDifficulty]   = useState('medium');
  const transformRef = useRef(null);

  useEffect(() => {
    const update = () => setIsMobile(navigator.maxTouchPoints > 0 || window.innerWidth < 1024);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Hard-lock iOS scroll. iOS Safari expands the scroll area for CSS transforms
  // even inside overflow:hidden containers, causing window.scrollX to drift when
  // the board is panned. Three layers of defence:
  useEffect(() => {
    // 1. Prevent touch-driven scroll
    const preventScroll = (e) => {
      if (e.target.closest('.tile-tray') || e.target.closest('.mob-pregame') || e.target.closest('.mob-scores')) return;
      if (e.cancelable) e.preventDefault();
    };
    document.addEventListener('touchmove', preventScroll, { passive: false });
    // 2. Snap back on any scroll event
    const snap = () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); };
    window.addEventListener('scroll', snap, { passive: true });
    window.scrollTo(0, 0);
    return () => {
      document.removeEventListener('touchmove', preventScroll);
      window.removeEventListener('scroll', snap);
    };
  }, []);

  // 3. Reset scroll synchronously after every render (catches transform-driven drift)
  useLayoutEffect(() => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  });

  // hostId can be a number or string depending on whether the room was loaded
  // from the DB (TEXT column) or created fresh in memory. Normalise to string.
  const isHost = String(room?.hostId) === String(user?.id);

  const myTurn   = gameState && gameState.players[gameState.currentPlayerIndex]?.id === user.id;
  const myPlayer = gameState?.players.find(p => p.id === user.id);
  const myHand   = myPlayer?.hand || [];

  const displayBoard = { ...(gameState?.board || {}) };
  for (const { x, y, tile } of staged) displayBoard[`${x},${y}`] = { ...tile, _staged: true };

  const lastPlacedKeys = new Set((gameState?.lastPlacements || []).map(p => `${p.x},${p.y}`));

  // Reset tray order when hand size changes (tiles drawn/played)
  useEffect(() => {
    setTrayOrder(myHand.map((_, i) => i));
  }, [myHand.length]);

  // ── Socket ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    socket.on('room_update', (updatedRoom) => {
      // Only accept updates for our room
      if (updatedRoom.id === roomId) setRoom(updatedRoom);
    });
    socket.on('game_started', ({ roomId: id }) => {
      if (id === roomId) setLastMsg('Game started!');
    });
    socket.on('game_update', ({ state, roomId: id }) => {
      if (id !== roomId) return;
      setGameState(state);
      setStaged([]);
      setSelectedHandIdx(null);
      setSwapMode(false);
      setSwapSelection([]);
      setMoveError('');
    });
    socket.on('move_made', ({ roomId: id, username, points, type, count }) => {
      if (id !== roomId) return;
      if      (type === 'swap') setLastMsg(`${username} swapped ${count} tile${count !== 1 ? 's' : ''}`);
      else if (type === 'pass') setLastMsg(`${username} passed`);
      else                      setLastMsg(`${username} scored ${points} pt${points !== 1 ? 's' : ''}`);
    });
    socket.on('move_error', (err) => { setMoveError(err); setStaged([]); });
    socket.on('game_over',  (data) => setGameOver(data));
    socket.on('room_deleted', ({ roomId: id }) => { if (id === roomId) onLeave(); });
    return () => {
      socket.off('room_update');
      socket.off('game_started');
      socket.off('game_update');
      socket.off('move_made');
      socket.off('move_error');
      socket.off('game_over');
      socket.off('room_deleted');
    };
  }, [socket]);

  // ── Re-center board when tiles change ───────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => transformRef.current?.centerView(0.9), 80);
    return () => clearTimeout(t);
  }, [gameState?.board]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function centerBoard() {
    transformRef.current?.centerView(0.9, 300);
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

  // Tray drag-to-reorder
  function onTrayDragStart(i) { setDragTrayIdx(i); }
  function onTrayDragEnter(i) {
    if (dragTrayIdx === null || dragTrayIdx === i) return;
    setTrayOrder(prev => {
      const next = [...prev];
      const from = next.indexOf(dragTrayIdx);
      const to   = next.indexOf(i);
      next.splice(from, 1);
      next.splice(to, 0, dragTrayIdx);
      return next;
    });
  }
  function onTrayDragEnd() { setDragTrayIdx(null); }

  const validDropCells    = getValidDropCells();

  // Board bounds — sized to fit placed tiles + drop targets + padding
  const allBoardKeys = new Set([...Object.keys(displayBoard), ...validDropCells]);
  let minX = -PAD, maxX = PAD, minY = -PAD, maxY = PAD;
  for (const k of allBoardKeys) {
    const [x, y] = k.split(',').map(Number);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  minX -= PAD; maxX += PAD; minY -= PAD; maxY += PAD;
  const boardW = (maxX - minX + 1) * CELL;
  const boardH = (maxY - minY + 1) * CELL;

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
    <div className={`game-page${!gameState ? ' pregame-active' : ''}`}>

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

      {/* ════ MAIN BODY: sidebar + board (hidden on mobile pre-game) ════ */}
      <div className={`game-body${!gameState && isMobile ? ' mob-hidden' : ''}`}>

        {/* ── Desktop sidebar — only rendered when not mobile ── */}
        {!isMobile && <aside className="game-sidebar">
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
                    {rp.isBot && <span className={`bot-badge ${rp.difficulty}`}>{rp.difficulty}</span>}
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
            {!gameState && isHost && (
              <div className="add-bot-row">
                <select
                  className="bot-diff-select"
                  value={botDifficulty}
                  onChange={e => setBotDifficulty(e.target.value)}
                >
                  <option value="easy">Easy Bot</option>
                  <option value="medium">Medium Bot</option>
                  <option value="hard">Hard Bot</option>
                </select>
                <button
                  className="btn-secondary"
                  disabled={room?.players.length >= 4}
                  onClick={() => socket.emit('add_bot', { roomId, difficulty: botDifficulty })}
                >+ Add Bot</button>
              </div>
            )}
            {!gameState && (
              room?.players.length < 2
                ? <div className="waiting-msg">Waiting for players…</div>
                : isHost
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
        </aside>}

        {/* ── Board ── */}
        <main className="board-viewport">
          <TransformWrapper
            ref={transformRef}
            initialScale={0.9}
            minScale={0.15}
            maxScale={4}
            centerOnInit
            limitToBounds={false}
            doubleClick={{ disabled: true }}
            panning={{ velocityDisabled: false, excluded: ['drop-target', 'staged-cell', 'board-ctrl-btn', 'hand-slot', 'btn-primary', 'btn-secondary', 'btn-ghost'] }}
          >
            {({ zoomIn, zoomOut }) => (
              <>
                <TransformComponent
                  wrapperStyle={{ width: '100%', height: '100%' }}
                  contentStyle={{ width: boardW, height: boardH }}
                >
                  <div className="board-world" style={{ width: boardW, height: boardH }}>

                    {myTurn && selectedHandIdx !== null && [...validDropCells].map(k => {
                      const [x, y] = k.split(',').map(Number);
                      if (displayBoard[k]) return null;
                      return (
                        <div
                          key={`drop-${k}`}
                          className="drop-target"
                          style={{ position: 'absolute', left: (x - minX) * CELL, top: (y - minY) * CELL, width: CELL, height: CELL }}
                          onClick={() => handleCellClick(x, y)}
                          onTouchEnd={e => { e.stopPropagation(); handleCellClick(x, y); }}
                        />
                      );
                    })}

                    {staged.map(({ x, y, tile }) => (
                      <div
                        key={`staged-${x},${y}`}
                        className="board-cell-wrapper staged-cell"
                        style={{ left: (x - minX) * CELL, top: (y - minY) * CELL }}
                        onClick={() => handleCellClick(x, y)}
                        onTouchEnd={e => { e.stopPropagation(); handleCellClick(x, y); }}
                      >
                        <KwerzoTile shape={tile.shape} color={tile.color} size={CELL} staged />
                      </div>
                    ))}

                    {Object.entries(displayBoard).map(([k, tile]) => {
                      if (tile._staged) return null;
                      const [x, y] = k.split(',').map(Number);
                      const isNew = lastPlacedKeys.has(k);
                      return (
                        <div
                          key={`tile-${k}`}
                          className="board-cell-wrapper"
                          style={{ left: (x - minX) * CELL, top: (y - minY) * CELL }}
                        >
                          <KwerzoTile shape={tile.shape} color={tile.color} size={CELL} highlighted={isNew} />
                        </div>
                      );
                    })}

                  </div>
                </TransformComponent>

                <div className="board-controls">
                  <button className="board-ctrl-btn" onClick={() => zoomIn()}>+</button>
                  <button className="board-ctrl-btn" onClick={() => zoomOut()}>−</button>
                  <button className="board-ctrl-btn" onClick={centerBoard}>⊙</button>
                </div>
              </>
            )}
          </TransformWrapper>
        </main>

      </div>{/* end game-body */}

      {/* ════ MOBILE PRE-GAME PANEL (full screen, replaces board before game starts) ════ */}
      {!gameState && (
        <div className="mob-pregame">
          <h2 className="mob-pregame-title">Room <span className="mob-pregame-roomid">{roomId}</span></h2>

          {/* Player list */}
          <div className="mob-pregame-players">
            {room?.players.map(p => (
              <div key={p.id} className="mob-pregame-player">
                <span className="mob-pregame-pname">
                  {p.username}{String(p.id) === String(user?.id) ? ' (you)' : ''}
                </span>
                {p.isBot && <span className={`bot-badge ${p.difficulty}`}>{p.difficulty}</span>}
              </div>
            ))}
            {(room?.players.length ?? 0) < 4 && (
              <div className="mob-pregame-player mob-pregame-empty">
                Waiting for player…
              </div>
            )}
          </div>

          {/* Host controls */}
          {isHost && (
            <>
              <div className="mob-pregame-section-label">Add a bot opponent</div>
              <div className="add-bot-row" style={{ marginBottom: 8 }}>
                <select
                  className="bot-diff-select"
                  value={botDifficulty}
                  onChange={e => setBotDifficulty(e.target.value)}
                  style={{ flex: 1 }}
                >
                  <option value="easy">Easy Bot (Joe)</option>
                  <option value="medium">Medium Bot</option>
                  <option value="hard">Hard Bot (John)</option>
                </select>
                <button
                  className="btn-secondary"
                  disabled={room?.players.length >= 4}
                  onClick={() => socket.emit('add_bot', { roomId, difficulty: botDifficulty })}
                >+ Add Bot</button>
              </div>

              {room?.players.length < 2 ? (
                <div className="mob-wait" style={{ textAlign: 'center', padding: '12px 0' }}>
                  Need at least 2 players to start
                </div>
              ) : (
                <button
                  className="btn-primary"
                  style={{ width: '100%', padding: '14px', fontSize: 16, marginTop: 4 }}
                  onClick={() => socket.emit('start_game', { roomId })}
                >
                  Start Game →
                </button>
              )}
            </>
          )}

          {!isHost && (
            <div className="mob-wait" style={{ textAlign: 'center', padding: '16px 0', fontSize: 14 }}>
              Waiting for the host to start the game…
            </div>
          )}

          <button className="btn-ghost" style={{ width: '100%', marginTop: 12 }} onClick={handleLeave}>
            Leave Room
          </button>
        </div>
      )}

      {/* ════ MOBILE STATUS + ACTIONS (hidden on desktop, shown during game) ════ */}
      {gameState && (
        <div className="mob-status">
          {moveError && <span className="mob-err">{moveError}</span>}
          {!moveError && lastMsg && <span className="mob-ok">{lastMsg}</span>}
          {!moveError && !lastMsg && !myTurn && (
            <span className="mob-wait">Waiting for {currentTurnPlayer?.username}…</span>
          )}
        </div>
      )}

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
        {(trayOrder.length === myHand.length ? trayOrder : myHand.map((_, i) => i)).map(origIdx => {
          const tile     = myHand[origIdx];
          if (!tile) return null;
          const used     = staged.some(s => s.handIdx === origIdx);
          const swapSel  = swapSelection.includes(origIdx);
          const isSelected = selectedHandIdx === origIdx;
          const isDragging = dragTrayIdx === origIdx;
          return (
            <div
              key={origIdx}
              className={`hand-slot${used ? ' used' : ''}${swapSel ? ' swap-selected' : ''}${isSelected ? ' selected-slot' : ''}${isDragging ? ' dragging-tile' : ''}`}
              draggable
              onDragStart={() => onTrayDragStart(origIdx)}
              onDragEnter={() => onTrayDragEnter(origIdx)}
              onDragEnd={onTrayDragEnd}
              onDragOver={e => e.preventDefault()}
              onClick={() => {
                if (swapMode) {
                  setSwapSelection(prev => prev.includes(origIdx) ? prev.filter(x => x !== origIdx) : [...prev, origIdx]);
                  return;
                }
                if (!myTurn || used) return;
                setSelectedHandIdx(prev => prev === origIdx ? null : origIdx);
                setMoveError('');
              }}
            >
              <KwerzoTile shape={tile.shape} color={tile.color} size={CELL} selected={isSelected} />
            </div>
          );
        })}
      </div>

    </div>
  );
}
