'use client';

import React from 'react';

interface CmdWindowFrameProps {
  title: string;
  children: React.ReactNode;
}

export function CmdWindowFrame({ title, children }: CmdWindowFrameProps) {
  return (
    <div className="flex flex-col w-full h-full bg-[#0C0C0C] text-[#CCCCCC] select-none overflow-hidden border border-[#333333]">
      {/* Thin Windows 10/11 cmd.exe title bar */}
      <div className="flex items-center justify-between h-7 px-2 bg-[#1F1F1F] text-[#CCCCCC] text-xs font-cmd border-b border-[#2D2D2D] shrink-0">
        <div className="flex items-center gap-2 truncate">
          <span className="inline-flex items-center justify-center w-4 h-3.5 bg-[#0C0C0C] border border-[#777777] text-[9px] font-bold text-[#F2F2F2] leading-none">
            C:\_
          </span>
          <span className="truncate">{title}</span>
        </div>
        <div className="flex items-center gap-4 px-1 text-[#999999]">
          <span>─</span>
          <span>□</span>
          <span>✕</span>
        </div>
      </div>
      {/* Full-viewport terminal canvas */}
      <div className="flex-1 w-full h-full overflow-hidden bg-[#0C0C0C] p-1">
        {children}
      </div>
    </div>
  );
}