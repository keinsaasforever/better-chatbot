"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Loader2, Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useFileUpload } from "@/hooks/use-presigned-upload";
import { generateAvatarImageAction } from "@/app/api/user/actions";
import { useTranslations } from "next-intl";
import { Avatar, AvatarImage, AvatarFallback } from "ui/avatar";

interface GenerateAvatarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (imageUrl: string) => void;
}

export function GenerateAvatarDialog({
  open,
  onOpenChange,
  onGenerate,
}: GenerateAvatarDialogProps) {
  const t = useTranslations("User.Profile.common");
  const tCommon = useTranslations("Common");
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { upload } = useFileUpload({ uploadType: "avatar" });

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error(t("pleaseEnterPrompt"));
      return;
    }

    setIsGenerating(true);
    setGeneratedImage(null);

    try {
      const result = await generateAvatarImageAction(prompt);

      if (!result.success || !result.base64) {
        toast.error(result.error || t("failedToGenerateImage"));
        return;
      }

      // Convert base64 to data URL if needed
      const imageData = result.base64.startsWith("data:")
        ? result.base64
        : `data:${result.mimeType || "image/png"};base64,${result.base64}`;

      setGeneratedImage(imageData);
    } catch (error) {
      console.error("Failed to generate image:", error);
      toast.error(
        error instanceof Error ? error.message : t("failedToGenerateImage"),
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!generatedImage) return;

    setIsSaving(true);
    try {
      // Convert base64 to File
      const response = await fetch(generatedImage);
      const blob = await response.blob();
      const file = new File([blob], `avatar-${Date.now()}.png`, {
        type: "image/png",
      });

      // Upload to storage
      const result = await upload(file);
      if (result) {
        onGenerate(result.url);

        // Reset and close
        setPrompt("");
        setGeneratedImage(null);
        onOpenChange(false);
      }
    } catch (error) {
      console.error("Failed to save image:", error);
      toast.error(t("failedToSaveImage"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setPrompt("");
    setGeneratedImage(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            {t("generateAvatarWithAI")}
          </DialogTitle>
          <DialogDescription>
            Generate a professional avatar using Google Gemini 2.5 Flash Image
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Prompt Input */}
          <div className="space-y-2">
            <Label htmlFor="prompt">{t("describeYourAvatar")}</Label>
            <Input
              id="prompt"
              placeholder={t("avatarPromptPlaceholder")}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isGenerating}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isGenerating) {
                  handleGenerate();
                }
              }}
            />
          </div>

          {/* Generate Button */}
          {!generatedImage && (
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              className="w-full"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {t("generating")}
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 size-4" />
                  {tCommon("generate")}
                </>
              )}
            </Button>
          )}

          {/* Generated Image Preview */}
          {generatedImage && (
            <div className="space-y-3">
              <div className="relative aspect-square rounded-lg overflow-hidden border-2 border-border">
                <Avatar className="ring ring-border w-full h-full object-cover">
                  <AvatarImage src={generatedImage || undefined} />
                  <AvatarFallback>
                    {generatedImage.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  variant="outline"
                  className="flex-1"
                >
                  <RefreshCw className="mr-2 size-4" />
                  {t("regenerate")}
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex-1"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {tCommon("saving")}
                    </>
                  ) : (
                    t("useThisAvatar")
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={handleClose}>
            {tCommon("cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
