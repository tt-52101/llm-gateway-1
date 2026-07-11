/**
 * TokenCount Component
 *
 * Renders a token quantity using {@link formatTokenCount}:
 * - < 1000: the exact value.
 * - >= 1000: abbreviated with `K`/`M` and two decimals, with the exact value shown
 *   in a tooltip on hover.
 */

'use client';

import React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatTokenCount, tokenCountTooltip } from '@/lib/utils';

interface TokenCountProps {
  value: number | null | undefined;
  className?: string;
}

export function TokenCount({ value, className }: TokenCountProps) {
  const display = formatTokenCount(value);
  const tooltip = tokenCountTooltip(value);

  if (!tooltip) {
    return <span className={className}>{display}</span>;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={className}>{display}</span>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
