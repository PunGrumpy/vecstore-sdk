-- vecstore-sdk: server side for the Supabase adapter.
-- Run once per project, with a role that can create functions.
--   supabase db execute --file node_modules/vecstore-sdk/sql/supabase.sql
-- Every function runs with the privileges of the caller, so row level
-- security policies on your vector tables still apply.

create extension if not exists vector;

create or replace function vecstore_table(index_name text, index_schema text)
returns text
language sql
immutable
security invoker
set search_path = public, extensions
as $$
  select case
    when index_schema is null then quote_ident(index_name)
    else quote_ident(index_schema) || '.' || quote_ident(index_name)
  end;
$$;

create or replace function vecstore_filter_sql(match_filter jsonb, column_name text)
returns text
language plpgsql
immutable
security invoker
set search_path = public, extensions
as $$
declare
  kind text := match_filter ->> 'kind';
  field text := match_filter ->> 'field';
  path text;
  parts text[] := '{}';
  child jsonb;
  operator text;
begin
  if kind is null then
    raise exception 'vecstore: filter has no "kind"' using errcode = '22023';
  end if;

  if kind in ('and', 'or') then
    for child in select value from jsonb_array_elements(match_filter -> 'filters') loop
      parts := parts || vecstore_filter_sql(child, column_name);
    end loop;
    if cardinality(parts) = 0 then
      raise exception 'vecstore: "%" needs at least one filter', kind using errcode = '22023';
    end if;
    return '(' || array_to_string(parts, case kind when 'and' then ' AND ' else ' OR ' end) || ')';
  end if;

  if kind = 'not' then
    return 'NOT (' || vecstore_filter_sql(match_filter -> 'filter', column_name) || ')';
  end if;

  if field is null then
    raise exception 'vecstore: "%" has no "field"', kind using errcode = '22023';
  end if;

  path := '(' || column_name || ' -> ' || quote_literal(field) || '::text)';

  if kind = 'eq' then
    return column_name || ' @> '
      || quote_literal(jsonb_build_object(field, match_filter -> 'value')) || '::jsonb';
  end if;

  if kind = 'ne' then
    return 'NOT (' || column_name || ' @> '
      || quote_literal(jsonb_build_object(field, match_filter -> 'value')) || '::jsonb)';
  end if;

  if kind in ('gt', 'gte', 'lt', 'lte') then
    operator := case kind
      when 'gt' then '>'
      when 'gte' then '>='
      when 'lt' then '<'
      else '<='
    end;
    return '(jsonb_typeof(' || path || ') = ''number'' AND ' || path || ' '
      || operator || ' ' || quote_literal(match_filter -> 'value') || '::jsonb)';
  end if;

  if kind = 'in' then
    return path || ' <@ ' || quote_literal(match_filter -> 'values') || '::jsonb';
  end if;

  if kind = 'nin' then
    return 'NOT COALESCE(' || path || ' <@ '
      || quote_literal(match_filter -> 'values') || '::jsonb, false)';
  end if;

  if kind = 'exists' then
    return '(' || path || ' IS NOT NULL AND jsonb_typeof(' || path || ') <> ''null'')';
  end if;

  raise exception 'vecstore: unknown filter kind "%"', kind using errcode = '22023';
end;
$$;

create or replace function vecstore_metric(index_name text, index_schema text)
returns text
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select coalesce(
    (
      select case
        when indexdef like '%vector_cosine_ops%' then 'cosine'
        when indexdef like '%vector_ip_ops%' then 'dot'
        when indexdef like '%vector_l2_ops%' then 'euclidean'
      end
      from pg_indexes
      where tablename = index_name
        and schemaname = coalesce(index_schema, current_schema())
        and (
          indexdef like '%vector_cosine_ops%'
          or indexdef like '%vector_ip_ops%'
          or indexdef like '%vector_l2_ops%'
        )
      limit 1
    ),
    'cosine'
  );
$$;

create or replace function vecstore_create_index(
  index_name text,
  index_schema text,
  dimension int,
  metric text
)
returns void
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  target text := vecstore_table(index_name, index_schema);
  opclass text := case metric
    when 'euclidean' then 'vector_l2_ops'
    when 'dot' then 'vector_ip_ops'
    else 'vector_cosine_ops'
  end;
