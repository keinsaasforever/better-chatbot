"use client";

import MCPEditor from "@/components/mcp-editor";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function Page() {
  const t = useTranslations();

  const searchParams = useSearchParams();

  const [initialConfig, setInitialConfig] = useState<any>();
  const [initialName, setInitialName] = useState<string>();

  useEffect(() => {
    const name = searchParams.get("name");
    const config = searchParams.get("config");

    if (name && config) {
      try {
        setInitialConfig(JSON.parse(config));
        setInitialName(name);
      } catch (e) {
        console.error("Failed to parse config from URL params", e);
      }
    }
  }, [searchParams]);

  return (
    <div className="container max-w-3xl mx-0 px-4 sm:mx-4 md:mx-auto py-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/mcp"
          className="flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="size-3" />
          {t("Common.back")}
        </Link>
        <header className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-3xl font-semibold my-2">
              {t("MCP.mcpConfiguration")}
            </h2>
            <p className="text text-muted-foreground">
              {t("MCP.configureYourMcpServerConnectionSettings")}
            </p>
          </div>
        </header>

        <main className="my-8">
          <MCPEditor
            key={`${initialName}-${JSON.stringify(initialConfig)}`}
            initialConfig={initialConfig}
            name={initialName}
          />
        </main>
      </div>
    </div>
  );
}
