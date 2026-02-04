import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Check if the app is running in demo mode (read-only).
 * Demo mode disables all mutation operations for public viewers.
 * Enabled via NEXT_PUBLIC_DEMO_MODE=true environment variable.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
}
