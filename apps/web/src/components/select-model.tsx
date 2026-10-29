"use client";

import { appStore } from "@/app/store";
import { LocalModelsDialog } from "@/components/local-models/local-models-dialog";
import { useChatModels } from "@/hooks/queries/use-chat-models";
import { useModelsMetadata } from "@/hooks/queries/use-models-metadata";
import { useLocalModelsAccess } from "@/hooks/use-local-models-access";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChatModel } from "app-types/chat";
import { cn, fetcher } from "lib/utils";
import { CheckIcon, ChevronDown, HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Fragment,
  PropsWithChildren,
  memo,
  useEffect,
  useMemo,
  useState,
} from "react";
import useSWR from "swr";
import { Button } from "ui/button";
import { Label } from "ui/label";
import { Switch } from "ui/switch";

import {
  BlockIcon,
  BrainIcon,
  CautionIcon,
  GemIcon,
  MaxIcon,
  PiggyBankIcon,
  RabbitIcon,
} from "@/components/ui/model-badge-icons";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "ui/command";
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from "ui/drawer";
import { ModelProviderIcon } from "ui/model-provider-icon";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "ui/tooltip";

interface SelectModelProps {
  onSelect: (model: ChatModel) => void;
  align?: "start" | "end";
  /** Preferred side of the trigger. Anchored callers (the chat composer) pass
   * "top" so the list opens over the conversation instead of under the input. */
  side?: "top" | "bottom";
  currentModel?: ChatModel;
  showProvider?: boolean;
}

// Helper function to convert country code to flag emoji
const getCountryFlag = (countryCode: string | null | undefined): string => {
  if (!countryCode) return "";

  const flags: Record<string, string> = {
    US: "🇺🇸",
    CN: "🇨🇳",
    EU: "🇪🇺",
  };

  return flags[countryCode.toUpperCase()] || "";
};

/**
 * Catalog price for one model, as "$3 / $15" (input / output per 1M tokens).
 *
 * Drizzle hands `numeric` back as a string, so the raw values look like
 * "3.0000000000" — readable only once trailing zeros are dropped. Sub-dollar
 * prices, which most cheap models have, need enough decimals to stay
 * distinguishable: $0.15 and $0.075 must not both render as "$0.1".
 *
 * Returns null unless both sides are known; half a price is worse than none.
 */
export function formatModelPrice(
  input?: string | null,
  output?: string | null,
): string | null {
  const format = (value?: string | null) => {
    if (value == null) return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    if (amount === 0) return "$0";
    const decimals = amount < 0.01 ? 4 : amount < 1 ? 3 : 2;
    // toFixed then trim: "0.1500" -> "0.15", "3.00" -> "3".
    return `$${amount.toFixed(decimals).replace(/\.?0+$/, "")}`;
  };

  const inputPrice = format(input);
  const outputPrice = format(output);
  if (!inputPrice || !outputPrice) return null;
  return `${inputPrice} / ${outputPrice}`;
}

// Helper function to get badge icons with tooltips
const getBadgeIcons = (badges: {
  hiddenGem?: boolean;
  caution?: boolean;
  notRecommended?: boolean;
  cheapAlternative?: boolean;
  speed?: boolean;
  thinking?: boolean;
  maxPerformance?: boolean;
}) => {
  const icons: Array<{ icon: React.ReactElement; tooltip: string }> = [];

  if (badges.hiddenGem) {
    icons.push({
      icon: <GemIcon className="size-3.5 text-amber-500" />,
      tooltip: "Best value for money. We recommend!",
    });
  }
  if (badges.maxPerformance) {
    icons.push({
      icon: <MaxIcon className="size-3.5 text-indigo-500" />,
      tooltip: "The best model from its developer",
    });
  }
  if (badges.speed) {
    icons.push({
      icon: <RabbitIcon className="size-3.5 text-blue-500" />,
      tooltip: "Super fast. Good for the impatient.",
    });
  }
  if (badges.thinking) {
    icons.push({
      icon: <BrainIcon className="size-3.5 text-purple-500" />,
      tooltip: "Follows instructions optimally through planning and reasoning.",
    });
  }
  if (badges.cheapAlternative) {
    icons.push({
      icon: <PiggyBankIcon className="size-3.5 text-green-500" />,
      tooltip: "Cheapest but good model from same developer.",
    });
  }
  if (badges.caution) {
    icons.push({
      icon: <CautionIcon className="size-3.5 text-orange-500" />,
      tooltip: "Expensive! $10+ per 1M output tokens.",
    });
  }
  if (badges.notRecommended) {
    icons.push({
      icon: <BlockIcon className="size-3.5 text-red-500" />,
      tooltip:
        "We have it because it's popular. But it has low quality output.",
    });
  }

  return icons;
};

