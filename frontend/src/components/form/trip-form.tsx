import { useEffect, useId, useRef, useState } from "react";

import type { IntervalMi, Place, RoutesRequest } from "@/api/types";
import { Button } from "@/components/primitives/button";
import { Input } from "@/components/primitives/input";
import * as Menu from "@/components/primitives/menu";
import * as ToggleGroup from "@/components/primitives/toggle-group";
import * as Tooltip from "@/components/primitives/tooltip";
import { Icon } from "@/components/icon";
import { Spinner } from "@/components/spinner";
import { nextFullHour, toDateTimeLocalValue } from "@/lib/time";
import { cn } from "@/lib/utils";
import { FieldError } from "./field-error";
import { PlaceField } from "./place-field";
import { LOAD_MAX, type TripFormErrors, type TripFormValues, validateTrip } from "./validate";

const LOAD_PRESETS: readonly { lb: number; label: string }[] = [
  { lb: 15_000, label: "Empty 15k" },
  { lb: 30_000, label: "30k" },
  { lb: 40_000, label: "40k" },
  { lb: 80_000, label: "80k max" },
];

const INTERVALS: readonly IntervalMi[] = [10, 25, 50];

const LOAD_HINT =
  "Heavier loads raise wind risk: over 30,000 lb is No Travel at 45 mph, over 40,000 lb is Severe at 35 mph.";

interface TripFormProps {
  initial?: Partial<TripFormValues>;
  pending: boolean;
  /** Departure set from outside the form (the travel-window drag), as ISO; the field follows it. */
  departure?: string;
  onSubmit: (req: RoutesRequest) => void;
}

