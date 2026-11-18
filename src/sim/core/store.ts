// src/sim/core/store.ts
import { BackendComponent, BackendLogEntry, ClusterState, FlowStepBanner } from './types';
import { createInitialClusterState } from './initialState';
import { tickClusterReconciler } from '../controllers/reconciler';

const STORAGE_KEY = 'sap_sim_cluster_state_v2';
const CHANNEL_NAME = 'sap_sim_broadcast_channel_v2';

type StateListener = (state: ClusterState) => void;
type LogListener = (entry: BackendLogEntry) => void;

class ClusterStore {
  private state: ClusterState;
  private stateListeners: Set<StateListener> = new Set();
  private logListeners: Set<LogListener> = new Set();
  private channel: BroadcastChannel | null = null;
  private seenLogIds: Set<string> = new Set();
  private tickerStarted = false;

  constructor() {
    this.state = this.loadFromStorage() || createInitialClusterState();
    for (const log of this.state.backendLogs) {
      this.seenLogIds.add(log.id);
    }

    if (typeof window !== 'undefined') {
      if ('BroadcastChannel' in window) {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = (ev) => {
          if (ev.data?.type === 'STATE_SYNC' && ev.data.state) {
            this.applyIncomingState(ev.data.state as ClusterState);
          } else if (ev.data?.type === 'RESET_STATE' && ev.data.state) {
            this.seenLogIds.clear();
            this.applyIncomingState(ev.data.state as ClusterState, true);
          }
        };
      }

      window.addEventListener('storage', (ev) => {
        if (ev.key === STORAGE_KEY && ev.newValue) {
          try {
            const parsed = JSON.parse(ev.newValue) as ClusterState;
            this.applyIncomingState(parsed);
          } catch {
            // ignore malformed storage write
          }
        }
      });

      this.startReconcilerLoop();
    }
  }

  private loadFromStorage(): ClusterState | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as ClusterState;
    } catch {
      return null;
    }
  }

  private saveToStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // storage quota guard
    }
  }

  private applyIncomingState(incoming: ClusterState, force = false): void {
    if (!force && incoming.version <= this.state.version) return;
    this.state = incoming;
    for (const entry of incoming.backendLogs) {
      if (!this.seenLogIds.has(entry.id)) {
        this.seenLogIds.add(entry.id);
        this.logListeners.forEach((cb) => cb(entry));
      }
    }
    this.stateListeners.forEach((cb) => cb(this.state));
  }

  public getState(): ClusterState {
    return this.state;
  }

  public update(mutator: (draft: ClusterState) => void): ClusterState {
    const draft: ClusterState = JSON.parse(JSON.stringify(this.state));
    mutator(draft);
    draft.version = this.state.version + 1;
    this.state = draft;

    for (const entry of draft.backendLogs) {
      if (!this.seenLogIds.has(entry.id)) {
        this.seenLogIds.add(entry.id);
        this.logListeners.forEach((cb) => cb(entry));
      }
    }

    this.saveToStorage();
    if (this.channel) {
      this.channel.postMessage({ type: 'STATE_SYNC', state: this.state });
    }
    this.stateListeners.forEach((cb) => cb(this.state));
    return this.state;
  }

  public reset(): ClusterState {
    const fresh = createInitialClusterState(Date.now());
    fresh.version = this.state.version + 1;
    this.state = fresh;
    this.seenLogIds.clear();
    for (const entry of fresh.backendLogs) {
      this.seenLogIds.add(entry.id);
    }
    this.saveToStorage();
    if (this.channel) {
      this.channel.postMessage({ type: 'RESET_STATE', state: this.state });
    }
    this.stateListeners.forEach((cb) => cb(this.state));
    return this.state;
  }

  public emitBackendLog(params: {
    component: BackendComponent;
    podOrHost: string;
    message: string;
    banner?: FlowStepBanner;
    isError?: boolean;
  }): void {
    this.update((draft) => {
      appendBackendLogToDraft(draft, params);
    });
  }

  public subscribeState(cb: StateListener): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  public subscribeLogs(cb: LogListener): () => void {
    this.logListeners.add(cb);
    return () => this.logListeners.delete(cb);
  }

  private startReconcilerLoop(): void {
    if (this.tickerStarted) return;
    this.tickerStarted = true;
    setInterval(() => {
      const changed = tickClusterReconciler(this.state, Date.now());
      if (changed) {
        this.update((draft) => {
          tickClusterReconciler(draft, Date.now());
        });
      }
    }, 1000);
  }
}

export function formatTimeMs(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const mmm = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${mmm}`;
}

export function appendBackendLogToDraft(
  draft: ClusterState,
  params: {
    component: BackendComponent;
    podOrHost: string;
    message: string;
    banner?: FlowStepBanner;
    isError?: boolean;
    timestampMs?: number;
  }
): void {
  const now = params.timestampMs ?? Date.now();
  const id = `log_${now}_${Math.random().toString(36).slice(2, 8)}`;
  draft.backendLogs.push({
    id,
    timestampMs: now,
    timeFormatted: formatTimeMs(now),
    component: params.component,
    podOrHost: params.podOrHost,
    message: params.message,
    banner: params.banner,
    isError: params.isError
  });
  if (draft.backendLogs.length > 2500) {
    draft.backendLogs.splice(0, draft.backendLogs.length - 2500);
  }
}

let singletonStore: ClusterStore | null = null;

export function getClusterStore(): ClusterStore {
  if (!singletonStore) {
    singletonStore = new ClusterStore();
  }
  return singletonStore;
}