type FilterType = "hiddenGem" | "speed" | "thinking";

/** Flagship chat models (google, openai, anthropic) shown under "Top 3". */
const FEATURED_TOP3_MODELS: ReadonlyArray<{ provider: string; model: string }> =
  [
    { provider: "google", model: "gemini-3.1-pro-preview" },
    { provider: "openai", model: "gpt-5.6-sol" },
    { provider: "anthropic", model: "claude-sonnet-5" },
  ];

/**
 * Direct TensorX provider (see lib/ai/models.ts). It gets its own block right
 * under "Top 3" rather than sitting in the alphabetical tail, because the
 * zero-retention path is the reason to pick it.
 */
const TENSORX_PROVIDER = "TensorX";

/** Suffix appended after a provider's name in its group heading. */
const PROVIDER_LABEL_SUFFIX: Record<string, string> = {
  [TENSORX_PROVIDER]: "(0 Data Retention)",
};

type ModelsProvider = NonNullable<
  ReturnType<typeof useChatModels>["data"]
>[number] & { isPlaceholder?: boolean };

function buildModelMenuPlan(filtered: ModelsProvider[] | undefined) {
  if (!filtered?.length) return null;

  const byProvider = new Map(filtered.map((p) => [p.provider, p]));
  const top3Key = new Set(
    FEATURED_TOP3_MODELS.map((t) => `${t.provider}\0${t.model}`),
  );

  const navigator = byProvider.get("Navigator");
  const baseModel =
    navigator?.models.some((m) => m.name === "Base model") && navigator
      ? {
          provider: navigator,
          item: navigator.models.find((m) => m.name === "Base model")!,
        }
      : null;

  const top3: Array<{
    provider: ModelsProvider;
    item: ModelsProvider["models"][number];
  }> = [];
  for (const ref of FEATURED_TOP3_MODELS) {
    const p = byProvider.get(ref.provider);
    const item = p?.models.find((m) => m.name === ref.model);
    if (p && item) top3.push({ provider: p, item });
  }

  const mistral = byProvider.get("mistral");
  const tensorx = byProvider.get(TENSORX_PROVIDER);

  const tail: ModelsProvider[] = [];
  const localPlaceholders: ModelsProvider[] = [];

  for (const p of filtered) {
    if (p.provider === "Navigator") continue;
    if (p.provider === "mistral") continue;
    if (p.provider === TENSORX_PROVIDER) continue;
    if (p.provider === "Add Local Models" || p.isPlaceholder) {
      localPlaceholders.push(p);
      continue;
    }
    if (p.provider === "Local Models") {
      localPlaceholders.push(p);
      continue;
    }

    const models = p.models.filter(
      (m) => !top3Key.has(`${p.provider}\0${m.name}`),
    );
    if (models.length > 0) {
      tail.push({ ...p, models });
    }
  }

  const mistralBlock = mistral && mistral.models.length > 0 ? mistral : null;
  const tensorxBlock = tensorx && tensorx.models.length > 0 ? tensorx : null;

  return {
    baseModel,
    top3,
    tensorx: tensorxBlock,
    mistral: mistralBlock,
    tail,
    localPlaceholders,
  };
}

