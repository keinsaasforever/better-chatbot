import { WorkflowToolKey } from "lib/ai/workflow/workflow.interface";
import { groupBy } from "lib/utils";
import { ChevronDownIcon, WrenchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { ReactNode, useMemo, useState } from "react";
import { Button } from "ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "ui/command";
import { MCPIcon } from "ui/mcp-icon";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";

export function WorkflowToolSelect({
  tools,
  onChange,
  children,
  side,
  align,
  tool,
}: {
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "end" | "center";
  tools: WorkflowToolKey[];
  onChange: (tool: WorkflowToolKey) => void;
  children?: ReactNode;
  tool?: WorkflowToolKey;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const mcpToolsByServerId = useMemo(() => {
    const mcpTools = tools.filter((tool) => tool.type == "mcp-tool");
    return Object.entries(groupBy(mcpTools, "serverId")).map(
      ([serverId, tools]) => {
        return {
          serverId,
          serverName: tools[0].serverName,
          tools,
        };
      },
    );
  }, [tools]);
  const defaultTools = useMemo(() => {
    return tools.filter((tool) => tool.type == "app-tool");
  }, [tools]);

  const selectedToolLabel = useMemo(() => {
    if (!tool)
      return (
        <>
          <WrenchIcon className="size-3.5" />
          <span className="text-muted-foreground">
            {t("Common.selectTool")}
          </span>
        </>
      );
    if (tool.type == "mcp-tool") {
      return (
        <>
          <MCPIcon className="size-3.5" />
          <span className="font-bold">{tool.serverName}</span>
          <div className="bg-primary text-primary-foreground px-2 rounded-md truncate">
            {tool.id}
          </div>
        </>
      );
    }
    return (
      <>
        <WrenchIcon className="size-3.5" />
        <span className="font-semibold truncate">{tool.id}</span>
      </>
    );
  }, [tool]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children || (
          <Button
            variant={"outline"}
            size={"lg"}
            className="border data-[state=open]:bg-input!"
          >
            {selectedToolLabel}
            <ChevronDownIcon className="size-3.5 ml-auto" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="p-0" side={side} align={align}>
        <Command>
          <CommandInput placeholder={t("Common.search")} />
          <CommandList>
            <CommandEmpty>{t("Common.noResults")}</CommandEmpty>
            {mcpToolsByServerId.map((mcpTools) => {
              return (
                <CommandGroup
                  key={mcpTools.serverId}
                  heading={mcpTools.serverName}
                >
                  {mcpTools.tools.map((tool) => {
                    return (
                      <CommandItem
                        key={tool.id}
                        onSelect={() => {
                          onChange(tool);
                          setOpen(false);
                        }}
                        className="cursor-pointer"
                      >
                        <WrenchIcon className="size-3.5" />
                        <span className="font-semibold truncate">
                          {tool.id}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}
            <CommandGroup heading={"App Default Tools"}>
              {defaultTools.map((tool) => {
                return (
                  <CommandItem
                    key={tool.id}
                    onSelect={() => {
                      onChange(tool);
                      setOpen(false);
                    }}
                    className="cursor-pointer"
                  >
                    <WrenchIcon className="size-3.5" />
                    <span className="font-semibold truncate">{tool.id}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
