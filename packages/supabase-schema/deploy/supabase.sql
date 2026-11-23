-- PostgreSQL database dump
--


--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql;


--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql_public;


--
-- Name: pgbouncer; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgbouncer;


--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA realtime;


--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA storage;


--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA vault;


--
-- Name: pg_graphql; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_graphql WITH SCHEMA graphql;


--
-- Name: EXTENSION pg_graphql; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_graphql IS 'pg_graphql: GraphQL support';


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;


--
-- Name: EXTENSION supabase_vault; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION supabase_vault IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select nullif(current_setting('request.jwt.claim.email', true), '')::text;
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select nullif(current_setting('request.jwt.claim.role', true), '')::text;
$$;


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;


-------------------------------------------------
-------------------------------------------------
-------------------------------------------------
-------------------------------------------------
-- NOTE: CHEATING FOR NOW (NO LONGER NEEDED)
-- Grant permissions on auth schema and functions to public
-- GRANT USAGE ON SCHEMA auth TO public;
-- GRANT EXECUTE ON FUNCTION auth.uid() TO public;
-- GRANT EXECUTE ON FUNCTION auth.role() TO public;
-------------------------------------------------
-------------------------------------------------
-------------------------------------------------
-------------------------------------------------




--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
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
$_$;


--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
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
END; $$;


--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
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
END; $$;


--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
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
$_$;


--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: get_auth(text); Type: FUNCTION; Schema: pgbouncer; Owner: -
--

CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(username text, password text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
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
$_$;


--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
_filename text;
BEGIN
    select string_to_array(name, '/') into _parts;
    select _parts[array_length(_parts,1)] into _filename;
    -- @todo return the last part instead of 2
    return split_part(_filename, '.', 2);
END
$$;


--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
BEGIN
    select string_to_array(name, '/') into _parts;
    return _parts[array_length(_parts,1)];
END
$$;


--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
BEGIN
    select string_to_array(name, '/') into _parts;
    return _parts[1:array_length(_parts,1)-1];
END
$$;


--
-- Name: search(text, text, integer, integer, integer); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql
    AS $$
DECLARE
_bucketId text;
BEGIN
    -- will be replaced by migrations when server starts
    -- saving space for cloud-init
END
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone
);


--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: -
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: -
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying(128) NOT NULL
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--

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


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_token_idx ON auth.refresh_tokens USING btree (token);


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, email);


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: buckets buckets_owner_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_owner_fkey FOREIGN KEY (owner) REFERENCES auth.users(id);


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: objects objects_owner_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_owner_fkey FOREIGN KEY (owner) REFERENCES auth.users(id);


--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: -
--

CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION extensions.set_graphql_placeholder();


--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_cron_access();


--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end
         WHEN TAG IN ('CREATE FUNCTION')
   EXECUTE FUNCTION extensions.grant_pg_graphql_access();


--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_net_access();


--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end
   EXECUTE FUNCTION extensions.pgrst_ddl_watch();


--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop
   EXECUTE FUNCTION extensions.pgrst_drop_watch();










------------------------------------------------------------------------------- 14
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
-- TODO: organize these sections into there own files
-- idea their own packages too..





-------------------supabase_functions https://github.com/supabase/cli/blob/8f3bf1cde284bf594f7e59349bc0a1817ad46400/internal/utils/templates/initial_schemas/14.sql#L1512



--
-- Name: supabase_functions; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA IF NOT EXISTS supabase_functions;


ALTER SCHEMA supabase_functions OWNER TO supabase_admin;

--
-- Name: SCHEMA supabase_functions; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA supabase_functions TO postgres;
GRANT USAGE ON SCHEMA supabase_functions TO anon;
GRANT USAGE ON SCHEMA supabase_functions TO authenticated;
GRANT USAGE ON SCHEMA supabase_functions TO service_role;
GRANT ALL ON SCHEMA supabase_functions TO supabase_functions_admin;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: supabase_functions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON SEQUENCES  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON SEQUENCES  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON SEQUENCES  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON SEQUENCES  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: supabase_functions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON FUNCTIONS  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON FUNCTIONS  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON FUNCTIONS  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON FUNCTIONS  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: supabase_functions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON TABLES  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON TABLES  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON TABLES  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON TABLES  TO service_role;



