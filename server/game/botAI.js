'use strict';

const { validateMove, scoreMove } = require('./kwerzoEngine');

const KWERZO_SIZE = 6;

function k(x, y) { return `${x},${y}`; }

// ── Board helpers ─────────────────────────────────────────────────────────────

function adjacentCells(board) {
  if (Object.keys(board).length === 0) return [{ x: 0, y: 0 }];
  const seen = new Set();
  const cells = [];
  for (const cell of Object.keys(board)) {
    const [x, y] = cell.split(',').map(Number);
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nk = k(x+dx, y+dy);
      if (!board[nk] && !seen.has(nk)) { seen.add(nk); cells.push({ x: x+dx, y: y+dy }); }
    }
  }
  return cells;
}

function lineLength(board, x, y, dir) {
  let len = board[k(x, y)] ? 1 : 0;
  const [dx, dy] = dir === 'h' ? [1, 0] : [0, 1];
  for (let cx = x-dx, cy = y-dy; board[k(cx,cy)]; cx -= dx, cy -= dy) len++;
  for (let cx = x+dx, cy = y+dy; board[k(cx,cy)]; cx += dx, cy += dy) len++;
  return len;
}

function getLineValues(board, x, y, dir) {
  const tiles = [board[k(x,y)]];
  const [dx, dy] = dir === 'h' ? [1, 0] : [0, 1];
  for (let cx = x-dx, cy = y-dy; board[k(cx,cy)]; cx -= dx, cy -= dy) tiles.push(board[k(cx,cy)]);
  for (let cx = x+dx, cy = y+dy; board[k(cx,cy)]; cx += dx, cy += dy) tiles.push(board[k(cx,cy)]);
  return tiles;
}

// ── Kwerzo-potential scoring ─────────────────────────────────────────────────
// Returns a strategic bonus for moves that complete or approach a Kwerzo line.
// Completing a Kwerzo already earns +6 from scoreMove; this adds extra bias so
// setup moves are ranked above equally-scored alternatives.
function kwerzoPotential(board, placements) {
  const tempBoard = { ...board };
  for (const { x, y, tile } of placements) tempBoard[k(x, y)] = tile;

  let bonus = 0;
  const checkedLines = new Set();

  for (const { x, y } of placements) {
    for (const dir of ['h', 'v']) {
      // Canonical line key so we don't double-count
      const len  = lineLength(tempBoard, x, y, dir);
      const [dx, dy] = dir === 'h' ? [1, 0] : [0, 1];
      // Walk to the leftmost/topmost cell of this line to build a canonical key
      let lx = x, ly = y;
      while (tempBoard[k(lx-dx, ly-dy)]) { lx -= dx; ly -= dy; }
      const lineKey = `${dir}:${lx},${ly}`;
      if (checkedLines.has(lineKey)) continue;
      checkedLines.add(lineKey);

      if (len === KWERZO_SIZE)      bonus += 50;  // completes a Kwerzo — highest priority
      else if (len === KWERZO_SIZE - 1) bonus += 12;  // one tile away
      else if (len === KWERZO_SIZE - 2) bonus += 4;   // two tiles away
    }
  }
  return bonus;
}

// ── Find all valid placements ─────────────────────────────────────────────────
// Key improvement over the original: extend() skips over existing board tiles
// so the bot can place at BOTH ENDS of a line in one move (required to complete
// many Kwerzos).
function findAllMoves(board, hand) {
  const moves = [];
  const seen  = new Set();

  function dedup(placements) {
    const s = placements
      .map(p => `${p.x},${p.y}:${p.tile.shape}:${p.tile.color}`)
      .sort().join('|');
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  }

  function tryAdd(placements) {
    if (!validateMove(board, placements).valid) return false;
    if (dedup(placements)) {
      moves.push({ placements: [...placements], pts: scoreMove(board, placements) });
    }
    return true;
  }

  // Extend the current placement along (dx,dy), jumping over existing board
  // tiles so we can place at both ends of an occupied line.
  function extend(placements, usedIdx, dx, dy) {
    if (placements.length >= KWERZO_SIZE) return;
    const last = placements[placements.length - 1];
    let nx = last.x + dx, ny = last.y + dy;

    // Skip over cells that are already on the board (allows both-ends placement)
    while (board[k(nx, ny)]) { nx += dx; ny += dy; }

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
      extend(p, new Set([i]),  1,  0);
      extend(p, new Set([i]), -1,  0);
      extend(p, new Set([i]),  0,  1);
      extend(p, new Set([i]),  0, -1);
    }
  }

  return moves;
}

// ── Single-tile strategic value (how much a tile contributes to live lines) ──
function tileValue(tile, board) {
  let value = 0;
  for (const cell of Object.keys(board)) {
    const [cx, cy] = cell.split(',').map(Number);
    for (const dir of ['h', 'v']) {
      const line = getLineValues(board, cx, cy, dir);
      const len  = line.length;
      if (len >= KWERZO_SIZE) continue;
      const sameColor = line.every(t => t.color === tile.color);
      const sameShape = line.every(t => t.shape === tile.shape);
      if (sameColor || sameShape) value += len >= 4 ? 10 : len >= 3 ? 4 : 1;
    }
  }
  return value;
}

