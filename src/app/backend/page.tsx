'use client';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { CmdWindowFrame } from '@/ui/CmdWindowFrame';

const BackendConsoleView = dynamic(() => import('@/ui/BackendConsoleView'), { ssr: false });

function BackendInner() {
  const searchParams = useSearchParams();
  const component = searchParams.get('component') || undefined;
  return <BackendConsoleView componentFilter={component} />;
}

export default function BackendConsolePage() {
  return (
    <main className="w-screen h-screen">
      <CmdWindowFrame title="Backend Console - cluster event stream">
        <Suspense fallback={null}>
          <BackendInner />
        </Suspense>
      </CmdWindowFrame>
    </main>
  );
}