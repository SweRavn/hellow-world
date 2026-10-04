import type { WidgetSpec, WidgetStore } from "@graft/core";

export * from "@graft/core";
export { renderWidget } from "./render.js";
export { mountSlot, renderSpec, type SlotOptions } from "./slot.js";
export { openVibePanel, mountVibeButton, type VibePanelOptions } from "./panel.js";
export { injectStyles, GRAFT_CSS } from "./styles.js";

/** Persists accepted widgets in localStorage (per browser). Use your own WidgetStore to sync per user. */
export class LocalStorageStore implements WidgetStore {
  constructor(private readonly key = "graft.widgets") {}
  async load(): Promise<unknown[]> {
    try {
      const v = JSON.parse(localStorage.getItem(this.key) ?? "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  async save(widgets: WidgetSpec[]): Promise<void> {
    try {
      localStorage.setItem(this.key, JSON.stringify(widgets));
    } catch {
      /* storage full or blocked: widgets stay in memory for this session */
    }
  }
}
