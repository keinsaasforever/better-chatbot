import { ChevronDownIcon, WrenchIcon } from "lucide-react";
import { PropsWithChildren } from "react";
import { Button } from "ui/button";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";

export type EnabledTools = {
  groupName: string;
  tools: {
    name: string;
    description?: string;
  }[];
};

export function EnabledToolsDropdown({
  children,
  align,
  side,
  tools = [],
}: PropsWithChildren<{
  align?: "start" | "end";
  tools?: EnabledTools[];
  side?: "left" | "right" | "top" | "bottom";
}>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {children || (
          <Button variant={"secondary"}>
            Tool <ChevronDownIcon />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-40" side={side} align={align}>
        <DropdownMenuGroup className="cursor-pointer">
          {tools.length ? (
            tools.map((toolGroup, index) => {
              return (
                <DropdownMenuSub key={index}>
                  <DropdownMenuSubTrigger>
                    <p className="text-sm font-medium flex items-center gap-2 min-w-32">
                      <WrenchIcon className="size-3.5" />
                      <span className="truncate">{toolGroup.groupName}</span>
                    </p>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      {toolGroup.tools.map((tool) => {
                        return (
                          <DropdownMenuItem key={tool.name}>
                            <div className="flex text-xs flex-col w-40">
                              <p className=" truncate">{tool.name}</p>
                              <p className="text-muted-foreground truncate">
                                {tool.description}
                              </p>
                            </div>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              );
            })
          ) : (
            <DropdownMenuItem>
              <div className="flex flex-col items-center justify-center h-full">
                <p className="text-sm text-muted-foreground">
                  No tools available
                </p>
              </div>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
