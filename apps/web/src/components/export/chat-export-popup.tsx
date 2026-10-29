import { exportChatAction } from "@/app/api/chat/actions";
import { LinkIcon, Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { safe } from "ts-safe";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "ui/dialog";
import { useTranslations } from "next-intl";

type Props = {
  threadId: string;
  onExport?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
};

export function ChatExportPopup(props: Props) {
  const router = useRouter();
  const t = useTranslations();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(() => {
    setIsExporting(true);
    safe(() =>
      exportChatAction({
        threadId: props.threadId,
      }),
    )
      .watch(() => setIsExporting(false))
      .ifOk((exportId) => {
        const link = `${window.location.origin}/export/${exportId}`;
        void navigator.clipboard.writeText(link);
        router.push(`/export/${exportId}`);
      })
      .ifFail((error) => {
        toast.error(error.message || "Failed to export chat");
      })
      .unwrap();
  }, [props.threadId, router]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogTrigger asChild>{props.children}</DialogTrigger>
      <DialogContent className="flex flex-col gap-4">
        <DialogHeader className="mb-4">
          <DialogTitle>{t("Chat.Thread.sharePublicLink")}</DialogTitle>
          <DialogDescription>
            {t("Chat.Thread.sharePublicLinkDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 p-6 rounded-full border">
          <span className="mr-auto truncate min-w-0">{`${window.location.origin}/export/...`}</span>
          <Button
            className="rounded-full"
            size="lg"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? (
              <Loader className="size-3.5 animate-spin" />
            ) : (
              <LinkIcon className="size-3.5" />
            )}
            {isExporting
              ? t("Chat.Thread.creatingLink")
              : t("Chat.Thread.createLink")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
