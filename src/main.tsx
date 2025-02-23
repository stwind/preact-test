import { type FunctionComponent as FC, render } from 'preact';
import { useRef, useCallback } from 'preact/hooks';
import './css/index.css';

import { fromPort } from './signals';
import { type Node, node, passthrough } from './node';
import { usePointers, useCanvas2D } from './ui';
import { annotate, cross } from './draw';
import {
  type Affine,
  type Vec2,
  isMobile,
  copy,
  matmul,
  translate,
  scale,
  transform,
  fixAt,
  RAD2DEG,
} from './utils';

interface Pointer {
  id: number;
  positions: Vec2[];
  active: boolean;
  trail: Vec2[];
}

interface State {
  pointers: Record<number, Pointer>;
  transform: Affine;
}

const nodes = {
  main: passthrough(['pointer', 'wheel', 'context']),

  pointers: node(output => {
    const pointers: State['pointers'] = {};
    const removeInactive = isMobile();
    return {
      pointer: (e: PointerEvent) => {
        const pointer = (pointers[e.pointerId] ||= {
          id: e.pointerId,
          positions: [],
          trail: [],
          active: false,
        });

        pointer.active = e.buttons === 1;
        pointer.positions.unshift([e.offsetX, e.offsetY]);
        if (pointer.positions.length > 30) pointer.positions.pop();

        if (e.type == 'pointerdown') pointer.trail.length = 0;
        if (pointer.active) pointer.trail.unshift([e.offsetX, e.offsetY]);

        if (removeInactive && e.type == 'pointerdown') {
          for (const id in pointers)
            if (!pointers[id].active) delete pointers[id];
        }
        output('value', pointers);
      },
    };
  }),
  state: node(output => {
    const state: State = {
      transform: [1, 0, 0, 1, 0, 0],
      pointers: {},
    };
    const tfms: Affine = [1, 0, 0, 1, 0, 0];
    const p0: Vec2 = [-1, -1],
      p1: Vec2 = [-1, -1];
    let r0 = 0;
    let mag0 = 0;
    let last = 0;
    return {
      pointers: (pointers: State['pointers']) => {
        state.pointers = pointers;

        const ptrs = Object.values(pointers).filter(p => p.active);
        if (ptrs.length == 2) {
          const [ptr0, ptr1] = ptrs;
          const a = ptr0.positions[0];
          const b = ptr1.positions[0];
          const p: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

          if (last != 2) {
            copy(tfms, state.transform);
            p0[0] = p[0];
            p0[1] = p[1];
            r0 = Math.atan2(a[1] - b[1], a[0] - b[0]);
            mag0 = Math.hypot(a[0] - b[0], a[1] - b[1]);
          }
          p1[0] = p[0];
          p1[1] = p[1];
          const rad = Math.atan2(a[1] - b[1], a[0] - b[0]) - r0;

          const s = Math.hypot(a[0] - b[0], a[1] - b[1]) / mag0;

          matmul(
            state.transform,
            fixAt(transform([p1[0] - p0[0], p1[1] - p0[1]], rad, [s, s]), p0),
            tfms
          );
        } else if (ptrs.length == 1) {
          const ptr = ptrs[0];
          if (last != 1) {
            copy(tfms, state.transform);
            p0[0] = ptr.positions[0][0];
            p0[1] = ptr.positions[0][1];
          }
          p1[0] = ptr.positions[0][0];
          p1[1] = ptr.positions[0][1];

          matmul(
            state.transform,
            translate([p1[0] - p0[0], p1[1] - p0[1]]),
            tfms
          );
        }
        last = ptrs.length;

        output('value', state);
      },
      wheel: (e: WheelEvent) => {
        const s = e.deltaY * 5e-4;

        const sx = 1 - s / state.transform[0];
        const sy = 1 - s / state.transform[3];

        matmul(
          state.transform,
          fixAt(scale([sx, sy]), [e.offsetX, e.offsetY]),
          state.transform
        );
        output('value', state);
      },
    };
  }),
  draw: node(() => {
    let ctx: CanvasRenderingContext2D,
      dpr: number = window.devicePixelRatio;
    const clear = () => {
      ctx.fillStyle = 'hsl(0,0%,95%)';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    };
    const drawMark = (size = 500) => {
      ctx.fillStyle = 'rgba(36,94,7,1)';
      ctx.strokeStyle = 'hsl(0,0%,20%)';
      const x = (ctx.canvas.width - size) * 0.5;
      const y = (ctx.canvas.height - size) * 0.5;
      ctx.fillRect(x, y, size, size);
    };
    return {
      init: ([_ctx, _dpr]: [CanvasRenderingContext2D, number]) => {
        ctx = _ctx;
        dpr = _dpr;
        clear();
        drawMark();
      },
      update({ pointers, transform }: State) {
        clear();

        ctx.save();
        ctx.transform(
          transform[0],
          transform[1],
          transform[2],
          transform[3],
          transform[4] * dpr,
          transform[5] * dpr
        );
        drawMark();
        ctx.restore();

        for (const { id, active, positions, trail } of Object.values(
          pointers
        )) {
          ctx.fillStyle = 'hsla(0,0%,50%,.1)';
          ctx.strokeStyle = 'hsla(0,0%,50%,.5)';
          let s = positions.length + 10;
          for (const [x, y] of positions) {
            ctx.beginPath();
            ctx.arc(x * dpr, y * dpr, s--, 0, 360);
            ctx.fill();
            ctx.stroke();
          }

          if (trail.length > 0) {
            ctx.strokeStyle = 'hsl(0,0%,30%)';
            ctx.beginPath();
            ctx.moveTo(trail[0][0] * dpr, trail[0][1] * dpr);
            for (let i = 1, n = trail.length; i < n; i++) {
              const [x, y] = trail[i];
              ctx.lineTo(x * dpr, y * dpr);
            }
            ctx.stroke();

            const first = trail[0],
              last = trail[trail.length - 1];
            ctx.strokeStyle = 'rgb(202,38,38)';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(first[0] * dpr, first[1] * dpr);
            ctx.lineTo(last[0] * dpr, last[1] * dpr);
            ctx.stroke();
            ctx.lineWidth = 1;
          }

          const [x, y] = positions[0];
          ctx.setLineDash([2, 2]);
          ctx.strokeStyle = 'hsl(0,0%,20%)';
          cross({ ctx, dpr }, { x, y });
          annotate(
            { ctx, dpr },
            {
              x,
              y,
              text: `${x.toFixed(0)},${y.toFixed(0)}`,
              bg: active ? 'rgb(202,38,38)' : 'hsl(0,0%,20%)',
            }
          );
          ctx.setLineDash([]);
        }

        const ptrs = Object.values(pointers).filter(p => p.active);
        if (ptrs.length == 2) {
          const [ptr0, ptr1] = ptrs;
          const a = ptr0.positions[0];
          const b = ptr1.positions[0];
          const p = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

          ctx.lineWidth = 10;
          ctx.beginPath();
          ctx.moveTo(a[0] * dpr, a[1] * dpr);
          ctx.lineTo(b[0] * dpr, b[1] * dpr);
          ctx.stroke();
          ctx.lineWidth = 1;
          ctx.fillStyle = 'rgb(202,38,38)';
          ctx.beginPath();
          ctx.arc(p[0] * dpr, p[1] * dpr, 20, 0, 360);
          ctx.fill();
        }
      },
    };
  }),
};

