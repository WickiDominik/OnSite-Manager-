import { ArrowUpRight, Check, Circle, Eraser, Highlighter, Pen, Square, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { loadImage } from '../lib/util';

type Tool = 'pen' | 'marker' | 'arrow' | 'rect' | 'ellipse';
interface Stroke {
  tool: Tool;
  color: string;
  width: number;
  points: { x: number; y: number }[];
}

const COLORS = ['#f5c400', '#ef4444', '#22c55e', '#3b82f6', '#ffffff', '#111111'];
const WIDTHS = [4, 8, 14, 22];
const TOOLS: { id: Tool; label: string; icon: ReactElement }[] = [
  { id: 'pen', label: 'Stift', icon: <Pen size={22} /> },
  { id: 'marker', label: 'Marker', icon: <Highlighter size={22} /> },
  { id: 'arrow', label: 'Pfeil', icon: <ArrowUpRight size={22} /> },
  { id: 'rect', label: 'Rechteck', icon: <Square size={22} /> },
  { id: 'ellipse', label: 'Kreis', icon: <Circle size={22} /> },
];

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, scale: number) {
  const pts = s.points;
  if (!pts.length) return;
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width * scale * (s.tool === 'marker' ? 2.2 : 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.tool === 'marker') ctx.globalAlpha = 0.4;
  const a = pts[0];
  const b = pts[pts.length - 1];
  ctx.beginPath();
  switch (s.tool) {
    case 'pen':
    case 'marker':
      ctx.moveTo(a.x, a.y);
      if (pts.length === 1) ctx.lineTo(a.x + 0.1, a.y + 0.1);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      if (pts.length > 1) ctx.lineTo(b.x, b.y);
      ctx.stroke();
      break;
    case 'rect':
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      break;
    case 'ellipse':
      ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'arrow': {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = Math.max(18 * scale, ctx.lineWidth * 3.5);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 7), b.y - head * Math.sin(ang - Math.PI / 7));
      ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 7), b.y - head * Math.sin(ang + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/** Full screen redlining editor. Resolves with the annotated JPEG data URL. */
export function PhotoEditor({ src, onCancel, onSave }: { src: string; onCancel: () => void; onSave: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[1]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [ready, setReady] = useState(false);
  const scaleRef = useRef(1);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img) return;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    for (const s of strokes) drawStroke(ctx, s, scaleRef.current);
    if (current.current) drawStroke(ctx, current.current, scaleRef.current);
  }, [strokes]);

  useEffect(() => {
    let alive = true;
    loadImage(src).then((img) => {
      if (!alive || !canvasRef.current) return;
      imgRef.current = img;
      const c = canvasRef.current;
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      // stroke widths are defined for ~1000px images
      scaleRef.current = Math.max(img.naturalWidth, img.naturalHeight) / 1000;
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [src]);

  useEffect(() => {
    if (ready) redraw();
  }, [ready, redraw]);

  const toCanvas = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };

  const down = (e: React.PointerEvent) => {
    if (!ready) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    current.current = { tool, color, width, points: [toCanvas(e)] };
    redraw();
  };
  const move = (e: React.PointerEvent) => {
    const s = current.current;
    if (!s) return;
    const p = toCanvas(e);
    if (s.tool === 'pen' || s.tool === 'marker') s.points.push(p);
    else s.points = [s.points[0], p];
    redraw();
  };
  const up = () => {
    const s = current.current;
    current.current = null;
    if (s) setStrokes((l) => [...l, s]);
  };

  const save = () => {
    const c = canvasRef.current!;
    onSave(c.toDataURL('image/jpeg', 0.88));
  };

  return (
    <div className="editor">
      <div className="editor-top">
        <button className="icon-btn" aria-label="Abbrechen" onClick={onCancel}>
          <X />
        </button>
        <strong className="grow">Markieren</strong>
        <button className="icon-btn" aria-label="Rückgängig" disabled={!strokes.length} onClick={() => setStrokes((l) => l.slice(0, -1))}>
          <Undo2 />
        </button>
        <button
          className="icon-btn"
          aria-label="Alles löschen"
          disabled={!strokes.length}
          onClick={() => strokes.length && window.confirm('Alle Markierungen löschen?') && setStrokes([])}
        >
          <Eraser />
        </button>
        <button className="btn primary sm" onClick={save} disabled={!ready}>
          <Check size={18} /> Speichern
        </button>
      </div>
      <div className="editor-stage">
        <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      </div>
      <div className="editor-tools">
        <div className="tool-row">
          {TOOLS.map((t) => (
            <button key={t.id} className={`tool-btn ${tool === t.id ? 'on' : ''}`} aria-label={t.label} title={t.label} onClick={() => setTool(t.id)}>
              {t.icon}
            </button>
          ))}
        </div>
        <div className="tool-row" style={{ marginTop: 8 }}>
          {WIDTHS.map((w) => (
            <button key={w} className={`tool-btn ${width === w ? 'on' : ''}`} aria-label={`Strichstärke ${w}`} onClick={() => setWidth(w)}>
              <span className="stroke-dot" style={{ width: 4 + w / 1.5, height: 4 + w / 1.5 }} />
            </button>
          ))}
        </div>
        <div className="tool-row" style={{ marginTop: 8 }}>
          {COLORS.map((c) => (
            <button key={c} className={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Farbe ${c}`} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
    </div>
  );
}