// ── 1-ply lookahead: reward moves that leave a stronger hand behind ──────────
// Expert-only — simulates the post-move board and hand, then values the
// leftover tiles against it. Hard plays the best move available right now;
// expert also accounts for what that move sets up for its NEXT turn.
function handQualityBonus(move, hand, board) {
  const remaining = [...hand];
  for (const { tile } of move.placements) {
    const idx = remaining.findIndex(t => t.shape === tile.shape && t.color === tile.color);
    if (idx !== -1) remaining.splice(idx, 1);
  }
  const tempBoard = { ...board };
  for (const { x, y, tile } of move.placements) tempBoard[k(x, y)] = tile;

  let total = 0;
  for (const t of remaining) total += tileValue(t, tempBoard);
  return Math.round(total * 0.3); // tie-breaker weight — never overrides raw points
}

// ── 2-ply lookahead: score the best follow-up move with the remaining hand ────
// Legendary-only — after committing to a move, find the best move the bot could
// make on its NEXT turn using only the tiles that remain in hand (conservative:
// ignores new draws, so any actual draw is pure upside).
function nextTurnBonus(move, hand, board) {
  const remaining = [...hand];
  for (const { tile } of move.placements) {
    const idx = remaining.findIndex(t => t.shape === tile.shape && t.color === tile.color);
    if (idx !== -1) remaining.splice(idx, 1);
  }
  if (remaining.length === 0) return 0;

  const tempBoard = { ...board };
  for (const { x, y, tile } of move.placements) tempBoard[k(x, y)] = tile;

  const nextMoves = findAllMoves(tempBoard, remaining);
  if (nextMoves.length === 0) return 0;

  // Best raw score available next turn, weighted to not dominate current points
  const bestNext = Math.max(...nextMoves.map(m => m.pts + kwerzoPotential(tempBoard, m.placements)));
  return Math.round(bestNext * 0.5);
}

// ── Score a move with difficulty-appropriate Kwerzo awareness ────────────────
function effectiveScore(move, board, difficulty, hand) {
  const base    = move.pts;
  const kBonus  = kwerzoPotential(board, move.placements);

  if (difficulty === 'easy')       return base + Math.round(kBonus * 0.6);
  if (difficulty === 'medium')     return base + Math.round(kBonus * 0.9);
  if (difficulty === 'expert')     return base + kBonus + handQualityBonus(move, hand, board);
  if (difficulty === 'legendary')  return base + kBonus + handQualityBonus(move, hand, board) + nextTurnBonus(move, hand, board);
  return base + kBonus; // hard: 100% kwerzo awareness, greedy best move
}

// ── Pick a move by difficulty ─────────────────────────────────────────────────
function pickMove(moves, board, difficulty, hand) {
  if (moves.length === 0) return null;

  if (difficulty === 'easy') {
    const singles = moves.filter(m => m.placements.length === 1);
    const pool    = singles.length > 0 ? singles : moves;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const scored = moves.map(m => ({ m, score: effectiveScore(m, board, difficulty, hand) }));
  scored.sort((a, b) => b.score - a.score || b.m.placements.length - a.m.placements.length);

  if (difficulty === 'medium') {
    const top = scored.slice(0, Math.min(3, scored.length));
    return top[Math.floor(Math.random() * top.length)].m;
  }

  // hard / expert / legendary: always the best-scored move
  return scored[0].m;
}

// ── Swap decision ─────────────────────────────────────────────────────────────
// Prefer to keep tiles that can contribute to near-Kwerzo lines.
function chooseTilesToSwap(hand, board, difficulty) {
  if (hand.length === 0) return [];

  // Score each tile by how many near-Kwerzo lines it could extend
  const scored = hand.map((tile, idx) => ({ tile, idx, value: tileValue(tile, board) }));

  scored.sort((a, b) => a.value - b.value); // lowest value tiles first

  if (difficulty === 'hard' || difficulty === 'expert' || difficulty === 'legendary') {
    // Swap only the single least-useful tile
    return [scored[0].tile];
  }
  // medium/easy: swap the worst tile (or two if multiple are useless)
  const useless = scored.filter(s => s.value === 0);
  return useless.length > 0
    ? useless.slice(0, 2).map(s => s.tile)
    : [scored[0].tile];
}

// ── Main bot decision ─────────────────────────────────────────────────────────
function getBotMove(state, botId, difficulty) {
  const player = state.players.find(p => p.id === botId);
  if (!player) return { action: 'pass' };

  const hand  = player.hand;
  const board = state.board;
  const moves = findAllMoves(board, hand);

  if (moves.length === 0) {
    if (state.bag.length >= 1) {
      const tiles = chooseTilesToSwap(hand, board, difficulty);
      return { action: 'swap', tiles };
    }
    return { action: 'pass' };
  }

  const chosen = pickMove(moves, board, difficulty, hand);
  if (!chosen) return { action: 'pass' };
  return { action: 'place', placements: chosen.placements };
}

module.exports = { getBotMove };
