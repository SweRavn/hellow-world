import type { Formatter } from "./expr.js";
import { toTime } from "./expr.js";
import type { Json } from "./types.js";

/** Default `format` operator implementation backed by Intl (browsers, Node, React Native with Hermes Intl). */
export class IntlFormatter implements Formatter {
  constructor(
    private readonly locale?: string,
    private readonly currency = "USD",
  ) {}

  format(value: Json, kind: string, arg: Json): string | null {
    const n = typeof value === "number" ? value : null;
    try {
      switch (kind) {
        case "number":
          if (n === null) return null;
          return new Intl.NumberFormat(this.locale, typeof arg === "number"
            ? { minimumFractionDigits: arg, maximumFractionDigits: arg }
            : { maximumFractionDigits: 2 }).format(n);
        case "currency":
          if (n === null) return null;
          return new Intl.NumberFormat(this.locale, {
            style: "currency",
            currency: typeof arg === "string" ? arg : this.currency,
          }).format(n);
        case "percent":
          if (n === null) return null;
          return new Intl.NumberFormat(this.locale, { style: "percent", maximumFractionDigits: 1 }).format(n);
        case "date":
        case "datetime": {
          const t = toTime(value);
          if (t === null) return null;
          return new Intl.DateTimeFormat(this.locale, kind === "date"
            ? { dateStyle: "medium" }
            : { dateStyle: "medium", timeStyle: "short" }).format(t);
        }
        case "relative": {
          const t = toTime(value);
          if (t === null) return null;
          const diff = t - Date.now();
          const abs = Math.abs(diff);
          const rtf = new Intl.RelativeTimeFormat(this.locale, { numeric: "auto" });
          const units: [Intl.RelativeTimeFormatUnit, number][] = [
            ["year", 31_536_000_000], ["month", 2_592_000_000], ["day", 86_400_000],
            ["hour", 3_600_000], ["minute", 60_000],
          ];
          for (const [u, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), u);
          return rtf.format(0, "minute");
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }
}
