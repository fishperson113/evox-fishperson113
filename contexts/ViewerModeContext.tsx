"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface ViewerModeContextType {
  isViewerMode: boolean;
  setViewerMode: (value: boolean) => void;
}

const ViewerModeContext = createContext<ViewerModeContextType>({
  isViewerMode: false,
  setViewerMode: () => {},
});

/**
 * AGT-230: Viewer Mode Provider — Public Demo Protection
 * Priority order:
 * 1. NEXT_PUBLIC_DEMO_MODE env var (forced demo mode for Vercel deployment)
 * 2. URL param: ?mode=viewer or ?mode=readonly
 * 3. localStorage (for admin toggle)
 */
export function ViewerModeProvider({ children }: { children: ReactNode }) {
  // Check env var first — if set, always in demo mode
  const envDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const [isViewerMode, setIsViewerMode] = useState(envDemoMode);

  useEffect(() => {
    // If env var is set, always force demo mode
    if (envDemoMode) {
      setIsViewerMode(true);
      return;
    }

    // Check URL param
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get("mode");

    if (modeParam === "viewer" || modeParam === "readonly") {
      setIsViewerMode(true);
      return;
    }

    // Check localStorage (for admin toggle)
    const stored = localStorage.getItem("evox-viewer-mode");
    if (stored === "true") {
      setIsViewerMode(true);
    }
  }, [envDemoMode]);

  const setViewerMode = (value: boolean) => {
    setIsViewerMode(value);
    localStorage.setItem("evox-viewer-mode", value.toString());
  };

  return (
    <ViewerModeContext.Provider value={{ isViewerMode, setViewerMode }}>
      {children}
    </ViewerModeContext.Provider>
  );
}

export function useViewerMode() {
  return useContext(ViewerModeContext);
}
