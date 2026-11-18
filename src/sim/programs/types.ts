import { ClusterState, HostId, WindowRole } from '../core/types';

export interface ShellFrame {
  hostId: HostId;
  user: string;
  cwd: string;
  env: Record<string, string>;
  mode: 'cmd' | 'bash' | 'psql';
  boundarySessionId?: string;
  psqlUser?: string;
  psqlDb?: string;
}

export interface CommandExecutionResult {
  output: string;
  clearScreen?: boolean;
  pushFrame?: ShellFrame;
  popFrame?: boolean;
  promptInput?: {
    promptText: string;
    echo: boolean;
    onInput: (value: string) => CommandExecutionResult;
  };
  allowUnredactedToken?: boolean;
  delayMs?: number;
}

export interface ProgramContext {
  windowRole: WindowRole;
  frame: ShellFrame;
  state: ClusterState;
  updateState: (mutator: (draft: ClusterState) => void) => ClusterState;
  rawLine: string;
  args: string[];
  stdin?: string;
}