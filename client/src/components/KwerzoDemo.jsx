import React, { useEffect, useState } from 'react';
import KwerzoTile from './KwerzoTile';

const CELL = 40;

// A scripted 3-turn sequence that ends in a Kwerzo (a completed line of 6),
// used purely as an animated illustration of how the game works.
const TURNS = [
  {
    label: 'Player 1',
    points: 3,
    kwerzo: false,
    note: 'Places 3 tiles sharing the same shape (★) — scores 1 point per tile.',
    tiles: [
      { x: 0, y: 0, shape: 'star', color: 'jade' },
      { x: 1, y: 0, shape: 'star', color: 'amber' },
      { x: 2, y: 0, shape: 'star', color: 'sapphire' },
    ],
  },
  {
    label: 'Bot',
    points: 3,
    kwerzo: false,
    note: 'Extends down with 2 more tiles sharing the same color — a new line scores again.',
    tiles: [
      { x: 0, y: 1, shape: 'moon', color: 'jade' },
      { x: 0, y: 2, shape: 'bolt', color: 'jade' },
    ],
  },
  {
    label: 'Player 1',
    points: 12,
    kwerzo: true,
    note: 'Completes a line of 6 stars — Kwerzo! 6 points + 6 bonus = 12.',
    tiles: [
      { x: 3, y: 0, shape: 'star', color: 'amethyst' },
      { x: 4, y: 0, shape: 'star', color: 'coral' },
      { x: 5, y: 0, shape: 'star', color: 'ruby' },
    ],
  },
];

const TILE_DELAY  = 450;  // ms between each tile appearing
const TURN_PAUSE  = 1700; // ms to hold the score popup before next turn
const RESET_PAUSE = 2600; // ms to hold the final Kwerzo before looping

const COLS = 6;
const ROWS = 3;

export default function KwerzoDemo() {
  const [boardTiles, setBoardTiles] = useState({});
  const [revealKey, setRevealKey] = useState(null);
  const [scorePopup, setScorePopup] = useState(null);
  const [activeTurn, setActiveTurn] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const timeouts = [];
    const schedule = (fn, delay) => {
      const t = setTimeout(() => { if (!cancelled) fn(); }, delay);
      timeouts.push(t);
    };

    function runTurn(idx) {
      if (cancelled) return;

      if (idx >= TURNS.length) {
        schedule(() => {
          setBoardTiles({});
          setScorePopup(null);
          setActiveTurn(null);
          runTurn(0);
        }, RESET_PAUSE);
        return;
      }

      const turn = TURNS[idx];
      setActiveTurn(turn);
      setScorePopup(null);

      turn.tiles.forEach((tile, i) => {
        schedule(() => {
          setBoardTiles(prev => ({ ...prev, [`${tile.x},${tile.y}`]: tile }));
          setRevealKey(`${tile.x},${tile.y}`);
        }, (i + 1) * TILE_DELAY);
      });

      const afterTiles = (turn.tiles.length + 1) * TILE_DELAY;
      schedule(() => setScorePopup(turn), afterTiles);
      schedule(() => runTurn(idx + 1), afterTiles + TURN_PAUSE);
    }

    runTurn(0);

    return () => {
      cancelled = true;
      timeouts.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="kwerzo-demo">
      <div className="kwerzo-demo-header">
        <span className="kwerzo-demo-title">How Kwerzo works</span>
        {activeTurn && <span className="kwerzo-demo-turn">{activeTurn.label}'s turn</span>}
      </div>

      <div className="kwerzo-demo-board" style={{ width: COLS * CELL, height: ROWS * CELL }}>
        {Array.from({ length: COLS * ROWS }).map((_, i) => {
          const x = i % COLS;
          const y = Math.floor(i / COLS);
          return (
            <div
              key={`bg-${x}-${y}`}
              className="kwerzo-demo-cell"
              style={{ left: x * CELL, top: y * CELL, width: CELL, height: CELL }}
            />
          );
        })}

        {Object.entries(boardTiles).map(([k, tile]) => {
          const [x, y] = k.split(',').map(Number);
          return (
            <div
              key={k}
              className={`kwerzo-demo-tile-wrap ${k === revealKey ? 'tile-reveal' : ''}`}
              style={{ left: x * CELL, top: y * CELL, width: CELL, height: CELL }}
            >
              <KwerzoTile shape={tile.shape} color={tile.color} size={CELL} />
            </div>
          );
        })}

        {scorePopup && (
          <div className={`kwerzo-demo-score ${scorePopup.kwerzo ? 'kwerzo' : ''}`}>
            {scorePopup.kwerzo ? 'Kwerzo! +12' : `+${scorePopup.points}`}
          </div>
        )}
      </div>

      <div className="kwerzo-demo-caption">
        {activeTurn ? activeTurn.note : 'Match shapes or colors in a line to score — complete a line of 6 for a Kwerzo bonus!'}
      </div>
    </div>
  );
}
