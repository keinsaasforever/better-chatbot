/**
 * Model Badge Icons
 *
 * Icons used to display model characteristics in the enhanced model selector
 */

import {
  Gem,
  AlertTriangle,
  Ban,
  PiggyBank,
  Zap,
  Brain,
  TrendingUp,
} from "lucide-react";

export interface BadgeIconProps {
  className?: string;
}

export const GemIcon: React.FC<BadgeIconProps> = ({ className }) => (
  <Gem className={className} />
);

export const CautionIcon: React.FC<BadgeIconProps> = ({ className }) => (
  <AlertTriangle className={className} />
);

export const BlockIcon: React.FC<BadgeIconProps> = ({ className }) => (
  <Ban className={className} />
);

export const PiggyBankIcon: React.FC<BadgeIconProps> = ({ className }) => (
  <PiggyBank className={className} />
);

export const RabbitIcon: React.FC<BadgeIconProps> = ({ className }) => (
  <Zap className={className} />
);

export const BrainIcon: React.FC<BadgeIconProps> = ({ className }) => (
  <Brain className={className} />
);

export const MaxIcon: React.FC<BadgeIconProps> = ({ className }) => (
  <TrendingUp className={className} />
);

export const BadgeIcons = {
  Gem: GemIcon,
  Caution: CautionIcon,
  Block: BlockIcon,
  PiggyBank: PiggyBankIcon,
  Rabbit: RabbitIcon,
  Brain: BrainIcon,
  Max: MaxIcon,
} as const;

export type BadgeIconType = keyof typeof BadgeIcons;
