import React, { useEffect, useState } from 'react';
import KwerzoTile from './KwerzoTile';

const CELL = 52;
const COLS = 6;
const ROWS = 5;

const PLAYERS = [
  { id: 1, name: 'Alice',  color: '#7c3aed' },
  { id: 2, name: 'Marcus', color: '#e91e63' },
  { id: 3, name: 'Sofia',  color: '#10b981' },
];

const SCRIPT = [
  // ── Round 1 ──
  {
    playerId: 1,
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
    ],
  },
  {
    playerId: 2,
    tiles: [
      { x:1, y:3, shape:'moon', color:'sapphire' },
      { x:1, y:4, shape:'bolt', color:'sapphire' },
    ],
    points: 3, kwerzo: false,
    hand: [
      { shape:'moon', color:'sapphire' },
      { shape:'bolt', color:'sapphire' },
      { shape:'hex',  color:'coral' },
      { shape:'leaf', color:'amethyst' },
    ],
  },
  {
    playerId: 3,
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
    ],
  },
  // ── Round 2 ──
  {
    playerId: 1,
    tiles: [
      { x:2, y:0, shape:'hex',  color:'jade' },
      { x:2, y:1, shape:'moon', color:'jade' },
    ],
    points: 4, kwerzo: false,
    hand: [
      { shape:'hex',   color:'jade' },
      { shape:'moon',  color:'jade' },
      { shape:'heart', color:'amber' },
      { shape:'star',  color:'ruby' },
    ],
  },
  {
    playerId: 2,
    tiles: [
      { x:3, y:0, shape:'leaf', color:'amber' },
      { x:3, y:1, shape:'bolt', color:'amber' },
    ],
    points: 4, kwerzo: false,
    hand: [
      { shape:'leaf', color:'amber' },
      { shape:'bolt', color:'amber' },
      { shape:'moon', color:'coral' },
      { shape:'hex',  color:'ruby' },
    ],
  },
  {
    playerId: 3,
    tiles: [
      { x:4, y:3, shape:'moon', color:'coral' },
      { x:4, y:4, shape:'bolt', color:'coral' },
    ],
    points: 3, kwerzo: false,
    hand: [
      { shape:'moon',  color:'coral' },
      { shape:'bolt',  color:'coral' },
      { shape:'star',  color:'jade' },
      { shape:'heart', color:'amethyst' },
    ],
  },
  // ── Round 3 ──
  {
    playerId: 1,
    tiles: [
      { x:0, y:2, shape:'star', color:'ruby' },
    ],
    points: 12, kwerzo: true,
    hand: [
      { shape:'star',  color:'ruby' },
      { shape:'bolt',  color:'amethyst' },
      { shape:'heart', color:'coral' },
      { shape:'hex',   color:'jade' },
    ],
  },
  {
    playerId: 2,
    tiles: [
      { x:5, y:3, shape:'moon',  color:'amethyst' },
      { x:5, y:4, shape:'heart', color:'amethyst' },
    ],
    points: 4, kwerzo: false,
    hand: [
      { shape:'moon',  color:'amethyst' },
      { shape:'heart', color:'amethyst' },
      { shape:'bolt',  color:'jade' },
      { shape:'leaf',  color:'sapphire' },
    ],
  },
  {
    playerId: 3,
    tiles: [
      { x:0, y:3, shape:'hex', color:'jade' },
      { x:0, y:4, shape:'hex', color:'amber' },
    ],
    points: 4, kwerzo: false,
    hand: [
      { shape:'hex',  color:'jade' },
      { shape:'hex',  color:'amber' },
      { shape:'moon', color:'ruby' },
      { shape:'star', color:'sapphire' },
    ],
  },
];

const TILE_DELAY  = 480;
const SCORE_HOLD  = 2000;
const TURN_GAP    = 500;
const RESET_PAUSE = 3000;

