import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { MessageCircle, Zap, TrendingUp, Cpu } from "lucide-react";
import { useProfileTranslations } from "@/hooks/use-profile-translations";
import { PieChart } from "@/components/tool-invocation/pie-chart";

import { ModelProviderIcon } from "ui/model-provider-icon";

interface UserStatisticsCardProps {
  stats: {
    threadCount: number;
    messageCount: number;
    modelStats: Array<{
      model: string;
      messageCount: number;
      totalTokens: number;
      provider: string;
    }>;
    totalTokens: number;
    period: string;
  };
  view?: "admin" | "user";
}

export function UserStatisticsCard({ stats, view }: UserStatisticsCardProps) {
  const { t, tCommon } = useProfileTranslations(view);
  const hasActivity = stats.totalTokens > 0;

  // Prepare pie chart data for model usage (TOP 3 only)
  const top3Models = stats.modelStats.slice(0, 3);
  const modelPieData = top3Models.map((model) => ({
    label: model.model,
    value: model.totalTokens,
  }));

  return (
    <Card
      className="transition-all duration-200 hover:shadow-md"
      data-testid="user-statistics-card"
    >
      <CardHeader className="pb-4">
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-accent-foreground" />
          {tCommon("usageStatistics")}
        </CardTitle>
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          {t("aiModelUsageFor", { period: stats.period })}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {!hasActivity ? (
          // Empty State
          <div className="text-center py-12" data-testid="no-activity-state">
            <div className="mx-auto w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-4">
              <TrendingUp className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {tCommon("noAiActivityYet")}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("noAiActivityDescription")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("usageStatsWillAppear")}
            </p>
          </div>
        ) : (
          <>
            {/* Main Stats Grid */}
            <div className="grid gap-4 sm:grid-cols-4" data-testid="stats-grid">
              {/* Total Tokens */}
              <div
                className="rounded-lg border p-3 bg-primary/10 col-span-2"
                data-testid="total-tokens-stat"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-full p-2 bg-primary/10 shrink-0">
                    <Zap className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      {tCommon("totalTokens")}
                    </p>
                    <p
                      className="text-xl font-bold"
                      data-testid="stat-total-tokens"
                    >
                      {stats.totalTokens.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {tCommon("totalTokensNote")}
                    </p>
                  </div>
                </div>
              </div>

              {/* Models Used */}
              <div
                className="rounded-lg border p-3 bg-muted/30"
                data-testid="models-used-stat"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-full p-2 bg-muted shrink-0">
                    <Cpu className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      {tCommon("models")}
                    </p>
                    <p
                      className="text-xl font-bold"
                      data-testid="stat-models-used"
                    >
                      {stats.modelStats.length}
                    </p>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div
                className="rounded-lg border p-3 bg-muted/30"
                data-testid="messages-stat"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-full p-2 bg-muted shrink-0">
                    <MessageCircle className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      {tCommon("messages")}
                    </p>
                    <p
                      className="text-xl font-bold"
                      data-testid="stat-messages-sent"
                    >
                      {stats.messageCount}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Top Models by Token Usage */}
            {stats.modelStats.length > 0 && (
              <div
                className="rounded-lg border bg-muted/30 p-4 space-y-4"
                data-testid="top-models-section"
              >
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Cpu className="h-4 w-4" />
                  {tCommon("topModelsByTokenUsage")}
                </h4>

                <div className="grid gap-6 lg:grid-cols-2">
                  {/* Pie Chart - TOP 3 Models */}
                  <div className="min-h-[300px]">
                    <PieChart
                      title="Top 3 Models Usage"
                      data={modelPieData}
                      unit="tokens"
                      prefix=""
                      jsonView={false}
                      description="Token usage by top 3 models"
                    />
                  </div>

                  {/* Model List - Vertical Layout with Scroll */}
                  <div className="space-y-2 max-h-[420px] overflow-y-auto ">
                    <div className="pr-2 space-y-2">
                      {stats.modelStats.map((modelStat, index) => (
                        <div
                          key={modelStat.model}
                          className={`flex items-center justify-between p-3 rounded-lg border hover:bg-background/70 transition-colors ${
                            index < 3
                              ? "bg-primary/5 border-primary/20"
                              : "bg-background/50"
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <ModelProviderIcon
                                provider={modelStat.provider}
                                className="h-4 w-4 shrink-0"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">
                                {modelStat.model}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {modelStat.messageCount} {tCommon("msgs")}
                              </div>
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-right shrink-0 ml-3">
                            {modelStat.totalTokens.toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Stats */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-muted/30 p-3 text-center">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  {tCommon("conversations")}
                </p>
                <p
                  className="text-lg font-semibold"
                  data-testid="stat-chat-threads"
                >
                  {stats.threadCount}
                </p>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 text-center">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  {tCommon("avgTokensPerMessage")}
                </p>
                <p className="text-lg font-semibold">
                  {stats.messageCount > 0
                    ? Math.round(
                        stats.totalTokens / stats.messageCount,
                      ).toLocaleString()
                    : 0}
                </p>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 text-center">
                <p className="text-xs font-medium text-muted-foreground mr-1 mb-1">
                  {tCommon("topModel")}
                </p>
                <p className="text-lg font-semibold flex items-center justify-center gap-1">
                  {stats.modelStats[0] && (
                    <ModelProviderIcon
                      provider={stats.modelStats[0].provider}
                      className="h-3 w-3 mr-1"
                    />
                  )}
                  <span className="truncate">
                    {stats.modelStats[0]?.model || tCommon("notAvailable")}
                  </span>
                </p>
              </div>
            </div>

            {/* Insights */}
            {stats.totalTokens > 0 && (
              <div className="rounded-lg p-3">
                <p className="text-sm text-primary/80">
                  {tCommon("tokensAcross", {
                    tokens: stats.totalTokens.toLocaleString(),
                    count: stats.modelStats.length,
                    period: stats.period.toLowerCase(),
                  })}
                  {stats.modelStats[0] && (
                    <>
                      {" "}
                      {tCommon("mostActive", {
                        model: stats.modelStats[0].model,
                        tokens:
                          stats.modelStats[0].totalTokens.toLocaleString(),
                      })}
                    </>
                  )}
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
