'use client';

import dynamic from 'next/dynamic';

const App = dynamic(() => import('@/App').then((mod) => mod.App), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground font-mono">
      <div className="flex items-center gap-3 text-sm text-muted-foreground animate-pulse">
        <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        Initializing NetGuardia...
      </div>
    </div>
  ),
});

export default function Home() {
  return <App />;
}
