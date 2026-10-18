import { useEffect, useId, useRef, useState } from "react";

import type { IntervalMi, Place, RoutesRequest } from "@/api/types";
import { Button } from "@/components/primitives/button";
import { Input } from "@/components/primitives/input";
import * as ToggleGroup from "@/components/primitives/toggle-group";
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

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5" aria-label="Trip details">
      <div className="flex flex-col gap-2">
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
        />
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
          labelAction={
            <Button variant="outline" size="xs" onClick={swap} aria-label="Swap start and destination">
              <Icon name="swap" size={14} />
              Swap
            </Button>
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.departure} className="text-[13px] font-medium text-ink">
          Departure
        </label>
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
        <label htmlFor={ids.load} className="text-[13px] font-medium text-ink">
          Load weight
        </label>
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
            className="tabular pr-10"
          />
          <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-sm text-ink-label">lb</span>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Load presets">
          {LOAD_PRESETS.map((p) => {
            const active = loadNumber === p.lb;
            return (
              <Button
                key={p.lb}
                size="xs"
                variant={active ? "default" : "secondary"}
                aria-pressed={active}
                onClick={() => {
                  setLoad(String(p.lb));
                  clearError("load");
                }}
                className="tabular"
              >
                {p.label}
              </Button>
            );
          })}
        </div>
        <p id={`${ids.load}-hint`} className="text-xs text-ink-label">
          Heavier loads raise wind risk: over 30,000 lb is No Travel at 45 mph, over 40,000 lb is Severe at 35 mph.
        </p>
        <FieldError id={`${ids.load}-error`} message={errors.load} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span id={ids.interval} className="text-[13px] font-medium text-ink">
          Check weather every
        </span>
        <ToggleGroup.Root<string>
          aria-labelledby={ids.interval}
          value={String(interval)}
          onValueChange={(v) => setInterval(Number(v) as IntervalMi)}
          className="self-start"
        >
          {INTERVALS.map((mi) => (
            <ToggleGroup.Item key={mi} value={String(mi)} className="tabular min-w-16">
              {mi} mi
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </div>

      <Button type="submit" size="lg" className={cn("w-full")}>
        {pending ? (
          <>
            <Spinner size={16} />
            Checking routes and weather…
          </>
        ) : (
          "Compare routes"
        )}
      </Button>
    </form>
  );
}
