"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AGENTSET_EMBEDDING_PROFILE_OPTIONS,
  type AgentsetEmbeddingProfileOption,
} from "@/lib/agentset/embedding-profile-options";
import type { AgentsetEmbeddingProfileId } from "@/types/project";

export function EmbeddingModelSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: AgentsetEmbeddingProfileId;
  onChange?: (value: AgentsetEmbeddingProfileId) => void;
  disabled?: boolean;
}) {
  const selected = AGENTSET_EMBEDDING_PROFILE_OPTIONS.find(
    (option) => option.id === value,
  );

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Retrieval profile</label>
      {disabled ? (
        <ProfileSummary
          option={selected ?? AGENTSET_EMBEDDING_PROFILE_OPTIONS[0]}
        />
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select retrieval profile" />
          </SelectTrigger>
          <SelectContent>
            {AGENTSET_EMBEDDING_PROFILE_OPTIONS.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                <ProfileSummary option={option} compact />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <p className="text-xs text-muted-foreground">
        {disabled
          ? "This profile is locked for the project's Agentset namespace. Changing it requires re-indexing in a new namespace."
          : "Choose how this project indexes uploaded documents via Agentset. This cannot be changed after project creation without re-indexing."}
      </p>
    </div>
  );
}

function ProfileSummary({
  option,
  compact = false,
}: {
  option: AgentsetEmbeddingProfileOption;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="font-medium">{option.label}</span>
      <span className="text-xs text-muted-foreground">
        {option.providerLabel} • {option.modelLabel}
      </span>
      {!compact && (
        <span className="text-xs text-muted-foreground mt-1">
          {option.description}
        </span>
      )}
    </div>
  );
}
