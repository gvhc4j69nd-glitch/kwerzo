'use strict';

const SHAPES = ['moon', 'bolt', 'star', 'leaf', 'hex', 'heart'];
const COLORS = ['ruby', 'amber', 'jade', 'sapphire', 'amethyst', 'coral'];
const TILES_PER_SET = 3;
const HAND_SIZE = 6;
const KWERZO_SIZE = 6;
const KWERZO_BONUS = 6;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createBag() {
  const tiles = [];
  for (const shape of SHAPES) {
    for (const color of COLORS) {
      for (let i = 0; i < TILES_PER_SET; i++) {
        tiles.push({ shape, color });
      }
    }
  }
  return shuffle(tiles);
}

function drawTiles(bag, count) {
  return bag.splice(0, Math.min(count, bag.length));
}

function key(x, y) {
  return `${x},${y}`;
}

function getLine(board, x, y, dir) {
  const tiles = [{ x, y }];
  if (dir === 'h') {
    for (let cx = x - 1; board[key(cx, y)]; cx--) tiles.push({ x: cx, y });
    for (let cx = x + 1; board[key(cx, y)]; cx++) tiles.push({ x: cx, y });
  } else {
    for (let cy = y - 1; board[key(x, cy)]; cy--) tiles.push({ x, y: cy });
    for (let cy = y + 1; board[key(x, cy)]; cy++) tiles.push({ x, y: cy });
  }
  return tiles;
}

function isValidLine(board, positions) {
  if (positions.length > KWERZO_SIZE) return false;
  const tiles = positions.map(({ x, y }) => board[key(x, y)]);
  const shapes = new Set(tiles.map(t => t.shape));
  const colors = new Set(tiles.map(t => t.color));
  if (shapes.size !== 1 && colors.size !== 1) return false;
  const combos = new Set(tiles.map(t => `${t.shape}:${t.color}`));
  return combos.size === tiles.length;
}

function validateMove(board, placements) {
  if (!placements || placements.length === 0) {
    return { valid: false, error: 'Must place at least one tile' };
  }

  const xs = placements.map(p => p.x);
  const ys = placements.map(p => p.y);
  const uniqueRows = new Set(ys);
  const uniqueCols = new Set(xs);

  if (uniqueRows.size > 1 && uniqueCols.size > 1) {
    return { valid: false, error: 'All tiles must be in the same row or column' };
  }

  for (const { x, y } of placements) {
    if (board[key(x, y)]) {
      return { valid: false, error: `Cell (${x},${y}) is already occupied` };
    }
  }

  const placementKeys = placements.map(p => key(p.x, p.y));
  if (new Set(placementKeys).size !== placements.length) {
    return { valid: false, error: 'Cannot place two tiles in the same cell' };
  }

  const tempBoard = { ...board };
  for (const { x, y, tile } of placements) {
    tempBoard[key(x, y)] = tile;
  }

  if (Object.keys(board).length > 0) {
    const hasAdj = placements.some(({ x, y }) =>
      board[key(x - 1, y)] || board[key(x + 1, y)] ||
      board[key(x, y - 1)] || board[key(x, y + 1)]
    );
    if (!hasAdj) {
      return { valid: false, error: 'Tiles must connect to existing tiles on the board' };
    }
  }

  // Check for gaps in the line being placed
  if (uniqueRows.size === 1) {
    const y = [...uniqueRows][0];
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    for (let x = minX; x <= maxX; x++) {
      if (!tempBoard[key(x, y)]) {
        return { valid: false, error: 'Tiles must form a contiguous line (no gaps allowed)' };
      }
    }
  } else {
    const x = [...uniqueCols][0];
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    for (let y = minY; y <= maxY; y++) {
      if (!tempBoard[key(x, y)]) {
        return { valid: false, error: 'Tiles must form a contiguous line (no gaps allowed)' };
      }
    }
  }

  for (const { x, y } of placements) {
    const hLine = getLine(tempBoard, x, y, 'h');
    const vLine = getLine(tempBoard, x, y, 'v');
    if (hLine.length > 1 && !isValidLine(tempBoard, hLine)) {
      return { valid: false, error: 'Invalid row: tiles must all share the same shape or color, with no duplicates' };
    }
    if (vLine.length > 1 && !isValidLine(tempBoard, vLine)) {
      return { valid: false, error: 'Invalid column: tiles must all share the same shape or color, with no duplicates' };
    }
  }

  return { valid: true };
}

function scoreMove(board, placements) {
  const tempBoard = { ...board };
  for (const { x, y, tile } of placements) {
    tempBoard[key(x, y)] = tile;
  }

  const scoredLines = new Set();
  let total = 0;

  for (const { x, y } of placements) {
    for (const dir of ['h', 'v']) {
      const line = getLine(tempBoard, x, y, dir);
      if (line.length < 2) continue;
      const lineKey = `${dir}:${line.map(p => key(p.x, p.y)).sort((a, b) => {
        const [ax, ay] = a.split(',').map(Number);
        const [bx, by] = b.split(',').map(Number);
        return ax !== bx ? ax - bx : ay - by;
      }).join('|')}`;
      if (scoredLines.has(lineKey)) continue;
      scoredLines.add(lineKey);
      total += line.length;
      if (line.length === KWERZO_SIZE) total += KWERZO_BONUS;
    }
  }

  if (total === 0) total = 1;
  return total;
}

