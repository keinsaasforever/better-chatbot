-- ============================================================================
-- COMPLETE SUPABASE SETUP FOR RAG EMBEDDINGS
-- ============================================================================
-- Run this entire script in Supabase SQL Editor
-- This sets up everything needed for automatic document embedding
-- ============================================================================

-- ============================================================================
-- PART 1: Enable Required Extensions
-- ============================================================================

-- Vector operations with pgvector
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Job queuing with automatic retries
CREATE EXTENSION IF NOT EXISTS pgmq;

-- Async HTTP requests to Edge Functions  
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Scheduled task processing
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Utility for clearing columns on update
CREATE EXTENSION IF NOT EXISTS hstore WITH SCHEMA extensions;

-- Comments
COMMENT ON EXTENSION vector IS 'Vector similarity search for embeddings';
COMMENT ON EXTENSION pgmq IS 'PostgreSQL message queue for async job processing';
COMMENT ON EXTENSION pg_net IS 'Async HTTP requests to Edge Functions';
COMMENT ON EXTENSION pg_cron IS 'Scheduled task execution';

-- ============================================================================
-- PART 2: Utility Functions and Project URL
-- ============================================================================

-- Schema for utility functions
CREATE SCHEMA IF NOT EXISTS util;

-- IMPORTANT: Add your Vercel project URL to Vault first!
-- Uncomment and run ONE of these (based on your deployment):

-- For Production (Vercel):
-- SELECT vault.create_secret('https://your-project.vercel.app', 'project_url');

-- For Local Development:
-- SELECT vault.create_secret('http://localhost:3000', 'project_url');

-- Utility to get project URL for Edge Function callbacks
CREATE OR REPLACE FUNCTION util.project_url()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  secret_value text;
BEGIN
  SELECT decrypted_secret INTO secret_value 
  FROM vault.decrypted_secrets 
  WHERE name = 'project_url';
  RETURN secret_value;
END;
$$;

-- Generic function to invoke any Edge Function
CREATE OR REPLACE FUNCTION util.invoke_edge_function(
  name text,
  body jsonb,
  timeout_milliseconds int = 5 * 60 * 1000  -- 5 minute default
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  headers_raw text;
  auth_header text;
BEGIN
  -- Reuse PostgREST session headers if available
  headers_raw := current_setting('request.headers', true);
  
  auth_header := CASE
    WHEN headers_raw IS NOT NULL THEN
      (headers_raw::json->>'authorization')
    ELSE
      NULL
  END;
  
  -- Async HTTP request to Edge Function
  PERFORM net.http_post(
    url => util.project_url() || '/functions/v1/' || name,
    headers => jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', auth_header
    ),
    body => body,
    timeout_milliseconds => timeout_milliseconds
  );
END;
$$;

-- Utility trigger to clear a column on update
CREATE OR REPLACE FUNCTION util.clear_column()
RETURNS trigger
LANGUAGE plpgsql 
AS $$
DECLARE
  clear_column text := TG_ARGV[0];
BEGIN
  NEW := NEW #= hstore(clear_column, NULL);
  RETURN NEW;
END;
$$;

-- Comments
COMMENT ON SCHEMA util IS 'Utility functions for RAG pipeline';
COMMENT ON FUNCTION util.project_url() IS 'Get project URL from vault for Edge Function calls';
COMMENT ON FUNCTION util.invoke_edge_function(text, jsonb, int) IS 'Invoke Edge Function asynchronously via pg_net';
COMMENT ON FUNCTION util.clear_column() IS 'Trigger function to clear a column on update';

-- ============================================================================
-- PART 3: Embedding Queue and Processing
-- ============================================================================

-- Create embedding jobs queue
SELECT pgmq.create('embedding_jobs');

-- Function to generate embedding input from chunk
CREATE OR REPLACE FUNCTION embedding_input(chunk document_chunk)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Return chunk content for embedding
  RETURN chunk.content;
END;
$$;

-- Trigger function to queue embedding generation jobs
CREATE OR REPLACE FUNCTION util.queue_embeddings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  content_function text := TG_ARGV[0];
  embedding_column text := TG_ARGV[1];
BEGIN
  PERFORM pgmq.send(
    queue_name => 'embedding_jobs',
    msg => jsonb_build_object(
      'id', NEW.id,
      'schema', TG_TABLE_SCHEMA,
      'table', TG_TABLE_NAME,
      'contentFunction', content_function,
      'embeddingColumn', embedding_column,
      'userId', NEW.user_id,
      'projectId', NEW.project_id
    )
  );
  RETURN NEW;
END;
$$;