--------------https://github.com/supabase/cli/blob/8f3bf1cde284bf594f7e59349bc0a1817ad46400/internal/db/start/templates/webhook.sql#L24


-- supabase_functions.migrations definition
CREATE TABLE supabase_functions.migrations (
  version text PRIMARY KEY,
  inserted_at timestamptz NOT NULL DEFAULT NOW()
);


-- Initial supabase_functions migration
INSERT INTO supabase_functions.migrations (version) VALUES ('initial');

-- supabase_functions.hooks definition
CREATE TABLE supabase_functions.hooks (
  id bigserial PRIMARY KEY,
  hook_table_id integer NOT NULL,
  hook_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  request_id bigint
);
CREATE INDEX supabase_functions_hooks_request_id_idx ON supabase_functions.hooks USING btree (request_id);
CREATE INDEX supabase_functions_hooks_h_table_id_h_name_idx ON supabase_functions.hooks USING btree (hook_table_id, hook_name);
COMMENT ON TABLE supabase_functions.hooks IS 'Supabase Functions Hooks: Audit trail for triggered hooks.';









------------------------------------------------------------------------------- FOR AUTH FLOW STATE
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------

-------------------auth.flow_state https://github.com/supabase/auth/blob/master/migrations/20230322519590_add_flow_state_table.up.sql


-- see: https://stackoverflow.com/questions/7624919/check-if-a-user-defined-type-already-exists-in-postgresql/48382296#48382296
do $$ begin
    create type auth.code_challenge_method as enum('s256', 'plain');
exception
    when duplicate_object then null;
end $$;
create table if not exists auth.flow_state(
       id uuid primary key,
       user_id uuid null,
       auth_code text not null,
       code_challenge_method code_challenge_method not null,
       code_challenge text not null,
       provider_type text not null,
       provider_access_token text null,
       provider_refresh_token text null,
       created_at timestamptz null,
       updated_at timestamptz null
);
create index if not exists idx_auth_code on auth.flow_state(auth_code);
comment on table auth.flow_state is 'stores metadata for pkce logins';


------------------------------------------------------------------------------- FOR IDENTITIES
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------

-------------------auth.identities https://github.com/supabase/auth/blob/master/migrations/20210909172000_create_identities_table.up.sql

CREATE TABLE IF NOT EXISTS auth.identities (
    id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data JSONB NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamptz NULL,
    created_at timestamptz NULL,
    updated_at timestamptz NULL,
    CONSTRAINT identities_pkey PRIMARY KEY (provider, id),
    CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);










------------------------------------------------------------------------------- FOR AUTH.SESSIONS
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------

-------------------auth.sessions https://github.com/supabase/auth/blob/74f15295255976058eee6746c8d059f7c1d8b954/migrations/20220811173540_add_sessions_table.up.sql
-- Add session_id column to refresh_tokens table
create table if not exists auth.sessions (
    id uuid not null,
    user_id uuid not null,
    created_at timestamptz null,
    updated_at timestamptz null,
    constraint sessions_pkey primary key (id),
    constraint sessions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);
comment on table auth.sessions is 'Auth: Stores session data associated to a user.';

alter table auth.refresh_tokens
add column if not exists session_id uuid null;

do $$
begin
  if not exists(select *
    from information_schema.constraint_column_usage
    where table_schema = 'auth' and table_name='sessions' and constraint_name='refresh_tokens_session_id_fkey')
  then
      alter table "auth"."refresh_tokens" add constraint refresh_tokens_session_id_fkey foreign key (session_id) references auth.sessions(id) on delete cascade;
  end if;
END $$;










------------------------------------------------------------------------------- FOR AUTH.MFA*
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------

-------------------auth.mfa* https://github.com/supabase/auth/blob/74f15295255976058eee6746c8d059f7c1d8b954/migrations/20221003041349_add_mfa_schema.up.sql#L41
create type factor_type as enum('totp', 'webauthn');
create type factor_status as enum('unverified', 'verified');
create type aal_level as enum('aal1', 'aal2', 'aal3');


-- auth.mfa_factors definition
create table if not exists auth.mfa_factors(
       id uuid not null,
       user_id uuid not null,
       friendly_name text null,
       factor_type factor_type not null,
       status factor_status not null,
       created_at timestamptz not null,
       updated_at timestamptz not null,
       secret text null,
       constraint mfa_factors_pkey primary key(id),
       constraint mfa_factors_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);
