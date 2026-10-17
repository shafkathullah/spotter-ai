import type { Checkpoint } from "@/api/types";
import { formatDateTimeTz, formatInHr, formatMph, formatTempF } from "@/lib/format";
import { riskMeta, withAlpha } from "@/lib/risk";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Popup body for a checkpoint, built with textContent only (no HTML strings),
 * styled with the same tokens as the panel.
 */
export function checkpointPopupNode(cp: Checkpoint, routeName: string): HTMLElement {
  const m = riskMeta(cp.level);
  const root = el("div", "flex w-[248px] max-w-full flex-col gap-2 text-[13px] text-ink");

  const head = el("div", "flex items-center justify-between gap-2 pr-6");
  head.append(el("span", "label-mono text-ink-label", `${routeName} · mi ${Math.round(cp.distance_mi)}`));
  const chip = el(
    "span",
    "inline-flex items-center gap-1.5 rounded-tile px-1.5 py-[3px] font-mono text-xs font-medium tracking-[0.04em] whitespace-nowrap uppercase",
  );
  chip.style.backgroundColor = withAlpha(m.fill, 0.14);
  chip.style.color = m.ink;
  const sw = el("span", "size-2 rounded-[1px]");
  sw.style.backgroundColor = m.fill;
  chip.append(sw, document.createTextNode(m.label));
  head.append(chip);
  root.append(head);

  root.append(el("p", "tabular font-semibold", `ETA ${formatDateTimeTz(cp.eta)}`));

  const grid = el("dl", "tabular grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-ink-secondary");
  const rows: [string, string][] = [
    ["Wind", `${formatMph(cp.weather.wind_mph)}, gusts ${formatMph(cp.weather.gust_mph)}`],
    ["Rain", formatInHr(cp.weather.rain_in_hr)],
    ["Snow", formatInHr(cp.weather.snow_in_hr)],
    ["Temp", formatTempF(cp.weather.temp_f)],
  ];
  for (const [k, v] of rows) {
    grid.append(el("dt", "text-ink-label", k), el("dd", "text-ink", v));
  }
  root.append(grid);

  if (cp.drivers.length > 0) {
    const list = el("ul", "flex flex-col gap-0.5 border-t border-hairline pt-2 text-ink-secondary");
    for (const d of cp.drivers) list.append(el("li", "", d));
    root.append(list);
  }
  return root;
}
