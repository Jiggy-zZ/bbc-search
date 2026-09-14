create extension if not exists pgcrypto;

create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  series text not null,
  season integer not null,
  episode integer not null,
  title text,
  duration_ms bigint,
  created_at timestamptz not null default now(),

  constraint episodes_season_positive check (season > 0),
  constraint episodes_episode_positive check (episode > 0),
  constraint episodes_duration_positive check (
    duration_ms is null or duration_ms > 0
  )
);

create table public.dialogue_segments (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null
    references public.episodes(id) on delete cascade,
  start_ms bigint not null,
  end_ms bigint not null,
  speaker text,
  text_en text,
  text_zh text,
  normalized_en text,
  normalized_zh text,
  alignment_confidence numeric(4, 3),
  created_at timestamptz not null default now(),

  constraint dialogue_segments_start_nonnegative check (start_ms >= 0),
  constraint dialogue_segments_time_order check (end_ms > start_ms),
  constraint dialogue_segments_has_text check (
    text_en is not null or text_zh is not null
  ),
  constraint dialogue_segments_alignment_range check (
    alignment_confidence is null
    or (alignment_confidence >= 0 and alignment_confidence <= 1)
  )
);

create index dialogue_segments_episode_id_idx
  on public.dialogue_segments (episode_id);

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid unique not null
    references public.dialogue_segments(id) on delete cascade,
  object_key text unique not null,
  clip_start_ms bigint not null,
  clip_end_ms bigint not null,
  duration_ms bigint not null,
  status text not null default 'ready',
  created_at timestamptz not null default now(),

  constraint clips_start_nonnegative check (clip_start_ms >= 0),
  constraint clips_time_order check (clip_end_ms > clip_start_ms),
  constraint clips_duration_positive check (duration_ms > 0),
  constraint clips_status_allowed check (status in ('ready', 'missing', 'error'))
);