comment on table auth.mfa_factors is 'auth: stores metadata about factors';

create unique index if not exists mfa_factors_user_friendly_name_unique on auth.mfa_factors (friendly_name, user_id) where trim(friendly_name) <> '';

-- auth.mfa_challenges definition
create table if not exists auth.mfa_challenges(
       id uuid not null,
       factor_id uuid not null,
       created_at timestamptz not null,
       verified_at timestamptz  null,
       ip_address  inet not null,
       constraint mfa_challenges_pkey primary key (id),
       constraint mfa_challenges_auth_factor_id_fkey foreign key (factor_id) references auth.mfa_factors(id) on delete cascade
);
comment on table auth.mfa_challenges is 'auth: stores metadata about challenge requests made';



-- add factor_id and amr claims to session
create table if not exists auth.mfa_amr_claims(
    session_id uuid not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    authentication_method text not null,
    constraint mfa_amr_claims_session_id_authentication_method_pkey unique(session_id, authentication_method),
    constraint mfa_amr_claims_session_id_fkey foreign key(session_id) references auth.sessions(id) on delete cascade
);
comment on table auth.mfa_amr_claims is 'auth: stores authenticator method reference claims for multi factor authentication';













------------------------------------------------------------------------------- FOR AUTH.OAUTH_CLIENTS
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------

-------------------auth.oauth_clients https://github.com/supabase/auth/blob/74f15295255976058eee6746c8d059f7c1d8b954/migrations/20250731150234_add_oauth_clients_table.up.sql

-- Create enums for OAuth client fields
do $$ begin
    create type auth.oauth_registration_type as enum('dynamic', 'manual');
exception
    when duplicate_object then null;
end $$;

-- Create oauth_clients table for OAuth client management
create table if not exists auth.oauth_clients (
    id uuid not null,
    client_id text not null,
    client_secret_hash text not null,
    registration_type auth.oauth_registration_type not null,
    redirect_uris text not null,
    grant_types text not null,
    client_name text null,
    client_uri text null,
    logo_uri text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz null,
    constraint oauth_clients_pkey primary key (id),
    constraint oauth_clients_client_id_key unique (client_id),
    constraint oauth_clients_client_name_length check (char_length(client_name) <= 1024),
    constraint oauth_clients_client_uri_length check (char_length(client_uri) <= 2048),
    constraint oauth_clients_logo_uri_length check (char_length(logo_uri) <= 2048)
);

-- Create indexes
create index if not exists oauth_clients_client_id_idx 
    on auth.oauth_clients (client_id);

create index if not exists oauth_clients_deleted_at_idx 
    on auth.oauth_clients (deleted_at);













------------------------------------------------------------------------------- FOR AUTH.OAUTH_AUTHORIZATIONS
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------

-------------------auth.oauth_authorizations https://github.com/supabase/auth/blob/74f15295255976058eee6746c8d059f7c1d8b954/migrations/20250804100000_add_oauth_authorizations_consents.up.sql


-- Create OAuth 2.1 support with enums, authorization, and consent tables

-- Create enums for OAuth authorization management
do $$ begin
    create type auth.oauth_authorization_status as enum('pending', 'approved', 'denied', 'expired');
exception
    when duplicate_object then null;
end $$;

do $$ begin
    create type auth.oauth_response_type as enum('code');
exception
    when duplicate_object then null;
end $$;

-- Create oauth_authorizations table for OAuth 2.1 authorization requests
create table if not exists auth.oauth_authorizations (
    id uuid not null,
    authorization_id text not null,
    client_id uuid not null references auth.oauth_clients(id) on delete cascade,
    user_id uuid null references auth.users(id) on delete cascade,
    redirect_uri text not null,
    scope text not null,
    state text null,
    resource text null,
    code_challenge text null,
    code_challenge_method auth.code_challenge_method null,
    response_type auth.oauth_response_type not null default 'code',
    
    -- Flow control
    status auth.oauth_authorization_status not null default 'pending',
    authorization_code text null,
    
    -- Timestamps
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '3 minutes'),
    approved_at timestamptz null,
    
    constraint oauth_authorizations_pkey primary key (id),
    constraint oauth_authorizations_authorization_id_key unique (authorization_id),
    constraint oauth_authorizations_authorization_code_key unique (authorization_code),
    constraint oauth_authorizations_redirect_uri_length check (char_length(redirect_uri) <= 2048),
    constraint oauth_authorizations_scope_length check (char_length(scope) <= 4096),
    constraint oauth_authorizations_state_length check (char_length(state) <= 4096),
    constraint oauth_authorizations_resource_length check (char_length(resource) <= 2048),
    constraint oauth_authorizations_code_challenge_length check (char_length(code_challenge) <= 128),
    constraint oauth_authorizations_authorization_code_length check (char_length(authorization_code) <= 255),
    constraint oauth_authorizations_expires_at_future check (expires_at > created_at)
);

