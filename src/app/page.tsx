'use client';

import dynamic from 'next/dynamic';
import { CmdWindowFrame } from '@/ui/CmdWindowFrame';

const TerminalView = dynamic(() => import('@/ui/TerminalView'), { ssr: false });

export default function AdminLaptopPage() {
  return (
    <main className="w-screen h-screen">
      <CmdWindowFrame title="C:\WINDOWS\system32\cmd.exe">
        <TerminalView role="admin" />
      </CmdWindowFrame>
    </main>
  );
}