nodes.main.route(nodes.pointers, { pointer: 'pointer' });
nodes.main.route(nodes.state, { wheel: 'wheel' });
nodes.main.route(nodes.draw, { context: 'init' });
nodes.pointers.route(nodes.state, { value: 'pointers' });
nodes.state.route(nodes.draw, { value: 'update' });

// UI
const state = fromPort<State | undefined>(nodes.state, 'value', undefined);

type Component = FC<{ state: typeof state; events: Node }>;

const Canvas: Component = ({ events }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useCanvas2D(canvasRef, (ctx, dpr) => events.dispatch('context', [ctx, dpr]));

  const props = usePointers({
    down: e => events.dispatch('pointer', e),
    move: e => events.dispatch('pointer', e),
    up: e => events.dispatch('pointer', e),
  });

  return (
    <canvas
      class="stage"
      ref={canvasRef}
      {...props}
      onWheel={useCallback((e: WheelEvent) => events.dispatch('wheel', e), [])}
    ></canvas>
  );
};

const Info: Component = ({ state }) => {
  if (!state.value) return null;

  const tfms = state.value.transform;
  const s = Math.hypot(tfms[0], tfms[1]);
  return (
    <div class="info">
      <div>scale: {s.toFixed(3)}x</div>
      <div>rotate: {(Math.acos(tfms[0] / s) * RAD2DEG).toFixed(3)}°</div>
      <div>
        translate: {tfms[4].toFixed(0)}, {tfms[5].toFixed(0)}
      </div>
    </div>
  );
};

const App: Component = props => (
  <>
    <Canvas {...props} />
    <Info {...props} />
  </>
);

render(
  <App state={state} events={nodes.main} />,
  document.getElementById('app') as HTMLElement
);
