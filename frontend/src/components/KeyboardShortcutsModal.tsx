import React from 'react';
import { Keyboard, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: '1', desc: 'Navigate to Overview Dashboard' },
  { key: '2', desc: 'Navigate to Devices Management' },
  { key: '3', desc: 'Navigate to Topology Map' },
  { key: '4', desc: 'Navigate to Alerts & Maintenance' },
  { key: '5', desc: 'Navigate to Configuration Compliance' },
  { key: '6', desc: 'Navigate to Fleet Config Search' },
  { key: '7', desc: 'Navigate to Credential Vault' },
  { key: '8', desc: 'Navigate to Operational Audit Trail' },
  { key: '?', desc: 'Open this Keyboard Shortcuts cheat-sheet' },
  { key: 'Esc', desc: 'Close any open modal or drawer' },
];

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-border shadow-xl">
        <CardHeader className="p-4 border-b border-border flex flex-row items-center justify-between">
          <div className="space-y-0.5">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Keyboard className="w-4 h-4 text-primary" />
              Keyboard Navigation Shortcuts
            </CardTitle>
            <CardDescription className="text-xs">
              Quick key bindings for high-efficiency network administration.
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>

        <CardContent className="p-4 space-y-2">
          <div className="divide-y divide-border/60">
            {SHORTCUTS.map((s) => (
              <div key={s.key} className="py-2 flex items-center justify-between text-xs font-mono">
                <span className="text-muted-foreground">{s.desc}</span>
                <kbd className="px-2 py-0.5 rounded bg-secondary border border-border text-foreground font-bold text-[11px] shadow-sm">
                  {s.key}
                </kbd>
              </div>
            ))}
          </div>
        </CardContent>

        <div className="p-3 border-t border-border bg-secondary/20 flex justify-end">
          <Button size="sm" onClick={onClose}>
            Got it
          </Button>
        </div>
      </Card>
    </div>
  );
}
