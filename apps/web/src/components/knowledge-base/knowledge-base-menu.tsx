"use client";

import { useKnowledgeBases } from "@/hooks/queries/use-knowledge-bases";
import { LibraryBig, UploadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "ui/dropdown-menu";
import { CREATE_NEW, type KnowledgeBaseTarget } from "./knowledge-base-dialog";

/**
 * Composer submenu for knowledge bases: add documents to one (creating it on
 * the way if needed), or attach one to this thread so the model searches it
 * for context on every turn. Attaching writes a `knowledgeBase` chat mention;
 * the dialog lives in the composer, outside the dropdown, so closing the menu
 * does not unmount it.
 *
 * Projects are deliberately absent. A project owns a knowledge base but is not
 * one — it also carries the brain graph, memory and status that
 * `buildProjectRetrievalPrompt` reads, and binding one here would search only
 * its Agentset namespace, quietly dropping the rest. A chat uses a project by
 * living inside it (`thread.projectId`), and documents go in through the
 * project's own upload.
 */
export function KnowledgeBaseMenu({
  attachedIds,
  onToggle,
  onAddDocuments,
}: {
  attachedIds: string[];
  onToggle: (target: KnowledgeBaseTarget, attached: boolean) => void;
  /** Receives the target the dialog should open on (`kb:` id, or CREATE_NEW). */
  onAddDocuments: (initialTarget: string) => void;
}) {
  const t = useTranslations("Chat.KnowledgeBase");
  const { knowledgeBases, isLoading } = useKnowledgeBases();
  const isAttached = (id: string) => attachedIds.includes(id);

  // Adding documents almost always means adding them to what this chat already
  // searches, so open the dialog there. With nothing to add to, the dialog
  // opens on its create form instead, which is the only useful thing left.
  const addTarget = (() => {
    const target =
      knowledgeBases.find((kb) => isAttached(kb.id)) ?? knowledgeBases[0];
    return target ? `kb:${target.id}` : CREATE_NEW;
  })();

  return (
    <DropdownMenuGroup>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="flex items-center gap-2 cursor-pointer">
          <LibraryBig className="size-4" />
          {t("menuLabel")}
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent className="w-[var(--radix-popper-available-width)] md:w-72">
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => onAddDocuments(addTarget)}
            >
              <UploadIcon className="size-3.5" />
              {t("addDocuments")}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {!isLoading && knowledgeBases.length === 0 ? (
              <div className="text-xs text-muted-foreground px-2 py-4 text-center">
                {t("empty")}
              </div>
            ) : (
              <>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {t("attachHint")}
                </DropdownMenuLabel>
                {knowledgeBases.map((kb) => (
                  <DropdownMenuCheckboxItem
                    key={kb.id}
                    checked={isAttached(kb.id)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(checked) =>
                      onToggle(
                        { id: kb.id, name: kb.name, sourceType: "kb" },
                        !!checked,
                      )
                    }
                  >
                    <span className="truncate">{kb.name}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    </DropdownMenuGroup>
  );
}
