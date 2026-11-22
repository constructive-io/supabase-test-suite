\echo Use "CREATE EXTENSION supabase-schema" to load this file. \quit
CREATE SCHEMA auth;

CREATE SCHEMA extensions;

CREATE SCHEMA graphql;

CREATE SCHEMA graphql_public;

CREATE SCHEMA pgbouncer;

CREATE SCHEMA realtime;

CREATE SCHEMA storage;

CREATE SCHEMA vault;

COMMENT ON EXTENSION pg_graphql IS 'pg_graphql: GraphQL support';

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';

COMMENT ON EXTENSION supabase_vault IS 'Supabase Vault Extension';

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';

CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $EOFCODE$
  select nullif(current_setting('request.jwt.claim.email', true), '')::text;
$EOFCODE$;

CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $EOFCODE$
  select nullif(current_setting('request.jwt.claim.role', true), '')::text;
$EOFCODE$;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $EOFCODE$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$EOFCODE$;

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger LANGUAGE plpgsql AS $EOFCODE$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$EOFCODE$;

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger LANGUAGE plpgsql AS $EOFCODE$
DECLARE
    func_is_graphql_resolve bool;
BEGIN
    func_is_graphql_resolve = (
        SELECT n.proname = 'resolve'
        FROM pg_event_trigger_ddl_commands() AS ev
        LEFT JOIN pg_catalog.pg_proc AS n
        ON ev.objid = n.oid
    );

    IF func_is_graphql_resolve
    THEN
        -- Update public wrapper to pass all arguments through to the pg_graphql resolve func
        DROP FUNCTION IF EXISTS graphql_public.graphql;
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language sql
        as $$
            select graphql.resolve(
                query := query,
                variables := coalesce(variables, '{}'),
                "operationName" := "operationName",
                extensions := extensions
            );
        $$;

        -- This hook executes when `graphql.resolve` is created. That is not necessarily the last
        -- function in the extension so we need to grant permissions on existing entities AND
        -- update default permissions to any others that are created after `graphql.resolve`
        grant usage on schema graphql to postgres, anon, authenticated, service_role;
        grant select on all tables in schema graphql to postgres, anon, authenticated, service_role;
        grant execute on all functions in schema graphql to postgres, anon, authenticated, service_role;
        grant all on all sequences in schema graphql to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on tables to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on functions to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on sequences to postgres, anon, authenticated, service_role;

        -- Allow postgres role to allow granting usage on graphql and graphql_public schemas to custom roles
        grant usage on schema graphql_public to postgres with grant option;
        grant usage on schema graphql to postgres with grant option;
    END IF;

END;
$EOFCODE$;

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger LANGUAGE plpgsql AS $EOFCODE$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$EOFCODE$;

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger LANGUAGE plpgsql AS $EOFCODE$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $EOFCODE$;

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger LANGUAGE plpgsql AS $EOFCODE$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $EOFCODE$;

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger LANGUAGE plpgsql AS $EOFCODE$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$EOFCODE$;

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';

CREATE FUNCTION pgbouncer.get_auth(
  p_usename text
) RETURNS TABLE (
  username text,
  password text
) LANGUAGE plpgsql SECURITY DEFINER AS $EOFCODE$
begin
    raise debug 'PgBouncer auth request: %', p_usename;

    return query
    select 
        rolname::text, 
        case when rolvaliduntil < now() 
            then null 
            else rolpassword::text 
        end 
    from pg_authid 
    where rolname=$1 and rolcanlogin;
end;
$EOFCODE$;

CREATE FUNCTION storage.extension(
  name text
) RETURNS text LANGUAGE plpgsql AS $EOFCODE$
DECLARE
_parts text[];
_filename text;
BEGIN
    select string_to_array(name, '/') into _parts;
    select _parts[array_length(_parts,1)] into _filename;
    -- @todo return the last part instead of 2
    return split_part(_filename, '.', 2);
END
$EOFCODE$;

CREATE FUNCTION storage.filename(
  name text
) RETURNS text LANGUAGE plpgsql AS $EOFCODE$
DECLARE
_parts text[];
BEGIN
    select string_to_array(name, '/') into _parts;
    return _parts[array_length(_parts,1)];
END
$EOFCODE$;

CREATE FUNCTION storage.foldername(
  name text
) RETURNS text[] LANGUAGE plpgsql AS $EOFCODE$
DECLARE
_parts text[];
BEGIN
    select string_to_array(name, '/') into _parts;
    return _parts[1:array_length(_parts,1)-1];
END
$EOFCODE$;

CREATE FUNCTION storage.search(
  prefix text,
  bucketname text,
  limits int DEFAULT 100,
  levels int DEFAULT 1,
  offsets int DEFAULT 0
) RETURNS TABLE (
  name text,
  id uuid,
  updated_at timestamp with time zone,
  created_at timestamp with time zone,
  last_accessed_at timestamp with time zone,
  metadata jsonb
) LANGUAGE plpgsql AS $EOFCODE$
DECLARE
_bucketId text;
BEGIN
    -- will be replaced by migrations when server starts
    -- saving space for cloud-init
