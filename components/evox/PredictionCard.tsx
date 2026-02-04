"use client";

import { cn } from "@/lib/utils";

interface Prediction {
  icon: string;
  label: string;
  value: string;
  type?: "normal" | "warning" | "success";
}

interface PredictionCardProps {
  predictions: Prediction[];
  className?: string;
}

/**
 * AGT-205: Predictions card (ETA, projected cost, bottlenecks)
 */
export function PredictionCard({ predictions, className }: PredictionCardProps) {
  if (predictions.length === 0) {
    return (
      <div className={cn("text-center text-[#555555] py-4", className)}>
        No predictions available
      </div>
    );
  }

  const typeStyles: Record<string, string> = {
    normal: "text-[#888888]",
    warning: "text-amber-400",
    success: "text-emerald-400",
  };

  return (
    <div className={cn("space-y-2", className)}>
      {predictions.map((prediction, idx) => (
        <div
          key={idx}
          className="flex items-start gap-2 py-2 px-3 rounded-lg bg-[#0d0d0d] border border-[#1a1a1a]"
        >
          <span className="text-base">{prediction.icon}</span>
          <div className="flex-1 min-w-0">
            <span className={cn("text-sm", typeStyles[prediction.type || "normal"])}>
              {prediction.label}:{" "}
              <span className="font-medium text-white">{prediction.value}</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
