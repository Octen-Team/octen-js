import type { PlaceSearchParams } from '@octen.ai/sdk';
import { tool } from 'ai';
import type { Tool } from 'ai';
import {
  asList,
  isRecord,
  mergeParams,
  modelSchema,
  nonEmpty,
  requestOptions,
  resolveClient,
  trimWebResults,
  warningOf,
} from '../shared.js';
import type { ModelField, ModelWebResult, OctenClient, OctenToolOptions } from '../shared.js';

export type PlaceSearchInput = { query: string };
export type ModelPlace = {
  name?: string;
  category?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  distance?: number;
  rating?: number;
  review_count?: number;
  opening_hours?: string[];
  status?: string;
  phone?: string;
  website?: string;
};
export type PlaceSearchToolResult = { request_id: string; warning?: string; places: ModelPlace[]; results: ModelWebResult[] };

const DESCRIPTION =
  "Find places such as shops, restaurants and services, with address, coordinates, rating, opening hours and contact details. Put the area in the query, for example 'coffee near Shibuya, Tokyo', unless a location is already set.";

const TOOL_DEFAULTS: Partial<PlaceSearchParams> = { places: { count: 5 } };
const MODEL_FIELDS = ['query'] as const satisfies readonly ModelField[];

const STRING_FIELDS = ['name', 'category', 'address', 'status', 'phone', 'website'] as const;
const NUMBER_FIELDS = ['latitude', 'longitude', 'distance', 'rating', 'review_count'] as const;

// Empty, null and non-finite values are left out; zero is a real value and stays.
function trimPlace(p: Record<string, unknown>): ModelPlace {
  const out: ModelPlace = {};
  for (const key of STRING_FIELDS) {
    const value = nonEmpty(p[key]);
    if (value !== undefined) out[key] = value;
  }
  for (const key of NUMBER_FIELDS) {
    const value = p[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  const hours = Array.isArray(p['opening_hours']) ? p['opening_hours'].filter((h) => nonEmpty(h) !== undefined) : [];
  if (hours.length > 0) out.opening_hours = hours as string[];
  return out;
}

export function octenPlaceSearch(
  options: OctenToolOptions<PlaceSearchParams, OctenClient> = {},
): Tool<PlaceSearchInput, PlaceSearchToolResult> {
  // One client per tool, reused by every call.
  const client = resolveClient(options);
  return tool({
    description: options.description ?? DESCRIPTION,
    inputSchema: modelSchema<PlaceSearchInput>(MODEL_FIELDS, options.defaults),
    execute: async (input: PlaceSearchInput, { abortSignal }): Promise<PlaceSearchToolResult> => {
      const params = mergeParams<PlaceSearchParams>(TOOL_DEFAULTS, options.defaults, input, MODEL_FIELDS);
      const res = await client.placeSearch.search(params, requestOptions(abortSignal));
      return {
        request_id: res.request_id,
        ...warningOf(res),
        places: asList(res.data?.places, 'data.places')
          .filter(isRecord)
          .map(trimPlace)
          .filter((p) => Object.keys(p).length > 0),
        results: trimWebResults(res.data?.results, 'data.results'),
      };
    },
  });
}