-- Create indexes for oauth_authorizations
--  for CleanupExpiredOAuthServerAuthorizations
create index if not exists oauth_auth_pending_exp_idx
    on auth.oauth_authorizations (expires_at)
    where status = 'pending';



-- Create oauth_consents table for user consent management
create table if not exists auth.oauth_consents (
    id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    client_id uuid not null references auth.oauth_clients(id) on delete cascade,
    scopes text not null,
    granted_at timestamptz not null default now(),
    revoked_at timestamptz null,
    
    constraint oauth_consents_pkey primary key (id),
    constraint oauth_consents_user_client_unique unique (user_id, client_id),
    constraint oauth_consents_scopes_length check (char_length(scopes) <= 2048),
    constraint oauth_consents_scopes_not_empty check (char_length(trim(scopes)) > 0),
    constraint oauth_consents_revoked_after_granted check (revoked_at is null or revoked_at >= granted_at)
);

-- Create indexes for oauth_consents
-- Active consent look-up (user + client, only non-revoked rows)
create index if not exists oauth_consents_active_user_client_idx
    on auth.oauth_consents (user_id, client_id)
    where revoked_at is null;

-- "Show me all consents for this user, newest first"
create index if not exists oauth_consents_user_order_idx
    on auth.oauth_consents (user_id, granted_at desc);

-- Bulk revoke for an entire client (only non-revoked rows)
create index if not exists oauth_consents_active_client_idx
    on auth.oauth_consents (client_id)
    where revoked_at is null;











------------------------------------------------------------------------------- FOR AUTH.SAML AND SSO
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------

-------------------auth.saml* https://github.com/supabase/auth/blob/74f15295255976058eee6746c8d059f7c1d8b954/migrations/20240427152123_add_one_time_tokens_table.up.sql
-- Multi-instance mode (see auth.sso_providers) table intentionally not supported and ignored.

create table if not exists auth.sso_providers (
	id uuid not null,
	resource_id text null,
	created_at timestamptz null,
	updated_at timestamptz null,
	primary key (id),
	constraint "resource_id not empty" check (resource_id = null or char_length(resource_id) > 0)
);

comment on table auth.sso_providers is 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';
comment on column auth.sso_providers.resource_id is 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';

create unique index if not exists sso_providers_resource_id_idx on auth.sso_providers (lower(resource_id));

create table if not exists auth.sso_domains (
	id uuid not null,
	sso_provider_id uuid not null,
	domain text not null,
	created_at timestamptz null,
	updated_at timestamptz null,
	primary key (id),
	foreign key (sso_provider_id) references auth.sso_providers (id) on delete cascade,
	constraint "domain not empty" check (char_length(domain) > 0)
);

create index if not exists sso_domains_sso_provider_id_idx on auth.sso_domains (sso_provider_id);
create unique index if not exists sso_domains_domain_idx on auth.sso_domains (lower(domain));

comment on table auth.sso_domains is 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';

create table if not exists auth.saml_providers (
	id uuid not null,
	sso_provider_id uuid not null,
	entity_id text not null unique,
	metadata_xml text not null,
	metadata_url text null,
	attribute_mapping jsonb null,
	created_at timestamptz null,
	updated_at timestamptz null,
	primary key (id),
	foreign key (sso_provider_id) references auth.sso_providers (id) on delete cascade,
	constraint "metadata_xml not empty" check (char_length(metadata_xml) > 0),
	constraint "metadata_url not empty" check (metadata_url = null or char_length(metadata_url) > 0),
	constraint "entity_id not empty" check (char_length(entity_id) > 0)
);

