'use client';

import React, { useEffect, useRef } from 'react';
import { BackendLogEntry } from '@/sim/core/types';
import { getClusterStore } from '@/sim/core/store';

interface BackendConsoleViewProps {
  componentFilter?: string;
}

function formatAnsiLogLine(entry: BackendLogEntry): string {
  const colorMap: Record<string, string> = {
    boundary: entry.podOrHost.includes('worker') ? '\x1b[95m' : '\x1b[96m', // magenta worker, cyan controller
    vault: '\x1b[92m',         // bright green
    haproxy: '\x1b[93m',       // yellow
    postgres: '\x1b[94m',      // blue
    ldap: '\x1b[97m',          // bright white
    k8s: '\x1b[90m',           // grey
    metallb: '\x1b[90m',
    longhorn: '\x1b[90m',
    'cert-manager': '\x1b[90m'
  };

  const reset = '\x1b[0m';
  const color = entry.isError ? '\x1b[91m' : colorMap[entry.component] || '\x1b[37m';
  const lines: string[] = [];

  if (entry.banner) {
    lines.push(`\x1b[1;97m${entry.banner}${reset}`);
  }
  lines.push(`${ entry.timeFormatted } ${color}[${entry.podOrHost}]${reset} ${entry.isError ? '\x1b[91m' : ''}${entry.message}${reset}`);
  return lines.join('\r\n');
}

export default function BackendConsoleView({ componentFilter }: BackendConsoleViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let term: import('@xterm/xterm').Terminal | null = null;
    let unsubLogs: (() => void) | null = null;

    async function initBackendStream() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit')
      ]);

      if (disposed || !containerRef.current) return;

      term = new Terminal({
        disableStdin: true,
        cursorBlink: false,
        cursorStyle: 'underline',
        fontFamily: '"Cascadia Mono", Consolas, "Lucida Console", monospace',
        fontSize: 15,
        lineHeight: 1.22,
        scrollback: 10000,
        convertEol: true,
        theme: {
          background: '#0C0C0C',
          foreground: '#CCCCCC',
          cursor: '#0C0C0C'
        }
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      const store = getClusterStore();
      const matchesFilter = (entry: BackendLogEntry) =>
        !componentFilter || entry.component.toLowerCase() === componentFilter.toLowerCase();

      for (const entry of store.getState().backendLogs) {
        if (matchesFilter(entry)) {
          term.writeln(formatAnsiLogLine(entry));
        }
      }

      unsubLogs = store.subscribeLogs((entry) => {
        if (term && matchesFilter(entry)) {
          term.writeln(formatAnsiLogLine(entry));
        }
      });

      const handleResize = () => fitAddon.fit();
      window.addEventListener('resize', handleResize);
    }

    void initBackendStream();

    return () => {
      disposed = true;
      if (unsubLogs) unsubLogs();
      if (term) term.dispose();
    };
  }, [componentFilter]);

  return <div ref={containerRef} className="w-full h-full" />;
}

