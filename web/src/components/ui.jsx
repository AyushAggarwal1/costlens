import React, { useMemo, useState } from 'react';
import { money, pct } from '../api.js';

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
export const RESOURCE_COLORS = { cpuCost: 'var(--s1)', ramCost: 'var(--s2)', pvCost: 'var(--s3)', networkCost: 'var(--s4)', loadBalancerCost: 'var(--s5)', gpuCost: 'var(--s6)', sharedCost: 'var(--s7)', externalCost: 'var(--s8)' };

export function Tiles({ children }) { return <div className="tiles">{children}</div>; }
export function Tile({ label, value, sub, hero, wide }) {
  return (
    <div className={`tile${wide ? ' wide' : ''}`}>
      <div className="label">{label}</div>
      <div className={`value${hero ? ' hero' : ''}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Section({ title, sub, right, children, className = '' }) {
  return (
    <section className={`section ${className}`}>
      <div className="section-head">
        <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Seg({ options, value, onChange }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Notice({ tone = '', title, children, action }) {
  return (
    <div className={`notice ${tone}`}>
      <div className="body">{title && <h3>{title}</h3>}<p>{children}</p></div>
      {action}
    </div>
  );
}

export function Badge({ tone = 'info', children, className = '' }) {
  return <span className={`badge ${tone} ${className}`}><span className="i" aria-hidden="true" />{children}</span>;
}

export function Legend({ items }) {
  return (
    <div className="legend" aria-label="Legend">
      {items.map((it) => (
        <span className="it" key={it.label}><span className={`sw ${it.kind || ''}`} style={it.color ? { background: it.color } : undefined} />{it.label}</span>
      ))}
    </div>
  );
}

export function Meter({ value, max = 1, mark, tone }) {
  const p = max > 0 ? Math.min(1, value / max) : 0;
  const cls = tone || (p > 0.9 ? 'bad' : p > 0.75 ? 'warn' : '');
  return (
    <div className="meter">
      <div className="track"><div className={`fill ${cls}`} style={{ width: `${p * 100}%` }} />{mark != null && max > 0 && <div className="mark" style={{ left: `${Math.min(100, (mark / max) * 100)}%` }} title="Requested" />}</div>
      <div className="v">{pct(p)}</div>
    </div>
  );
}

/** Horizontal bar list: one series, one colour, unless rows carry their own colour. */
export function HBars({ rows, format = money, total, onClick, colorByRow = false }) {
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  const sum = total ?? rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="hbars">
      {rows.map((r, i) => (
        <div className={`hbar${onClick ? ' clickable' : ''}`} key={r.key ?? r.label} onClick={onClick ? () => onClick(r) : undefined} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
          <div className="name" title={r.label}>{r.label}{r.sub && <span className="sub">{r.sub}</span>}</div>
          <div className="track"><div className="fill" style={{ width: `${(r.value / max) * 100}%`, background: colorByRow ? (r.color || SERIES[i % 8]) : (r.color || 'var(--s1)') }} /></div>
          <div className="val">{format(r.value)}{sum > 0 && <span className="p">{pct(r.value / sum)}</span>}</div>
        </div>
      ))}
      {rows.length === 0 && <div className="muted small">Nothing in this slice.</div>}
    </div>
  );
}

/** Sortable table. columns: { key, label, align:'r'|'l', render(row), sort(row), width, foot } */
export function DataTable({ columns, rows, defaultSort, defaultDir = 'desc', pageSize = 25, rowKey, onRowClick, selectedKey, footer, emptyText = 'No rows in this slice.' }) {
  const [sort, setSort] = useState(defaultSort || columns[0].key);
  const [dir, setDir] = useState(defaultDir);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort) || columns[0];
    const val = (r) => (col.sort ? col.sort(r) : r[col.key]);
    const arr = [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      return String(x).localeCompare(String(y));
    });
    return dir === 'desc' ? arr.reverse() : arr;
  }, [rows, sort, dir, columns]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const view = sorted.slice(cur * pageSize, cur * pageSize + pageSize);
  const toggle = (k) => { if (sort === k) setDir(dir === 'desc' ? 'asc' : 'desc'); else { setSort(k); setDir('desc'); } setPage(0); };
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>{columns.map((c) => (
            <th key={c.key} className={`${c.align === 'r' ? 'r' : ''} ${c.sortable === false ? '' : 'sortable'}`} style={c.width ? { width: c.width } : undefined} onClick={c.sortable === false ? undefined : () => toggle(c.key)} aria-sort={sort === c.key ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}>
              {c.label}{sort === c.key && <span className="arrow" aria-hidden="true">{dir === 'desc' ? '▾' : '▴'}</span>}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {view.map((r, i) => {
            const k = rowKey ? rowKey(r) : i;
            return (
              <tr key={k} className={`${onRowClick ? 'clickable' : ''} ${selectedKey != null && selectedKey === k ? 'selected' : ''}`} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c) => <td key={c.key} className={c.align === 'r' ? 'r' : ''}>{c.render ? c.render(r) : r[c.key]}</td>)}
              </tr>
            );
          })}
          {view.length === 0 && <tr><td colSpan={columns.length} className="muted">{emptyText}</td></tr>}
        </tbody>
        {footer && <tfoot><tr>{columns.map((c) => <td key={c.key} className={c.align === 'r' ? 'r' : ''}>{footer[c.key] ?? ''}</td>)}</tr></tfoot>}
      </table>
      {pages > 1 && (
        <div className="tbl-foot">
          <span>{sorted.length} rows</span>
          <span>
            <button className="btn small" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</button>
            <span style={{ margin: '0 10px' }}>{cur + 1} / {pages}</span>
            <button className="btn small" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button>
          </span>
        </div>
      )}
    </div>
  );
}

/** Tiny inline line chart for history evidence. */
export function Sparkline({ points, width = 240, height = 44, color = 'var(--s1)', refValue }) {
  if (!points || points.length < 2) return <span className="muted small">Not enough history</span>;
  const max = Math.max(...points, refValue || 0) || 1;
  const step = width / (points.length - 1);
  const y = (v) => height - 4 - (v / max) * (height - 8);
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="History">
      {refValue != null && <line x1="0" x2={width} y1={y(refValue)} y2={y(refValue)} stroke="var(--axis)" strokeWidth="1" />}
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <circle cx={(points.length - 1) * step} cy={y(points[points.length - 1])} r="3" fill={color} stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}

export function Loading({ label = 'Loading…' }) { return <div className="empty">{label}</div>; }
export function ErrorBox({ error }) { return <div className="notice bad"><div className="body"><h3>Could not load data</h3><p>{String(error.message || error)}</p></div></div>; }
