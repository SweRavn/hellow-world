import { GraftError, type Graft, type WidgetSpec } from "@graft/core";
import { renderSpec } from "./slot.js";
import { injectStyles } from "./styles.js";

export interface VibePanelOptions {
  /** Pre-selected slot. When omitted the user can pick one (or let the AI decide). */
  slot?: string;
  /** Widget to modify instead of creating a new one. */
  edit?: WidgetSpec;
  title?: string;
  placeholder?: string;
  /** Human-friendly slot names for the picker. Defaults to the slot ids. */
  slotLabels?: Record<string, string>;
  onAccepted?(spec: WidgetSpec): void;
}

/**
 * Opens the end-user "vibe" dialog: describe a feature → preview the generated widget → add it.
 * Returns a function that closes the dialog.
 */
export function openVibePanel(graft: Graft, opts: VibePanelOptions = {}): () => void {
  injectStyles();
  const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    Object.assign(e, props);
    e.append(...kids);
    return e;
  };

  const backdrop = h("div", { className: "graft-backdrop" });
  const panel = h("div", { className: "graft-panel" });
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Add a feature");

  const input = h("textarea", {
    placeholder: opts.placeholder ?? (opts.edit ? "What should change?" : "e.g. Show how much I spent on food this month compared to my budget"),
  });
  const slotSelect = h("select");
  slotSelect.append(h("option", { value: "", textContent: "Let AI choose where" }));
  for (const id of graft.slotIds()) slotSelect.append(h("option", { value: id, textContent: opts.slotLabels?.[id] ?? id }));
  slotSelect.value = opts.edit?.slot ?? opts.slot ?? "";
  slotSelect.setAttribute("aria-label", "Where to place it");

  const status = h("div", { className: "graft-status" });
  status.setAttribute("aria-live", "polite");
  const preview = h("div", { className: "graft-root" });
  const generateBtn = h("button", { type: "button", className: "graft-btn graft-btn-primary", textContent: opts.edit ? "Update preview" : "Generate" });
  const acceptBtn = h("button", { type: "button", className: "graft-btn graft-btn-primary", textContent: opts.edit ? "Save changes" : "Add to app", hidden: true });
  const cancelBtn = h("button", { type: "button", className: "graft-btn", textContent: "Cancel" });

  panel.append(
    h("h2", { textContent: opts.title ?? (opts.edit ? `Change “${opts.edit.title}”` : "Add a feature") }),
    h("p", { className: "graft-hint", textContent: "Describe what you want to see. You'll get a preview before anything is added." }),
    input,
    slotSelect,
    status,
    preview,
    h("div", { className: "graft-actions" }, cancelBtn, generateBtn, acceptBtn),
  );
  backdrop.append(panel);
  document.body.append(backdrop);
  input.focus();

  // The spec being refined: starts as the edited widget, then each preview builds on the last.
  let current: WidgetSpec | undefined = opts.edit;
  let proposed: WidgetSpec | undefined;
  let busy = false;

  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && close();
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", (e) => e.target === backdrop && !busy && close());
  cancelBtn.addEventListener("click", close);

  const setBusy = (b: boolean) => {
    busy = b;
    generateBtn.disabled = acceptBtn.disabled = input.disabled = b;
  };

  const generate = async () => {
    const prompt = input.value.trim();
    if (!prompt || busy) return;
    setBusy(true);
    status.className = "graft-status";
    status.textContent = "Building your widget…";
    try {
      proposed = await graft.propose(prompt, { ...(slotSelect.value && { slot: slotSelect.value }), ...(current && { edit: current }) });
      current = proposed;
      preview.replaceChildren(h("div", { className: "graft-preview" }, renderSpec(graft, proposed, await graft.snapshot())));
      status.textContent = `Preview of “${proposed.title}”. Not right? Describe a change and press “Refine”.`;
      generateBtn.textContent = "Refine";
      acceptBtn.hidden = false;
      input.value = "";
      input.placeholder = "What should change?";
    } catch (e) {
      status.className = "graft-status graft-c-negative";
      status.textContent = e instanceof GraftError ? `${e.message}. Try rephrasing.` : "Something went wrong. Please try again.";
      if (e instanceof GraftError && e.details.length) console.warn("[graft]", e.details);
    } finally {
      setBusy(false);
      input.focus();
    }
  };

  generateBtn.addEventListener("click", () => void generate());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void generate();
  });
  acceptBtn.addEventListener("click", async () => {
    if (!proposed) return;
    setBusy(true);
    try {
      await graft.accept(proposed);
      opts.onAccepted?.(proposed);
      close();
    } catch {
      status.className = "graft-status graft-c-negative";
      status.textContent = "Could not save the widget.";
      setBusy(false);
    }
  });

  return close;
}

/** Adds a floating "✨ Add feature" button that opens the vibe panel. Returns a remove function. */
export function mountVibeButton(graft: Graft, opts: VibePanelOptions & { label?: string } = {}): () => void {
  injectStyles();
  const b = document.createElement("button");
  b.type = "button";
  b.className = "graft-fab";
  b.textContent = opts.label ?? "✨ Add feature";
  b.addEventListener("click", () => openVibePanel(graft, opts));
  document.body.append(b);
  return () => b.remove();
}
