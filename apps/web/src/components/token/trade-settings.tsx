"use client";

import { useState } from "react";
import { useLocalStorage } from "@/lib/hooks";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { Segmented } from "../ui/tabs";

const SLIPPAGE_PRESETS = [50, 100, 200] as const;
const MAX_SLIPPAGE_BPS = 5_000;
const DEFAULT_QUICK_BUY = ["0.1", "0.5", "1"];

export interface TradeSettingsState {
  slippageBps: number;
  setSlippageBps: (bps: number) => void;
  /** Three quick-buy amounts in SOL, as typed. */
  quickBuy: string[];
  setQuickBuy: (amounts: string[]) => void;
}

/** Trade settings saved in this browser: max slippage and the three quick-buy amounts (SOL). */
export function useTradeSettings(): TradeSettingsState {
  const [slippageBps, setSlippageBps] = useLocalStorage("holdfast:slippage-bps", 100);
  const [quickBuy, setQuickBuy] = useLocalStorage<string[]>("holdfast:quick-buy", DEFAULT_QUICK_BUY);
  const valid = Array.isArray(quickBuy) && quickBuy.length === 3 && quickBuy.every((v) => Number(v) > 0);
  return { slippageBps, setSlippageBps, quickBuy: valid ? quickBuy : DEFAULT_QUICK_BUY, setQuickBuy };
}

const clean = (v: string) => v.replace(/,/g, ".").replace(/[^\d.]/g, "");

/**
 * Settings modal (§4.5, pump.fun): slippage 0.5/1/2/custom with a one-line explanation, and the
 * quick-buy presets. Edits apply on "Save" to the trade panel's `settings`.
 */
export function TradeSettings({
  open,
  onOpenChange,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: TradeSettingsState;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Trade settings" width={420}>
      {open ? <SettingsForm settings={settings} onDone={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function SettingsForm({ settings, onDone }: { settings: TradeSettingsState; onDone: () => void }) {
  const preset = SLIPPAGE_PRESETS.find((p) => p === settings.slippageBps);
  const [mode, setMode] = useState<string>(preset ? String(preset) : "custom");
  const [custom, setCustom] = useState(preset ? "" : String(settings.slippageBps / 100));
  const [quick, setQuick] = useState(settings.quickBuy);

  const customBps = Math.round(Number(custom) * 100);
  const bps = mode === "custom" ? customBps : Number(mode);
  const slipError =
    mode === "custom" && (!custom || !(customBps > 0) || customBps > MAX_SLIPPAGE_BPS)
      ? `Enter 0.01–${MAX_SLIPPAGE_BPS / 100}%.`
      : null;
  const quickError = quick.some((v) => !(Number(v) > 0)) ? "Each amount must be above 0." : null;

  return (
    <form
      className="grid gap-6 px-5 pt-4 pb-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (slipError || quickError) return;
        settings.setSlippageBps(bps);
        settings.setQuickBuy(quick.map((v) => String(Number(v))));
        onDone();
      }}
    >
      <div className="grid gap-2">
        <span className="label text-ink-3">Max slippage</span>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Max slippage"
            value={mode}
            onChange={setMode}
            items={[...SLIPPAGE_PRESETS.map((p) => ({ value: String(p), label: `${p / 100}%` })), { value: "custom", label: "Custom" }]}
          />
          {mode === "custom" ? (
            <Input
              aria-label="Custom slippage"
              inputMode="decimal"
              value={custom}
              onChange={(e) => setCustom(clean(e.target.value))}
              suffix="%"
              invalid={!!slipError}
              className="w-28"
            />
          ) : null}
        </div>
        <p className={slipError ? "small text-down" : "small text-ink-3"}>
          {slipError ?? "Your trade reverts if the price moves more than this before it lands."}
        </p>
        {!slipError && bps > 500 ? <p className="small text-warn">Above 5% you may get a much worse fill.</p> : null}
      </div>

      <div className="grid gap-2">
        <span className="label text-ink-3">Quick buy amounts</span>
        <div className="grid grid-cols-3 gap-2">
          {quick.map((v, i) => (
            <Field key={i} label={`Preset ${i + 1}`} className="[&_label]:sr-only">
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={v}
                  suffix="SOL"
                  onChange={(e) => setQuick(quick.map((q, j) => (j === i ? clean(e.target.value) : q)))}
                  invalid={!(Number(v) > 0)}
                />
              )}
            </Field>
          ))}
        </div>
        <p className={quickError ? "small text-down" : "small text-ink-3"}>
          {quickError ?? "The buy buttons under the amount. Saved in this browser."}
        </p>
      </div>

      <Button type="submit" variant="primary" size="lg" disabled={!!slipError || !!quickError}>
        Save
      </Button>
    </form>
  );
}
