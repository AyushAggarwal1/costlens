import React, { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { money, shortDate } from '../api.js';
import { Legend, DataTable } from './ui.jsx';

const axisStyle = { fontSize: 11, fill: 'var(--muted)', fontFamily: 'var(--font)' };

function TooltipBox({ active, payload, label, format, step, seriesLabels, showTotal }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value != null && p.value !== 0);
  const total = rows.reduce((a, p) => a + (p.value || 0), 0);
  return (
    <div className="tooltip">
      <div className="t">{typeof label === 'string' && label.includes('T') ? new Date(label).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: step === '1h' ? '2-digit' : undefined, minute: step === '1h' ? '2-digit' : undefined }) : label}</div>
      {rows.map((p) => (
        <div className="row" key={p.dataKey}><span className="n"><span className="sw" style={{ background: p.color || p.stroke }} />{seriesLabels?.[p.dataKey] || p.name}</span><span className="num">{format(p.value)}</span></div>
      ))}
      {showTotal && rows.length > 1 && <div className="row total"><span>Total</span><span className="num">{format(total)}</span></div>}
    </div>
  );
}

/**
 * Card with a chart and a table twin. series: [{ key, label, color }]. data: rows with xKey + series keys.
 */
export function ChartCard({ title, sub, children, data, series, xKey = 'x', step, format = money, height = 240, legendExtra = [] }) {
  const [mode, setMode] = useState('chart');
  const columns = [{ key: xKey, label: step === '1h' ? 'Hour' : 'Day', render: (r) => (typeof r[xKey] === 'string' && r[xKey].includes('T') ? shortDate(r[xKey], step) : r[xKey]) }, ...series.map((s) => ({ key: s.key, label: s.label, align: 'r', render: (r) => format(r[s.key] || 0) }))];
  return (
    <div className="chart-card">
      <div className="head">
        <div><h3>{title}</h3>{sub && <div className="sub">{sub}</div>}</div>
        <div className="seg"><button type="button" aria-pressed={mode === 'chart'} onClick={() => setMode('chart')}>Chart</button><button type="button" aria-pressed={mode === 'table'} onClick={() => setMode('table')}>Table</button></div>
      </div>
      {mode === 'chart' ? (
        <>
          <div className="plot" style={{ height }}>{children}</div>
          {(series.length > 1 || legendExtra.length > 0) && <Legend items={[...series.map((s) => ({ label: s.label, color: s.color })), ...legendExtra]} />}
        </>
      ) : (
        <DataTable columns={columns} rows={data} defaultSort={xKey} defaultDir="asc" pageSize={50} />
      )}
    </div>
  );
}

export function StackedBars({ data, series, xKey = 'x', step, format = money, showTotal = true }) {
  const labels = Object.fromEntries(series.map((s) => [s.key, s.label]));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke="var(--hair)" />
        <XAxis dataKey={xKey} tickFormatter={(v) => (typeof v === 'string' && v.includes('T') ? shortDate(v, step) : v)} tick={axisStyle} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} minTickGap={24} />
        <YAxis tickFormatter={(v) => format(v, 0)} tick={axisStyle} axisLine={false} tickLine={false} width={56} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<TooltipBox format={format} step={step} seriesLabels={labels} showTotal={showTotal} />} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} stroke="var(--surface)" strokeWidth={1} maxBarSize={36} isAnimationActive={false} radius={i === series.length - 1 ? [3, 3, 0, 0] : 0} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Lines({ data, series, xKey = 'x', step, format, refLines = [], yDomain }) {
  const labels = Object.fromEntries(series.map((s) => [s.key, s.label]));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--hair)" />
        <XAxis dataKey={xKey} tickFormatter={(v) => (typeof v === 'string' && v.includes('T') ? shortDate(v, step) : v)} tick={axisStyle} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} minTickGap={24} />
        <YAxis tickFormatter={(v) => format(v)} tick={axisStyle} axisLine={false} tickLine={false} width={64} domain={yDomain || [0, 'auto']} />
        <Tooltip cursor={{ stroke: 'var(--axis)' }} content={<TooltipBox format={format} step={step} seriesLabels={labels} showTotal={false} />} />
        {refLines.map((r) => <ReferenceLine key={r.label} y={r.value} stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="4 3" label={{ value: r.label, position: 'insideTopRight', fontSize: 11, fill: 'var(--muted)' }} />)}
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