export function TripForm({ initial, pending, departure: departureIso, onSubmit }: TripFormProps) {
  const ids = { departure: useId(), load: useId(), interval: useId() };
  const [origin, setOrigin] = useState<Place | null>(initial?.origin ?? null);
  const [destination, setDestination] = useState<Place | null>(initial?.destination ?? null);
  const [departure, setDeparture] = useState(initial?.departure ?? toDateTimeLocalValue(nextFullHour()));
  const [load, setLoad] = useState(initial?.load ?? "40000");
  const [interval, setInterval] = useState<IntervalMi>(initial?.interval ?? 25);
  const [errors, setErrors] = useState<TripFormErrors>({});

  useEffect(() => {
    if (departureIso) setDeparture(toDateTimeLocalValue(new Date(departureIso)));
  }, [departureIso]);

  const refs = {
    origin: useRef<HTMLInputElement>(null),
    destination: useRef<HTMLInputElement>(null),
    departure: useRef<HTMLInputElement>(null),
    load: useRef<HTMLInputElement>(null),
  };

  function clearError(key: keyof TripFormErrors) {
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { errors: next, request } = validateTrip({ origin, destination, departure, load, interval });
    setErrors(next);
    if (!request) {
      // Focus moves to the first invalid field.
      const first = (["origin", "destination", "departure", "load"] as const).find((k) => next[k]);
      if (first) refs[first].current?.focus();
      return;
    }
    onSubmit(request);
  }

  function swap() {
    setOrigin(destination);
    setDestination(origin);
    setErrors((e) => ({ ...e, origin: undefined, destination: undefined }));
  }

  const loadNumber = Number(load.replace(/,/g, ""));

  // The trip bar: one row from xl up (From, swap, To, Departure, Load, Interval, Compare),
  // two rows of four from lg (From and To span two), two columns from sm, stacked on phones. Every label sits in an h-7 row so the
  // controls line up even when one field shows an error below it.
  const labelRow = "flex h-7 items-end justify-between gap-2";
  const labelText = "text-[13px] font-medium text-ink";
  const swapLabel = "Swap start and destination";

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-label="Trip details"
      className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_15.5rem_10.5rem_auto_auto] xl:items-start"
    >
      <PlaceField
        label="From"
        placeholder="City or address"
        value={origin}
        onChange={(p) => {
          setOrigin(p);
          clearError("origin");
        }}
        error={errors.origin}
        inputRef={refs.origin}
        className="lg:col-span-2 xl:col-span-1"
      />

      <div className="hidden flex-col gap-1.5 xl:flex">
        <span className={labelRow} aria-hidden />
        <Tooltip.Root>
          <Tooltip.Trigger
            render={<Button variant="outline" size="icon" onClick={swap} aria-label={swapLabel} className="size-10" />}
          >
            <Icon name="swap" size={16} className="rotate-90" />
          </Tooltip.Trigger>
          <Tooltip.Default>{swapLabel}</Tooltip.Default>
        </Tooltip.Root>
      </div>

      <PlaceField
        label="To"
        placeholder="City or address"
        value={destination}
        onChange={(p) => {
          setDestination(p);
          clearError("destination");
        }}
        error={errors.destination}
        inputRef={refs.destination}
        className="lg:col-span-2 xl:col-span-1"
        labelAction={
          <Button variant="outline" size="xs" onClick={swap} aria-label={swapLabel} className="xl:hidden">
            <Icon name="swap" size={14} />
            Swap
          </Button>
        }
      />

      <div className="flex flex-col gap-1.5">
        <div className={labelRow}>
          <label htmlFor={ids.departure} className={labelText}>
            Departure
          </label>
        </div>
        <Input
          ref={refs.departure}
          id={ids.departure}
          type="datetime-local"
          step={900}
          value={departure}
          onChange={(e) => {
            setDeparture(e.target.value);
            clearError("departure");
          }}
          aria-invalid={errors.departure ? true : undefined}
          aria-describedby={errors.departure ? `${ids.departure}-error` : undefined}
          className="tabular"
        />
        <FieldError id={`${ids.departure}-error`} message={errors.departure} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className={labelRow}>
          <label htmlFor={ids.load} className={labelText}>
            Load weight
          </label>
          <Tooltip.Root>
            <Tooltip.Trigger
              render={
                <button
                  type="button"
                  aria-label="How load affects risk"
                  className="touch-hit -mb-0.5 rounded-sm text-ink-label hover:text-ink focus-visible:shadow-focus focus-visible:outline-none"
                />
              }
            >
              <Icon name="info" size={16} />
            </Tooltip.Trigger>
            <Tooltip.Default className="max-w-64">{LOAD_HINT}</Tooltip.Default>
          </Tooltip.Root>
        </div>
        <div className="relative">
          <Input
            ref={refs.load}
            id={ids.load}
            type="number"
            inputMode="numeric"
            min={1}
            max={LOAD_MAX}
            step={500}
            value={load}
            onChange={(e) => {
              setLoad(e.target.value);
              clearError("load");
            }}
            aria-invalid={errors.load ? true : undefined}
            aria-describedby={`${ids.load}-hint${errors.load ? ` ${ids.load}-error` : ""}`}
            className="tabular pr-[4.5rem]"
          />
          <span className="pointer-events-none absolute top-1/2 right-10 -translate-y-1/2 text-sm text-ink-label">lb</span>
          <Menu.Root>
            <Menu.Trigger
              render={
                <button
                  type="button"
                  aria-label="Load presets"
                  className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-secondary hover:bg-highlight hover:text-ink focus-visible:shadow-focus focus-visible:outline-none data-popup-open:bg-highlight"
                />
              }
            >
              <Icon name="expand_more" size={16} />
            </Menu.Trigger>
            <Menu.Default align="end">
              <Menu.RadioGroup
                value={LOAD_PRESETS.some((p) => p.lb === loadNumber) ? String(loadNumber) : ""}
                onValueChange={(v: string) => {
                  setLoad(v);
                  clearError("load");
                }}
              >
                {LOAD_PRESETS.map((p) => (
                  <Menu.RadioItem key={p.lb} value={String(p.lb)} className="tabular">
                    {p.label} <span className="ml-auto pl-4 text-ink-label">{p.lb.toLocaleString("en-US")} lb</span>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Default>
          </Menu.Root>
        </div>
        <p id={`${ids.load}-hint`} className="sr-only">
          {LOAD_HINT}
        </p>
        <FieldError id={`${ids.load}-error`} message={errors.load} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className={labelRow}>
          <span id={ids.interval} className={labelText}>
            Check weather every
          </span>
        </div>
        <ToggleGroup.Root<string>
          aria-labelledby={ids.interval}
          value={String(interval)}
          onValueChange={(v) => setInterval(Number(v) as IntervalMi)}
          className="self-start"
        >
          {INTERVALS.map((mi) => (
            <ToggleGroup.Item key={mi} value={String(mi)} className="tabular min-w-14">
              {mi} mi
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={cn(labelRow, "hidden sm:flex")} aria-hidden />
        <Button type="submit" className="h-10 w-full px-5 xl:w-auto">
          {pending ? (
            <>
              <Spinner size={16} />
              Checking…
            </>
          ) : (
            "Compare routes"
          )}
        </Button>
      </div>
    </form>
  );
}