-- Function to process embedding jobs from queue in batches
CREATE OR REPLACE FUNCTION util.process_embeddings(
  batch_size int = 10,
  max_requests int = 10,
  timeout_milliseconds int = 5 * 60 * 1000 -- 5 minute timeout
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  job_batches jsonb[];
  batch jsonb;
BEGIN
  WITH
    -- Get jobs and assign batch numbers
    numbered_jobs AS (
      SELECT
        message || jsonb_build_object('jobId', msg_id) as job_info,
        (row_number() OVER (ORDER BY 1) - 1) / batch_size as batch_num
      FROM pgmq.read(
        queue_name => 'embedding_jobs',
        vt => timeout_milliseconds / 1000,
        qty => max_requests * batch_size
      )
    ),
    -- Group jobs into batches
    batched_jobs AS (
      SELECT
        jsonb_agg(job_info) as batch_array,
        batch_num
      FROM numbered_jobs
      GROUP BY batch_num
    )
  -- Aggregate all batches
  SELECT array_agg(batch_array)
  FROM batched_jobs
  INTO job_batches;
  
  -- Invoke Edge Function for each batch
  FOREACH batch IN ARRAY job_batches LOOP
    PERFORM util.invoke_edge_function(
      name => 'embed',
      body => batch,
      timeout_milliseconds => timeout_milliseconds
    );
  END LOOP;
END;
$$;

-- Schedule processing every 10 seconds via pg_cron
-- Note: Adjust frequency based on your needs
SELECT cron.schedule(
  'process-embeddings',
  '10 seconds',
  $$SELECT util.process_embeddings();$$
);

-- Comments
COMMENT ON FUNCTION embedding_input(document_chunk) IS 'Extract text from chunk for embedding generation';
COMMENT ON FUNCTION util.queue_embeddings() IS 'Trigger function to queue embedding jobs in pgmq';
COMMENT ON FUNCTION util.process_embeddings(int, int, int) IS 'Process embedding jobs from queue in batches';

-- ============================================================================
-- PART 4: Automatic Embedding Triggers
-- ============================================================================

-- Queue embedding job when a new chunk is created
CREATE OR REPLACE TRIGGER embed_chunks_on_insert
  AFTER INSERT
  ON document_chunk
  FOR EACH ROW
  WHEN (NEW.id IS NOT NULL)
  EXECUTE FUNCTION util.queue_embeddings('embedding_input', 'embedding');

COMMENT ON TRIGGER embed_chunks_on_insert ON document_chunk IS 'Queue embedding generation for new chunks';

-- ============================================================================
-- PART 5: Schema Updates (Tables and Columns)
-- ============================================================================

-- 1. Add embedding_model column to archive table (projects)
ALTER TABLE archive 
ADD COLUMN IF NOT EXISTS embedding_model text NOT NULL DEFAULT 'text-embedding-3-small';

CREATE INDEX IF NOT EXISTS idx_archive_embedding_model ON archive(embedding_model);

COMMENT ON COLUMN archive.embedding_model IS 'Embedding model used for RAG (e.g., text-embedding-3-small, text-embedding-3-large)';

-- 2. Add user_id to document_chunk table (if not exists)
ALTER TABLE document_chunk
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES "user"(id) ON DELETE CASCADE;

-- Backfill user_id from document table for existing chunks
UPDATE document_chunk dc
SET user_id = d.user_id
FROM document d
WHERE dc.document_id = d.id
  AND dc.user_id IS NULL;

-- Make user_id NOT NULL after backfill
ALTER TABLE document_chunk
ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_chunk_user_id ON document_chunk(user_id);

-- 3. Add project_id to chat_thread table (for RAG-enabled project chats)
ALTER TABLE chat_thread
ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES archive(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_chat_thread_project_id ON chat_thread(project_id);

COMMENT ON COLUMN chat_thread.project_id IS 'Optional reference to project/archive for context-aware RAG chats';

-- 4. Create document and document_chunk tables if they don't exist
CREATE TABLE IF NOT EXISTS document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size integer NOT NULL,
  hash text,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_document_project_id ON document(project_id);
CREATE INDEX IF NOT EXISTS idx_document_user_id ON document(user_id);

CREATE TABLE IF NOT EXISTS document_chunk (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  content text NOT NULL,
  chunk_index integer NOT NULL,
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_document_chunk_document_id ON document_chunk(document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunk_project_id ON document_chunk(project_id);
CREATE INDEX IF NOT EXISTS idx_document_chunk_user_id ON document_chunk(user_id);

-- 5. Create document_embedding table (separate from chunks for flexible vector storage)
CREATE TABLE IF NOT EXISTS document_embedding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id uuid NOT NULL REFERENCES document_chunk(id) ON DELETE CASCADE,
  embedding vector(1536), -- Default to OpenAI text-embedding-3-small (1536 dimensions)
  model text NOT NULL, -- e.g., 'text-embedding-3-small', 'text-embedding-3-large'
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(chunk_id) -- One embedding per chunk
);

CREATE INDEX IF NOT EXISTS idx_document_embedding_chunk_id ON document_embedding(chunk_id);
-- HNSW index for fast vector similarity search
CREATE INDEX IF NOT EXISTS idx_document_embedding_vector ON document_embedding 
  USING hnsw (embedding vector_cosine_ops);

COMMENT ON TABLE document_embedding IS 'Stores embeddings separately from chunks for flexible vector dimensions';
COMMENT ON COLUMN document_embedding.embedding IS 'Vector embedding for semantic search';
COMMENT ON COLUMN document_embedding.model IS 'Embedding model used (determines vector dimensions)';

-- ============================================================================
-- SETUP COMPLETE!
-- ============================================================================

-- Next steps:
-- 1. Set project_url in vault (see PART 2 above)
-- 2. Deploy the embed Edge Function
-- 3. Set VERCEL_AI_GATEWAY_API_KEY in Edge Function secrets
-- 4. Upload a test document to verify everything works
