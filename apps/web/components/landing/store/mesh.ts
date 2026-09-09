const CORNER_SEGMENTS = 6;
const RING = CORNER_SEGMENTS * 4;
const HALF = 0.5;
const RADIUS = 0.14;
const DEPTH = 0.055;
const CORNERS = [
  [HALF - RADIUS, HALF - RADIUS],
  [-(HALF - RADIUS), HALF - RADIUS],
  [-(HALF - RADIUS), -(HALF - RADIUS)],
  [HALF - RADIUS, -(HALF - RADIUS)],
];
const RADIANS = Math.PI / 180;
const FOV = 30 * RADIANS;
const DISTANCE = -10.4;

const ringPoints = () => {
  const points: [number, number, number, number][] = [];
  for (const [corner, center] of CORNERS.entries()) {
    for (let step = 0; step < CORNER_SEGMENTS; step += 1) {
      const angle =
        (corner * Math.PI) / 2 + (step / (CORNER_SEGMENTS - 1)) * (Math.PI / 2);
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      points.push([center[0] + nx * RADIUS, center[1] + ny * RADIUS, nx, ny]);
    }
  }
  return points;
};

export const cellMesh = () => {
  const ring = ringPoints();
  const vertices: number[] = [];
  const indices: number[] = [];
  const push = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number
  ) => {
    vertices.push(x, y, z, nx, ny, nz);
    return vertices.length / 6 - 1;
  };

  const front = push(0, 0, DEPTH, 0, 0, 1);
  for (const [x, y] of ring) {
    push(x, y, DEPTH, 0, 0, 1);
  }
  const back = push(0, 0, -DEPTH, 0, 0, -1);
  for (const [x, y] of ring) {
    push(x, y, -DEPTH, 0, 0, -1);
  }
  const side = vertices.length / 6;
  for (const [x, y, nx, ny] of ring) {
    push(x, y, DEPTH, nx, ny, 0);
    push(x, y, -DEPTH, nx, ny, 0);
  }

  for (let index = 0; index < RING; index += 1) {
    const next = (index + 1) % RING;
    indices.push(
      front,
      front + 1 + index,
      front + 1 + next,
      back,
      back + 1 + next,
      back + 1 + index
    );
    const top = side + index * 2;
    const nextTop = side + next * 2;
    indices.push(top, top + 1, nextTop + 1, top, nextTop + 1, nextTop);
  }

  return {
    indices: new Uint16Array(indices),
    vertices: new Float32Array(vertices),
  };
};

const multiply = (a: number[], b: number[]) => {
  const out: number[] = Array.from({ length: 16 }, () => 0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row] * b[column * 4 + k];
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
};

const perspective = (aspect: number) => {
  const focal = 1 / Math.tan(FOV / 2);
  const near = 0.1;
  const far = 40;
  return [
    focal / aspect,
    0,
    0,
    0,
    0,
    focal,
    0,
    0,
    0,
    0,
    far / (near - far),
    -1,
    0,
    0,
    (far * near) / (near - far),
    0,
  ];
};

const translation = (z: number) => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  z,
  1,
];

const rotationX = (radians: number) => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
};

const rotationY = (radians: number) => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
};

export const viewProjection = (
  aspect: number,
  tiltX: number,
  tiltY: number
) => {
  const camera = multiply(perspective(aspect), translation(DISTANCE));
  const model = multiply(
    rotationX(tiltX * RADIANS),
    rotationY(tiltY * RADIANS)
  );
  return multiply(camera, model);
};

export const project = (matrix: number[], x: number, y: number, z: number) => {
  const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const safe = Math.abs(clipW) < 0.0001 ? 0.0001 : clipW;
  return { x: clipX / safe, y: clipY / safe };
};

export const cameraPosition = (tiltX: number, tiltY: number) => {
  const rx = tiltX * RADIANS;
  const ry = tiltY * RADIANS;
  const distance = -DISTANCE;
  return [
    -Math.sin(ry) * Math.cos(rx) * distance,
    Math.sin(rx) * distance,
    Math.cos(ry) * Math.cos(rx) * distance,
  ];
};

export const modelDepth = (
  x: number,
  y: number,
  z: number,
  tiltX: number,
  tiltY: number
) => {
  const rx = tiltX * RADIANS;
  const ry = tiltY * RADIANS;
  const rotated = -Math.sin(ry) * x + Math.cos(ry) * z;
  return Math.sin(rx) * y + Math.cos(rx) * rotated;
};
