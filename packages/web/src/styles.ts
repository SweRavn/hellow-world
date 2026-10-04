/**
 * Default look. Hosts theme Graft by overriding the CSS custom properties on any ancestor, e.g.
 *   :root { --graft-accent: #7c3aed; --graft-radius: 16px; }
 */
export const GRAFT_CSS = `
.graft-root, .graft-panel {
  --graft-bg: var(--graft-surface, #fff);
  --graft-fg: #1b1b1f;
  --graft-muted: #6b6b76;
  --graft-accent-c: var(--graft-accent, #4f46e5);
  --graft-positive: #15803d;
  --graft-negative: #b91c1c;
  --graft-warning: #b45309;
  --graft-border: rgba(0,0,0,.1);
  --graft-r: var(--graft-radius, 12px);
  font-family: var(--graft-font, inherit);
  color: var(--graft-fg);
}
@media (prefers-color-scheme: dark) {
  .graft-root, .graft-panel {
    --graft-bg: var(--graft-surface, #1c1c22); --graft-fg: #ececf1; --graft-muted: #a0a0ab;
    --graft-positive: #4ade80; --graft-negative: #f87171; --graft-warning: #fbbf24; --graft-border: rgba(255,255,255,.12);
  }
}
.graft-slot { display: flex; flex-direction: column; gap: 12px; }
.graft-slot:empty { display: none; }
.graft-widget { position: relative; }
.graft-widget-menu { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; opacity: 0; transition: opacity .15s; }
.graft-widget:hover .graft-widget-menu, .graft-widget:focus-within .graft-widget-menu { opacity: 1; }
.graft-icon-btn { border: 1px solid var(--graft-border); background: var(--graft-bg); color: var(--graft-muted); border-radius: 8px; font-size: 12px; padding: 2px 8px; cursor: pointer; }
.graft-card { background: var(--graft-bg); border: 1px solid var(--graft-border); border-radius: var(--graft-r); padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.graft-card-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--graft-muted); padding-right: 72px; }
.graft-column { display: flex; flex-direction: column; gap: 8px; }
.graft-row { display: flex; flex-direction: row; gap: 8px; align-items: center; }
.graft-row[data-align="center"] { justify-content: center; }
.graft-row[data-align="end"] { justify-content: flex-end; }
.graft-row[data-align="spaceBetween"] { justify-content: space-between; }
.graft-text { margin: 0; }
.graft-text-title { font-size: 18px; font-weight: 600; }
.graft-text-body { font-size: 14px; }
.graft-text-caption { font-size: 12px; }
.graft-metric-label { font-size: 13px; color: var(--graft-muted); }
.graft-metric-value { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
.graft-metric-caption { font-size: 12px; color: var(--graft-muted); }
.graft-progress-label { font-size: 13px; margin-bottom: 4px; }
.graft-progress-track { height: 8px; border-radius: 4px; background: var(--graft-border); overflow: hidden; }
.graft-progress-bar { height: 100%; background: var(--graft-accent-c); border-radius: 4px; }
.graft-progress-bar.graft-over { background: var(--graft-negative); }
.graft-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.graft-list-empty { color: var(--graft-muted); font-size: 13px; }
.graft-bars { display: flex; flex-direction: column; gap: 6px; }
.graft-bar-row { display: grid; grid-template-columns: minmax(60px, 30%) 1fr auto; gap: 8px; align-items: center; font-size: 13px; }
.graft-bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.graft-bar-track { height: 10px; background: var(--graft-border); border-radius: 5px; overflow: hidden; }
.graft-bar { display: block; height: 100%; background: var(--graft-accent-c); border-radius: 5px; }
.graft-bar-value { font-variant-numeric: tabular-nums; color: var(--graft-muted); }
.graft-badge { display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid currentColor; }
.graft-divider { border: 0; border-top: 1px solid var(--graft-border); margin: 4px 0; width: 100%; }
.graft-c-default { color: inherit; } .graft-c-muted { color: var(--graft-muted); } .graft-c-accent { color: var(--graft-accent-c); }
.graft-c-positive { color: var(--graft-positive); } .graft-c-negative { color: var(--graft-negative); } .graft-c-warning { color: var(--graft-warning); }
.graft-error { font-size: 13px; color: var(--graft-negative); border: 1px dashed var(--graft-negative); border-radius: var(--graft-r); padding: 12px; }

.graft-fab { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; border: 0; border-radius: 999px; padding: 12px 18px;
  background: var(--graft-accent, #4f46e5); color: #fff; font: 600 14px system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.2); cursor: pointer; }
.graft-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 2147483001; display: flex; align-items: flex-end; justify-content: center; }
@media (min-width: 640px) { .graft-backdrop { align-items: center; } }
.graft-panel { background: var(--graft-bg); width: min(560px, 100%); max-height: 90vh; overflow: auto; border-radius: 16px 16px 0 0; padding: 20px;
  display: flex; flex-direction: column; gap: 12px; font-family: system-ui, sans-serif; box-sizing: border-box; }
@media (min-width: 640px) { .graft-panel { border-radius: 16px; } }
.graft-panel h2 { margin: 0; font-size: 18px; }
.graft-panel p.graft-hint { margin: 0; font-size: 13px; color: var(--graft-muted); }
.graft-panel textarea { width: 100%; box-sizing: border-box; min-height: 80px; font: inherit; font-size: 15px; padding: 10px; border-radius: 10px;
  border: 1px solid var(--graft-border); background: transparent; color: inherit; resize: vertical; }
.graft-panel select { font: inherit; padding: 6px; border-radius: 8px; border: 1px solid var(--graft-border); background: transparent; color: inherit; }
.graft-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.graft-btn { font: 600 14px system-ui, sans-serif; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--graft-border); background: transparent; color: inherit; cursor: pointer; }
.graft-btn-primary { background: var(--graft-accent-c); border-color: transparent; color: #fff; }
.graft-btn:disabled { opacity: .5; cursor: default; }
.graft-preview { border: 1px dashed var(--graft-accent-c); border-radius: calc(var(--graft-r) + 4px); padding: 8px; }
.graft-status { font-size: 13px; color: var(--graft-muted); }
.graft-status.graft-c-negative { color: var(--graft-negative); }
`;

export function injectStyles(doc: Document = document): void {
  if (doc.getElementById("graft-styles")) return;
  const style = doc.createElement("style");
  style.id = "graft-styles";
  style.textContent = GRAFT_CSS;
  doc.head.appendChild(style);
}