function createInitialState(playerIds) {
  const bag = createBag();
  const players = playerIds.map(id => ({
    id,
    hand: drawTiles(bag, HAND_SIZE),
    score: 0
  }));
  return {
    board: {},
    bag,
    players,
    currentPlayerIndex: 0,
    turnOrder: playerIds,
    status: 'playing',
    lastMoveAt: Date.now(),
    moveHistory: []
  };
}

function applyMove(state, userId, placements) {
  const playerIdx = state.players.findIndex(p => p.id === userId);
  if (playerIdx !== state.currentPlayerIndex) {
    return { error: 'Not your turn' };
  }

  const player = state.players[playerIdx];
  const handCopy = [...player.hand];
  for (const { tile } of placements) {
    const idx = handCopy.findIndex(h => h.shape === tile.shape && h.color === tile.color);
    if (idx === -1) return { error: 'Tile not in hand' };
    handCopy.splice(idx, 1);
  }

  const validation = validateMove(state.board, placements);
  if (!validation.valid) return { error: validation.error };

  const newBoard = { ...state.board };
  for (const { x, y, tile } of placements) newBoard[key(x, y)] = tile;

  const points = scoreMove(state.board, placements);
  const newBag = [...state.bag];
  const refill = drawTiles(newBag, placements.length);
  const newHand = [...handCopy, ...refill];

  const newPlayers = state.players.map((p, i) =>
    i === playerIdx
      ? { ...p, hand: newHand, score: p.score + points }
      : p
  );

  let status = state.status;
  if (newHand.length === 0 && newBag.length === 0) {
    status = 'finished';
    newPlayers[playerIdx] = { ...newPlayers[playerIdx], score: newPlayers[playerIdx].score + KWERZO_BONUS };
  }

  const nextPlayerIndex = status === 'finished'
    ? state.currentPlayerIndex
    : (state.currentPlayerIndex + 1) % state.players.length;

  return {
    newState: {
      ...state,
      board: newBoard,
      bag: newBag,
      players: newPlayers,
      currentPlayerIndex: nextPlayerIndex,
      status,
      lastMoveAt: Date.now(),
      moveHistory: [...(state.moveHistory || []), { type: 'place', userId, placements, points }]
    },
    points
  };
}

function applySwap(state, userId, tiles) {
  const playerIdx = state.players.findIndex(p => p.id === userId);
  if (playerIdx !== state.currentPlayerIndex) return { error: 'Not your turn' };
  if (!tiles || tiles.length === 0) return { error: 'Must swap at least one tile' };
  if (state.bag.length < tiles.length) return { error: 'Not enough tiles in bag to swap' };

  const handCopy = [...state.players[playerIdx].hand];
  for (const tile of tiles) {
    const idx = handCopy.findIndex(h => h.shape === tile.shape && h.color === tile.color);
    if (idx === -1) return { error: 'Tile not in hand' };
    handCopy.splice(idx, 1);
  }

  const newBag = shuffle([...state.bag, ...tiles]);
  const drawn = drawTiles(newBag, tiles.length);
  const newHand = [...handCopy, ...drawn];

  const newPlayers = state.players.map((p, i) =>
    i === playerIdx ? { ...p, hand: newHand } : p
  );

  return {
    newState: {
      ...state,
      bag: newBag,
      players: newPlayers,
      currentPlayerIndex: (state.currentPlayerIndex + 1) % state.players.length,
      lastMoveAt: Date.now(),
      moveHistory: [...(state.moveHistory || []), { type: 'swap', userId, count: tiles.length }]
    }
  };
}

function applyPass(state, userId) {
  const playerIdx = state.players.findIndex(p => p.id === userId);
  if (playerIdx !== state.currentPlayerIndex) return { error: 'Not your turn' };

  return {
    newState: {
      ...state,
      currentPlayerIndex: (state.currentPlayerIndex + 1) % state.players.length,
      lastMoveAt: Date.now(),
      moveHistory: [...(state.moveHistory || []), { type: 'pass', userId }]
    }
  };
}

function getStateForPlayer(state, playerId) {
  return {
    ...state,
    bag: state.bag.length,
    players: state.players.map(p => ({
      id: p.id,
      score: p.score,
      handSize: p.hand.length,
      hand: p.id === playerId ? p.hand : undefined
    }))
  };
}

module.exports = {
  SHAPES,
  COLORS,
  HAND_SIZE,
  createInitialState,
  validateMove,
  scoreMove,
  applyMove,
  applySwap,
  applyPass,
  getStateForPlayer
};
