import React from 'react';
import { Badge } from '@shopify/polaris';

type BadgeTone = 'success' | 'info' | 'attention' | 'warning' | 'critical';

const CONDITION_MAP: Record<string, { label: string; tone: BadgeTone }> = {
  'condition-like_new_minus': { label: 'Like New-', tone: 'success' },
  'condition-like_new': { label: 'Like New', tone: 'success' },
  'condition-excellent_plus': { label: 'Excellent+', tone: 'success' },
  'condition-excellent': { label: 'Excellent', tone: 'info' },
  'condition-excellent_minus': { label: 'Excellent-', tone: 'info' },
  'condition-good_plus': { label: 'Good+', tone: 'attention' },
  'condition-good': { label: 'Good', tone: 'attention' },
  'condition-good_minus': { label: 'Good-', tone: 'attention' },
  'condition-poor': { label: 'Poor', tone: 'warning' },
  'condition-ugly': { label: 'Ugly', tone: 'critical' },
};

/**
 * Extract condition tag from a tags array and render a Polaris Badge.
 * Returns null if no condition tag found.
 */
export function getConditionFromTags(tags: string[]): { label: string; tone: BadgeTone } | null {
  if (!tags?.length) return null;
  for (const tag of tags) {
    const match = CONDITION_MAP[tag];
    if (match) return match;
  }
  return null;
}

const ConditionBadge: React.FC<{ tags?: string[] }> = ({ tags }) => {
  if (!tags?.length) return null;
  const condition = getConditionFromTags(tags);
  if (!condition) return null;
  return <Badge tone={condition.tone}>{condition.label}</Badge>;
};

export default ConditionBadge;