create index if not exists saml_providers_sso_provider_id_idx on auth.saml_providers (sso_provider_id);

comment on table auth.saml_providers is 'Auth: Manages SAML Identity Provider connections.';

create table if not exists auth.saml_relay_states (
	id uuid not null,
	sso_provider_id uuid not null,
	request_id text not null,
	for_email text null,
	redirect_to text null,
	from_ip_address inet null,
	created_at timestamptz null,
	updated_at timestamptz null,
	primary key (id),
	foreign key (sso_provider_id) references auth.sso_providers (id) on delete cascade,
	constraint "request_id not empty" check(char_length(request_id) > 0)
);

create index if not exists saml_relay_states_sso_provider_id_idx on auth.saml_relay_states (sso_provider_id);
create index if not exists saml_relay_states_for_email_idx on auth.saml_relay_states (for_email);

comment on table auth.saml_relay_states is 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';

create table if not exists auth.sso_sessions (
	id uuid not null,
	session_id uuid not null,
	sso_provider_id uuid null,
	not_before timestamptz null,
	not_after timestamptz null,
	idp_initiated boolean default false,
	created_at timestamptz null,
	updated_at timestamptz null,
	primary key (id),
	foreign key (session_id) references auth.sessions (id) on delete cascade,
	foreign key (sso_provider_id) references auth.sso_providers (id) on delete cascade
);

create index if not exists sso_sessions_session_id_idx on auth.sso_sessions (session_id);
create index if not exists sso_sessions_sso_provider_id_idx on auth.sso_sessions (sso_provider_id);

comment on table auth.sso_sessions is 'Auth: A session initiated by an SSO Identity Provider';












------------------------------------------------------------------------------- FOR AUTH.ONE_TIME_TOKENS
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------

-------------------auth.one-time-tokens https://github.com/supabase/auth/blob/74f15295255976058eee6746c8d059f7c1d8b954/migrations/20221021082433_add_saml.up.sql
-- Multi-instance mode (see auth.one-time-tokens) table intentionally not supported and ignored.

do $$ begin
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
end $$;


do $$ begin
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
end $$;


















------------------------------------------------------------------------------- FOR STORAGE
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------

-------------------storage https://github.com/supabase/storage/blob/master/migrations/tenant/0002-storage-schema.sql




DO $$
BEGIN
    IF NOT EXISTS(SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'storage') THEN
        CREATE SCHEMA storage;
    END IF;
END$$;

DO $$
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
END$$;


