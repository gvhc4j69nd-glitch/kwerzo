import React, { useEffect, useState } from 'react';
import KwerzoTile from './KwerzoTile';

const CELL = 48;
const COLS = 6;
const ROWS = 5;

const PLAYER_COLORS = ['#7c3aed', '#e91e63', '#10b981'];
const PLAYERS = [
  { id: 1, name: 'Alice',  color: PLAYER_COLORS[0] },
  { id: 2, name: 'Marcus', color: PLAYER_COLORS[1] },
  { id: 3, name: 'Sofia',  color: PLAYER_COLORS[2] },
];

const SCRIPT = [
  // Round 1
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
    bag: 72,
    status: '▶ Your turn',
    statusClass: 'mob-ok',
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
    bag: 69,
    status: 'Marcus placed 2 · +3 pts',
    statusClass: 'mob-ok',
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
    bag: 67,
    status: 'Waiting for Sofia…',
    statusClass: 'mob-wait',
  },
  // Round 2
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
    bag: 65,
    status: '▶ Your turn',
    statusClass: 'mob-ok',
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
    bag: 63,
    status: 'Alice placed 2 · +4 pts',
    statusClass: 'mob-ok',
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
    bag: 61,
    status: 'Waiting for Sofia…',
    statusClass: 'mob-wait',
  },
  // Round 3
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
    bag: 59,
    status: '▶ Your turn — make it count!',
    statusClass: 'mob-ok',
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
    bag: 57,
    status: '✦ KWERZO! Alice · +12 pts',
    statusClass: 'mob-ok',
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
    bag: 55,
    status: 'Waiting for Sofia…',
    statusClass: 'mob-wait',
  },
];

const TILE_DELAY  = 480;
const SCORE_HOLD  = 2000;
const TURN_GAP    = 600;
const RESET_PAUSE = 3200;

export default function KwerzoDemoPlayMobile() {
  const [boardTiles,    setBoardTiles]    = useState({});
  const [scores,        setScores]        = useState({ 1: 0, 2: 0, 3: 0 });
  const [moveIndex,     setMoveIndex]     = useState(0);
  const [revealKey,     setRevealKey]     = useState(null);
  const [scorePopup,    setScorePopup]    = useState(null);
  const [highlightKeys, setHighlightKeys] = useState(new Set());
  const [statusMsg,     setStatusMsg]     = useState('');
  const [statusClass,   setStatusClass]   = useState('mob-wait');

  const move         = SCRIPT[moveIndex];
  const activePlayer = PLAYERS.find(p => p.id === move.playerId);
  const myTurn       = move.playerId === 1;

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
      setStatusClass(m.statusClass);

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
        if (SCRIPT[idx + 1]) {
          setStatusMsg(SCRIPT[idx + 1].status);
          setStatusClass(SCRIPT[idx + 1].statusClass);
        }
      }, afterTiles);

      schedule(() => {
        setScorePopup(null);
        setHighlightKeys(new Set());
        schedule(() => runMove(idx + 1), TURN_GAP);
      }, afterTiles + SCORE_HOLD);
    }

    schedule(() => runMove(0), 600);
    return () => { cancelled = true; timeouts.forEach(clearTimeout); };
  }, []);

  return (
    <div className="gdpm-shell">
      {/* ── Mobile header: logo + bag + scores ── */}
      <div className="gdpm-header">
        <div className="gdpm-header-top">
          <span className="mob-logo"><span className="logo-k">K</span>wer<span className="logo-z">z</span>o</span>
          <span className="gdpm-bag">🎒 {move.bag} left</span>
          <span className="gdpm-round">R{move.round}/3</span>
        </div>
        <div className="mob-scores">
          {PLAYERS.map(p => {
            const isActive = p.id === activePlayer?.id;
            return (
              <span key={p.id} className={`mob-score-chip${isActive ? ' active' : ''}`}
                style={{ borderColor: isActive ? p.color : undefined,
                         color: isActive ? p.color : undefined,
                         background: isActive ? `${p.color}22` : undefined }}>
                {isActive ? '▶ ' : ''}{p.name} {scores[p.id]}
              </span>
            );
          })}
        </div>
      </div>

      {/* ── Board ── */}
      <div className="gdpm-board-viewport">
        <div className="gdpm-board-world">
          {Array.from({ length: COLS * (ROWS + 1) }).map((_, i) => {
            const x = i % COLS, y = Math.floor(i / COLS);
            return <div key={i} className="gdp-cell"
              style={{ left: x * CELL, top: y * CELL, width: CELL, height: CELL }} />;
          })}

          {Object.entries(boardTiles).map(([k, tile]) => {
            const [x, y] = k.split(',').map(Number);
            const player  = PLAYERS.find(p => p.id === tile.playerId);
            const glow    = highlightKeys.has(k);
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

          {scorePopup && (
            <div
              className={`board-score-popup${scorePopup.kwerzo ? ' kwerzo' : ''}`}
              style={{
                left: (scorePopup.x + 0.5) * CELL,
                top:  Math.max(0, (scorePopup.y - 0.7) * CELL),
              }}>
              {scorePopup.kwerzo ? `✦ KWERZO! +${scorePopup.points}` : `+${scorePopup.points}`}
            </div>
          )}
        </div>
      </div>

      {/* ── Status bar ── */}
      <div className="gdpm-status">
        <span className={statusClass}>{statusMsg}</span>
      </div>

      {/* ── Action buttons ── */}
      <div className="gdpm-actions">
        {myTurn && !scorePopup ? (
          <>
            <button className="btn-primary btn-small" disabled>Place (3)</button>
            <button className="btn-secondary btn-small" disabled>Swap</button>
            <button className="btn-ghost btn-small" disabled>Pass</button>
          </>
        ) : (
          <span className="mob-wait">Waiting for {activePlayer?.name}…</span>
        )}
      </div>

      {/* ── Tile tray ── */}
      <div className="tile-tray">
        {move.hand.map((tile, i) => {
          const used = placedInMove.has(`${tile.shape}:${tile.color}`);
          return (
            <div key={i} className={`hand-slot${used ? ' used' : ''}`}>
              <KwerzoTile shape={tile.shape} color={tile.color} size={48} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
