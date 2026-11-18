'use client';

import dynamic from 'next/dynamic';
import { CmdWindowFrame } from '@/ui/CmdWindowFrame';

const TerminalView = dynamic(() => import('@/ui/TerminalView'), { ssr: false });
const BackendConsoleView = dynamic(() => import('@/ui/BackendConsoleView'), { ssr: false });

export default function AllTiledWindowsPage() {
  return (
    <main className="grid grid-cols-3 w-screen h-screen bg-[#0C0C0C]">
      <CmdWindowFrame title="C:\WINDOWS\system32\cmd.exe - Admin (VAANISHKA-LT)">
        <TerminalView role="admin" />
      </CmdWindowFrame>
      <CmdWindowFrame title="C:\WINDOWS\system32\cmd.exe - Employee (YOTTA-LT-4471)">
        <TerminalView role="employee" />
      </CmdWindowFrame>
      <CmdWindowFrame title="Backend Console - cluster event stream">
        <BackendConsoleView />
      </CmdWindowFrame>
    </main>
  );
}