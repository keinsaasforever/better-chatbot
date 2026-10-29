"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Hash, Lock, RefreshCw, Slack } from "lucide-react";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import { Skeleton } from "ui/skeleton";
import { Switch } from "ui/switch";
import { fetcher } from "lib/utils";

interface SlackStatus {
  connected: boolean;
  botName: string;
  connection: {
    id: string;
    slackTeamId: string | null;
    slackTeamName: string | null;
    slackBotUserId: string | null;
    triggerId: string | null;
  } | null;
  subscriptions: Array<{
    channelId: string;
    channelName: string | null;
    enabled: boolean;
    agentId: string | null;
  }>;
}

interface ChannelRow {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  enabled: boolean;
  agentId: string | null;
}

interface AgentSummaryLite {
  id: string;
  name: string;
}

const NO_AGENT = "__none__";

export default function SlackIntegrationSettings() {
  const {
    data: status,
    isLoading: statusLoading,
    mutate: refreshStatus,
  } = useSWR<SlackStatus>("/api/slack", fetcher);

  const { data: agents } = useSWR<AgentSummaryLite[]>(
    "/api/agent?filters=mine,shared&limit=100",
    fetcher,
  );

  const [channels, setChannels] = useState<ChannelRow[] | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const loadChannels = useCallback(async () => {
    setChannelsLoading(true);
    try {
      const res = await fetch("/api/slack/channels");
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setChannels(data.channels);
    } catch (error: any) {
      toast.error(error?.message || "Failed to load Slack channels");
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  // Finalize the connection when returning from the Composio OAuth flow.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("connected") !== "1") return;
    url.searchParams.delete("connected");
    window.history.replaceState({}, "", url.toString());

    (async () => {
      try {
        const res = await fetch("/api/slack/sync", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (data.triggerError) {
          toast.warning(
            `Slack connected, but trigger setup failed: ${data.triggerError}`,
          );
        }
        await refreshStatus();
        await loadChannels();
      } catch (error: any) {
        toast.error(error?.message || "Failed to finalize Slack connection");
      }
    })();
  }, [refreshStatus, loadChannels]);

  useEffect(() => {
    if (status?.connected && channels === null && !channelsLoading) {
      void loadChannels();
    }
  }, [status?.connected, channels, channelsLoading, loadChannels]);

  const connect = async () => {
    setConnecting(true);
    try {
      const res = await fetch("/api/slack/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.redirectUrl) {
        throw new Error(data.error || "Failed to start Slack OAuth");
      }
      window.location.href = data.redirectUrl;
    } catch (error: any) {
      toast.error(error?.message || "Failed to connect Slack");
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    try {
      const res = await fetch("/api/slack", { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      setChannels(null);
      await refreshStatus();
    } catch (error: any) {
      toast.error(error?.message || "Failed to disconnect Slack");
    }
  };

  const updateChannel = (id: string, patch: Partial<ChannelRow>) => {
    setChannels(
      (prev) =>
        prev?.map((c) => (c.id === id ? { ...c, ...patch } : c)) ?? prev,
    );
  };

  const save = async () => {
    if (!channels) return;
    setSaving(true);
    try {
      const res = await fetch("/api/slack/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels: channels
            .filter((c) => c.enabled || c.agentId)
            .map((c) => ({
              channelId: c.id,
              channelName: c.name,
              isPrivate: c.isPrivate,
              enabled: c.enabled,
              agentId: c.agentId,
            })),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      await refreshStatus();
    } catch (error: any) {
      toast.error(error?.message || "Failed to save channels");
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = useMemo(
    () => channels?.filter((c) => c.enabled).length ?? 0,
    [channels],
  );

  const botHandle = `@${status?.botName ?? "navigator"}`;

  if (statusLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Slack className="size-5" />
            Slack Integration
          </CardTitle>
          <CardDescription>
            Connect your Slack workspace and mention {botHandle} in enabled
            channels to run your agents from Slack.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {status?.connected ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="secondary">
                  {status.connection?.slackTeamName ||
                    status.connection?.slackTeamId ||
                    "Workspace connected"}
                </Badge>
                <Badge variant="outline">Bot: {botHandle}</Badge>
                <Badge variant="outline">
                  {enabledCount} channel{enabledCount === 1 ? "" : "s"} enabled
                </Badge>
                {!status.connection?.triggerId && (
                  <Badge variant="destructive">
                    Trigger missing — reconnect
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadChannels()}
                  disabled={channelsLoading}
                >
                  <RefreshCw className="size-4 mr-1" />
                  Reload channels
                </Button>
                <Button variant="destructive" size="sm" onClick={disconnect}>
                  Disconnect
                </Button>
              </div>
            </>
          ) : (
            <div>
              <Button onClick={connect} disabled={connecting}>
                {connecting ? "Redirecting…" : "Connect Slack"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {status?.connected && (
        <Card>
          <CardHeader>
            <CardTitle>Channels</CardTitle>
            <CardDescription>
              {botHandle} only responds in channels you enable here. For private
              channels, first run{" "}
              <code className="bg-muted px-1 rounded">/invite {botHandle}</code>{" "}
              in Slack, then reload channels.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {channelsLoading && !channels ? (
              <Skeleton className="h-40 w-full" />
            ) : channels && channels.length > 0 ? (
              <>
                <div className="flex flex-col divide-y">
                  {channels.map((channel) => (
                    <div
                      key={channel.id}
                      className="flex items-center gap-3 py-2"
                    >
                      {channel.isPrivate ? (
                        <Lock className="size-4 text-muted-foreground shrink-0" />
                      ) : (
                        <Hash className="size-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="flex-1 truncate text-sm">
                        {channel.name}
                      </span>
                      <Select
                        value={channel.agentId ?? NO_AGENT}
                        onValueChange={(value) =>
                          updateChannel(channel.id, {
                            agentId: value === NO_AGENT ? null : value,
                          })
                        }
                      >
                        <SelectTrigger className="w-44 h-8">
                          <SelectValue placeholder="Default agent" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_AGENT}>
                            Default assistant
                          </SelectItem>
                          {(agents ?? []).map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              {agent.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Switch
                        checked={channel.enabled}
                        onCheckedChange={(checked) =>
                          updateChannel(channel.id, { enabled: checked })
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end pt-2">
                  <Button onClick={save} disabled={saving}>
                    {saving ? "Saving…" : "Save channels"}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No channels found. Make sure the Slack connection is active,
                then reload.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
