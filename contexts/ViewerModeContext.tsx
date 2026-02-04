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
 * Viewer Mode Provider
 * - Check URL param: ?mode=viewer
 * - Check localStorage for saved preference
 * - Provides read-only mode for public viewers
 */
export function ViewerModeProvider({ children }: { children: ReactNode }) {
  const [isViewerMode, setIsViewerMode] = useState(false);

  useEffect(() => {
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
  }, []);

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