export const SelectModel = (props: PropsWithChildren<SelectModelProps>) => {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const { data: providers } = useChatModels();
  const autoRouting = appStore((state) => state.autoRouting);
  const appStoreMutate = appStore((state) => state.mutate);
  const { data: routingAvailability } = useSWR<{
    enabled: boolean;
    candidateCount: number;
  }>("/api/chat/routing", fetcher, {
    dedupingInterval: 60_000 * 5,
    revalidateOnFocus: false,
  });
  const [model, setModel] = useState(props.currentModel);
  const [activeFilters, setActiveFilters] = useState<FilterType[]>([]);

  // NEW: Add local models dialog state
  const [showLocalModelsDialog, setShowLocalModelsDialog] = useState(false);
  const [forceConfigView, setForceConfigView] = useState(false);
  const { hasAccess } = useLocalModelsAccess();

  const t = useTranslations();

  // Fetch metadata from database
  const { data: modelsMetadata } = useModelsMetadata();

  // Helper to get badges and country for a model
  const getModelData = (provider: string, modelName: string) => {
    // Normalize provider name for matching (remove spaces, lowercase)
    const normalizeProvider = (name: string) =>
      name.toLowerCase().replace(/\s+/g, "");

    const metadata = modelsMetadata?.find(
      (m) =>
        normalizeProvider(m.developer) === normalizeProvider(provider) &&
        m.model === modelName,
    );

    if (!metadata) return { badges: {}, country: null, price: null };

    return {
      badges: {
        hiddenGem: metadata.hiddenGem,
        caution: metadata.caution,
        notRecommended: metadata.notRecommended,
        cheapAlternative: metadata.cheapAlternative,
        speed: metadata.speed,
        thinking: metadata.thinking,
        maxPerformance: metadata.maxPerformance,
      },
      country: metadata.country,
      price: formatModelPrice(metadata.inputPriceUsd, metadata.outputPriceUsd),
    };
  };

  // Filter providers based on active filters
  const filteredProviders = useMemo(() => {
    if (!providers || activeFilters.length === 0) return providers;

    return providers
      .map((provider) => {
        const filteredModels = provider.models.filter((modelItem) => {
          const modelData = getModelData(provider.provider, modelItem.name);
          // Check if model has ALL active filters
          return activeFilters.every(
            (filter) => modelData.badges[filter] === true,
          );
        });

        return filteredModels.length > 0
          ? { ...provider, models: filteredModels }
          : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [providers, activeFilters, modelsMetadata]);

  const toggleFilter = (filter: FilterType) => {
    setActiveFilters((prev) =>
      prev.includes(filter)
        ? prev.filter((f) => f !== filter)
        : [...prev, filter],
    );
  };

  const clearFilters = () => {
    setActiveFilters([]);
  };

  const hasNoResults =
    filteredProviders?.length === 0 &&
    (activeFilters.length > 0 || providers?.length === 0);

  const menuPlan = useMemo(
    () => buildModelMenuPlan(filteredProviders as ModelsProvider[] | undefined),
    [filteredProviders],
  );

  useEffect(() => {
    const modelToUse = props.currentModel ?? appStore.getState().chatModel;

    if (modelToUse) {
      setModel(modelToUse);
    }
  }, [props.currentModel]);

  function renderModelItem(
    provider: ModelsProvider,
    item: ModelsProvider["models"][number],
  ) {
    const modelData = getModelData(provider.provider, item.name);
    const badgeIcons = getBadgeIcons(modelData.badges);
    const flag = getCountryFlag(modelData.country);

    return (
      <CommandItem
        key={`${provider.provider}-${item.name}`}
        disabled={!provider.hasAPIKey}
        className="cursor-pointer"
        onSelect={() => {
          appStoreMutate({ autoRouting: false });
          setModel({
            provider: provider.provider,
            model: item.name,
          });
          props.onSelect({
            provider: provider.provider,
            model: item.name,
          });
          setOpen(false);
        }}
        // cmdk tracks items by value, so it must be unique: Kimi K3 is offered
        // both via the gateway and via TensorX. The name stays a substring, so
        // searching by model name still matches.
        value={`${provider.provider}/${item.name}`}
        data-testid={`model-option-${provider.provider}-${item.name}`}
      >
        {model?.provider === provider.provider && model?.model === item.name ? (
          <CheckIcon className="size-3" data-testid="selected-model-check" />
        ) : (
          <div className="ml-3" />
        )}
        <span className="pr-2 flex items-center gap-1">
          {item.name}
          {flag && <span className="text-sm">{flag}</span>}
        </span>

        {modelData.price && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                {modelData.price}
              </span>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p className="text-xs">
                {t("Chat.modelPriceTooltip", { price: modelData.price })}
              </p>
            </TooltipContent>
          </Tooltip>
        )}

        {badgeIcons.length > 0 && (
          <div
            className={cn(
              "flex gap-1 mr-2",
              // The price already claimed ml-auto when it is shown.
              !modelData.price && "ml-auto",
              modelData.price && "ml-2",
            )}
          >
            {badgeIcons.map((badge, idx) => (
              <Tooltip key={idx}>
                <TooltipTrigger asChild>
                  <div className="flex items-center">{badge.icon}</div>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p className="text-xs">{badge.tooltip}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}

        {item.isToolCallUnsupported && (
          <div
            className={cn(
              "flex items-center gap-1 text-xs text-muted-foreground",
              // Whichever of price/badges renders first already took ml-auto.
              badgeIcons.length === 0 && !modelData.price && "ml-auto",
            )}
          >
            No tools
          </div>
        )}
      </CommandItem>
    );
  }

  function renderModelsProviderGroup(provider: ModelsProvider) {
    return (
      <CommandGroup
        heading={
          <ProviderHeader
            provider={provider.provider}
            hasAPIKey={provider.hasAPIKey}
            isPlaceholder={provider.isPlaceholder}
          />
        }
        className={cn("pb-4 group", !provider.hasAPIKey && "opacity-50")}
        onWheel={(e) => {
          e.stopPropagation();
        }}
        data-testid={`model-provider-${provider.provider}`}
      >
        {provider.isPlaceholder ? (
          <CommandItem
            className="cursor-pointer"
            onSelect={() => {
              setOpen(false);
              setForceConfigView(false);
              setShowLocalModelsDialog(true);
            }}
            data-testid="add-local-models-button"
          >
            <span className="text-sm text-primary font-medium">
              Add local Model
            </span>
          </CommandItem>
        ) : (
          provider.models.map((item) => renderModelItem(provider, item))
        )}

        {provider.provider === "Local Models" &&
          provider.hasAPIKey &&
          provider.models.length > 0 && (
            <CommandItem
              className="cursor-pointer"
              onSelect={() => {
                setOpen(false);
                setForceConfigView(true);
                setShowLocalModelsDialog(true);
              }}
              data-testid="update-local-models-button"
            >
              <span className="text-sm text-primary font-medium">Update</span>
            </CommandItem>
          )}
      </CommandGroup>
    );
  }

  /** A plain provider group, without the Local Models add/update affordances. */
  function renderSimpleProviderGroup(provider: ModelsProvider) {
    return (
      <CommandGroup
        heading={
          <ProviderHeader
            provider={provider.provider}
            hasAPIKey={provider.hasAPIKey}
            isPlaceholder={provider.isPlaceholder}
          />
        }
        className={cn("pb-4 group", !provider.hasAPIKey && "opacity-50")}
        onWheel={(e) => {
          e.stopPropagation();
        }}
        data-testid={`model-provider-${provider.provider}`}
      >
        {provider.models.map((item) => renderModelItem(provider, item))}
      </CommandGroup>
    );
  }

  const trigger = props.children || (
    <Button
      variant={"secondary"}
      size={"sm"}
      className="data-[state=open]:bg-input! hover:bg-input! "
      data-testid="model-selector-button"
    >
      <div className="mr-auto flex items-center gap-1">
        {(props.showProvider ?? true) && (
          <ModelProviderIcon
            provider={model?.provider || ""}
            className="size-2.5 mr-1"
          />
        )}
        <p data-testid="selected-model-name">{model?.model || "model"}</p>
      </div>
      <ChevronDown className="size-3" />
    </Button>
  );

  const modelCommand = (
    <Command
      className={cn(
        "relative",
        isMobile ? "h-full rounded-none" : "rounded-lg shadow-md h-80",
      )}
      value={JSON.stringify(model)}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Filter Buttons */}
      <div className="p-3 border-b">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 shrink-0">
            <Label
              htmlFor="automatic-routing"
              className="text-xs text-muted-foreground cursor-pointer"
            >
              Automatic
            </Label>
            <Switch
              id="automatic-routing"
              checked={autoRouting}
              disabled={routingAvailability?.enabled === false}
              onCheckedChange={(checked) =>
                appStoreMutate({ autoRouting: checked })
              }
              data-testid="automatic-routing-toggle"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={
                  activeFilters.includes("hiddenGem") ? "default" : "outline"
                }
                className="size-8 p-0"
                onClick={() => toggleFilter("hiddenGem")}
              >
                <GemIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Hidden Gems - Best value for money</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={
                  activeFilters.includes("speed") ? "default" : "outline"
                }
                className="size-8 p-0"
                onClick={() => toggleFilter("speed")}
              >
                <RabbitIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Speed - Super fast models</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={
                  activeFilters.includes("thinking") ? "default" : "outline"
                }
                className="size-8 p-0"
                onClick={() => toggleFilter("thinking")}
              >
                <BrainIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Thinking - Reasoning capable models</p>
            </TooltipContent>
          </Tooltip>

          {activeFilters.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="ml-auto text-xs"
            >
              Clear
            </Button>
          )}

          {/* Help/Legend Icon */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "size-8 p-0",
                  activeFilters.length === 0 && "ml-auto",
                )}
              >
                <HelpCircle className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" className="w-64 text-sm">
              <div className="space-y-2">
                <h3 className="font-semibold">Model Badges</h3>
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <GemIcon className="size-3.5 text-amber-500 mt-0.5" />
                    <span className="text-xs">
                      Best value for money. We recommend!
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <MaxIcon className="size-3.5 text-indigo-500 mt-0.5" />
                    <span className="text-xs">
                      The best model from its developer
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <RabbitIcon className="size-3.5 text-blue-500 mt-0.5" />
                    <span className="text-xs">
                      Super fast. Good for the impatient.
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <BrainIcon className="size-3.5 text-purple-500 mt-0.5" />
                    <span className="text-xs">
                      Follows instructions optimally through planning and
                      reasoning.
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <PiggyBankIcon className="size-3.5 text-green-500 mt-0.5" />
                    <span className="text-xs">
                      Cheapest but good model from same developer.
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CautionIcon className="size-3.5 text-orange-500 mt-0.5" />
                    <span className="text-xs">
                      Expensive! $10+ per 1M output tokens.
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <BlockIcon className="size-3.5 text-red-500 mt-0.5" />
                    <span className="text-xs">
                      We have it because it's popular. But it has low quality
                      output.
                    </span>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <CommandInput
        placeholder="search model..."
        data-testid="model-search-input"
      />
      <CommandList className="p-2">
        {hasNoResults ? (
          <div className="space-y-3 p-4 text-center text-sm text-muted-foreground">
            <p>No models match the selected filters.</p>
            {activeFilters.length > 0 && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <>
            <CommandEmpty>No results found.</CommandEmpty>
            {menuPlan && (
              <>
                {menuPlan.baseModel && (
                  <CommandGroup
                    heading="Base model"
                    className={cn(
                      "pb-4 group",
                      !menuPlan.baseModel.provider.hasAPIKey && "opacity-50",
                    )}
                    onWheel={(e) => {
                      e.stopPropagation();
                    }}
                    data-testid="model-section-base"
                  >
                    {renderModelItem(
                      menuPlan.baseModel.provider,
                      menuPlan.baseModel.item,
                    )}
                  </CommandGroup>
                )}
                {menuPlan.baseModel &&
                  (menuPlan.top3.length > 0 ||
                    menuPlan.tensorx ||
                    menuPlan.mistral ||
                    menuPlan.tail.length > 0 ||
                    menuPlan.localPlaceholders.length > 0) && (
                    <CommandSeparator />
                  )}
                {menuPlan.top3.length > 0 && (
                  <CommandGroup
                    heading="Top 3"
                    className="pb-4 group"
                    onWheel={(e) => {
                      e.stopPropagation();
                    }}
                    data-testid="model-section-top3"
                  >
                    {menuPlan.top3.map(({ provider, item }) =>
                      renderModelItem(provider, item),
                    )}
                  </CommandGroup>
                )}
                {menuPlan.top3.length > 0 &&
                  (menuPlan.tensorx ||
                    menuPlan.mistral ||
                    menuPlan.tail.length > 0 ||
                    menuPlan.localPlaceholders.length > 0) && (
                    <CommandSeparator />
                  )}
                {menuPlan.tensorx &&
                  renderSimpleProviderGroup(menuPlan.tensorx)}
                {menuPlan.tensorx &&
                  (menuPlan.mistral ||
                    menuPlan.tail.length > 0 ||
                    menuPlan.localPlaceholders.length > 0) && (
                    <CommandSeparator />
                  )}
                {menuPlan.mistral &&
                  renderSimpleProviderGroup(menuPlan.mistral)}
                {menuPlan.mistral &&
                  (menuPlan.tail.length > 0 ||
                    menuPlan.localPlaceholders.length > 0) && (
                    <CommandSeparator />
                  )}
                {menuPlan.tail.map((provider, i) => (
                  <Fragment key={provider.provider}>
                    {renderModelsProviderGroup(provider)}
                    {i < menuPlan.tail.length - 1 ? <CommandSeparator /> : null}
                  </Fragment>
                ))}
                {menuPlan.tail.length > 0 &&
                  menuPlan.localPlaceholders.length > 0 && <CommandSeparator />}
                {menuPlan.localPlaceholders.map((provider, i) => (
                  <Fragment key={provider.provider}>
                    {renderModelsProviderGroup(provider)}
                    {i < menuPlan.localPlaceholders.length - 1 ? (
                      <CommandSeparator />
                    ) : null}
                  </Fragment>
                ))}
              </>
            )}
          </>
        )}
      </CommandList>
    </Command>
  );

  return (
    <TooltipProvider>
      {isMobile ? (
        // Phones get a sheet instead of an anchored popover. Anchored to a
        // composer that sits mid-screen there is no room for the list above the
        // input, so Radix flipped it below — half of it landing behind the
        // browser toolbar, and re-anchoring (jumping) whenever a scroll
        // collapsed that toolbar. A sheet is fixed to the viewport, so it can
        // neither be clipped nor move while open.
        <Drawer open={open} onOpenChange={setOpen} repositionInputs={false}>
          <DrawerTrigger asChild>{trigger}</DrawerTrigger>
          <DrawerContent
            className="h-[70dvh] p-0"
            data-testid="model-selector-popover"
          >
            <DrawerTitle className="sr-only">Select model</DrawerTitle>
            <div className="min-h-0 flex-1 pt-2">{modelCommand}</div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent
            className="p-0 w-[320px] max-w-[calc(100vw-1rem)]"
            align={props.align || "end"}
            side={props.side}
            collisionPadding={12}
            data-testid="model-selector-popover"
          >
            {modelCommand}
          </PopoverContent>
        </Popover>
      )}

      {/* NEW: Add local models dialog */}
      <LocalModelsDialog
        open={showLocalModelsDialog}
        onOpenChange={setShowLocalModelsDialog}
        hasAccess={forceConfigView || hasAccess}
      />
    </TooltipProvider>
  );
};

const ProviderHeader = memo(function ProviderHeader({
  provider,
  hasAPIKey,
  isPlaceholder,
}: {
  provider: string;
  hasAPIKey: boolean;
  isPlaceholder?: boolean;
}) {
  return (
    <div className="text-sm text-muted-foreground flex items-center gap-1.5 group-hover:text-foreground transition-colors duration-300">
      {provider === "openai" ? (
        <ModelProviderIcon
          provider="openai"
          className="size-3 text-foreground"
        />
      ) : (
        <ModelProviderIcon provider={provider} className="size-3" />
      )}
      {provider}
      {PROVIDER_LABEL_SUFFIX[provider] && (
        <span className="text-xs">{PROVIDER_LABEL_SUFFIX[provider]}</span>
      )}
      {!hasAPIKey && !isPlaceholder && (
        <>
          <span className="text-xs ml-auto text-muted-foreground">
            No API Key
          </span>
        </>
      )}
    </div>
  );
});
