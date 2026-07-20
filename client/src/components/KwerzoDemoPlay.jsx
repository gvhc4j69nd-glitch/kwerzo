import React, { useEffect, useState, useRef } from 'react';
import KwerzoTile from './KwerzoTile';

const CELL = 52;
const COLS = 7;
const ROWS = 6;

const PLAYER_COLORS = ['#7c3aed', '#e91e63', '#10b981'];

const PLAYERS = [
  { id: 1, name: 'Alice',  color: PLAYER_COLORS[0], isMe: true  },
  { id: 2, name: 'Marcus', color: PLAYER_COLORS[1], isMe: false },
  { id: 3, name: 'Sofia',  color: PLAYER_COLORS[2], isMe: false },
];

// Each move: who plays, what tiles, score, and what their full hand looks like before the move
const SCRIPT = [
  // ── Round 1 ──
  {
    playerId: 1, round: 1,
    tiles: [
      { x:1, y:2, shape:'star', color:'sapphire' },
      { x:2, y:2, shape:'star', color:'jade' },
      { x:3, y:2, shape:'star', color:'amber' },
    ],
    points: 3, kwerzo: false,
    hand: [
      { shape:'star', color:'sapphire' },
      { shape:'star', color:'jade' },
      { shape:'star', color:'amber' },
      { shape:'moon', color:'ruby' },
      { shape:'hex',  color:'coral' },
      { shape:'bolt', color:'amethyst' },
    ],
    handSizes: { 2: 6, 3: 6 },
    bag: 72,
    status: '▶ Alice\'s turn',
  },
  {
    playerId: 2, round: 1,
    tiles: [
      { x:1, y:3, shape:'moon', color:'sapphire' },
      { x:1, y:4, shape:'bolt', color:'sapphire' },
    ],
    points: 3, kwerzo: false,
    hand: [
      { shape:'moon',  color:'sapphire' },
      { shape:'bolt',  color:'sapphire' },
      { shape:'hex',   color:'coral' },
      { shape:'leaf',  color:'amethyst' },
      { shape:'heart', color:'ruby' },
      { shape:'star',  color:'jade' },
    ],
    handSizes: { 1: 3, 3: 6 },
    bag: 69,
    status: 'Marcus placed 2 tiles · +3 pts',
  },
  {
    playerId: 3, round: 1,
    tiles: [
      { x:4, y:2, shape:'star', color:'coral' },
      { x:5, y:2, shape:'star', color:'amethyst' },
    ],
    points: 5, kwerzo: false,
    hand: [
      { shape:'star',  color:'coral' },
      { shape:'star',  color:'amethyst' },
      { shape:'heart', color:'jade' },
      { shape:'bolt',  color:'ruby' },
      { shape:'moon',  color:'sapphire' },
      { shape:'hex',   color:'amber' },
    ],
    handSizes: { 1: 3, 2: 4 },
    bag: 67,
    status: 'Sofia\'s turn',
  },
  // ── Round 2 ──
  {
    playerId: 1, round: 2,
    tiles: [
      { x:2, y:0, shape:'hex',  color:'jade' },
      { x:2, y:1, shape:'moon', color:'jade' },
    ],
    points: 4, kwerzo: false,
    hand: [
      { shape:'moon',  color:'ruby' },
      { shape:'hex',   color:'coral' },
      { shape:'bolt',  color:'amethyst' },
      { shape:'hex',   color:'jade' },
      { shape:'moon',  color:'jade' },
      { shape:'heart', color:'amber' },
    ],
    handSizes: { 2: 4, 3: 4 },
    bag: 65,
    status: '▶ Alice\'s turn',
  },
  {
    playerId: 2, round: 2,
    tiles: [
      { x:3, y:0, shape:'leaf', color:'amber' },
      { x:3, y:1, shape:'bolt', color:'amber' },
    ],
    points: 4, kwerzo: false,
    hand: [
      { shape:'hex',   color:'coral' },
      { shape:'leaf',  color:'amethyst' },
      { shape:'heart', color:'ruby' },
      { shape:'star',  color:'jade' },
      { shape:'leaf',  color:'amber' },
      { shape:'bolt',  color:'amber' },
    ],
    handSizes: { 1: 4, 3: 4 },
    bag: 63,
    status: 'Alice placed 2 tiles · +4 pts',
  },
  {
    playerId: 3, round: 2,
    tiles: [
      { x:4, y:3, shape:'moon', color:'coral' },
      { x:4, y:4, shape:'bolt', color:'coral' },
    ],
    points: 3, kwerzo: false,
    hand: [
      { shape:'heart', color:'jade' },
      { shape:'bolt',  color:'ruby' },
      { shape:'moon',  color:'sapphire' },
      { shape:'hex',   color:'amber' },
      { shape:'moon',  color:'coral' },
      { shape:'bolt',  color:'coral' },
    ],
    handSizes: { 1: 4, 2: 4 },
    bag: 61,
    status: 'Sofia\'s turn',
  },
  // ── Round 3 ──
  {
    playerId: 1, round: 3,
    tiles: [
      { x:0, y:2, shape:'star', color:'ruby' },
    ],
    points: 12, kwerzo: true,
    hand: [
      { shape:'moon',  color:'ruby' },
      { shape:'hex',   color:'coral' },
      { shape:'bolt',  color:'amethyst' },
      { shape:'heart', color:'amber' },
      { shape:'star',  color:'ruby' },
      { shape:'leaf',  color:'sapphire' },
    ],
    handSizes: { 2: 4, 3: 4 },
    bag: 59,
    status: '▶ Alice\'s turn — KWERZO incoming!',
  },
  {
    playerId: 2, round: 3,
    tiles: [
      { x:5, y:3, shape:'moon',  color:'amethyst' },
      { x:5, y:4, shape:'heart', color:'amethyst' },
    ],
    points: 4, kwerzo: false,
    hand: [
      { shape:'hex',   color:'coral' },
      { shape:'leaf',  color:'amethyst' },
      { shape:'heart', color:'ruby' },
      { shape:'star',  color:'jade' },
      { shape:'moon',  color:'amethyst' },
      { shape:'heart', color:'amethyst' },
    ],
    handSizes: { 1: 5, 3: 4 },
    bag: 57,
    status: 'Alice · KWERZO! · +12 pts 🎉',
  },
  {
    playerId: 3, round: 3,
    tiles: [
      { x:1, y:5, shape:'hex', color:'sapphire' },
      { x:2, y:5, shape:'hex', color:'jade' },
    ],
    points: 5, kwerzo: false,
    hand: [
      { shape:'heart', color:'jade' },
      { shape:'bolt',  color:'ruby' },
      { shape:'moon',  color:'sapphire' },
      { shape:'hex',   color:'amber' },
      { shape:'hex',   color:'sapphire' },
      { shape:'hex',   color:'jade' },
    ],
    handSizes: { 1: 5, 2: 4 },
    bag: 55,
    status: 'Marcus placed 2 tiles · +4 pts',
  },
];

