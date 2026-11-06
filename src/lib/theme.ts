import { useEffect, useState } from 'react';

export type ThemeMode = 'dark' | 'light' | 'system';

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = localStorage.getItem('netguardia_theme') as ThemeMode | null;
    if (saved === 'dark' || saved === 'light' || saved === 'system') {
      return saved;
    }
  } catch (_) {}
  return 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const root = document.documentElement;

    function apply() {
      const isDark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

      if (isDark) {
        root.classList.add('dark');
        root.style.colorScheme = 'dark';
        setResolvedTheme('dark');
      } else {
        root.classList.remove('dark');
        root.style.colorScheme = 'light';
        setResolvedTheme('light');
      }
    }

    apply();
    try {
      localStorage.setItem('netguardia_theme', theme);
    } catch (_) {}

    if (theme === 'system') {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => apply();
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((curr) => {
      if (curr === 'dark') return 'light';
      if (curr === 'light') return 'system';
      return 'dark';
    });
  };

  return { theme, setTheme, resolvedTheme, toggleTheme };
}
