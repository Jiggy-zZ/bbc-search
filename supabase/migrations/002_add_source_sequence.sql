alter table public.dialogue_segments
  add column source_sequence integer;

alter table public.dialogue_segments
  add constraint dialogue_segments_source_sequence_positive
  check (source_sequence is null or source_sequence > 0);

-- Keep this index non-partial so PostgREST can infer it from
-- on_conflict=episode_id,source_sequence during batch upserts. PostgreSQL's
-- default NULLS DISTINCT behavior still permits multiple pre-Phase-4 rows with
-- a null source_sequence.
create unique index dialogue_segments_episode_source_sequence_uidx
  on public.dialogue_segments (episode_id, source_sequence);
