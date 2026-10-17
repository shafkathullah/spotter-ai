import { useSyncExternalStore } from "react";

/**
 * Which checkpoint is hovered (list row or map marker) and which one was last
 * picked on the map. A tiny external store instead of React state at the app
 * level: hovering must not re-render the results panel, only the two rows
 * whose highlight changes (each row subscribes with a boolean selector) and
 * the map, which listens directly and flips feature-state.
 */
export interface CheckpointRef {
  routeId: string;
  idx: number;
}

type Listener = () => void;

function createStore() {
  let hovered: CheckpointRef | null = null;
  let picked: CheckpointRef | null = null;
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());

  return {
    getHovered: () => hovered,
    getPicked: () => picked,
    setHovered(next: CheckpointRef | null) {
      if (hovered?.routeId === next?.routeId && hovered?.idx === next?.idx) return;
      hovered = next;
      emit();
    },
    setPicked(next: CheckpointRef | null) {
      picked = next;
      emit();
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export const checkpointStore = createStore();

export function useIsCheckpointHovered(routeId: string, idx: number): boolean {
  return useSyncExternalStore(checkpointStore.subscribe, () => {
    const h = checkpointStore.getHovered();
    return h !== null && h.routeId === routeId && h.idx === idx;
  });
}

export function useIsCheckpointPicked(routeId: string, idx: number): boolean {
  return useSyncExternalStore(checkpointStore.subscribe, () => {
    const p = checkpointStore.getPicked();
    return p !== null && p.routeId === routeId && p.idx === idx;
  });
}
