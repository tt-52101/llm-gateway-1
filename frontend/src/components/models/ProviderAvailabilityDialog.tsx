/**
 * Provider Availability Dialog
 *
 * Lets the user switch a single model-provider mapping between three states:
 *  - Available        → { is_active: true, paused_until: null }
 *  - Temporarily paused → { is_active: true, paused_until: now + duration }
 *  - Permanently disabled → { is_active: false }
 *
 * Paused mappings stay in the candidate pool but are scheduled last, so they
 * are only used once all non-paused providers have failed. The window ends
 * automatically at paused_until (no scheduled job required).
 */

'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, PauseCircle, Ban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ModelMappingProvider, ModelMappingProviderUpdate } from '@/types/model';
import { cn } from '@/lib/utils';

type AvailabilityMode = 'available' | 'paused' | 'disabled';

/** Duration presets in minutes. 1h (60) is the default. */
const DURATION_PRESETS = [30, 60, 180, 720, 1440] as const;
const DEFAULT_DURATION_MINUTES = 60;

interface ProviderAvailabilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapping: ModelMappingProvider | null;
  onSubmit: (data: ModelMappingProviderUpdate) => void | Promise<void>;
  loading?: boolean;
}

function isPausedNow(mapping: ModelMappingProvider | null): boolean {
  if (!mapping || !mapping.is_active || !mapping.paused_until) return false;
  return new Date(mapping.paused_until).getTime() > Date.now();
}

/** Minutes remaining in the pause window (>= 1), or null if not paused. */
function pauseRemainingMinutes(mapping: ModelMappingProvider | null): number | null {
  if (!isPausedNow(mapping)) return null;
  const ms = new Date(mapping!.paused_until as string).getTime() - Date.now();
  return Math.max(1, Math.round(ms / 60000));
}

export function ProviderAvailabilityDialog({
  open,
  onOpenChange,
  mapping,
  onSubmit,
  loading = false,
}: ProviderAvailabilityDialogProps) {
  const t = useTranslations('models');
  const tCommon = useTranslations('common');

  const [mode, setMode] = useState<AvailabilityMode>('available');
  // Selected preset (minutes) or 'custom'.
  const [durationChoice, setDurationChoice] = useState<number | 'custom'>(
    DEFAULT_DURATION_MINUTES
  );
  const [customMinutes, setCustomMinutes] = useState<string>('');

  // Reset local state to reflect the mapping's current state each time it opens.
  useEffect(() => {
    if (!open) return;
    const nextMode: AvailabilityMode =
      mapping && mapping.is_active === false
        ? 'disabled'
        : isPausedNow(mapping)
          ? 'paused'
          : 'available';
    /* eslint-disable react-hooks/set-state-in-effect */
    setMode(nextMode);
    setDurationChoice(DEFAULT_DURATION_MINUTES);
    setCustomMinutes('');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, mapping]);

  const remainingMinutes = pauseRemainingMinutes(mapping);
  const remainingLabel = (() => {
    if (remainingMinutes === null) return null;
    if (remainingMinutes < 60)
      return t('availability.remainingMinutes', { minutes: remainingMinutes });
    const hours = Math.floor(remainingMinutes / 60);
    const mins = remainingMinutes % 60;
    return mins > 0
      ? t('availability.remainingHoursMinutes', { hours, minutes: mins })
      : t('availability.remainingHours', { hours });
  })();

  const effectiveMinutes = (): number | null => {
    if (durationChoice === 'custom') {
      const parsed = parseInt(customMinutes, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return parsed;
    }
    return durationChoice;
  };

  const canSubmit = mode !== 'paused' || effectiveMinutes() !== null;

  const handleSubmit = async () => {
    let data: ModelMappingProviderUpdate;
    if (mode === 'disabled') {
      // Clear any lingering pause window so re-enabling later starts fully available.
      data = { is_active: false, paused_until: null };
    } else if (mode === 'paused') {
      const minutes = effectiveMinutes();
      if (minutes === null) return;
      const until = new Date(Date.now() + minutes * 60000).toISOString();
      data = { is_active: true, paused_until: until };
    } else {
      data = { is_active: true, paused_until: null };
    }
    await onSubmit(data);
  };

  const durationLabel = (minutes: number): string => {
    if (minutes < 60) return t('availability.durationMinutes', { minutes });
    const hours = minutes / 60;
    return t('availability.durationHours', { hours });
  };

  const options: Array<{
    value: AvailabilityMode;
    icon: React.ReactNode;
    title: string;
    description: string;
    accent: string;
  }> = [
    {
      value: 'available',
      icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" suppressHydrationWarning />,
      title: t('availability.available'),
      description: t('availability.availableDesc'),
      accent: 'data-[selected=true]:border-emerald-500 data-[selected=true]:bg-emerald-500/5',
    },
    {
      value: 'paused',
      icon: <PauseCircle className="h-5 w-5 text-amber-600" suppressHydrationWarning />,
      title: t('availability.paused'),
      description: t('availability.pausedDesc'),
      accent: 'data-[selected=true]:border-amber-500 data-[selected=true]:bg-amber-500/5',
    },
    {
      value: 'disabled',
      icon: <Ban className="h-5 w-5 text-red-600" suppressHydrationWarning />,
      title: t('availability.disabled'),
      description: t('availability.disabledDesc'),
      accent: 'data-[selected=true]:border-red-500 data-[selected=true]:bg-red-500/5',
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('availability.title')}</DialogTitle>
          <DialogDescription>
            {mapping
              ? t('availability.subtitle', {
                  provider: mapping.provider_name,
                  model: mapping.target_model_name,
                })
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {options.map((opt) => {
            const selected = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                data-selected={selected}
                onClick={() => setMode(opt.value)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  'hover:bg-muted/50',
                  opt.accent
                )}
              >
                <span className="mt-0.5">{opt.icon}</span>
                <span className="flex-1">
                  <span className="flex items-center gap-2 font-medium">
                    {opt.title}
                    {opt.value === 'paused' && remainingLabel && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-normal text-amber-700 dark:text-amber-300">
                        {remainingLabel}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {opt.description}
                  </span>
                </span>
                <span
                  className={cn(
                    'mt-1 h-4 w-4 shrink-0 rounded-full border-2',
                    selected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                  )}
                />
              </button>
            );
          })}
        </div>

        {mode === 'paused' && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <Label className="text-sm">{t('availability.durationLabel')}</Label>
            <div className="flex flex-wrap gap-2">
              {DURATION_PRESETS.map((minutes) => (
                <Button
                  key={minutes}
                  type="button"
                  size="sm"
                  variant={durationChoice === minutes ? 'default' : 'outline'}
                  onClick={() => setDurationChoice(minutes)}
                >
                  {durationLabel(minutes)}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant={durationChoice === 'custom' ? 'default' : 'outline'}
                onClick={() => setDurationChoice('custom')}
              >
                {t('availability.customDuration')}
              </Button>
            </div>
            {durationChoice === 'custom' && (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  placeholder={t('availability.customPlaceholder')}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">
                  {t('availability.minutesUnit')}
                </span>
              </div>
            )}
            {remainingLabel && (
              <p className="text-xs text-muted-foreground">
                {t('availability.overrideHint')}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !canSubmit}>
            {loading ? tCommon('processing') : tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