const TILE_DELAY  = 500;
const SCORE_HOLD  = 2200;
const TURN_GAP    = 700;
const RESET_PAUSE = 3500;

export default function KwerzoDemoPlay() {
  const [boardTiles,    setBoardTiles]    = useState({});
  const [scores,        setScores]        = useState({ 1: 0, 2: 0, 3: 0 });
  const [moveIndex,     setMoveIndex]     = useState(0);
  const [revealKey,     setRevealKey]     = useState(null);
  const [scorePopup,    setScorePopup]    = useState(null);
  const [highlightKeys, setHighlightKeys] = useState(new Set());
  const [statusMsg,     setStatusMsg]     = useState('');

  const move        = SCRIPT[moveIndex];
  const activePlayer = PLAYERS.find(p => p.id === move.playerId);
  const mePlayer     = PLAYERS[0]; // Alice = "me" for tray display
  const myTurn       = move.playerId === mePlayer.id;

  // Show hand of the active player
  const displayHand = move.hand;
  // Which tiles in the hand are currently "placed" (show as used)
  const placedInMove = scorePopup
    ? new Set(move.tiles.map(t => `${t.shape}:${t.color}`))
    : new Set();

  useEffect(() => {
    let cancelled = false;
    const timeouts = [];
    const schedule = (fn, ms) => {
      const t = setTimeout(() => { if (!cancelled) fn(); }, ms);
      timeouts.push(t);
    };

    function runMove(idx) {
      if (cancelled) return;
      if (idx >= SCRIPT.length) {
        schedule(() => {
          setBoardTiles({});
          setScores({ 1: 0, 2: 0, 3: 0 });
          setMoveIndex(0);
          setScorePopup(null);
          setHighlightKeys(new Set());
          setStatusMsg('');
          schedule(() => runMove(0), 600);
        }, RESET_PAUSE);
        return;
      }

      const m = SCRIPT[idx];
      setMoveIndex(idx);
      setScorePopup(null);
      setHighlightKeys(new Set());
      setStatusMsg(m.status);

      m.tiles.forEach((tile, i) => {
        schedule(() => {
          const k = `${tile.x},${tile.y}`;
          setBoardTiles(prev => ({ ...prev, [k]: { ...tile, playerId: m.playerId } }));
          setRevealKey(k);
        }, (i + 1) * TILE_DELAY);
      });

      const afterTiles = (m.tiles.length + 1) * TILE_DELAY;

      schedule(() => {
        setHighlightKeys(new Set(m.tiles.map(t => `${t.x},${t.y}`)));
        setScorePopup({ points: m.points, kwerzo: m.kwerzo, playerId: m.playerId,
          x: m.tiles.at(-1).x, y: m.tiles.at(-1).y });
        setScores(prev => ({ ...prev, [m.playerId]: prev[m.playerId] + m.points }));
        const nextMsg = SCRIPT[idx + 1]?.status ?? '';
        setStatusMsg(nextMsg || m.status);
      }, afterTiles);

      schedule(() => {
        setScorePopup(null);
        setHighlightKeys(new Set());
        schedule(() => runMove(idx + 1), TURN_GAP);
      }, afterTiles + SCORE_HOLD);
    }

    schedule(() => runMove(0), 800);
    return () => { cancelled = true; timeouts.forEach(clearTimeout); };
  }, []);

  const round = move.round;

  return (
    <div className="gdp-shell">
      {/* ── Sidebar ── */}
      <aside className="gdp-sidebar">
        <div className="gdp-logo-row">
          <div className="gdp-logo"><span className="logo-k">K</span>wer<span className="logo-z">z</span>o</div>
          <span className="gdp-round-chip">Round {round}/3</span>
        </div>

        <div className="gdp-players">
          {PLAYERS.map(p => {
            const isActive = p.id === activePlayer?.id;
            return (
              <div key={p.id} className={`player-row${isActive ? ' active-turn' : ''}${p.isMe ? ' me' : ''}`}>
                <div className="player-name">
                  {isActive && <span className="turn-arrow">▶</span>}
                  <span className="player-color-dot" style={{ background: p.color }} />
                  {p.name}{p.isMe ? ' (you)' : ''}
                </div>
                <div className="player-score">{scores[p.id]} pts</div>
                {!p.isMe && (
                  <div className="hand-size">{move.handSizes?.[p.id] ?? 6} tiles</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="bag-count">🎒 {move.bag} tiles left</div>

        {statusMsg && (
          <div className={`last-msg${scorePopup?.kwerzo ? ' gdp-kwerzo-msg' : ''}`}>
            {statusMsg}
          </div>
        )}

        <div className="game-actions">
          {myTurn && !scorePopup ? (
            <>
              <button className="btn-primary" disabled>Place (3)</button>
              <button className="btn-secondary" disabled>Swap</button>
              <button className="btn-ghost" disabled>Pass</button>
            </>
          ) : (
            <div className="waiting-msg">
              Waiting for {activePlayer?.name}…
            </div>
          )}
          <button className="btn-ghost" style={{ marginTop: 4 }} disabled>Leave</button>
        </div>
      </aside>

      {/* ── Board + Tray ── */}
      <div className="gdp-right">
        <div className="gdp-board-viewport">
          <div className="gdp-board-world">
            {/* Grid cells */}
            {Array.from({ length: COLS * ROWS }).map((_, i) => {
              const x = i % COLS, y = Math.floor(i / COLS);
              return <div key={i} className="gdp-cell"
                style={{ left: x * CELL, top: y * CELL, width: CELL, height: CELL }} />;
            })}

            {/* Placed tiles */}
            {Object.entries(boardTiles).map(([k, tile]) => {
              const [x, y] = k.split(',').map(Number);
              const player = PLAYERS.find(p => p.id === tile.playerId);
              const glow   = highlightKeys.has(k);
              return (
                <div key={k}
                  className={`board-cell-wrapper${k === revealKey ? ' tile-reveal' : ''}`}
                  style={{
                    left: x * CELL, top: y * CELL,
                    ...(glow ? {
                      outline: `3px solid ${player?.color}`,
                      outlineOffset: '-2px',
                      borderRadius: 6,
                      zIndex: 2,
                    } : {}),
                  }}>
                  <KwerzoTile shape={tile.shape} color={tile.color} size={CELL} />
                </div>
              );
            })}

            {/* Score popup */}
            {scorePopup && (
              <div
                className={`board-score-popup${scorePopup.kwerzo ? ' kwerzo' : ''}`}
                style={{
                  left: (scorePopup.x + 0.5) * CELL,
                  top:  Math.max(0, (scorePopup.y - 0.6) * CELL),
                }}>
                {scorePopup.kwerzo
                  ? `✦ KWERZO! +${scorePopup.points}`
                  : `+${scorePopup.points}`}
              </div>
            )}
          </div>
        </div>

        {/* ── Tile Tray ── */}
        <div className="tile-tray">
          <span className="gdp-tray-label">{myTurn ? 'Your hand:' : `${activePlayer?.name}'s hand:`}</span>
          {displayHand.map((tile, i) => {
            const key  = `${tile.shape}:${tile.color}`;
            const used = placedInMove.has(key);
            return (
              <div key={i} className={`hand-slot${used ? ' used' : ''}`}>
                <KwerzoTile shape={tile.shape} color={tile.color} size={52} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