CREATE TABLE IF NOT EXISTS "storage"."migrations" (
  id integer PRIMARY KEY,
  name varchar(100) UNIQUE NOT NULL,
  hash varchar(40) NOT NULL, -- sha1 hex encoded hash of the file name and contents, to ensure it hasn't been altered since applying the migration
  executed_at timestamp DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS "storage"."buckets" (
    "id" text not NULL,
    "name" text NOT NULL,
    "owner" uuid,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "bname" ON "storage"."buckets" USING BTREE ("name");

CREATE TABLE IF NOT EXISTS "storage"."objects" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "bucket_id" text,
    "name" text,
    "owner" uuid,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    "last_accessed_at" timestamptz DEFAULT now(),
    "metadata" jsonb,
    CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id"),
    PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "bucketid_objname" ON "storage"."objects" USING BTREE ("bucket_id","name");
CREATE INDEX IF NOT EXISTS name_prefix_search ON storage.objects(name text_pattern_ops);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

drop function if exists storage.foldername;
CREATE OR REPLACE FUNCTION storage.foldername(name text)
 RETURNS text[]
 LANGUAGE plpgsql
AS $function$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[1:array_length(_parts,1)-1];
END
$function$;

drop function if exists storage.filename;
CREATE OR REPLACE FUNCTION storage.filename(name text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$function$;

drop function if exists storage.extension;
CREATE OR REPLACE FUNCTION storage.extension(name text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
_parts text[];
_filename text;
BEGIN
	select string_to_array(name, '/') into _parts;
	select _parts[array_length(_parts,1)] into _filename;
	-- @todo return the last part instead of 2
	return reverse(split_part(reverse(_filename), '.', 1));
END
$function$;

-- @todo can this query be optimised further?
drop function if exists storage.search;
CREATE OR REPLACE FUNCTION storage.search(prefix text, bucketname text, limits int DEFAULT 100, levels int DEFAULT 1, offsets int DEFAULT 0)
 RETURNS TABLE (
    name text,
    id uuid,
    updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    last_accessed_at TIMESTAMPTZ,
    metadata jsonb
  )
 LANGUAGE plpgsql
AS $function$
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
$function$;


DO $$
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
END$$;








------------------------------------------------------------------------------- FOR STORAGE
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------

-------------------storage -- https://github.com/supabase/storage/blob/6ba23e408dc700e4e2ca5527eed1cf8c60ced218/migrations/tenant/0026-objects-prefixes.sql#L36

-- Add level column to objects
ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS level INT NULL;

--- Index Functions
CREATE OR REPLACE FUNCTION "storage"."get_level"("name" text)
    RETURNS int
AS $func$
SELECT array_length(string_to_array("name", '/'), 1);
$func$ LANGUAGE SQL IMMUTABLE STRICT;

-- Table
CREATE TABLE IF NOT EXISTS "storage"."prefixes" (
    "bucket_id" text,
    "name" text COLLATE "C" NOT NULL,
    "level" int GENERATED ALWAYS AS ("storage"."get_level"("name")) STORED,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    CONSTRAINT "prefixes_bucketId_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id"),
    PRIMARY KEY ("bucket_id", "level", "name")
);

ALTER TABLE storage.prefixes ENABLE ROW LEVEL SECURITY;

-- Functions
CREATE OR REPLACE FUNCTION "storage"."get_prefix"("name" text)
    RETURNS text
AS $func$
SELECT
    CASE WHEN strpos("name", '/') > 0 THEN
             regexp_replace("name", '[\/]{1}[^\/]+\/?$', '')
         ELSE
             ''
        END;
$func$ LANGUAGE SQL IMMUTABLE STRICT;

CREATE OR REPLACE FUNCTION "storage"."get_prefixes"("name" text)
    RETURNS text[]
AS $func$
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
$func$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE OR REPLACE FUNCTION "storage"."add_prefixes"(
    "_bucket_id" TEXT,
    "_name" TEXT
)
RETURNS void
SECURITY DEFINER
AS $func$
DECLARE
    prefixes text[];
BEGIN
    prefixes := "storage"."get_prefixes"("_name");

    IF array_length(prefixes, 1) > 0 THEN
        INSERT INTO storage.prefixes (name, bucket_id)
        SELECT UNNEST(prefixes) as name, "_bucket_id" ON CONFLICT DO NOTHING;
    END IF;
END;
$func$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE FUNCTION "storage"."delete_prefix" (
    "_bucket_id" TEXT,
    "_name" TEXT
) RETURNS boolean
SECURITY DEFINER
AS $func$
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
$func$ LANGUAGE plpgsql VOLATILE;

-- Triggers
CREATE OR REPLACE FUNCTION "storage"."prefixes_insert_trigger"()
    RETURNS trigger
AS $func$
BEGIN
    PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    RETURN NEW;
END;
$func$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE FUNCTION "storage"."objects_insert_prefix_trigger"()
    RETURNS trigger
AS $func$
BEGIN
    PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    NEW.level := "storage"."get_level"(NEW."name");

    RETURN NEW;
END;
$func$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE FUNCTION "storage"."delete_prefix_hierarchy_trigger"()
    RETURNS trigger
AS $func$
DECLARE
    prefix text;
BEGIN
    prefix := "storage"."get_prefix"(OLD."name");

    IF coalesce(prefix, '') != '' THEN
        PERFORM "storage"."delete_prefix"(OLD."bucket_id", prefix);
    END IF;

    RETURN OLD;
END;
$func$ LANGUAGE plpgsql VOLATILE;

-- "storage"."prefixes"
CREATE OR REPLACE TRIGGER "prefixes_delete_hierarchy"
    AFTER DELETE ON "storage"."prefixes"
    FOR EACH ROW
EXECUTE FUNCTION "storage"."delete_prefix_hierarchy_trigger"();

-- "storage"."objects"
CREATE OR REPLACE TRIGGER "objects_insert_create_prefix"
    BEFORE INSERT ON "storage"."objects"
    FOR EACH ROW
EXECUTE FUNCTION "storage"."objects_insert_prefix_trigger"();

CREATE OR REPLACE TRIGGER "objects_update_create_prefix"
    BEFORE UPDATE ON "storage"."objects"
    FOR EACH ROW
    WHEN (NEW.name != OLD.name)
EXECUTE FUNCTION "storage"."objects_insert_prefix_trigger"();

CREATE OR REPLACE TRIGGER "objects_delete_delete_prefix"
    AFTER DELETE ON "storage"."objects"
    FOR EACH ROW
EXECUTE FUNCTION "storage"."delete_prefix_hierarchy_trigger"();

-- Permissions
DO $$
    DECLARE
        anon_role text = COALESCE(current_setting('storage.anon_role', true), 'anon');
        authenticated_role text = COALESCE(current_setting('storage.authenticated_role', true), 'authenticated');
        service_role text = COALESCE(current_setting('storage.service_role', true), 'service_role');
    BEGIN
        EXECUTE 'GRANT ALL ON TABLE storage.prefixes TO ' || service_role || ',' || authenticated_role || ', ' || anon_role;
END$$;




















------------------------------------------------------------------------------- FOR STORAGE
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------

-------------------storage -- https://github.com/supabase/storage/blob/master/migrations/tenant/0029-create-prefixes.sql


-- -- postgres-migrations disable-transaction
-- -- Backfill prefixes table records
-- -- We run this with 50k batch size to avoid long running transaction
-- DO $$
--     DECLARE
--         batch_size INTEGER := 10000;
--         total_scanned INTEGER := 0;
--         row_returned INTEGER := 0;
--         last_name TEXT COLLATE "C" := NULL;
--         last_bucket_id TEXT COLLATE "C" := NULL;
--         delay INTEGER := 1;
--         start_time TIMESTAMPTZ;
--         end_time TIMESTAMPTZ;
--         exec_duration INTERVAL;
--     BEGIN
--         LOOP
--             start_time := clock_timestamp();  -- Start time of batch

--             -- Fetch a batch of objects ordered by name COLLATE "C"
--             WITH batch as (
--                 SELECT id, bucket_id, name, owner
--                 FROM storage.objects
--                 WHERE (last_name IS NULL OR ((name COLLATE "C", bucket_id) > (last_name, last_bucket_id)))
--                 ORDER BY name COLLATE "C", bucket_id
--                 LIMIT batch_size
--             ),
--             batch_count as (
--                 SELECT COUNT(*) as count FROM batch
--             ),
--             cursor as (
--                  SELECT name as last_name, bucket_id as last_bucket FROM batch b
--                  ORDER BY name COLLATE "C" DESC, bucket_id DESC LIMIT 1
--             ),
--             all_prefixes as (
--                 SELECT UNNEST(storage.get_prefixes(name)) as prefix, bucket_id
--                 FROM batch
--             ),
--             insert_prefixes as (
--                 INSERT INTO storage.prefixes (bucket_id, name)
--                 SELECT bucket_id, prefix FROM all_prefixes
--                 WHERE coalesce(prefix, '') != ''
--                 ON CONFLICT DO NOTHING
--             )
--             SELECT count, cursor.last_name, cursor.last_bucket FROM cursor, batch_count INTO row_returned, last_name, last_bucket_id;

--             end_time := clock_timestamp();  -- End time after batch processing
--             exec_duration := end_time - start_time;  -- Calculate elapsed time

--             RAISE NOTICE 'Object Row returned: %', row_returned;
--             RAISE NOTICE 'Last Object: %', last_name;
--             RAISE NOTICE 'Execution time for this batch: %', exec_duration;
--             RAISE NOTICE 'Delay: %', delay;
--             RAISE NOTICE 'Batch size: %', batch_size;
--             RAISE NOTICE '-------------------------------------------------';

--             total_scanned := total_scanned + row_returned;

--             IF row_returned IS NULL OR row_returned < batch_size THEN
--                 RAISE NOTICE 'Total Object scanned: %', coalesce(total_scanned, 0);
--                 COMMIT;
--                 EXIT;
--             ELSE
--                 COMMIT;
--                 PERFORM pg_sleep(delay);
--                 -- Increase delay by 1 second for each iteration until 30
--                 -- then reset it back to 1
--                 SELECT CASE WHEN delay >= 10 THEN 1 ELSE delay + 1 END INTO delay;

--                 -- Update the batch size:
--                 -- If execution time > 3 seconds, reset batch_size to 20k.
--                 -- If the batch size is already 20k, decrease it by 1k until 5k.
--                 -- Otherwise, increase batch_size by 5000 up to a maximum of 50k.
--                 IF exec_duration > interval '3 seconds' THEN
--                     IF batch_size <= 20000 THEN
--                         batch_size := GREATEST(batch_size - 1000, 5000);
--                     ELSE
--                         batch_size := 20000;
--                     END IF;
--                 ELSE
--                     batch_size := LEAST(batch_size + 5000, 50000);
--                 END IF;
--             END IF;
--     END LOOP;
-- END;
-- $$;












------------------------------------------------------------------------------- FOR STORAGE
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------

-------------------storage -- https://github.com/supabase/storage/blob/6ba23e408dc700e4e2ca5527eed1cf8c60ced218/migrations/tenant/0038-iceberg-catalog-flag-on-buckets.sql#L18

DO $$
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
END$$;














------------------------------------------------------------------------------- FOR STORAGE
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------

-------------------storage -- https://github.com/supabase/vault/blob/main/sql/supabase_vault--0.2.8.sql

-- CREATE TABLE vault.secrets (
--   id uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
--   name        text,
--   description text NOT NULL default '',
--   secret      text NOT NULL,
--   key_id      uuid REFERENCES pgsodium.key(id) DEFAULT (pgsodium.create_key()).id,
--   nonce       bytea DEFAULT pgsodium.crypto_aead_det_noncegen(),
--   created_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
--   updated_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
-- );
-- ALTER TABLE vault.secrets OWNER TO session_user;

-- COMMENT ON TABLE vault.secrets IS 'Table with encrypted `secret` column for storing sensitive information on disk.';

-- CREATE UNIQUE INDEX ON vault.secrets USING btree (name) WHERE name IS NOT NULL;

-- SECURITY LABEL FOR pgsodium ON COLUMN vault.secrets.secret IS
-- 'ENCRYPT WITH KEY COLUMN key_id ASSOCIATED (id, description, created_at, updated_at) NONCE nonce';

-- SELECT pgsodium.update_mask('vault.secrets'::regclass::oid);

-- ALTER EXTENSION supabase_vault DROP VIEW vault.decrypted_secrets;
-- ALTER EXTENSION supabase_vault DROP FUNCTION vault.secrets_encrypt_secret_secret;

-- GRANT ALL ON SCHEMA vault TO pgsodium_keyiduser;
-- GRANT ALL ON TABLE vault.secrets TO pgsodium_keyiduser;
-- GRANT ALL PRIVILEGES ON vault.decrypted_secrets TO pgsodium_keyiduser;

-- CREATE OR REPLACE FUNCTION vault.create_secret(
--     new_secret text,
--     new_name text = NULL,
--     new_description text = '',
--     new_key_id uuid = NULL) RETURNS uuid AS
--     $$
--     INSERT INTO vault.secrets (secret, name, description, key_id)
--     VALUES (
--         new_secret,
--         new_name,
--         new_description,
--         CASE WHEN new_key_id IS NULL THEN (pgsodium.create_key()).id ELSE new_key_id END)
--     RETURNING id;
--     $$ LANGUAGE SQL;

-- CREATE OR REPLACE FUNCTION vault.update_secret(
--     secret_id uuid,
--     new_secret text = NULL,
--     new_name text = NULL,
--     new_description text = NULL,
--     new_key_id uuid = NULL) RETURNS void AS
--     $$
-- 	UPDATE vault.decrypted_secrets s
--     SET
--         secret = CASE WHEN new_secret IS NULL THEN s.decrypted_secret ELSE new_secret END,
--         name = CASE WHEN new_name IS NULL THEN s.name ELSE new_name END,
--         description = CASE WHEN new_description IS NULL THEN s.description ELSE new_description END,
--         key_id = CASE WHEN new_key_id IS NULL THEN s.key_id ELSE new_key_id END,
--         updated_at = CURRENT_TIMESTAMP
--     WHERE s.id = secret_id
--     $$ LANGUAGE SQL;

-- SELECT pg_catalog.pg_extension_config_dump('vault.secrets', '');