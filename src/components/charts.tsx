import { useState, type ReactNode } from "react";

export function Card({ title, children, right }: { title?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card">
      {(title || right) && <header className="card-head"><h3>{title}</h3>{right}</header>}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ""}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Progress({ value, max, label }: { value: number; max: number; label?: ReactNode }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="progress-wrap">
      {label && <div className="progress-label">{label}</div>}
      <div className="progress" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`progress-fill ${pct >= 1 ? "done" : ""}`} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

export interface Bar { label: string; value: number; display: string; }

/** Barras verticales; `goal` dibuja una línea de referencia. Tocar/pasar por una barra muestra su valor. */
export function BarChart({ data, goal, goalLabel, color = "var(--series-1)", height = 140 }:
  { data: Bar[]; goal?: number; goalLabel?: string; color?: string; height?: number }) {
  const [hover, setHover] = useState<number>();
  const W = 320, H = height, top = 18, bottom = 20, left = 4, right = 4;
  const max = Math.max(goal ?? 0, ...data.map((d) => d.value)) * 1.1 || 1;
  const slot = (W - left - right) / data.length, bw = Math.min(28, slot * 0.6);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const shown = hover ?? data.length - 1;

  return (
    <div className="chart">
      <div className="chart-readout">
        <span><span className="muted">{data[shown]?.label}</span> <strong>{data[shown]?.display}</strong></span>
        {goalLabel && <span className="muted small"><i className="goal-swatch" />{goalLabel}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" onPointerLeave={() => setHover(undefined)}>
        <line x1={left} x2={W - right} y1={y(0)} y2={y(0)} className="axis" />
        {data.map((d, i) => {
          const x = left + slot * i + (slot - bw) / 2, h = y(0) - y(d.value);
          return (
            <g key={i} onPointerEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <rect x={left + slot * i} y={top} width={slot} height={H - top - bottom} fill="transparent" />
              {d.value > 0 && <path d={roundTop(x, y(d.value), bw, h)} fill={color} opacity={hover === undefined || hover === i ? 1 : 0.45} />}
              <text x={x + bw / 2} y={H - 6} textAnchor="middle" className={`tick ${i === shown ? "on" : ""}`}>{d.label}</text>
              <title>{`${d.label}: ${d.display}`}</title>
            </g>
          );
        })}
        {goal !== undefined && goal > 0 &&
          <line x1={left} x2={W - right} y1={y(goal)} y2={y(goal)} className="goal-line" />}
      </svg>
    </div>
  );
}

const roundTop = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

export interface RadarAxis { name: string; value: number; attempts: number; }
export interface RadarSeries { name: string; axes: RadarAxis[]; color: string; dashed?: boolean; }

/** Diagrama de araña 0–100 %. El primer eje queda arriba. */
export function Radar({ series, size = 340 }: { series: RadarSeries[]; size?: number }) {
  const [hover, setHover] = useState<number>();
  const axes = series[0]?.axes ?? [];
  const n = axes.length;
  if (n < 3) return <p className="muted small">Not enough data yet.</p>;
  const c = size / 2, R = size / 2 - (n > 10 ? 58 : 70);
  const pt = (i: number, r: number): [number, number] => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [c + r * Math.cos(a), c + r * Math.sin(a)];
  };
  const poly = (r: (i: number) => number) => axes.map((_, i) => pt(i, r(i)).join(",")).join(" ");
  const fs = n > 10 ? 9 : 11;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: 420, display: "block", margin: "0 auto" }} role="img"
           aria-label={`Accuracy by theme: ${axes.map((a) => `${a.name} ${Math.round(a.value * 100)}%`).join(", ")}`}>
        {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={poly(() => R * f)} className="grid" />)}
        {axes.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={c} y1={c} x2={x} y2={y} className="grid" />; })}
        {[50, 100].map((v) => <text key={v} x={c + 3} y={c - R * v / 100 + 10} className="tick">{v}%</text>)}
        {series.map((s) => (
          <g key={s.name}>
            <polygon points={poly((i) => R * (s.axes[i]?.attempts ? s.axes[i].value : 0))}
                     fill={s.color} fillOpacity={s.dashed ? 0 : 0.22} stroke={s.color} strokeWidth={2}
                     strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" />
            {s.axes.map((a, i) => {
              if (!a.attempts) return null;
              const [x, y] = pt(i, R * a.value);
              return <circle key={i} cx={x} cy={y} r={s.dashed ? 2.5 : 4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />;
            })}
          </g>
        ))}
        {axes.map((a, i) => {
          const [x, y] = pt(i, R + 14);
          const anchor = Math.abs(x - c) < 8 ? "middle" : x > c ? "start" : "end";
          const main = series[0].axes[i];
          return (
            <g key={a.name} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(undefined)} onClick={() => setHover(i)}>
              <text x={x} y={y} textAnchor={anchor} dominantBaseline="middle" fontSize={fs}
                    className={`radar-label ${hover === i ? "on" : ""}`}>
                <tspan x={x}>{a.name}</tspan>
                <tspan x={x} dy={fs + 2} className="radar-val">{main.attempts ? `${Math.round(main.value * 100)}%` : "—"}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => <span key={s.name}><i style={{ borderColor: s.color, borderStyle: s.dashed ? "dashed" : "solid" }} />{s.name}</span>)}
        </div>
      )}
      {hover !== undefined && (
        <p className="small center">
          <strong>{axes[hover].name}</strong>: {series.map((s) =>
            `${s.name} ${s.axes[hover].attempts ? `${Math.round(s.axes[hover].value * 100)}% (${s.axes[hover].attempts})` : "—"}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

/** Anillo pequeño con el porcentaje; al pulsarlo despliega `children` con el detalle */
export function Ring({ value, max, label, open, onToggle, children }:
  { value: number; max: number; label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const r = 13, c = 2 * Math.PI * r;
  return (
    <div className="ring-wrap">
      <button className={`ring ${open ? "on" : ""}`} onClick={onToggle} aria-expanded={open} aria-label={`${label}: ${Math.round(pct * 100)}%`}>
        <svg viewBox="0 0 32 32" aria-hidden>
          <circle cx="16" cy="16" r={r} className="ring-bg" />
          <circle cx="16" cy="16" r={r} className={`ring-fill ${pct >= 1 ? "done" : ""}`} strokeDasharray={`${pct * c} ${c}`} transform="rotate(-90 16 16)" />
        </svg>
        <span className="ring-text"><span className="ring-pct">{Math.floor(pct * 100)}%</span><span className="ring-label">{label}</span></span>
      </button>
      {open && <div className="popover" role="dialog">{children}</div>}
    </div>
  );
}
