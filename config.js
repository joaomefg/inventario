// Preencha com as credenciais do seu projeto Supabase
// URL do projeto: https://xxxxx.supabase.co
// Chave pública (anon): encontrada em Project Settings > API

export const SUPABASE_URL = 'https://mxwyiqdaovszuajiscpe.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14d3lpcWRhb3ZzenVhamlzY3BlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0NTMzNDUsImV4cCI6MjA3ODAyOTM0NX0.hSPdOe0jRfBAluNwyF0yTd-nDkmNKO4F6I6uFhyTCyU';

// Nome do bucket de armazenamento para fotos (crie no Supabase Storage)
export const SUPABASE_BUCKET = 'inventario-fotos';

// Nome da tabela para metadados dos itens
// Estrutura esperada:
// id (bigint, PK), numero_patrimonio (text), nome_objeto (text),
// foto_objeto_url (text, nullable), foto_localizacao_url (text, nullable), criado_em (timestamp)
export const SUPABASE_TABLE = 'inventario';