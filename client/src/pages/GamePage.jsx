import React, { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import KwerzoTile from '../components/KwerzoTile';
import AddPlayersPanel from '../components/AddPlayersPanel';
import { playKwerzoSound, playKwerzoFanfare, playBellSound, prewarmVoices, unlockAudio } from '../lib/kwerzoSound';
import { previewScore } from '../lib/kwerzoScoring';
import NotificationCenter from '../components/NotificationCenter';
import AdUnit from '../components/AdUnit';

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
  const [lastMoveByPlayer, setLastMoveByPlayer] = useState({});
  const [lastScoreByPlayer, setLastScoreByPlayer] = useState({}); // { [playerId]: { points, kwerzo } }
  const [moveError,       setMoveError]       = useState('');
  const [gameOver,        setGameOver]        = useState(null);
  const [isMobile,        setIsMobile]        = useState(
    () => window.innerWidth < 1024
  );
  const [trayOrder,       setTrayOrder]       = useState([]);
  const [dragTrayIdx,     setDragTrayIdx]     = useState(null);
  const [showTurnOverlay, setShowTurnOverlay] = useState(false);
  const [botThinking,     setBotThinking]     = useState(null); // { botId, username } | null
  const [boardScorePopup, setBoardScorePopup] = useState(null); // { points, kwerzo, placements } | null
  const [lastPlacementsByPlayer, setLastPlacementsByPlayer] = useState({}); // { [playerId]: Set<"x,y"> }
  const prevMyTurn = useRef(false);
  const transformRef = useRef(null);
  const trayRef = useRef(null);
  const gameStateRef = useRef(null);
  const scorePopupTimerRef = useRef(null);
  const lastMoverIdRef = useRef(null);
  const roundMovers = useRef(new Set());
  const pendingRoundMsgs = useRef([]);
  const pendingBoardPopupRef = useRef(null);

  const PLAYER_COLORS = ['#7c3aed', '#e91e63', '#10b981', '#f59e0b'];
  const playerColorMap = {};
  (room?.players || []).forEach((p, i) => {
    playerColorMap[p.id] = PLAYER_COLORS[i % PLAYER_COLORS.length];
  });

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Pre-warm TTS voices so they're ready when a Kwerzo is scored
  useEffect(() => { prewarmVoices(); }, []);

  // Hard-lock iOS scroll. iOS Safari expands the scroll area for CSS transforms
  // even inside overflow:hidden containers, causing window.scrollX to drift when
  // the board is panned. Three layers of defence:
  useEffect(() => {
    // 1. Prevent touch-driven scroll
    const preventScroll = (e) => {
      if (e.target.closest('.mob-pregame') || e.target.closest('.mob-scores')) return;
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

  // Touch-drag reorder for iOS Safari — document-level listeners.
  // Document-level is more reliable than element-level: touchmove is always
  // delivered here even if the finger moves outside the original target.
  // Bug fix: dragOrigIdx is NEVER updated mid-drag — we always reorder the
  // tile we started dragging, not whatever tile we last swapped with.
  useEffect(() => {
    let dragOrigIdx = null; // origIdx of the tile being dragged — NEVER changes mid-drag
    let startX = 0, startY = 0;
    let isDragging = false;
    const THRESHOLD = 10;

    function onTouchStart(e) {
      const slot = e.target.closest('[data-origidx]');
      if (!slot) { dragOrigIdx = null; return; }
      dragOrigIdx = parseInt(slot.dataset.origidx);
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isDragging = false;
      setDragTrayIdx(dragOrigIdx);
    }

    function onTouchMove(e) {
      if (dragOrigIdx === null) return;
      const t = e.touches[0];
      if (!isDragging) {
        if (Math.abs(t.clientX - startX) < THRESHOLD && Math.abs(t.clientY - startY) < THRESHOLD) return;
        isDragging = true;
      }
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const slot = el?.closest('[data-origidx]');
      if (!slot) return;
      const toIdx = parseInt(slot.dataset.origidx);
      if (isNaN(toIdx) || toIdx === dragOrigIdx) return;
      setTrayOrder(prev => {
        const next = [...prev];
        const from = next.indexOf(dragOrigIdx); // where the dragged tile currently is
        const to   = next.indexOf(toIdx);       // where the hovered tile currently is
        if (from === -1 || to === -1) return prev;
        next.splice(from, 1);
        next.splice(to, 0, dragOrigIdx);
        return next;
      });
      // *** Do NOT update dragOrigIdx — always track the same original tile ***
    }

    function onTouchEnd() {
      dragOrigIdx = null;
      isDragging = false;
      setDragTrayIdx(null);
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove',  onTouchMove,  { passive: true });
    document.addEventListener('touchend',   onTouchEnd,   { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove',  onTouchMove);
      document.removeEventListener('touchend',   onTouchEnd);
    };
  }, []);

  // hostId can be a number or string depending on whether the room was loaded
  // from the DB (TEXT column) or created fresh in memory. Normalise to string.
  const isHost = String(room?.hostId) === String(user?.id);

  const myTurn   = gameState && gameState.players[gameState.currentPlayerIndex]?.id === user.id;
  const myPlayer = gameState?.players.find(p => p.id === user.id);
  const myHand   = myPlayer?.hand || [];

  const displayBoard = { ...(gameState?.board || {}) };
  for (const { x, y, tile } of staged) displayBoard[`${x},${y}`] = { ...tile, _staged: true };

  const lastPlacedKeys = new Set((gameState?.lastPlacements || []).map(p => `${p.x},${p.y}`));

  // ── Reveal newly-placed tiles one-by-one (human or bot moves) ──────────────
  const [hiddenKeys, setHiddenKeys] = useState(new Set());
  const [revealedKeys, setRevealedKeys] = useState(new Set());
  const lastMoveAtRef = useRef(null);
  const firstStateRef = useRef(true);

  useEffect(() => {
    if (!gameState) return;
    const placements = gameState.lastPlacements || [];

    // Don't animate on initial load/reconnect — just record the baseline.
    if (firstStateRef.current) {
      firstStateRef.current = false;
      lastMoveAtRef.current = gameState.lastMoveAt;
      return;
    }

    if (placements.length < 1 || gameState.lastMoveAt === lastMoveAtRef.current) return;
    lastMoveAtRef.current = gameState.lastMoveAt;

    // Reveal in reading order (left-to-right, top-to-bottom)
    const sorted = [...placements].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const keys = sorted.map(p => `${p.x},${p.y}`);

    setHiddenKeys(new Set(keys));
    setRevealedKeys(new Set());

    keys.forEach((k, i) => {
      setTimeout(() => {
        setHiddenKeys(prev => { const next = new Set(prev); next.delete(k); return next; });
        setRevealedKeys(prev => new Set(prev).add(k));
      }, (i + 1) * 220);
    });
  }, [gameState?.lastMoveAt]);

  // Rebuild tray order when hand changes — preserve user's arrangement,
  // match surviving tiles by shape+color, fill played-tile slots with new draws.
  const prevHandRef2 = useRef(null);
  const prevHandKeyRef = useRef('');
  useEffect(() => {
    const key = myHand.map(t => `${t?.shape}|${t?.color}`).join(',');
    if (key === prevHandKeyRef.current) return; // tiles unchanged, nothing to do
    prevHandKeyRef.current = key;

    const prevHand = prevHandRef2.current;
    setTrayOrder(prevOrder => {
      if (!prevHand || prevOrder.length === 0) {
        return myHand.map((_, i) => i); // first deal — default order
      }
      // Map each old tile index → new hand index (by shape+color, first-match)
      const usedNew = new Set();
      const oldToNew = {};
      for (let pi = 0; pi < prevHand.length; pi++) {
        for (let ni = 0; ni < myHand.length; ni++) {
          if (!usedNew.has(ni) &&
              myHand[ni]?.shape === prevHand[pi]?.shape &&
              myHand[ni]?.color === prevHand[pi]?.color) {
            oldToNew[pi] = ni;
            usedNew.add(ni);
            break;
          }
        }
      }
      // Newly drawn tiles (not matched to anything in prevHand)
      const brandNew = myHand.map((_, i) => i).filter(i => !usedNew.has(i));
      let ptr = 0;
      const result = [];
      for (const oldIdx of prevOrder) {
        if (oldToNew[oldIdx] !== undefined) {
          result.push(oldToNew[oldIdx]);    // tile survived — keep its position
        } else if (ptr < brandNew.length) {
          result.push(brandNew[ptr++]);     // played slot → fill with new draw
        }
        // if hand shrunk and no new tile available, slot is dropped
      }
      while (ptr < brandNew.length) result.push(brandNew[ptr++]); // append any extras
      return result;
    });
    prevHandRef2.current = myHand;
  });

  // Show "Your Turn" overlay when turn transitions to local player
  useEffect(() => {
    if (myTurn && !prevMyTurn.current) {
      setShowTurnOverlay(true);
    }
    prevMyTurn.current = myTurn;
  }, [myTurn]);

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

      // Track last placements per player for color highlighting
      const moverId = lastMoverIdRef.current;
      if (moverId && state.lastPlacements?.length) {
        setLastPlacementsByPlayer(prev => ({
          ...prev,
          [String(moverId)]: new Set(state.lastPlacements.map(p => `${p.x},${p.y}`)),
        }));
        // Show board score popup immediately for own moves (before any round delay)
        if (pendingBoardPopupRef.current && String(moverId) === String(user.id) && state.lastPlacements?.length) {
          const popup = { ...pendingBoardPopupRef.current, placements: state.lastPlacements };
          pendingBoardPopupRef.current = null;
          if (scorePopupTimerRef.current) clearTimeout(scorePopupTimerRef.current);
          setBoardScorePopup(popup);
          scorePopupTimerRef.current = setTimeout(() => setBoardScorePopup(null), 2200);
        }
      }

      setGameState(state);
      setStaged([]);
      setSelectedHandIdx(null);
      setSwapMode(false);
      setSwapSelection([]);
      setMoveError('');
      setBotThinking(null);

      // Flush round text summary after all players have moved once
      const totalPlayers = state.players.length;
      if (roundMovers.current.size >= totalPlayers) {
        if (pendingRoundMsgs.current.length) {
          setLastMsg(pendingRoundMsgs.current.join(' · '));
          pendingRoundMsgs.current = [];
        }
        pendingBoardPopupRef.current = null;
        roundMovers.current = new Set();
      }
    });
    socket.on('bot_thinking', ({ roomId: id, botId, username }) => {
      if (id !== roomId) return;
      setBotThinking({ botId, username });
    });
    socket.on('move_made', ({ roomId: id, userId: moverId, username, points, type, count, kwerzo }) => {
      if (id !== roomId) return;
      const isOwnMove = moverId && String(moverId) === String(user.id);
      const who = isOwnMove ? 'You' : username;
      let msg;
      if      (type === 'swap') msg = `${who} swapped ${count} tile${count !== 1 ? 's' : ''}`;
      else if (type === 'pass') msg = `${who} passed`;
      else                      msg = `${who} scored ${points} pt${points !== 1 ? 's' : ''}${kwerzo ? ' — Kwerzo! 🎉' : ''}`;

      // Store mover so game_update can correlate placements to this player
      lastMoverIdRef.current = moverId;

      // Buffer message — will be shown after all players in this round have moved
      if (moverId) {
        roundMovers.current.add(String(moverId));
        pendingRoundMsgs.current.push(msg);
      }

      if (moverId) setLastMoveByPlayer(prev => ({ ...prev, [moverId]: msg }));
      if (moverId && type === undefined && typeof points === 'number') {
        setLastScoreByPlayer(prev => ({ ...prev, [moverId]: { points, kwerzo: !!kwerzo } }));
      }
      if (kwerzo) { playKwerzoSound(); playKwerzoFanfare(); }
      setBotThinking(null);

      // Buffer board score popup for own place moves — placements arrive in game_update
      if (isOwnMove && type === undefined && typeof points === 'number') {
        pendingBoardPopupRef.current = { points, kwerzo: !!kwerzo };
      }
    });
    socket.on('move_error', (err) => { setMoveError(err); setStaged([]); setBotThinking(null); });
    socket.on('game_over',  (data) => {
      // Flush any buffered round messages before showing game over
      if (pendingRoundMsgs.current.length) {
        setLastMsg(pendingRoundMsgs.current.join(' · '));
        pendingRoundMsgs.current = [];
      }
      roundMovers.current = new Set();
      pendingBoardPopupRef.current = null;
      setGameOver(data);
      setBotThinking(null);
    });
    socket.on('room_deleted', ({ roomId: id }) => { if (id === roomId) onLeave(); });
    return () => {
      socket.off('room_update');
      socket.off('game_started');
      socket.off('game_update');
      socket.off('bot_thinking');
      socket.off('move_made');
      socket.off('move_error');
      socket.off('game_over');
      socket.off('room_deleted');
      if (scorePopupTimerRef.current) clearTimeout(scorePopupTimerRef.current);
    };
  }, [socket]);

  // ── Center board once when it first gets tiles; never re-center after ────────
  const boardCenteredRef = useRef(false);
  useEffect(() => {
    if (boardCenteredRef.current) return;
    const tileCount = Object.keys(gameState?.board || {}).length;
    if (tileCount === 0) return;
    boardCenteredRef.current = true;
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

  const trayTileSize = isMobile
    ? Math.min(CELL, Math.floor((window.innerWidth - 24 - 5 * 8) / 6))
    : CELL;

  const validDropCells    = getValidDropCells();

  // Live "potential score" preview for the tiles currently staged for placement
  const scorePreview = staged.length > 0 ? previewScore(gameState?.board || {}, staged) : null;

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
            {[...gameOver.players].sort((a, b) => b.score - a.score).map((p, i) => {
              const lastScore = lastScoreByPlayer[p.id];
              return (
                <div key={p.id} className={`score-row ${gameOver.winners.includes(p.id) ? 'winner' : ''}`}>
                  <span className="rank">{i + 1}</span>
                  <div className="pname-col">
                    <span className="pname">{p.username}</span>
                    {lastScore && (
                      <span className="plast-score">
                        Last move: +{lastScore.points}{lastScore.kwerzo ? ' — Kwerzo! 🎉' : ''}
                      </span>
                    )}
                  </div>
                  <span className="pscore">{p.score} pts</span>
                  {gameOver.winners.includes(p.id) && <span className="crown">👑</span>}
                </div>
              );
            })}
          </div>
          <AdUnit style={{ marginTop: 8, marginBottom: 8 }} />
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
        <div className="mob-header-top">
          <span className="mob-logo"><span className="logo-k">K</span>wer<span className="logo-z">z</span>o</span>
          <div className="mob-header-right">
            {gameState && <span className="mob-bag">🎒 {gameState.bag} left</span>}
            <NotificationCenter socket={socket} user={user} />
            <button className="mob-leave-btn" onClick={handleLeave}>✕</button>
          </div>
        </div>
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
        </div>
      </header>

      {/* ════ MAIN BODY: sidebar + board (hidden on mobile pre-game) ════ */}
      <div className={`game-body${!gameState && isMobile ? ' mob-hidden' : ''}`}>

        {/* ── Desktop sidebar — only rendered when not mobile ── */}
        {!isMobile && <aside className="game-sidebar">
          <div className="sidebar-logo-row">
            <div className="sidebar-logo"><span className="logo-k">K</span>wer<span className="logo-z">z</span>o</div>
            <NotificationCenter socket={socket} user={user} />
          </div>

          <div className="players-panel">
            {room?.players.map(rp => {
              const gp            = gameState?.players.find(p => p.id === rp.id);
              const isCurrentTurn = gameState?.players[gameState.currentPlayerIndex]?.id === rp.id;
              return (
                <div key={rp.id} className={`player-row ${isCurrentTurn ? 'active-turn' : ''} ${rp.id === user.id ? 'me' : ''}`}>
                  <div className="player-name">
                    {isCurrentTurn && <span className="turn-arrow">▶</span>}
                    <span
                      className="player-color-dot"
                      style={{ background: playerColorMap[rp.id] }}
                    />
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
          {botThinking && <div className="bot-thinking">🤔 {botThinking.username} is thinking…</div>}
          {!botThinking && lastMsg   && <div className="last-msg">{lastMsg}</div>}
          {moveError && <div className="move-error">{moveError}</div>}

          <div className="game-actions">
            {!gameState && isHost && (
              <AddPlayersPanel socket={socket} roomId={roomId} room={room} style={{ marginBottom: 8 }} />
            )}
            {!gameState && (
              room?.players.length < 2
                ? <div className="waiting-msg">Waiting for players…</div>
                : isHost
                  ? <button className="btn-primary" onClick={() => socket.emit('start_game', { roomId })}>Start Game</button>
                  : <div className="waiting-msg">Waiting for host…</div>
            )}
            {gameState && !myTurn && !botThinking && (
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
                          onTouchEnd={e => { e.preventDefault(); e.stopPropagation(); handleCellClick(x, y); }}
                        />
                      );
                    })}

                    {staged.map(({ x, y, tile }) => (
                      <div
                        key={`staged-${x},${y}`}
                        className="board-cell-wrapper staged-cell"
                        style={{ left: (x - minX) * CELL, top: (y - minY) * CELL }}
                        onClick={() => handleCellClick(x, y)}
                        onTouchEnd={e => { e.preventDefault(); e.stopPropagation(); handleCellClick(x, y); }}
                      >
                        <KwerzoTile shape={tile.shape} color={tile.color} size={CELL} staged />
                      </div>
                    ))}

                    {scorePreview && (() => {
                      const xs = staged.map(p => p.x);
                      const ys = staged.map(p => p.y);
                      const cx = (Math.min(...xs) + Math.max(...xs) + 1) / 2;
                      const top = Math.min(...ys);
                      return (
                        <div
                          className={`score-preview-popup${scorePreview.kwerzo ? ' kwerzo' : ''}`}
                          style={{ left: (cx - minX) * CELL, top: (top - minY) * CELL }}
                        >
                          {scorePreview.kwerzo ? `Kwerzo! +${scorePreview.points}` : `+${scorePreview.points}`}
                        </div>
                      );
                    })()}

                    {Object.entries(displayBoard).map(([k, tile]) => {
                      if (tile._staged) return null;
                      if (hiddenKeys.has(k)) return null; // not yet revealed
                      const [x, y] = k.split(',').map(Number);
                      const isNew = lastPlacedKeys.has(k);
                      const justRevealed = revealedKeys.has(k);

                      // Find which player last placed this tile (for color highlight)
                      let playerColor = null;
                      for (const [pid, placedSet] of Object.entries(lastPlacementsByPlayer)) {
                        if (placedSet.has(k)) { playerColor = playerColorMap[pid]; break; }
                      }

                      return (
                        <div
                          key={`tile-${k}`}
                          className="board-cell-wrapper"
                          style={{
                            left: (x - minX) * CELL,
                            top: (y - minY) * CELL,
                            ...(playerColor ? {
                              outline: `3px solid ${playerColor}`,
                              outlineOffset: '-2px',
                              borderRadius: 5,
                              zIndex: 1,
                            } : {}),
                          }}
                        >
                          <KwerzoTile
                            shape={tile.shape}
                            color={tile.color}
                            size={CELL}
                            highlighted={isNew}
                            className={justRevealed ? 'tile-reveal' : ''}
                          />
                        </div>
                      );
                    })}

                    {boardScorePopup && (() => {
                      const xs = boardScorePopup.placements.map(p => p.x);
                      const ys = boardScorePopup.placements.map(p => p.y);
                      const cx = (Math.min(...xs) + Math.max(...xs) + 1) / 2;
                      const top = Math.min(...ys);
                      return (
                        <div
                          className={`board-score-popup${boardScorePopup.kwerzo ? ' kwerzo' : ''}`}
                          style={{ left: (cx - minX) * CELL, top: (top - minY) * CELL }}
                        >
                          {boardScorePopup.kwerzo ? `Kwerzo! +${boardScorePopup.points}` : `+${boardScorePopup.points}`}
                        </div>
                      );
                    })()}

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
              <div className="mob-pregame-section-label">Add players</div>
              <AddPlayersPanel socket={socket} roomId={roomId} room={room} style={{ marginBottom: 12 }} />

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
          {!moveError && botThinking && <span className="mob-wait bot-thinking">🤔 {botThinking.username} is thinking…</span>}
          {!moveError && !botThinking && lastMsg && <span className="mob-ok">{lastMsg}</span>}
          {!moveError && !botThinking && !lastMsg && !myTurn && (
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

      {/* ════ YOUR TURN OVERLAY ════ */}
      {showTurnOverlay && gameState && (
        <div className="turn-overlay" onClick={() => { unlockAudio(); setShowTurnOverlay(false); }} onTouchStart={() => { unlockAudio(); setShowTurnOverlay(false); }}>
          <div className="turn-overlay-msg">
            <div className="turn-overlay-title">⚡ Your Turn!</div>
            <div className="turn-overlay-tap-hint">Tap anywhere to continue</div>
            {room?.players.some(rp => lastMoveByPlayer[rp.id]) && (
              <div className="turn-overlay-tiles">
                <div className="turn-overlay-tiles-label">Last moves:</div>
                {room.players.map(rp => (
                  lastMoveByPlayer[rp.id] && (
                    <div key={rp.id} className="turn-overlay-tile-row">
                      <span>{lastMoveByPlayer[rp.id]}</span>
                    </div>
                  )
                ))}
              </div>
            )}
            {gameState.bag === 0 && (
              <div className="turn-overlay-tiles">
                <div className="turn-overlay-tiles-label">🎒 Bag empty — tiles remaining:</div>
                {room?.players.map(rp => {
                  const gp = gameState.players.find(p => p.id === rp.id);
                  const count = rp.id === user.id ? myHand.length : (gp?.handSize ?? 0);
                  return (
                    <div key={rp.id} className="turn-overlay-tile-row">
                      <span>{rp.username}{rp.id === user.id ? ' (you)' : ''}</span>
                      <span>{count} tile{count !== 1 ? 's' : ''}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════ TILE TRAY — always full width, single row ════ */}
      <div className="tile-tray" ref={trayRef}>
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
              data-origidx={origIdx}
              draggable
              onDragStart={() => onTrayDragStart(origIdx)}
              onDragEnter={() => onTrayDragEnter(origIdx)}
              onDragEnd={onTrayDragEnd}
              onDragOver={e => e.preventDefault()}
              onClick={() => {
                // Swap-select only during your turn
                if (swapMode && myTurn) {
                  setSwapSelection(prev => prev.includes(origIdx) ? prev.filter(x => x !== origIdx) : [...prev, origIdx]);
                  return;
                }
                // Allow tile selection any time (for planning) but skip used slots
                if (used) return;
                unlockAudio(); // ensure TTS + AudioContext are unlocked on first tap
                setSelectedHandIdx(prev => prev === origIdx ? null : origIdx);
                if (myTurn) setMoveError('');
              }}
            >
              <KwerzoTile shape={tile.shape} color={tile.color} size={trayTileSize} selected={isSelected} />
            </div>
          );
        })}
      </div>

    </div>
  );
}