begin
  if dimension is null or dimension < 1 then
    raise exception 'vecstore: dimension must be a positive integer, got %', dimension
      using errcode = '22023';
  end if;

  execute format(
    'create table %s (
       id text not null,
       namespace text not null default '''',
       embedding vector(%s) not null,
       metadata jsonb not null default ''{}''::jsonb,
       primary key (namespace, id)
     )',
    target, dimension
  );
  execute format(
    'create index %I on %s using hnsw (embedding %s)',
    index_name || '_embedding_idx', target, opclass
  );
  execute format(
    'create index %I on %s using gin (metadata)',
    index_name || '_metadata_idx', target
  );
end;
$$;

create or replace function vecstore_drop_index(index_name text, index_schema text)
returns void
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  execute format('drop table %s', vecstore_table(index_name, index_schema));
end;
$$;

create or replace function vecstore_list_indexes(index_schema text)
returns table (name text)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select c.relname::text as name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
  join pg_type t on t.oid = a.atttypid
  where c.relkind = 'r'
    and a.attname = 'embedding'
    and t.typname = 'vector'
    and n.nspname = coalesce(index_schema, current_schema())
  order by c.relname;
$$;

create or replace function vecstore_upsert(
  index_name text,
  index_schema text,
  match_namespace text,
  records jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  execute format(
    'insert into %s (id, namespace, embedding, metadata)
     select r.id, %L, r.embedding::vector, r.metadata
     from jsonb_to_recordset(%L::jsonb) as r(id text, embedding text, metadata jsonb)
     on conflict (namespace, id) do update
       set embedding = excluded.embedding, metadata = excluded.metadata',
    vecstore_table(index_name, index_schema), match_namespace, records
  );
end;
$$;

create or replace function vecstore_query(
  index_name text,
  index_schema text,
  match_namespace text,
  query_embedding text,
  match_count int,
  match_filter jsonb,
  include_vector boolean
)
returns table (id text, metadata jsonb, embedding text, score double precision)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  metric text := vecstore_metric(index_name, index_schema);
  distance text := case metric
    when 'euclidean' then 'embedding <-> ' || quote_literal(query_embedding) || '::vector'
    when 'dot' then 'embedding <#> ' || quote_literal(query_embedding) || '::vector'
    else 'embedding <=> ' || quote_literal(query_embedding) || '::vector'
  end;
  score_sql text := case metric
    when 'euclidean' then distance
    when 'dot' then '-(' || distance || ')'
    else '1 - (' || distance || ')'
  end;
  where_sql text := 'namespace = ' || quote_literal(match_namespace);
begin
  if match_filter is not null then
    where_sql := where_sql || ' AND ' || vecstore_filter_sql(match_filter, 'metadata');
  end if;

  return query execute format(
    'select id, metadata, %s as embedding, %s as score
     from %s where %s order by %s limit %s',
    case when include_vector then 'embedding::text' else 'null::text' end,
    score_sql,
    vecstore_table(index_name, index_schema),
    where_sql,
    distance,
    match_count
  );
end;
$$;

create or replace function vecstore_fetch(
  index_name text,
  index_schema text,
  match_namespace text,
  ids text[],
  include_vector boolean
)
returns table (id text, metadata jsonb, embedding text)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
begin
  return query execute format(
    'select id, metadata, %s as embedding
     from %s where namespace = %L and id = any(%L::text[])',
    case when include_vector then 'embedding::text' else 'null::text' end,
    vecstore_table(index_name, index_schema),
    match_namespace,
    ids
  );
end;
$$;

create or replace function vecstore_delete(
  index_name text,
  index_schema text,
  match_namespace text,
  ids text[],
  match_filter jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  where_sql text := 'namespace = ' || quote_literal(match_namespace);
begin
  if ids is not null then
    where_sql := where_sql || ' AND id = any(' || quote_literal(ids) || '::text[])';
  elsif match_filter is not null then
    where_sql := where_sql || ' AND ' || vecstore_filter_sql(match_filter, 'metadata');
  end if;

  execute format(
    'delete from %s where %s',
    vecstore_table(index_name, index_schema), where_sql
  );
end;
$$;
