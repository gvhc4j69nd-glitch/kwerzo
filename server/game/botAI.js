'use strict';

const { validateMove, scoreMove } = require('./kwerzoEngine');

function k(x, y) { return `${x},${y}`; }

// ── Adjacent empty cells ─────────────────────────────────────────────────────
function adjacentCells(board) {
  if (Object.keys(board).length === 0) return [{ x: 0, y: 0 }];
  const seen = new Set();
  const cells = [];
  for (const cell of Object.keys(board)) {
    const [x, y] = cell.split(',').map(Number);
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nk = k(x+dx, y+dy);
      if (!board[nk] && !seen.has(nk)) { seen.add(nk); cells.push({x: x+dx, y: y+dy}); }
    }
  }
  return cells;
}

// ── Find all valid placements from hand ───────────────────────────────────────
// Strategy: anchor at each adjacent cell, then try extending in H and V
// directions by adding more tiles from the remaining hand.
function findAllMoves(board, hand) {
  const moves = [];
  const seen  = new Set();

  function dedup(placements) {
    const s = placements.map(p => `${p.x},${p.y}:${p.tile.shape}:${p.tile.color}`).sort().join('|');
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  }

  function tryAdd(placements) {
    const v = validateMove(board, placements);
    if (!v.valid) return false;
    if (dedup(placements)) {
      moves.push({ placements: [...placements], pts: scoreMove(board, placements) });
    }
    return true;
  }

  // Extend a placement one step in direction (dx,dy), trying each unused hand tile
  function extend(placements, usedIdx, dx, dy) {
    if (placements.length >= 6) return;
    const last = placements[placements.length - 1];
    const nx = last.x + dx, ny = last.y + dy;
    if (board[k(nx, ny)]) return; // cell occupied by existing tile
    for (let i = 0; i < hand.length; i++) {
      if (usedIdx.has(i)) continue;
      const candidate = [...placements, { x: nx, y: ny, tile: hand[i] }];
      if (!tryAdd(candidate)) continue;
      extend(candidate, new Set([...usedIdx, i]), dx, dy);
    }
  }

  const anchors = adjacentCells(board);

  for (const { x, y } of anchors) {
    for (let i = 0; i < hand.length; i++) {
      const p = [{ x, y, tile: hand[i] }];
      if (!tryAdd(p)) continue;
      extend(p, new Set([i]),  1,  0); // extend right
      extend(p, new Set([i]), -1,  0); // extend left
      extend(p, new Set([i]),  0,  1); // extend down
      extend(p, new Set([i]),  0, -1); // extend up
    }
  }

  return moves;
}

// ── Pick a move by difficulty ─────────────────────────────────────────────────
function pickMove(moves, difficulty) {
  if (moves.length === 0) return null;

  if (difficulty === 'easy') {
    // Only single-tile moves; pick randomly
    const singles = moves.filter(m => m.placements.length === 1);
    const pool = singles.length > 0 ? singles : moves;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  if (difficulty === 'medium') {
    // Sort by score descending, pick randomly from the top-3
    const sorted = [...moves].sort((a, b) => b.pts - a.pts);
    const top    = sorted.slice(0, Math.min(3, sorted.length));
    return top[Math.floor(Math.random() * top.length)];
  }

  // hard: always the highest-scoring move; break ties by most tiles placed
  return moves.reduce((best, m) =>
    m.pts > best.pts || (m.pts === best.pts && m.placements.length > best.placements.length)
      ? m : best
  );
}

// ── Main bot decision ─────────────────────────────────────────────────────────
function getBotMove(state, botId, difficulty) {
  const player = state.players.find(p => p.id === botId);
  if (!player) return { action: 'pass' };

  const hand  = player.hand;
  const board = state.board;
  const moves = findAllMoves(board, hand);

  if (moves.length === 0) {
    // No valid placements — swap if possible, otherwise pass
    if (state.bag.length >= 1) {
      // Swap the tile(s) least likely to be useful (hard swaps worst tiles, easy swaps random)
      const toSwap = difficulty === 'hard'
        ? worstTiles(hand, board)
        : [hand[Math.floor(Math.random() * hand.length)]];
      return { action: 'swap', tiles: toSwap };
    }
    return { action: 'pass' };
  }

  const chosen = pickMove(moves, difficulty);
  if (!chosen) return { action: 'pass' };
  return { action: 'place', placements: chosen.placements };
}

// Heuristic: tiles that fit in the fewest existing lines are "worst"
function worstTiles(hand, board) {
  if (hand.length === 0) return [];
  const scored = hand.map(tile => {
    let fits = 0;
    for (const cell of Object.keys(board)) {
      const [x, y] = cell.split(',').map(Number);
      for (const [dx, dy] of [[1,0],[0,1]]) {
        // check if tile could ever extend this line (same shape or color as line)
        const line = getLineValues(board, x, y, dx === 1 ? 'h' : 'v');
        if (line.every(t => t.color === tile.color || t.shape === tile.shape)) fits++;
      }
    }
    return { tile, fits };
  });
  scored.sort((a, b) => a.fits - b.fits);
  return [scored[0].tile];
}

function getLineValues(board, x, y, dir) {
  const tiles = [board[k(x, y)]];
  if (dir === 'h') {
    for (let cx = x-1; board[k(cx,y)]; cx--) tiles.push(board[k(cx,y)]);
    for (let cx = x+1; board[k(cx,y)]; cx++) tiles.push(board[k(cx,y)]);
  } else {
    for (let cy = y-1; board[k(x,cy)]; cy--) tiles.push(board[k(x,cy)]);
    for (let cy = y+1; board[k(x,cy)]; cy++) tiles.push(board[k(x,cy)]);
  }
  return tiles;
}

module.exports = { getBotMove };
