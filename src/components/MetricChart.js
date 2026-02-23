import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'rgba(15, 15, 35, 0.95)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 10,
      padding: '0.65rem 0.9rem',
      fontSize: '0.82rem',
      fontFamily: 'Inter, sans-serif',
      color: '#e2e8f0',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      maxWidth: 250,
    }}>
      <p style={{ margin: '0 0 0.3rem', fontWeight: 700, color: '#fff', fontSize: '0.78rem' }}>
        {d.title}
      </p>
      <p style={{ margin: '0 0 0.15rem', color: '#818cf8' }}>
        {payload[0].name}: <strong>{Number(d.value).toLocaleString()}</strong>
      </p>
      <p style={{ margin: 0, opacity: 0.5, fontSize: '0.72rem' }}>{d.date}</p>
    </div>
  );
}

function ChartBody({ data, metric, chartTitle, height }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 64 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11, fontFamily: 'Inter,sans-serif' }}
          axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
          tickLine={false}
          angle={-40}
          textAnchor="end"
          interval={0}
        />
        <YAxis
          tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11, fontFamily: 'Inter,sans-serif' }}
          axisLine={false}
          tickLine={false}
          width={65}
          tickFormatter={(v) => v >= 1e6 ? `${parseFloat((v / 1e6).toFixed(1))}M` : v >= 1e3 ? `${parseFloat((v / 1e3).toFixed(1))}K` : v}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} />
        <Line
          type="monotone"
          dataKey="value"
          name={metric}
          stroke="#818cf8"
          strokeWidth={2}
          dot={{ r: 3, fill: '#818cf8' }}
          activeDot={{ r: 5, fill: '#a5b4fc' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function svgToPng(svgEl, scale = 2) {
  return new Promise((resolve) => {
    const clone = svgEl.cloneNode(true);

    // Inline all computed styles so the PNG renders correctly
    const origEls = svgEl.querySelectorAll('*');
    const cloneEls = clone.querySelectorAll('*');
    for (let i = 0; i < origEls.length; i++) {
      const cs = window.getComputedStyle(origEls[i]);
      let style = '';
      for (let j = 0; j < cs.length; j++) {
        const prop = cs[j];
        style += `${prop}:${cs.getPropertyValue(prop)};`;
      }
      cloneEls[i].setAttribute('style', style);
    }

    const { width, height } = svgEl.getBoundingClientRect();
    clone.setAttribute('width', width);
    clone.setAttribute('height', height);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const data = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0a0a1e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);

      canvas.toBlob((pngBlob) => resolve(pngBlob), 'image/png');
    };
    img.src = url;
  });
}

export default function MetricChart({ data, metric, chartTitle }) {
  const [enlarged, setEnlarged] = useState(false);
  const chartRef = useRef(null);

  const handleDownload = useCallback(async () => {
    const container = enlarged ? document.getElementById('metric-chart-portal') : chartRef.current;
    const svg = container?.querySelector('svg');
    if (!svg) return;

    const pngBlob = await svgToPng(svg);
    if (!pngBlob) return;
    const url = URL.createObjectURL(pngBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${metric}_vs_time.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, [metric, enlarged]);

  if (!data?.length) return null;

  return (
    <>
      <div ref={chartRef} className="metric-chart-wrap">
        <div className="metric-chart-header">
          <p className="metric-chart-label">{chartTitle}</p>
          <div className="metric-chart-actions">
            <button className="metric-chart-btn" onClick={handleDownload}>Download</button>
            <button className="metric-chart-btn" onClick={() => setEnlarged(true)}>Enlarge</button>
          </div>
        </div>
        <ChartBody data={data} metric={metric} chartTitle={chartTitle} height={280} />
      </div>

      {enlarged && createPortal(
        <div className="metric-chart-overlay" onClick={() => setEnlarged(false)}>
          <div className="metric-chart-modal" id="metric-chart-portal" onClick={(e) => e.stopPropagation()}>
            <div className="metric-chart-header">
              <p className="metric-chart-label" style={{ fontSize: '1rem' }}>{chartTitle}</p>
              <div className="metric-chart-actions">
                <button className="metric-chart-btn" onClick={handleDownload}>Download</button>
                <button className="metric-chart-btn" onClick={() => setEnlarged(false)}>Close</button>
              </div>
            </div>
            <ChartBody data={data} metric={metric} chartTitle={chartTitle} height={500} />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
