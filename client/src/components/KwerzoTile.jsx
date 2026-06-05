import React from 'react';

const COLOR_VALUES = {
  ruby:     '#E53935',
  amber:    '#FB8C00',
  jade:     '#43A047',
  sapphire: '#1E88E5',
  amethyst: '#8E24AA',
  coral:    '#E91E63'
};

function Moon({ fill }) {
  return (
    <path
      fillRule="evenodd"
      d="M20,4 A16,16,0,1,0,20,36 A16,16,0,1,0,20,4 Z M26,10 A11,11,0,1,1,26,30 A11,11,0,1,1,26,10 Z"
      fill={fill}
    />
  );
}

function Bolt({ fill }) {
  return <polygon points="23,2 12,22 21,22 17,38 28,18 19,18" fill={fill} />;
}

function Star({ fill }) {
  return (
    <polygon
      points="20,3 24,14 36,14 27,22 30,33 20,26 10,33 13,22 4,14 16,14"
      fill={fill}
    />
  );
}

function Leaf({ fill }) {
  return (
    <path
      d="M20,4 C32,6 36,16 34,26 C32,34 26,37 20,36 C14,37 8,34 6,26 C4,16 8,6 20,4 Z"
      fill={fill}
    />
  );
}

function Hex({ fill }) {
  return <polygon points="20,4 34,12 34,28 20,36 6,28 6,12" fill={fill} />;
}

function Heart({ fill }) {
  return (
    <path
      d="M20,34 C8,24 3,18 3,13 C3,7 8,3 13,3 C16,3 18,5 20,8 C22,5 24,3 27,3 C32,3 37,7 37,13 C37,18 32,24 20,34 Z"
      fill={fill}
    />
  );
}

const SHAPE_COMPONENTS = { moon: Moon, bolt: Bolt, star: Star, leaf: Leaf, hex: Hex, heart: Heart };

export default function KwerzoTile({ shape, color, size = 52, selected, staged, className = '', onClick, style = {} }) {
  const fill = COLOR_VALUES[color] || '#888';
  const ShapeComp = SHAPE_COMPONENTS[shape];

  return (
    <div
      className={`kwerzo-tile ${selected ? 'selected' : ''} ${staged ? 'staged' : ''} ${className}`}
      style={{ width: size, height: size, cursor: onClick ? 'pointer' : 'default', ...style }}
      onClick={onClick}
      title={`${color} ${shape}`}
    >
      <svg viewBox="0 0 40 40" width={size - 8} height={size - 8}>
        {ShapeComp && <ShapeComp fill={fill} />}
      </svg>
    </div>
  );
}

export { COLOR_VALUES };
