"use client";

import {
  type CockpitConnectionItem,
  type CockpitScopeSummary,
  type ConnectionMutationResult,
  useCockpitConnections,
} from "@/hooks/queries/use-cockpit-connections";
import { useMcpList } from "@/hooks/queries/use-mcp-list";
import {
  PROVIDER_FIELDS,
  type ProviderField,
  formatProjectLines,
  isSecretField,
  parseProjectLines,
} from "lib/cockpit/providers/schemas";
import { reasonText } from "lib/cockpit/reasons";
import { COCKPIT_PROVIDERS, type CockpitProvider } from "lib/cockpit/types";
import { cn } from "lib/utils";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Input } from "ui/input";
import { Label } from "ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import { Switch } from "ui/switch";
import { Textarea } from "ui/textarea";
import {
  ConsoleOverlay,
  ConsolePushbutton,
  GLASS,
  type PushbuttonState,
} from "./console-overlay";
import { CK, MONO } from "./instruments";

type LedState = "ok" | "error" | "off";

/**
 * Connections belong to the active workspace. Says which one, and when this
 * workspace has none but another one does, points there: switching workspace
 * (or a new session in the default workspace) otherwise makes saved
 * connections look lost.
 */
function ScopeNotice({
  scope,
  empty,
}: {
  scope: CockpitScopeSummary | null;
  empty: boolean;
}) {
  const t = useTranslations("Cockpit");
  if (!scope) return null;
  const name = (workspace: string | null) =>
    workspace ?? t("connect.personalWorkspace");
  const elsewhere = empty ? scope.elsewhere : [];
  return (
    <div className="mb-3 space-y-2 text-sm">
      <p className="text-white/60">
        {t("connect.workspace", { name: name(scope.workspace) })}
      </p>
      {elsewhere.map((other) => (
        <p
          key={other.workspace ?? "personal"}
          className="rounded-lg px-3 py-2"
          style={{
            color: CK.amber,
            backgroundColor: `${CK.amber}1a`,
            boxShadow: `inset 0 0 0 1px ${CK.amber}4d`,
          }}
        >
          {t("connect.elsewhere", {
            count: other.count,
            name: name(other.workspace),
          })}
        </p>
      ))}
    </div>
  );
}

function ledOf(connection: CockpitConnectionItem | undefined): LedState {
  if (!connection) return "off";
  if (connection.lastError || !connection.enabled) return "error";
  return "ok";
}

const LED_COLOR: Record<LedState, string> = {
  ok: CK.green,
  error: CK.red,
  off: CK.amber,
};

/**
 * CONNECT overhead pushbutton: the console that lists the six data sources
 * with an LED each, and a dialog per source to enter, test, save or remove
 * its credentials. Secrets are write-only: the API returns which secret
 * fields are set, never their values.
 */
