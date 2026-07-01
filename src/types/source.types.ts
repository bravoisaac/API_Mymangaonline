export interface SourceMetadata {
  id: string;
  name: string;
  enabled: boolean;
  supportsSpanish: boolean;
  supportsPages: boolean;
}

export interface SourceErrorResult {
  source: string;
  message: string;
}

export interface AggregatedSearchResult<TItem> {
  source: string;
  items: TItem[];
}
