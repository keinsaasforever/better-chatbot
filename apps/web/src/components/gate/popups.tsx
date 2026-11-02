"use client";

import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";

import { appStore } from "@/app/store";

/**
 * The Teams plan is set up together with keinsaas on a short call: billing,
 * and moving the team onto the hosted product, where organizations live.
 */
const TEAMS_PLAN_BOOKING_URL = "https://calendar.app.google/aLE4gKQ664c1X4HS9";

/**
 * Community build: the billing, organization-settings and managed builder
 * popups belong to the hosted product. What remains is the pitch behind
 * "Create Organization": team workspaces are a hosted Teams plan.
 */
export function CloudPopups() {
  return <TeamsPlanDialog />;
}

function TeamsPlanDialog() {
  const t = useTranslations("Organization.teamsPlan");
  const open = appStore((state) => state.openTeamsPlan);
  const close = () => appStore.setState({ openTeamsPlan: false });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent data-testid="teams-plan-dialog">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
            <Building2 className="size-5 text-muted-foreground" />
          </div>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t("dismiss")}
          </Button>
          <Button asChild>
            <a
              href={TEAMS_PLAN_BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={close}
            >
              {t("cta")}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
