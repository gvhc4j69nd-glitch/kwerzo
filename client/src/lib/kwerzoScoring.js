/**
 * Client-side mirror of the scoring portion of server/game/kwerzoEngine.js,
 * used to show a live "potential score" preview as the player stages tiles.
 * This must stay in sync with the server's scoreMove() — it does not need to
 * replicate move *validation*, only point totals.
 */

const KWERZO_SIZE  = 6;
const KWERZO_BONUS = 6;

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

// Returns { points, kwerzo } — the score the placements would earn right now.
export function previewScore(board, placements) {
  if (!placements || placements.length === 0) return null;

  const tempBoard = { ...board };
  for (const { x, y, tile } of placements) {
    tempBoard[key(x, y)] = tile;
  }

  const scoredLines = new Set();
  let total = 0;
  let kwerzo = false;

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
      if (line.length === KWERZO_SIZE) { total += KWERZO_BONUS; kwerzo = true; }
    }
  }

  if (total === 0) total = 1;
  return { points: total, kwerzo };
}
