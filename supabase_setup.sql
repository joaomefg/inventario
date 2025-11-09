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
  criado_em timestamptz not null default now(),
  -- sessão lógica do cliente (visão por sessão)
  session_id text
);

-- Evitar patrimônio duplicado
create unique index if not exists inventario_numero_patrimonio_key
  on public.inventario (numero_patrimonio);

-- Índice para busca por nome
create index if not exists inventario_nome_objeto_idx
  on public.inventario (nome_objeto);

-- Ativar RLS
alter table public.inventario enable row level security;

-- Reset de políticas anteriores
drop policy if exists inventario_select_public on public.inventario;
drop policy if exists inventario_insert_public on public.inventario;
drop policy if exists inventario_delete_public on public.inventario;
drop policy if exists inventario_insert_admin on public.inventario;
drop policy if exists inventario_delete_admin on public.inventario;
drop policy if exists inv_select_admin_all on public.inventario;
drop policy if exists inv_select_estagiario_last on public.inventario;
drop policy if exists inv_insert_admin on public.inventario;
drop policy if exists inv_insert_estagiario on public.inventario;
drop policy if exists inv_select_session_owner on public.inventario;

-- Admins: tabela com e-mails autorizados para escrita/apagar
create table if not exists public.admins (
  email text primary key
);

-- Estagiários: tabela com e-mails com permissões limitadas
create table if not exists public.estagiarios (
  email text primary key
);

-- Coluna de proprietário para atrelar itens ao usuário
alter table public.inventario add column if not exists owner_id uuid default auth.uid();
-- Coluna de sessão para visão por sessão (garante existência antes das policies)
alter table public.inventario add column if not exists session_id text;
-- Define DEFAULT para session_id vindo do cabeçalho x-session-id (idempotente)
do $$
begin
  begin
    alter table public.inventario alter column session_id set default current_setting('request.header.x-session-id', true);
  exception when others then
    -- Ignora caso a coluna não exista ou o default já esteja configurado
    null;
  end;
end $$;

-- Coluna de e-mail do proprietário (para exibir quem adicionou o item)
alter table public.inventario add column if not exists owner_email text;
do $$
begin
  begin
    alter table public.inventario alter column owner_email set default lower(auth.jwt() ->> 'email');
  exception when others then
    null;
  end;
end $$;

-- Backfill: preencher owner_email para registros existentes usando auth.users
do $$
begin
  begin
    update public.inventario inv
      set owner_email = lower(u.email)
    from auth.users u
    where inv.owner_email is null
      and inv.owner_id = u.id;
  exception when others then
    null;
  end;
end $$;

-- Função para determinar se o registro é o último do proprietário (evita recursão na policy)
create or replace function public.is_latest_for_owner(p_owner uuid, p_criado_em timestamptz)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(p_criado_em = (
    select max(criado_em)
    from public.inventario
    where owner_id = p_owner
  ), false);
$$;

grant execute on function public.is_latest_for_owner(uuid, timestamptz) to authenticated, anon;

-- Seleção: Admins veem tudo; Estagiários veem somente o último item que criaram
create policy inv_select_admin_all
  on public.inventario for select
  using (lower(auth.jwt() ->> 'email') in (select lower(email) from public.admins));

-- Seleção por sessão: usuários autenticados veem somente seus itens da sessão atual
drop policy if exists inv_select_session_owner on public.inventario;
create policy inv_select_session_owner
  on public.inventario for select
  using (
    auth.role() = 'authenticated'
    and owner_id = auth.uid()
  );

-- Inserção: Admins e Estagiários podem inserir; exige que owner_id = auth.uid()
create policy inv_insert_admin
  on public.inventario for insert
  with check (
    lower(auth.jwt() ->> 'email') in (select lower(email) from public.admins)
    and auth.uid() = owner_id
  );

create policy inv_insert_estagiario
  on public.inventario for insert
  with check (
    auth.role() = 'authenticated'
    and auth.uid() = owner_id
  );

-- Remoção: somente admins
create policy inventario_delete_admin
  on public.inventario for delete
  using (lower(auth.jwt() ->> 'email') in (select lower(email) from public.admins));


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
drop policy if exists storage_insert_admin_inventario on storage.objects;
drop policy if exists storage_delete_admin_inventario on storage.objects;
drop policy if exists storage_insert_estagiario_inventario on storage.objects;

-- Permitir leitura pública de objetos do bucket
create policy storage_select_public_inventario
  on storage.objects for select
  using (bucket_id = 'inventario-fotos');

-- Permitir upload (insert) para o bucket
create policy storage_insert_admin_inventario
  on storage.objects for insert
  with check (
    bucket_id = 'inventario-fotos' and name like 'itens/%'
    and lower(auth.jwt() ->> 'email') in (select lower(email) from public.admins)
  );

-- Permitir upload para Estagiários (para itens). Exclusão continua restrita a admins
create policy storage_insert_estagiario_inventario
  on storage.objects for insert
  with check (
    bucket_id = 'inventario-fotos' and name like 'itens/%'
    and auth.role() = 'authenticated'
  );

-- Permitir delete de objetos do bucket
create policy storage_delete_admin_inventario
  on storage.objects for delete
  using (
    bucket_id = 'inventario-fotos' and name like 'itens/%'
    and (auth.jwt() ->> 'email') in (select email from public.admins)
  );


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
  add column if not exists foto_localizacao_path text,
  add column if not exists session_id text;