END
$EOFCODE$;

SET default_tablespace TO '';

SET default_table_access_method TO heap;

CREATE TABLE auth.audit_log_entries (
  instance_id uuid,
  id uuid NOT NULL,
  payload pg_catalog.json,
  created_at timestamp with time zone
);

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';

CREATE TABLE auth.instances (
  id uuid NOT NULL,
  uuid uuid,
  raw_base_config text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
);

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';

CREATE TABLE auth.refresh_tokens (
  instance_id uuid,
  id bigint NOT NULL,
  token varchar(255),
  user_id varchar(255),
  revoked boolean,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
);

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';

CREATE SEQUENCE auth.refresh_tokens_id_seq START 1 INCREMENT 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;

CREATE TABLE auth.schema_migrations (
  version varchar(255) NOT NULL
);

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';

CREATE TABLE auth.users (
  instance_id uuid,
  id uuid NOT NULL,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  confirmed_at timestamp with time zone,
  invited_at timestamp with time zone,
  confirmation_token varchar(255),
  confirmation_sent_at timestamp with time zone,
  recovery_token varchar(255),
  recovery_sent_at timestamp with time zone,
  email_change_token varchar(255),
  email_change varchar(255),
  email_change_sent_at timestamp with time zone,
  last_sign_in_at timestamp with time zone,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
);

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';

CREATE TABLE public.schema_migrations (
  version varchar(128) NOT NULL
);

CREATE TABLE storage.buckets (
  id text NOT NULL,
  name text NOT NULL,
  owner uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE storage.migrations (
  id int NOT NULL,
  name varchar(100) NOT NULL,
  hash varchar(40) NOT NULL,
  executed_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE storage.objects (
  id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  last_accessed_at timestamp with time zone DEFAULT now(),
  metadata jsonb
);

ALTER TABLE ONLY auth.refresh_tokens 
  ALTER COLUMN id SET DEFAULT nextval(CAST('auth.refresh_tokens_id_seq' AS regclass));

ALTER TABLE ONLY auth.audit_log_entries 
  ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY auth.instances 
  ADD CONSTRAINT instances_pkey PRIMARY KEY (id);

ALTER TABLE ONLY auth.refresh_tokens 
  ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY auth.schema_migrations 
  ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);

ALTER TABLE ONLY auth.users 
  ADD CONSTRAINT users_email_key 
    UNIQUE (email);

ALTER TABLE ONLY auth.users 
  ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.schema_migrations 
  ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);

ALTER TABLE ONLY storage.buckets 
  ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY storage.migrations 
  ADD CONSTRAINT migrations_name_key 
    UNIQUE (name);

ALTER TABLE ONLY storage.migrations 
  ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY storage.objects 
  ADD CONSTRAINT objects_pkey PRIMARY KEY (id);

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries (instance_id);

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens (instance_id);

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens (instance_id, user_id);

CREATE INDEX refresh_tokens_token_idx ON auth.refresh_tokens (token);

CREATE INDEX users_instance_id_email_idx ON auth.users (instance_id, email);

CREATE INDEX users_instance_id_idx ON auth.users (instance_id);

CREATE UNIQUE INDEX bname ON storage.buckets (name);

CREATE UNIQUE INDEX bucketid_objname ON storage.objects (bucket_id, name);

CREATE INDEX name_prefix_search ON storage.objects (name text_pattern_ops);

ALTER TABLE ONLY storage.buckets 
  ADD CONSTRAINT buckets_owner_fkey
    FOREIGN KEY(owner)
    REFERENCES auth.users (id);

ALTER TABLE ONLY storage.objects 
  ADD CONSTRAINT "objects_bucketId_fkey"
    FOREIGN KEY(bucket_id)
    REFERENCES storage.buckets (id);

ALTER TABLE ONLY storage.objects 
  ADD CONSTRAINT objects_owner_fkey
    FOREIGN KEY(owner)
    REFERENCES auth.users (id);

ALTER TABLE storage.objects 
  ENABLE ROW LEVEL SECURITY;

CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');

CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop WHEN tag IN ('DROP EXTENSION') EXECUTE PROCEDURE extensions.set_graphql_placeholder();

CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end WHEN tag IN ('CREATE EXTENSION') EXECUTE PROCEDURE extensions.grant_pg_cron_access();

CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end WHEN tag IN ('CREATE FUNCTION') EXECUTE PROCEDURE extensions.grant_pg_graphql_access();

CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end WHEN tag IN ('CREATE EXTENSION') EXECUTE PROCEDURE extensions.grant_pg_net_access();

CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end EXECUTE PROCEDURE extensions.pgrst_ddl_watch();

CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop EXECUTE PROCEDURE extensions.pgrst_drop_watch();

CREATE SCHEMA IF NOT EXISTS supabase_functions;

ALTER SCHEMA supabase_functions OWNER TO supabase_admin;

GRANT USAGE ON SCHEMA supabase_functions TO postgres;

