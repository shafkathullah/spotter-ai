import { useEffect, useId, useMemo, useState } from "react";

import type { Place } from "@/api/types";
import { ApiError } from "@/api/client";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useGeocode } from "@/hooks/use-api";
import * as Combobox from "@/components/primitives/combobox";
import { Spinner } from "@/components/spinner";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";
import { FieldError } from "./field-error";

const placeKey = (p: Place) => `${p.label}|${p.lat.toFixed(5)}|${p.lon.toFixed(5)}`;

interface PlaceFieldProps {
  label: string;
  placeholder: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
  error?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  /** Rendered at the right end of the label row (the swap button). */
  labelAction?: React.ReactNode;
  /** Grid placement in the trip bar. */
  className?: string;
}

/**
 * Origin / destination search: Base UI Combobox fed by /api/geocode,
 * debounced 250 ms. Only typing searches (not picking an item), and the
 * stale request is aborted when the text changes (see `useGeocode`).
 */
export function PlaceField({
  label,
  placeholder,
  value,
  onChange,
  error,
  inputRef,
  labelAction,
  className,
}: PlaceFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const [inputValue, setInputValue] = useState(value?.label ?? "");
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 250);
  const geo = useGeocode(debounced);

  // An outside change (swap, reset) rewrites the text to the new place.
  useEffect(() => {
    setInputValue(value?.label ?? "");
  }, [value]);

  const results = useMemo(() => (debounced.trim().length >= 3 ? (geo.data?.results ?? []) : []), [debounced, geo.data]);
  const items = useMemo(() => {
    if (!value || results.some((r) => placeKey(r) === placeKey(value))) return results;
    return [...results, value];
  }, [results, value]);

  const typing = search.trim().length > 0;
  const tooShort = typing && search.trim().length < 3;
  const pending = !tooShort && typing && (search !== debounced || geo.isFetching);
  let status: React.ReactNode = null;
  if (tooShort) status = "Type at least 3 characters.";
  else if (pending)
    status = (
      <span className="inline-flex items-center gap-2">
        <Spinner size={14} /> Searching places…
      </span>
    );
  else if (geo.isError)
    status = geo.error instanceof ApiError ? geo.error.message : "Place search failed. Try again.";
  else if (typing && results.length === 0 && geo.isSuccess) status = `No places match “${search.trim()}”.`;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex h-7 items-end justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        {labelAction}
      </div>
      <Combobox.Root<Place>
        items={items}
        filter={null}
        value={value}
        inputValue={inputValue}
        itemToStringLabel={(p) => p.label}
        isItemEqualToValue={(a, b) => placeKey(a) === placeKey(b)}
        onValueChange={(next) => {
          onChange(next ?? null);
          setSearch("");
        }}
        onInputValueChange={(next, details) => {
          setInputValue(next);
          if (details.reason === "item-press") return;
          setSearch(next);
          if (next.trim() === "" && value) onChange(null);
        }}
      >
        <Combobox.InputGroup>
          <Icon name="pin" size={16} className="ml-3 text-ink-label" />
          <Combobox.Input
            id={id}
            ref={inputRef}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="pl-2"
          />
        </Combobox.InputGroup>
        <Combobox.Content aria-busy={pending || undefined}>
          <Combobox.Status>
            {status ? <div className="flex items-center px-3.5 py-3 text-[13px] text-ink-secondary">{status}</div> : null}
          </Combobox.Status>
          <Combobox.Empty>{!status && !typing ? "Start typing a city or address." : null}</Combobox.Empty>
          <Combobox.List>
            {(p: Place) => (
              <Combobox.Item key={placeKey(p)} value={p}>
                <Icon name="pin" size={16} className="mt-0.5 text-ink-label" />
                <span className="min-w-0 wrap-anywhere">{p.label}</span>
              </Combobox.Item>
            )}
          </Combobox.List>
        </Combobox.Content>
      </Combobox.Root>
      <FieldError id={errorId} message={error} />
    </div>
  );
}
