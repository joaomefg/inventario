-- Supabase Inventário Escolar
-- Este script cria a tabela, índices, ativa RLS e configura o bucket e políticas do Storage.
-- Execute no SQL Editor do Supabase. É idempotente (usa IF NOT EXISTS e dropar políticas antes de recriar).

-- =============================
-- Tabela: public.inventario
-- =============================
create table if not exists public.inventario (
  id bigserial primary key,
  numero_patrimonio text not null,
  nome_objeto text not null,
  localizacao_texto text,
  foto_objeto_url text,
  foto_localizacao_url text,
  -- paths internos no Storage para permitir remoção dos arquivos
  foto_objeto_path text,
  foto_localizacao_path text,
  criado_em timestamptz not null default now()
);

-- Evitar patrimônio duplicado
create unique index if not exists inventario_numero_patrimonio_key
  on public.inventario (numero_patrimonio);

-- Índice para busca por nome
create index if not exists inventario_nome_objeto_idx
  on public.inventario (nome_objeto);

-- Ativar RLS
alter table public.inventario enable row level security;

-- Políticas públicas (rápidas para testes)
drop policy if exists inventario_select_public on public.inventario;
drop policy if exists inventario_insert_public on public.inventario;
drop policy if exists inventario_delete_public on public.inventario;

create policy inventario_select_public
  on public.inventario for select
  using (true);

create policy inventario_insert_public
  on public.inventario for insert
  with check (true);
  with check (true);

create policy inventario_delete_public
  on public.inventario for delete
  using (true);


-- =============================
-- Storage: Bucket e Políticas
-- =============================
-- Cria bucket público via insert direto (compatível quando a função create_bucket não existe)
insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
select 'inventario-fotos', 'inventario-fotos', true, '{image/jpeg,image/png,image/webp}'::text[], 10485760::bigint
where not exists (select 1 from storage.buckets where id = 'inventario-fotos');

-- Remover políticas existentes relacionadas ao bucket
drop policy if exists storage_select_public_inventario on storage.objects;
drop policy if exists storage_insert_public_inventario on storage.objects;
drop policy if exists storage_delete_public_inventario on storage.objects;

-- Permitir leitura pública de objetos do bucket
create policy storage_select_public_inventario
  on storage.objects for select
  using (bucket_id = 'inventario-fotos');

-- Permitir upload (insert) para o bucket
create policy storage_insert_public_inventario
  on storage.objects for insert
  with check (bucket_id = 'inventario-fotos' and name like 'itens/%');

-- Permitir delete de objetos do bucket
create policy storage_delete_public_inventario
  on storage.objects for delete
  using (bucket_id = 'inventario-fotos' and name like 'itens/%');


-- =====================================================
-- Opção mais segura (AUTENTICAÇÃO) — EXECUTE SE PRECISAR
-- =====================================================
-- Comentado por padrão. Se quiser usar Auth, remova os comentários e ajuste
-- o app para prefixar arquivos com o usuário (ex.: itens/{auth.uid()}/arquivo).

-- alter table public.inventario add column if not exists owner_id uuid default auth.uid();

-- drop policy if exists inv_select_owner on public.inventario;
-- drop policy if exists inv_insert_owner on public.inventario;
-- drop policy if exists inv_delete_owner on public.inventario;

-- create policy inv_select_owner
--   on public.inventario for select
--   using (auth.uid() = owner_id);

-- create policy inv_insert_owner
--   on public.inventario for insert
--   with check (auth.uid() = owner_id);

-- create policy inv_delete_owner
--   on public.inventario for delete
--   using (auth.uid() = owner_id);

-- -- Storage com Auth (exemplo simples por role)
-- drop policy if exists storage_insert_auth_inventario on storage.objects;
-- drop policy if exists storage_delete_auth_inventario on storage.objects;

-- create policy storage_insert_auth_inventario
--   on storage.objects for insert
--   with check (bucket_id = 'inventario-fotos' and auth.role() = 'authenticated');

-- create policy storage_delete_auth_inventario
--   on storage.objects for delete
--   using (bucket_id = 'inventario-fotos' and auth.role() = 'authenticated');

-- Fim do script

-- Ajuste idempotente para casos de tabela já existente (adiciona colunas de path)
alter table if exists public.inventario
  add column if not exists localizacao_texto text,
  add column if not exists foto_objeto_path text,
  add column if not exists foto_localizacao_path text;