export function ConnectConsole() {
  const t = useTranslations("Cockpit");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CockpitProvider | null>(null);
  const connections = useCockpitConnections();
  const byProvider = new Map(
    connections.connections.map((c) => [c.provider, c] as const),
  );

  const leds = COCKPIT_PROVIDERS.map((p) => ledOf(byProvider.get(p)));
  const state: PushbuttonState = leds.includes("error")
    ? "fault"
    : leds.includes("ok")
      ? "on"
      : "off";

  return (
    <>
      <ConsolePushbutton
        label={t("overhead.connect.label")}
        detail={t("overhead.connect.detail")}
        state={state}
        stateLabel={t(`status.${state}`)}
        actionLabel={t("connect.openHint")}
        open={open}
        onOpenChange={setOpen}
      />
      <ConsoleOverlay
        open={open}
        onOpenChange={setOpen}
        title={t("connect.title")}
        subtitle={t("connect.subtitle")}
        closeLabel={t("console.close")}
      >
        <div className={cn(GLASS, "p-3 md:p-4")}>
          {!connections.secretsAvailable && (
            <p
              className="mb-3 rounded-lg bg-[#ff4d4d]/10 px-3 py-2 text-sm ring-1 ring-[#ff4d4d]/30"
              style={{ color: CK.red }}
            >
              {t("reasons.secretsUnavailable")}
            </p>
          )}
          {!connections.isLoading && !connections.canManage && (
            <p className="mb-3 text-sm text-white/70">
              {t("connect.readOnly")}
            </p>
          )}
          <ScopeNotice
            scope={connections.scope}
            empty={
              !connections.isLoading && connections.connections.length === 0
            }
          />
          <ul className="divide-y divide-white/10">
            {COCKPIT_PROVIDERS.map((provider) => {
              const connection = byProvider.get(provider);
              const led = ledOf(connection);
              return (
                <li
                  key={provider}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: LED_COLOR[led],
                        boxShadow: `0 0 8px ${LED_COLOR[led]}`,
                      }}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white">
                        {t(`connect.providers.${provider}.name`)}
                      </div>
                      <div
                        className="truncate text-xs"
                        style={{ ...MONO, color: LED_COLOR[led] }}
                      >
                        {statusLine(t, connection)}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0"
                    disabled={!connections.canManage}
                    onClick={() => setEditing(provider)}
                  >
                    {connection ? t("connect.configure") : t("connect.connect")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
        {/* Rendered inside the console so Radix stacks the two layers. */}
        {editing && (
          <ProviderDialog
            provider={editing}
            connection={byProvider.get(editing)}
            onClose={() => setEditing(null)}
            actions={connections}
          />
        )}
      </ConsoleOverlay>
    </>
  );
}

function statusLine(
  t: ReturnType<typeof useTranslations<"Cockpit">>,
  connection: CockpitConnectionItem | undefined,
): string {
  if (!connection) return t("status.notConnected");
  if (!connection.enabled) return t("reasons.disabled");
  if (connection.lastError) return reasonText(t, connection.lastError);
  return connection.lastOkAt ? t("connect.ok") : t("connect.saved");
}

type FormValues = Record<string, string | boolean>;

function initialValues(
  provider: CockpitProvider,
  connection: CockpitConnectionItem | undefined,
): FormValues {
  const values: FormValues = {};
  const stored = connection?.config.values ?? {};
  for (const field of PROVIDER_FIELDS[provider]) {
    const value = stored[field.name];
    if (field.type === "boolean") values[field.name] = value === true;
    else if (field.type === "projects")
      values[field.name] = formatProjectLines(
        value as Array<{ label: string; projectId: string }>,
      );
    else if (field.type === "select")
      values[field.name] = String(value ?? field.options?.[0] ?? "");
    else values[field.name] = value === undefined ? "" : String(value);
  }
  return values;
}

function toConfig(
  provider: CockpitProvider,
  values: FormValues,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of PROVIDER_FIELDS[provider]) {
    const value = values[field.name];
    if (field.type === "projects") {
      config[field.name] = parseProjectLines(String(value ?? ""));
    } else if (field.type === "boolean") {
      config[field.name] = value === true;
    } else if (field.type === "number") {
      if (value !== "") config[field.name] = Number(value);
    } else {
      config[field.name] = value;
    }
  }
  return config;
}

function ProviderDialog({
  provider,
  connection,
  onClose,
  actions,
}: {
  provider: CockpitProvider;
  connection: CockpitConnectionItem | undefined;
  onClose: () => void;
  actions: ReturnType<typeof useCockpitConnections>;
}) {
  const t = useTranslations("Cockpit");
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() =>
    initialValues(provider, connection),
  );
  const [busy, setBusy] = useState<null | "test" | "save" | "remove">(null);
  const [result, setResult] = useState<
    (ConnectionMutationResult & { action: "test" | "save" }) | null
  >(null);
  const fieldKey = (name: string) =>
    `connect.providers.${provider}.fields.${name}`;

  useEffect(() => {
    setValues(initialValues(provider, connection));
  }, [provider, connection?.updatedAt]);

  const run = async (
    action: "test" | "save",
    fn: () => Promise<ConnectionMutationResult>,
  ) => {
    setBusy(action);
    setResult(null);
    try {
      const outcome = await fn();
      setResult({ ...outcome, action });
      if (outcome.ok && action === "save") router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!connection) return;
    setBusy("remove");
    try {
      const outcome = await actions.remove(connection.id);
      if (outcome.ok) {
        router.refresh();
        onClose();
      } else setResult({ ...outcome, action: "save" });
    } finally {
      setBusy(null);
    }
  };

  const issues = result && !result.ok ? (result.issues ?? []) : [];

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(`connect.providers.${provider}.name`)}</DialogTitle>
          <DialogDescription>
            {t(`connect.providers.${provider}.help`)}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run("save", () =>
              actions.save(provider, toConfig(provider, values)),
            );
          }}
        >
          {PROVIDER_FIELDS[provider].map((field) => (
            <FieldInput
              key={field.name}
              id={`cockpit-${provider}-${field.name}`}
              field={field}
              label={t(`${fieldKey(field.name)}.label`)}
              help={
                t.has(`${fieldKey(field.name)}.help`)
                  ? t(`${fieldKey(field.name)}.help`)
                  : undefined
              }
              invalid={issues.includes(field.name)}
              isSet={
                connection?.config.secretsSet.includes(field.name) ?? false
              }
              keepPlaceholder={t("connect.secretKept")}
              value={values[field.name]}
              onChange={(v) =>
                setValues((prev) => ({ ...prev, [field.name]: v }))
              }
            />
          ))}
          {result && (
            <p
              role="status"
              className="text-sm"
              style={{ color: result.ok ? "#16a34a" : "#dc2626" }}
            >
              {result.ok
                ? result.action === "test"
                  ? t("connect.testOk")
                  : t("connect.savedOk")
                : result.reason
                  ? reasonText(t, result.reason)
                  : t("connect.failed")}
            </p>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            {connection ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={busy !== null}
                onClick={remove}
              >
                {busy === "remove" && <Loader2 className="animate-spin" />}
                {t("connect.remove")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  run("test", () =>
                    actions.test({
                      provider,
                      config: toConfig(provider, values),
                    }),
                  )
                }
              >
                {busy === "test" && <Loader2 className="animate-spin" />}
                {t("connect.test")}
              </Button>
              <Button type="submit" disabled={busy !== null}>
                {busy === "save" && <Loader2 className="animate-spin" />}
                {t("connect.save")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldInput({
  id,
  field,
  label,
  help,
  invalid,
  isSet,
  keepPlaceholder,
  value,
  onChange,
}: {
  id: string;
  field: ProviderField;
  label: string;
  help?: string;
  invalid: boolean;
  isSet: boolean;
  keepPlaceholder: string;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
}) {
  const helpId = help ? `${id}-help` : undefined;
  const common = {
    id,
    "aria-describedby": helpId,
    "aria-invalid": invalid || undefined,
  };
  let control: React.ReactNode;
  if (field.type === "boolean") {
    control = (
      <Switch
        {...common}
        checked={value === true}
        onCheckedChange={(checked) => onChange(checked)}
      />
    );
  } else if (field.type === "select") {
    control = (
      <Select value={String(value ?? "")} onValueChange={onChange}>
        <SelectTrigger {...common} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {field.options?.map((option) => (
            <SelectItem key={option} value={option}>
              {option === "openseo" ? "OpenSEO" : "DataForSEO"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (field.type === "mcpServer") {
    control = (
      <McpServerSelect
        common={common}
        value={String(value ?? "")}
        onChange={onChange}
      />
    );
  } else if (field.type === "projects" || field.type === "secretTextarea") {
    control = (
      <Textarea
        {...common}
        rows={field.type === "projects" ? 3 : 5}
        className="font-mono text-xs"
        autoComplete="off"
        spellCheck={false}
        placeholder={
          field.type === "secretTextarea" && isSet ? keepPlaceholder : undefined
        }
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else {
    const secret = isSecretField(field);
    control = (
      <Input
        {...common}
        type={secret ? "password" : field.type === "number" ? "number" : "text"}
        autoComplete={secret ? "new-password" : "off"}
        spellCheck={false}
        placeholder={secret && isSet ? keepPlaceholder : undefined}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {label}
        {field.required && <span aria-hidden> *</span>}
      </Label>
      {control}
      {help && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
    </div>
  );
}

const NO_SERVER = "__none__";

/**
 * Picks an MCP server connected in Navigator, for providers that only sign
 * in with OAuth (OpenSEO). Remote servers only: the feed runs on the server.
 * One still waiting for OAuth says so, since the feed cannot use it until it
 * is authorized under MCP servers.
 */
function McpServerSelect({
  common,
  value,
  onChange,
}: {
  common: Record<string, unknown>;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("Cockpit");
  const { data: servers = [] } = useMcpList();
  const remote = servers.filter((server) => "url" in server.config);
  return (
    <>
      <Select
        value={value || NO_SERVER}
        onValueChange={(v) => onChange(v === NO_SERVER ? "" : v)}
      >
        <SelectTrigger {...common} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_SERVER}>
            {t("connect.mcpServerNone")}
          </SelectItem>
          {remote.map((server) => (
            <SelectItem key={server.id} value={server.id}>
              {server.status === "authorizing"
                ? t("connect.mcpServerNeedsAuth", { name: server.name })
                : server.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Link href="/mcp" className="text-xs underline underline-offset-2">
        {t("connect.mcpServersLink")}
      </Link>
    </>
  );
}
