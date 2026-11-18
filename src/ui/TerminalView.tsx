'use client';

import React, { useEffect, useRef } from 'react';
import { ClusterState, WindowRole } from '../sim/core/types';
import { TerminalShellSession } from '../sim/shells/shellEngine';
import { completeCommandLine } from '../sim/shells/autocomplete';
import { getClusterStore } from '../sim/core/store';
import { CommandExecutionResult } from '../sim/programs/types';

export interface TerminalViewProps {
  role: Extract<WindowRole, 'admin' | 'employee'>;
}

export default function TerminalView({ role }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let term: import('@xterm/xterm').Terminal | null = null;
    let unsubState: (() => void) | null = null;

    async function initTerminal() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit')
      ]);

      if (disposed || !containerRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'underline',
        fontFamily: '"Cascadia Mono", Consolas, "Lucida Console", monospace',
        fontSize: 16,
        lineHeight: 1.2,
        scrollback: 10000,
        convertEol: true,
        theme: {
          background: '#0C0C0C',
          foreground: '#CCCCCC',
          cursor: '#F2F2F2',
          selectionBackground: '#FFFFFF33',
          black: '#0C0C0C',
          red: '#C50F1F',
          green: '#13A10E',
          yellow: '#C19C00',
          blue: '#0037DA',
          magenta: '#881798',
          cyan: '#3A96DD',
          white: '#CCCCCC',
          brightBlack: '#767676',
          brightRed: '#E74856',
          brightGreen: '#16C60C',
          brightYellow: '#F9F1A5',
          brightBlue: '#3B78FF',
          brightMagenta: '#B4009E',
          brightCyan: '#61D6D6',
          brightWhite: '#F2F2F2'
        }
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      const session = new TerminalShellSession(role);
      const store = getClusterStore();

      let currentBuffer = '';
      let cursorPos = 0;
      const history: string[] = [];
      let historyIdx = -1;
      let isStreaming = false;
      let pendingPrompt: CommandExecutionResult['promptInput'] | null = null;

      term.writeln('Microsoft Windows [Version 10.0.22631.4602]');
      term.writeln('(c) Microsoft Corporation. All rights reserved.');
      term.writeln('');
      term.write(session.getPrompt());

      const redrawInputLine = (newText: string, newCursor = newText.length) => {
        if (!term) return;
        const prompt = pendingPrompt ? pendingPrompt.promptText : session.getPrompt();
        term.write('\r\x1b[2K' + prompt + (pendingPrompt && !pendingPrompt.echo ? '' : newText));
        currentBuffer = newText;
        cursorPos = newCursor;
        if (!pendingPrompt || pendingPrompt.echo) {
          const back = currentBuffer.length - cursorPos;
          if (back > 0) {
            term.write('\x1b[' + back + 'D');
          }
        }
      };

      const streamOutputAndPrompt = async (res: CommandExecutionResult) => {
        if (!term) return;
        isStreaming = true;
        if (res.clearScreen) {
          term.clear();
        }
        if (res.output) {
          const lines = res.output.split('\n');
          const perLineDelay = res.delayMs ? Math.max(8, Math.floor(res.delayMs / Math.max(1, lines.length))) : 8;
          for (const line of lines) {
            if (disposed) return;
            term.writeln(line);
            if (perLineDelay > 0 && lines.length > 1) {
              await new Promise((r) => setTimeout(r, perLineDelay));
            }
          }
        }
        isStreaming = false;
        if (res.promptInput) {
          pendingPrompt = res.promptInput;
          term.write(res.promptInput.promptText);
        } else {
          pendingPrompt = null;
          term.write(session.getPrompt());
        }
      };

      unsubState = store.subscribeState((nextState: ClusterState) => {
        const closedMsg = session.checkActiveSessionExpiry(nextState);
        if (closedMsg && term) {
          pendingPrompt = null;
          currentBuffer = '';
          cursorPos = 0;
          term.writeln(closedMsg);
          term.write(session.getPrompt());
        }
      });

      term.onData((data: string) => {
        if (!term || isStreaming) return;

        if (data === '\x03') {
          term.writeln('^C');
          currentBuffer = '';
          cursorPos = 0;
          pendingPrompt = null;
          term.write(session.getPrompt());
          return;
        }

        if (data === '\x04') {
          if (currentBuffer.length === 0 && !pendingPrompt) {
            term.writeln('exit');
            const res = session.executeLine('exit');
            void streamOutputAndPrompt(res);
          }
          return;
        }

        if (data === '\r' || data === '\n') {
          term.writeln('');
          const submitted = currentBuffer;
          currentBuffer = '';
          cursorPos = 0;

          if (pendingPrompt) {
            const handler = pendingPrompt.onInput;
            pendingPrompt = null;
            const nextRes = handler(submitted);
            void streamOutputAndPrompt(nextRes);
            return;
          }

          if (submitted.trim()) {
            history.push(submitted);
            historyIdx = history.length;
          }
          const res = session.executeLine(submitted);
          void streamOutputAndPrompt(res);
          return;
        }

        if (data === '\x7f' || data === '\b') {
          if (cursorPos > 0) {
            const updated = currentBuffer.slice(0, cursorPos - 1) + currentBuffer.slice(cursorPos);
            redrawInputLine(updated, cursorPos - 1);
          }
          return;
        }

        if (data === '\t') {
          if (!pendingPrompt) {
            const completed = completeCommandLine(currentBuffer, session.currentFrame(), store.getState());
            redrawInputLine(completed, completed.length);
          }
          return;
        }

        if (data === '\x1b[A') {
          if (!pendingPrompt && history.length > 0 && historyIdx > 0) {
            historyIdx--;
            redrawInputLine(history[historyIdx]);
          }
          return;
        }
        if (data === '\x1b[B') {
          if (!pendingPrompt) {
            if (historyIdx < history.length - 1) {
              historyIdx++;
              redrawInputLine(history[historyIdx]);
            } else {
              historyIdx = history.length;
              redrawInputLine('');
            }
          }
          return;
        }
        if (data === '\x1b[D') {
          if (cursorPos > 0 && (!pendingPrompt || pendingPrompt.echo)) {
            cursorPos--;
            term.write('\x1b[D');
          }
          return;
        }
        if (data === '\x1b[C') {
          if (cursorPos < currentBuffer.length && (!pendingPrompt || pendingPrompt.echo)) {
            cursorPos++;
            term.write('\x1b[C');
          }
          return;
        }
        if (data === '\x1b[H') {
          redrawInputLine(currentBuffer, 0);
          return;
        }
        if (data === '\x1b[F') {
          redrawInputLine(currentBuffer, currentBuffer.length);
          return;
        }

        const clean = data.replace(/[\r\n]+/g, '');
        if (clean) {
          const nextBuf = currentBuffer.slice(0, cursorPos) + clean + currentBuffer.slice(cursorPos);
          redrawInputLine(nextBuf, cursorPos + clean.length);
        }
      });

      const handleResize = () => fitAddon.fit();
      window.addEventListener('resize', handleResize);
    }

    void initTerminal();

    return () => {
      disposed = true;
      if (unsubState) unsubState();
      if (term) term.dispose();
    };
  }, [role]);

  return <div ref={containerRef} className="w-full h-full" />;
}