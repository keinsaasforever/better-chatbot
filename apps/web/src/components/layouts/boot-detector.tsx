"use client";

import {
  configureBootDiagnostics,
  recordBootEvent,
  recordShellMount,
} from "@/lib/boot-diagnostics/client";
import { useEffect } from "react";

let reactMountCount = 0;
let shellMountCount = 0;

export function BootDetector({
  documentId,
  visitId,
}: {
  documentId: string;
  visitId: string;
}) {
  useEffect(() => {
    configureBootDiagnostics({ documentId, visitId });
    reactMountCount += 1;
    const mountCount = reactMountCount;
    recordBootEvent("react-mount", { mountCount });

    return () => {
      recordBootEvent("react-unmount", { mountCount });
    };
  }, [documentId, visitId]);

  return null;
}

/**
 * Mounts *inside* the provider tree, unlike BootDetector which is a sibling
 * above every provider in the root layout. Only this probe can see a provider
 * that withholds or remounts the app subtree.
 */
export function BootShellDetector() {
  useEffect(() => {
    shellMountCount += 1;
    const mountCount = shellMountCount;
    recordShellMount(mountCount);

    return () => {
      recordBootEvent("shell-unmount", { mountCount });
    };
  }, []);

  return null;
}
