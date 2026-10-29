"use client";

import { Clock, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function EmbeddingStatusIndicator({
  status,
}: {
  status: "pending" | "processing" | "completed" | "failed";
}) {
  const config = {
    pending: {
      icon: Clock,
      label: "Pending",
      color: "text-yellow-600",
      bgColor: "bg-yellow-100",
    },
    processing: {
      icon: Loader2,
      label: "Indexing",
      color: "text-blue-600",
      bgColor: "bg-blue-100",
      animate: "animate-spin",
    },
    completed: {
      icon: CheckCircle,
      label: "Indexed",
      color: "text-green-600",
      bgColor: "bg-green-100",
    },
    failed: {
      icon: XCircle,
      label: "Failed",
      color: "text-red-600",
      bgColor: "bg-red-100",
    },
  }[status];

  const Icon = config.icon;

  return (
    <div className="flex items-center gap-2">
      <div className={`p-1 rounded-full ${config.bgColor}`}>
        <Icon className={`w-3 h-3 ${config.color} ${config.animate || ""}`} />
      </div>
      <span className={`text-xs font-medium ${config.color}`}>
        {config.label}
      </span>
    </div>
  );
}

export function EmbeddingStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "completed" ? "default" : "secondary"}>
      {status}
    </Badge>
  );
}