export default function KwerzoDemoPlay() {
  const [boardTiles,    setBoardTiles]    = useState({});
  const [scores,        setScores]        = useState({ 1: 0, 2: 0, 3: 0 });
  const [moveIndex,     setMoveIndex]     = useState(0);
  const [revealKey,     setRevealKey]     = useState(null);
  const [scorePopup,    setScorePopup]    = useState(null);
  const [highlightKeys, setHighlightKeys] = useState(new Set());

  const round       = Math.floor(moveIndex / 3) + 1;
  const move        = SCRIPT[moveIndex];
  const activePlayer = PLAYERS.find(p => p.id === move.playerId);

  useEffect(() => {
    let cancelled = false;
    const timeouts = [];
    const schedule = (fn, ms) => {
      const t = setTimeout(() => { if (!cancelled) fn(); }, ms);
      timeouts.push(t);
      return t;
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
          schedule(() => runMove(0), 600);
        }, RESET_PAUSE);
        return;
      }

      const m = SCRIPT[idx];
      setMoveIndex(idx);
      setScorePopup(null);
      setHighlightKeys(new Set());

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
    <div className="kdp-wrap">
      {/* Sidebar */}
      <div className="kdp-sidebar">
        <div className="kdp-round-label">Round {round} / 3</div>
        <div className="kdp-players">
          {PLAYERS.map(p => {
            const isActive = p.id === activePlayer?.id;
            return (
              <div key={p.id} className={`kdp-player-row${isActive ? ' kdp-active' : ''}`}>
                <span className="kdp-arrow">{isActive ? '▶' : ' '}</span>
                <span className="kdp-dot" style={{ background: p.color }} />
                <span className="kdp-pname">{p.name}</span>
                <span className="kdp-pscore">{scores[p.id]}</span>
              </div>
            );
          })}
        </div>

        <div className="kdp-hand-label">Hand</div>
        <div className="kdp-hand">
          {move.hand.map((tile, i) => {
            const justPlayed = scorePopup != null &&
              move.tiles.some(t => t.shape === tile.shape && t.color === tile.color);
            return (
              <KwerzoTile key={i} shape={tile.shape} color={tile.color} size={34}
                style={{ opacity: justPlayed ? 0.2 : 1, transition: 'opacity 0.35s' }} />
            );
          })}
        </div>
      </div>

      {/* Board */}
      <div className="kdp-board-outer">
        <div className="kdp-board" style={{ width: COLS * CELL, height: ROWS * CELL }}>
          {Array.from({ length: COLS * ROWS }).map((_, i) => {
            const x = i % COLS, y = Math.floor(i / COLS);
            return <div key={i} className="kdp-cell"
              style={{ left: x * CELL, top: y * CELL, width: CELL, height: CELL }} />;
          })}

          {Object.entries(boardTiles).map(([k, tile]) => {
            const [x, y] = k.split(',').map(Number);
            const player  = PLAYERS.find(p => p.id === tile.playerId);
            const glow    = highlightKeys.has(k);
            return (
              <div key={k}
                className={`kdp-tile-wrap${k === revealKey ? ' tile-reveal' : ''}`}
                style={{
                  left: x * CELL, top: y * CELL, width: CELL, height: CELL,
                  ...(glow ? {
                    outline: `3px solid ${player?.color}`,
                    outlineOffset: '-2px',
                    borderRadius: 8,
                    zIndex: 2,
                  } : {}),
                }}>
                <KwerzoTile shape={tile.shape} color={tile.color} size={CELL - 4} />
              </div>
            );
          })}

          {scorePopup && (
            <div
              className={`kdp-score-pop${scorePopup.kwerzo ? ' kdp-kwerzo-pop' : ''}`}
              style={{
                left: (scorePopup.x + 0.5) * CELL,
                top:  Math.max(0, scorePopup.y - 0.8) * CELL,
              }}>
              {scorePopup.kwerzo ? `✦ KWERZO! +${scorePopup.points}` : `+${scorePopup.points}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
