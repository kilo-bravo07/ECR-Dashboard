import { parseFilters } from "./api-utils";
import { addDays, today } from "./date-utils";
import { DEFAULT_PROPERTY_KEY, isPropertyKey } from "./properties";
import type { FilterKey } from "./properties/types";
import type { ComparisonMode, DashboardQuery, DateRange, DimensionFilters } from "./types";

export interface FilterState extends DashboardQuery {
  comparisonMode: ComparisonMode;
  comparisonRange?: DateRange;
}

const FILTER_KEYS: FilterKey[] = ["device", "country", "ga4City", "trafficSource", "trafficMedium", "platform"];

/** Client-side counterpart to api-utils' parseQuery: never throws, defaults to "today" and the default property. */
export function parseFilterState(params: URLSearchParams): FilterState {
  const start = params.get("start") || today();
  const end = params.get("end") || start;
  const comparisonRaw = params.get("comparison");
  const comparisonMode: ComparisonMode =
    comparisonRaw === "d7" || comparisonRaw === "d365" || comparisonRaw === "none" || comparisonRaw === "custom"
      ? comparisonRaw
      : "d7";
  const propertyRaw = params.get("property");
  const property = propertyRaw && isPropertyKey(propertyRaw) ? propertyRaw : DEFAULT_PROPERTY_KEY;
  const cstart = params.get("cstart");
  const cend = params.get("cend");
  const comparisonRange: DateRange | undefined =
    comparisonMode === "custom"
      ? { start: cstart || addDays(start, -7), end: cend || addDays(end, -7) }
      : undefined;
  return { property, range: { start, end }, filters: parseFilters(params), comparisonMode, comparisonRange };
}

export function serializeFilterState(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("property", state.property);
  params.set("start", state.range.start);
  params.set("end", state.range.end);
  params.set("comparison", state.comparisonMode);
  if (state.comparisonMode === "custom" && state.comparisonRange) {
    params.set("cstart", state.comparisonRange.start);
    params.set("cend", state.comparisonRange.end);
  }
  FILTER_KEYS.forEach((key) => {
    const values = state.filters[key];
    if (values?.length) params.set(key, values.join(","));
  });
  return params;
}

export function toApiQueryString(state: FilterState): string {
  return serializeFilterState(state).toString();
}

export const FILTER_DIMENSION_KEYS = FILTER_KEYS;
