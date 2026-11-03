import { create } from "zustand";

interface UiState {
  sidebarOpen: boolean;
  dark: boolean;
  toggleSidebar: () => void;
  setSidebar: (open: boolean) => void;
  toggleDark: () => void;
  setDark: (dark: boolean) => void;
}

function readDark(): boolean {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem("mba-theme");
  if (stored === "dark") return true;
  if (stored === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  dark: readDark(),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebar: (open) => set({ sidebarOpen: open }),
  toggleDark: () =>
    set((s) => {
      const dark = !s.dark;
      localStorage.setItem("mba-theme", dark ? "dark" : "light");
      document.documentElement.classList.toggle("dark", dark);
      return { dark };
    }),
  setDark: (dark) => {
    localStorage.setItem("mba-theme", dark ? "dark" : "light");
    document.documentElement.classList.toggle("dark", dark);
    set({ dark });
  }
}));