GRANT USAGE ON SCHEMA supabase_functions TO anon;

GRANT USAGE ON SCHEMA supabase_functions TO authenticated;

GRANT USAGE ON SCHEMA supabase_functions TO service_role;

GRANT ALL ON SCHEMA supabase_functions TO supabase_functions_admin;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions
  GRANT ALL ON SEQUENCES TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions
  GRANT ALL ON SEQUENCES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions
  GRANT ALL ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions
  GRANT ALL ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions
  GRANT ALL ON FUNCTIONS TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions
  GRANT ALL ON FUNCTIONS TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions
  GRANT ALL ON FUNCTIONS TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions
  GRANT ALL ON FUNCTIONS TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions
  GRANT ALL ON TABLES TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions
  GRANT ALL ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions
  GRANT ALL ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions
  GRANT ALL ON TABLES TO service_role;

CREATE TABLE supabase_functions.migrations (
  version text PRIMARY KEY,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO supabase_functions.migrations (
  version
) VALUES
  ('initial');

CREATE TABLE supabase_functions.hooks (
  id bigserial PRIMARY KEY,
  hook_table_id int NOT NULL,
  hook_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  request_id bigint
);

CREATE INDEX supabase_functions_hooks_request_id_idx ON supabase_functions.hooks (request_id);

CREATE INDEX supabase_functions_hooks_h_table_id_h_name_idx ON supabase_functions.hooks (hook_table_id, hook_name);

COMMENT ON TABLE supabase_functions.hooks IS 'Supabase Functions Hooks: Audit trail for triggered hooks.';

DO $EOFCODE$ begin
    create type auth.code_challenge_method as enum('s256', 'plain');
exception
    when duplicate_object then null;
end $EOFCODE$;

CREATE TABLE IF NOT EXISTS auth.flow_state (
  id uuid PRIMARY KEY,
  user_id uuid NULL,
  auth_code text NOT NULL,
  code_challenge_method code_challenge_method NOT NULL,
  code_challenge text NOT NULL,
  provider_type text NOT NULL,
  provider_access_token text NULL,
  provider_refresh_token text NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_code ON auth.flow_state (auth_code);

COMMENT ON TABLE auth.flow_state IS 'stores metadata for pkce logins';

CREATE TABLE IF NOT EXISTS auth.identities (
  id text NOT NULL,
  user_id uuid NOT NULL,
  identity_data jsonb NOT NULL,
  provider text NOT NULL,
  last_sign_in_at timestamptz NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  CONSTRAINT identities_pkey PRIMARY KEY (provider, id),
  CONSTRAINT identities_user_id_fkey
    FOREIGN KEY(user_id)
    REFERENCES auth.users (id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  CONSTRAINT sessions_pkey PRIMARY KEY (id),
  CONSTRAINT sessions_user_id_fkey
    FOREIGN KEY(user_id)
    REFERENCES auth.users (id)
    ON DELETE CASCADE
);

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';

ALTER TABLE auth.refresh_tokens 
  ADD COLUMN IF NOT EXISTS session_id uuid
    NULL;

DO $EOFCODE$
begin
  if not exists(select *
    from information_schema.constraint_column_usage
    where table_schema = 'auth' and table_name='sessions' and constraint_name='refresh_tokens_session_id_fkey')
  then
      alter table "auth"."refresh_tokens" add constraint refresh_tokens_session_id_fkey foreign key (session_id) references auth.sessions(id) on delete cascade;
  end if;
END $EOFCODE$;

CREATE TYPE factor_type AS ENUM ('totp', 'webauthn');

CREATE TYPE factor_status AS ENUM ('unverified', 'verified');

CREATE TYPE aal_level AS ENUM ('aal1', 'aal2', 'aal3');

CREATE TABLE IF NOT EXISTS auth.mfa_factors (
  id uuid NOT NULL,
  user_id uuid NOT NULL,
  friendly_name text NULL,
  factor_type factor_type NOT NULL,
  status factor_status NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  secret text NULL,
  CONSTRAINT mfa_factors_pkey PRIMARY KEY (id),
  CONSTRAINT mfa_factors_user_id_fkey
    FOREIGN KEY(user_id)
    REFERENCES auth.users (id)
    ON DELETE CASCADE
);

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';

CREATE UNIQUE INDEX IF NOT EXISTS mfa_factors_user_friendly_name_unique ON auth.mfa_factors (friendly_name, user_id) WHERE TRIM(BOTH FROM friendly_name) <> '';

CREATE TABLE IF NOT EXISTS auth.mfa_challenges (
  id uuid NOT NULL,
  factor_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  verified_at timestamptz NULL,
  ip_address inet NOT NULL,
  CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id),
  CONSTRAINT mfa_challenges_auth_factor_id_fkey
    FOREIGN KEY(factor_id)
    REFERENCES auth.mfa_factors (id)
    ON DELETE CASCADE
);

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';

CREATE TABLE IF NOT EXISTS auth.mfa_amr_claims (
  session_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  authentication_method text NOT NULL,
  CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey 
    UNIQUE (session_id, authentication_method),
  CONSTRAINT mfa_amr_claims_session_id_fkey
    FOREIGN KEY(session_id)
    REFERENCES auth.sessions (id)
    ON DELETE CASCADE
);

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';

DO $EOFCODE$ begin
    create type auth.oauth_registration_type as enum('dynamic', 'manual');
exception
    when duplicate_object then null;
end $EOFCODE$;

CREATE TABLE IF NOT EXISTS auth.oauth_clients (
  id uuid NOT NULL,
  client_id text NOT NULL,
  client_secret_hash text NOT NULL,
  registration_type auth.oauth_registration_type NOT NULL,
  redirect_uris text NOT NULL,
  grant_types text NOT NULL,
  client_name text NULL,
  client_uri text NULL,
  logo_uri text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT oauth_clients_pkey PRIMARY KEY (id),
  CONSTRAINT oauth_clients_client_id_key 
    UNIQUE (client_id),
  CONSTRAINT oauth_clients_client_name_length 
    CHECK (char_length(client_name) <= 1024),
  CONSTRAINT oauth_clients_client_uri_length 
    CHECK (char_length(client_uri) <= 2048),
  CONSTRAINT oauth_clients_logo_uri_length 
    CHECK (char_length(logo_uri) <= 2048)
);

CREATE INDEX IF NOT EXISTS oauth_clients_client_id_idx ON auth.oauth_clients (client_id);

CREATE INDEX IF NOT EXISTS oauth_clients_deleted_at_idx ON auth.oauth_clients (deleted_at);

DO $EOFCODE$ begin
    create type auth.oauth_authorization_status as enum('pending', 'approved', 'denied', 'expired');
exception
    when duplicate_object then null;
end $EOFCODE$;

DO $EOFCODE$ begin
    create type auth.oauth_response_type as enum('code');
exception
    when duplicate_object then null;
end $EOFCODE$;

CREATE TABLE IF NOT EXISTS auth.oauth_authorizations (
  id uuid NOT NULL,
  authorization_id text NOT NULL,
  client_id uuid NOT NULL REFERENCES auth.oauth_clients (id)
    ON DELETE CASCADE,
  user_id uuid NULL REFERENCES auth.users (id)
    ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  scope text NOT NULL,
  state text NULL,
  resource text NULL,
  code_challenge text NULL,
  code_challenge_method auth.code_challenge_method NULL,
  response_type auth.oauth_response_type NOT NULL DEFAULT 'code',
  status auth.oauth_authorization_status NOT NULL DEFAULT 'pending',
  authorization_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + '3 minutes'::interval,
  approved_at timestamptz NULL,
  CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id),
  CONSTRAINT oauth_authorizations_authorization_id_key 
    UNIQUE (authorization_id),
  CONSTRAINT oauth_authorizations_authorization_code_key 
    UNIQUE (authorization_code),
  CONSTRAINT oauth_authorizations_redirect_uri_length 
    CHECK (char_length(redirect_uri) <= 2048),
  CONSTRAINT oauth_authorizations_scope_length 
    CHECK (char_length(scope) <= 4096),
  CONSTRAINT oauth_authorizations_state_length 
    CHECK (char_length(state) <= 4096),
  CONSTRAINT oauth_authorizations_resource_length 
    CHECK (char_length(resource) <= 2048),
  CONSTRAINT oauth_authorizations_code_challenge_length 
    CHECK (char_length(code_challenge) <= 128),
  CONSTRAINT oauth_authorizations_authorization_code_length 
    CHECK (char_length(authorization_code) <= 255),
  CONSTRAINT oauth_authorizations_expires_at_future 
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS oauth_auth_pending_exp_idx ON auth.oauth_authorizations (expires_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS auth.oauth_consents (
  id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users (id)
    ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES auth.oauth_clients (id)
    ON DELETE CASCADE,
  scopes text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  CONSTRAINT oauth_consents_pkey PRIMARY KEY (id),
  CONSTRAINT oauth_consents_user_client_unique 
    UNIQUE (user_id, client_id),
  CONSTRAINT oauth_consents_scopes_length 
    CHECK (char_length(scopes) <= 2048),
  CONSTRAINT oauth_consents_scopes_not_empty 
    CHECK (char_length(TRIM(BOTH FROM scopes)) > 0),
  CONSTRAINT oauth_consents_revoked_after_granted 
    CHECK (
    revoked_at IS NULL
      OR revoked_at >= granted_at
  )
);

CREATE INDEX IF NOT EXISTS oauth_consents_active_user_client_idx ON auth.oauth_consents (user_id, client_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS oauth_consents_user_order_idx ON auth.oauth_consents (user_id, granted_at DESC);

CREATE INDEX IF NOT EXISTS oauth_consents_active_client_idx ON auth.oauth_consents (client_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth.sso_providers (
  id uuid NOT NULL,
  resource_id text NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  PRIMARY KEY (id),
  CONSTRAINT "resource_id not empty" 
    CHECK (
    resource_id = NULL
      OR char_length(resource_id) > 0
  )
);

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';

CREATE UNIQUE INDEX IF NOT EXISTS sso_providers_resource_id_idx ON auth.sso_providers ((lower(resource_id)));

CREATE TABLE IF NOT EXISTS auth.sso_domains (
  id uuid NOT NULL,
  sso_provider_id uuid NOT NULL,
  domain text NOT NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  PRIMARY KEY (id),
  FOREIGN KEY(sso_provider_id)
    REFERENCES auth.sso_providers (id)
    ON DELETE CASCADE,
  CONSTRAINT "domain not empty" 
    CHECK (char_length(domain) > 0)
);

CREATE INDEX IF NOT EXISTS sso_domains_sso_provider_id_idx ON auth.sso_domains (sso_provider_id);

CREATE UNIQUE INDEX IF NOT EXISTS sso_domains_domain_idx ON auth.sso_domains ((lower(domain)));

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';

CREATE TABLE IF NOT EXISTS auth.saml_providers (
  id uuid NOT NULL,
  sso_provider_id uuid NOT NULL,
  entity_id text NOT NULL UNIQUE,
  metadata_xml text NOT NULL,
  metadata_url text NULL,
  attribute_mapping jsonb NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  PRIMARY KEY (id),
  FOREIGN KEY(sso_provider_id)
    REFERENCES auth.sso_providers (id)
    ON DELETE CASCADE,
  CONSTRAINT "metadata_xml not empty" 
    CHECK (char_length(metadata_xml) > 0),
  CONSTRAINT "metadata_url not empty" 
    CHECK (
    metadata_url = NULL
      OR char_length(metadata_url) > 0
  ),
  CONSTRAINT "entity_id not empty" 
    CHECK (char_length(entity_id) > 0)
);

CREATE INDEX IF NOT EXISTS saml_providers_sso_provider_id_idx ON auth.saml_providers (sso_provider_id);

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';

CREATE TABLE IF NOT EXISTS auth.saml_relay_states (
  id uuid NOT NULL,
  sso_provider_id uuid NOT NULL,
  request_id text NOT NULL,
  for_email text NULL,
  redirect_to text NULL,
  from_ip_address inet NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  PRIMARY KEY (id),
  FOREIGN KEY(sso_provider_id)
    REFERENCES auth.sso_providers (id)
    ON DELETE CASCADE,
  CONSTRAINT "request_id not empty" 
    CHECK (char_length(request_id) > 0)
);

CREATE INDEX IF NOT EXISTS saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states (sso_provider_id);

CREATE INDEX IF NOT EXISTS saml_relay_states_for_email_idx ON auth.saml_relay_states (for_email);

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';

CREATE TABLE IF NOT EXISTS auth.sso_sessions (
  id uuid NOT NULL,
  session_id uuid NOT NULL,
  sso_provider_id uuid NULL,
  not_before timestamptz NULL,
  not_after timestamptz NULL,
  idp_initiated boolean DEFAULT false,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  PRIMARY KEY (id),
  FOREIGN KEY(session_id)
    REFERENCES auth.sessions (id)
    ON DELETE CASCADE,
  FOREIGN KEY(sso_provider_id)
    REFERENCES auth.sso_providers (id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sso_sessions_session_id_idx ON auth.sso_sessions (session_id);

CREATE INDEX IF NOT EXISTS sso_sessions_sso_provider_id_idx ON auth.sso_sessions (sso_provider_id);

COMMENT ON TABLE auth.sso_sessions IS 'Auth: A session initiated by an SSO Identity Provider';

DO $EOFCODE$ begin
  create type one_time_token_type as enum (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
  );
exception
  when duplicate_object then null;
end $EOFCODE$;

DO $EOFCODE$ begin
  create table if not exists auth.one_time_tokens (
    id uuid primary key,
    user_id uuid not null references auth.users on delete cascade,
    token_type one_time_token_type not null,
    token_hash text not null,
    relates_to text not null,
    created_at timestamp without time zone not null default now(),
    updated_at timestamp without time zone not null default now(),
    check (char_length(token_hash) > 0)
  );

  begin
    create index if not exists one_time_tokens_token_hash_hash_idx on auth.one_time_tokens using hash (token_hash);
    create index if not exists one_time_tokens_relates_to_hash_idx on auth.one_time_tokens using hash (relates_to);
  exception when others then
    -- Fallback to btree indexes if hash creation fails
    create index if not exists one_time_tokens_token_hash_hash_idx on auth.one_time_tokens using btree (token_hash);
    create index if not exists one_time_tokens_relates_to_hash_idx on auth.one_time_tokens using btree (relates_to);
  end;

  create unique index if not exists one_time_tokens_user_id_token_type_key on auth.one_time_tokens (user_id, token_type);
end $EOFCODE$;

DO $EOFCODE$
BEGIN
    IF NOT EXISTS(SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'storage') THEN
        CREATE SCHEMA storage;
    END IF;
END$EOFCODE$;

DO $EOFCODE$
DECLARE
    install_roles text = COALESCE(current_setting('storage.install_roles', true), 'true');
    anon_role text = COALESCE(current_setting('storage.anon_role', true), 'anon');
    authenticated_role text = COALESCE(current_setting('storage.authenticated_role', true), 'authenticated');
    service_role text = COALESCE(current_setting('storage.service_role', true), 'service_role');
BEGIN
    IF install_roles != 'true' THEN
        RETURN;
    END IF;

  -- Install ROLES
--   EXECUTE 'CREATE ROLE ' || anon_role || ' NOLOGIN NOINHERIT';
--   EXECUTE 'CREATE ROLE ' || authenticated_role || ' NOLOGIN NOINHERIT';
--   EXECUTE 'CREATE ROLE ' || service_role || ' NOLOGIN NOINHERIT bypassrls';

--   create user authenticator noinherit;
  EXECUTE 'grant ' || anon_role || ' to authenticator';
  EXECUTE 'grant ' || authenticated_role || ' to authenticator';
  EXECUTE 'grant ' || service_role || ' to authenticator';
--   grant postgres          to authenticator;

  EXECUTE 'grant usage on schema storage to postgres,' ||  anon_role || ',' || authenticated_role || ',' || service_role;

  EXECUTE 'alter default privileges in schema storage grant all on tables to postgres,' ||  anon_role || ',' || authenticated_role || ',' || service_role;
  EXECUTE 'alter default privileges in schema storage grant all on functions to postgres,' ||  anon_role || ',' || authenticated_role || ',' || service_role;
  EXECUTE 'alter default privileges in schema storage grant all on sequences to postgres,' ||  anon_role || ',' || authenticated_role || ',' || service_role;
END$EOFCODE$;

CREATE TABLE IF NOT EXISTS storage.migrations (
  id int PRIMARY KEY,
  name varchar(100) UNIQUE NOT NULL,
  hash varchar(40) NOT NULL,
  executed_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text NOT NULL,
  name text NOT NULL,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS bname ON storage.buckets (name);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb,
  CONSTRAINT "objects_bucketId_fkey"
    FOREIGN KEY(bucket_id)
    REFERENCES storage.buckets (id),
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS bucketid_objname ON storage.objects (bucket_id, name);

CREATE INDEX IF NOT EXISTS name_prefix_search ON storage.objects (name text_pattern_ops);

ALTER TABLE storage.objects 
  ENABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS storage.foldername;

CREATE OR REPLACE FUNCTION storage.foldername(
  name text
) RETURNS text[] LANGUAGE plpgsql AS $EOFCODE$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[1:array_length(_parts,1)-1];
END
$EOFCODE$;

DROP FUNCTION IF EXISTS storage.filename;

CREATE OR REPLACE FUNCTION storage.filename(
  name text
) RETURNS text LANGUAGE plpgsql AS $EOFCODE$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$EOFCODE$;

DROP FUNCTION IF EXISTS storage.extension;

CREATE OR REPLACE FUNCTION storage.extension(
  name text
) RETURNS text LANGUAGE plpgsql AS $EOFCODE$
DECLARE
_parts text[];
_filename text;
BEGIN
	select string_to_array(name, '/') into _parts;
	select _parts[array_length(_parts,1)] into _filename;
	-- @todo return the last part instead of 2
	return reverse(split_part(reverse(_filename), '.', 1));
END
$EOFCODE$;

DROP FUNCTION IF EXISTS storage.search;

CREATE OR REPLACE FUNCTION storage.search(
  prefix text,
  bucketname text,
  limits int DEFAULT 100,
  levels int DEFAULT 1,
  offsets int DEFAULT 0
) RETURNS TABLE (
  name text,
  id uuid,
  updated_at timestamptz,
  created_at timestamptz,
  last_accessed_at timestamptz,
  metadata jsonb
) LANGUAGE plpgsql AS $EOFCODE$
BEGIN
	return query 
		with files_folders as (
			select ((string_to_array(objects.name, '/'))[levels]) as folder
			from objects
			where objects.name ilike prefix || '%'
			and bucket_id = bucketname
			GROUP by folder
			limit limits
			offset offsets
		) 
		select files_folders.folder as name, objects.id, objects.updated_at, objects.created_at, objects.last_accessed_at, objects.metadata from files_folders 
		left join objects
		on prefix || files_folders.folder = objects.name and objects.bucket_id=bucketname;
END
$EOFCODE$;

DO $EOFCODE$
DECLARE
    install_roles text = COALESCE(current_setting('storage.install_roles', true), 'true');
    super_user text = COALESCE(current_setting('storage.super_user', true), 'supabase_storage_admin');
BEGIN
    IF install_roles != 'true' THEN
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = super_user) THEN
        EXECUTE 'CREATE USER ' || super_user || ' NOINHERIT CREATEROLE LOGIN NOREPLICATION';
    END IF;

    -- Grant privileges to Super User
    EXECUTE 'GRANT ALL PRIVILEGES ON SCHEMA storage TO ' || super_user;
    EXECUTE 'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA storage TO ' || super_user;
    EXECUTE 'GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA storage TO ' || super_user;

    IF super_user != 'postgres' THEN
        EXECUTE 'ALTER USER ' || super_user || ' SET search_path = "storage"';
    END IF;

    EXECUTE 'ALTER table "storage".objects owner to ' || super_user;
    EXECUTE 'ALTER table "storage".buckets owner to ' || super_user;
    EXECUTE 'ALTER table "storage".migrations OWNER TO ' || super_user;
    EXECUTE 'ALTER function "storage".foldername(text) owner to ' || super_user;
    EXECUTE 'ALTER function "storage".filename(text) owner to ' || super_user;
    EXECUTE 'ALTER function "storage".extension(text) owner to ' || super_user;
    EXECUTE 'ALTER function "storage".search(text,text,int,int,int) owner to ' || super_user;
END$EOFCODE$;

ALTER TABLE storage.objects 
  ADD COLUMN IF NOT EXISTS level int
    NULL;

CREATE OR REPLACE FUNCTION storage.get_level(
  name text
) RETURNS int AS $EOFCODE$
SELECT array_length(string_to_array("name", '/'), 1);
$EOFCODE$ LANGUAGE sql IMMUTABLE STRICT;

CREATE TABLE IF NOT EXISTS storage.prefixes (
  bucket_id text,
  name text COLLATE "C" NOT NULL,
  level int GENERATED ALWAYS AS (storage.get_level(name)) STORED,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT "prefixes_bucketId_fkey"
    FOREIGN KEY(bucket_id)
    REFERENCES storage.buckets (id),
  PRIMARY KEY (bucket_id, level, name)
);

ALTER TABLE storage.prefixes 
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.get_prefix(
  name text
) RETURNS text AS $EOFCODE$
SELECT
    CASE WHEN strpos("name", '/') > 0 THEN
             regexp_replace("name", '[\/]{1}[^\/]+\/?$', '')
         ELSE
             ''
        END;
$EOFCODE$ LANGUAGE sql IMMUTABLE STRICT;

CREATE OR REPLACE FUNCTION storage.get_prefixes(
  name text
) RETURNS text[] AS $EOFCODE$
DECLARE
    parts text[];
    prefixes text[];
    prefix text;
BEGIN
    -- Split the name into parts by '/'
    parts := string_to_array("name", '/');
    prefixes := '{}';

    -- Construct the prefixes, stopping one level below the last part
    FOR i IN 1..array_length(parts, 1) - 1 LOOP
            prefix := array_to_string(parts[1:i], '/');
            prefixes := array_append(prefixes, prefix);
    END LOOP;

    RETURN prefixes;
END;
$EOFCODE$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE OR REPLACE FUNCTION storage.add_prefixes(
  _bucket_id text,
  _name text
) RETURNS void SECURITY DEFINER AS $EOFCODE$
DECLARE
    prefixes text[];
BEGIN
    prefixes := "storage"."get_prefixes"("_name");

    IF array_length(prefixes, 1) > 0 THEN
        INSERT INTO storage.prefixes (name, bucket_id)
        SELECT UNNEST(prefixes) as name, "_bucket_id" ON CONFLICT DO NOTHING;
    END IF;
END;
$EOFCODE$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE FUNCTION storage.delete_prefix(
  _bucket_id text,
  _name text
) RETURNS boolean SECURITY DEFINER AS $EOFCODE$
BEGIN
    -- Check if we can delete the prefix
    IF EXISTS(
        SELECT FROM "storage"."prefixes"
        WHERE "prefixes"."bucket_id" = "_bucket_id"
          AND level = "storage"."get_level"("_name") + 1
          AND "prefixes"."name" COLLATE "C" LIKE "_name" || '/%'
        LIMIT 1
    )
    OR EXISTS(
        SELECT FROM "storage"."objects"
        WHERE "objects"."bucket_id" = "_bucket_id"
          AND "storage"."get_level"("objects"."name") = "storage"."get_level"("_name") + 1
          AND "objects"."name" COLLATE "C" LIKE "_name" || '/%'
        LIMIT 1
    ) THEN
    -- There are sub-objects, skip deletion
    RETURN false;
    ELSE
        DELETE FROM "storage"."prefixes"
        WHERE "prefixes"."bucket_id" = "_bucket_id"
          AND level = "storage"."get_level"("_name")
          AND "prefixes"."name" = "_name";
        RETURN true;
    END IF;
END;
$EOFCODE$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE FUNCTION storage.prefixes_insert_trigger() RETURNS trigger AS $EOFCODE$
BEGIN
    PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    RETURN NEW;
END;
$EOFCODE$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE FUNCTION storage.objects_insert_prefix_trigger() RETURNS trigger AS $EOFCODE$
BEGIN
    PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    NEW.level := "storage"."get_level"(NEW."name");

    RETURN NEW;
END;
$EOFCODE$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE FUNCTION storage.delete_prefix_hierarchy_trigger() RETURNS trigger AS $EOFCODE$
DECLARE
    prefix text;
BEGIN
    prefix := "storage"."get_prefix"(OLD."name");

    IF coalesce(prefix, '') != '' THEN
        PERFORM "storage"."delete_prefix"(OLD."bucket_id", prefix);
    END IF;

    RETURN OLD;
END;
$EOFCODE$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE TRIGGER prefixes_delete_hierarchy
  AFTER DELETE
  ON storage.prefixes
  FOR EACH ROW
  EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();

CREATE OR REPLACE TRIGGER objects_insert_create_prefix
  BEFORE INSERT
  ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION storage.objects_insert_prefix_trigger();

CREATE OR REPLACE TRIGGER objects_update_create_prefix
  BEFORE UPDATE
  ON storage.objects
  FOR EACH ROW
  WHEN (new.name <> old.name)
  EXECUTE FUNCTION storage.objects_insert_prefix_trigger();

CREATE OR REPLACE TRIGGER objects_delete_delete_prefix
  AFTER DELETE
  ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();

DO $EOFCODE$
    DECLARE
        anon_role text = COALESCE(current_setting('storage.anon_role', true), 'anon');
        authenticated_role text = COALESCE(current_setting('storage.authenticated_role', true), 'authenticated');
        service_role text = COALESCE(current_setting('storage.service_role', true), 'service_role');
    BEGIN
        EXECUTE 'GRANT ALL ON TABLE storage.prefixes TO ' || service_role || ',' || authenticated_role || ', ' || anon_role;
END$EOFCODE$;

DO $EOFCODE$
    DECLARE
        is_multitenant bool = COALESCE(current_setting('storage.multitenant', true), 'false')::boolean;
        anon_role text = COALESCE(current_setting('storage.anon_role', true), 'anon');
        authenticated_role text = COALESCE(current_setting('storage.authenticated_role', true), 'authenticated');
        service_role text = COALESCE(current_setting('storage.service_role', true), 'service_role');
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'buckettype') THEN
            create type storage.BucketType as enum (
                'STANDARD',
                'ANALYTICS'
            );
        END IF;

        ALTER TABLE storage.buckets DROP COLUMN IF EXISTS iceberg_catalog;
        ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS type storage.BucketType NOT NULL default 'STANDARD';

        CREATE TABLE IF NOT EXISTS storage.buckets_analytics (
            id text not null primary key,
            type storage.BucketType NOT NULL default 'ANALYTICS',
            format text NOT NULL default 'ICEBERG',
            created_at timestamptz NOT NULL default now(),
            updated_at timestamptz NOT NULL default now()
        );

        ALTER TABLE storage.buckets_analytics ADD COLUMN IF NOT EXISTS type storage.BucketType NOT NULL default 'ANALYTICS';
        ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

        EXECUTE 'GRANT ALL ON TABLE storage.buckets_analytics TO ' || service_role || ', ' || authenticated_role || ', ' || anon_role;

        IF is_multitenant THEN
            RETURN;
        END IF;

        CREATE TABLE IF NOT EXISTS storage.iceberg_namespaces (
            id uuid primary key default gen_random_uuid(),
            bucket_id text NOT NULL references storage.buckets_analytics(id) ON DELETE CASCADE,
            name text COLLATE "C" NOT NULL,
            created_at timestamptz NOT NULL default now(),
            updated_at timestamptz NOT NULL default now()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_iceberg_namespaces_bucket_id ON storage.iceberg_namespaces (bucket_id, name);

        CREATE TABLE IF NOT EXISTS storage.iceberg_tables (
          id uuid primary key default gen_random_uuid(),
          namespace_id uuid NOT NULL references storage.iceberg_namespaces(id) ON DELETE CASCADE,
          bucket_id text NOT NULL references storage.buckets_analytics(id) ON DELETE CASCADE,
          name text COLLATE "C" NOT NULL,
          location text not null,
          created_at timestamptz NOT NULL default now(),
          updated_at timestamptz NOT NULL default now()
        );

        CREATE UNIQUE INDEX idx_iceberg_tables_namespace_id ON storage.iceberg_tables (namespace_id, name);

        ALTER TABLE storage.iceberg_namespaces ENABLE ROW LEVEL SECURITY;
        ALTER TABLE storage.iceberg_tables ENABLE ROW LEVEL SECURITY;

        EXECUTE 'revoke all on storage.iceberg_namespaces from ' || anon_role || ', ' || authenticated_role;
        EXECUTE 'GRANT ALL ON TABLE storage.iceberg_namespaces TO ' || service_role;
        EXECUTE 'GRANT SELECT ON TABLE storage.iceberg_namespaces TO ' || authenticated_role || ', ' || anon_role;

        EXECUTE 'revoke all on storage.iceberg_tables from ' || anon_role || ', ' || authenticated_role;
        EXECUTE 'GRANT ALL ON TABLE storage.iceberg_tables TO ' || service_role;
        EXECUTE 'GRANT SELECT ON TABLE storage.iceberg_tables TO ' || authenticated_role || ', ' || anon_role;
END$EOFCODE$;