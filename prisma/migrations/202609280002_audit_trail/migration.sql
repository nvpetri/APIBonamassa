CREATE TABLE "AuditTrail" (
  "id" BIGSERIAL PRIMARY KEY, "storeId" UUID NOT NULL,
  "tableName" VARCHAR(60) NOT NULL, "recordId" VARCHAR(100) NOT NULL,
  "operation" VARCHAR(10) NOT NULL, "actorId" UUID, "actorName" VARCHAR(80),
  "actorRole" VARCHAR(20), "sharedAccount" BOOLEAN NOT NULL DEFAULT false,
  "origin" VARCHAR(20) NOT NULL, "clientSource" VARCHAR(40), "requestId" UUID,
  "sessionId" UUID, "action" VARCHAR(160), "method" VARCHAR(10), "path" VARCHAR(300),
  "ip" VARCHAR(100), "userAgent" VARCHAR(300), "keyHash" VARCHAR(64),
  "databaseUser" VARCHAR(100) NOT NULL, "transactionId" VARCHAR(30) NOT NULL,
  "changedFields" TEXT[] NOT NULL, "before" JSONB, "after" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuditTrail_storeId_id_idx" ON "AuditTrail" ("storeId", "id");
CREATE INDEX "AuditTrail_storeId_createdAt_idx" ON "AuditTrail" ("storeId", "createdAt");
CREATE INDEX "AuditTrail_storeId_tableName_recordId_id_idx" ON "AuditTrail" ("storeId", "tableName", "recordId", "id");
CREATE INDEX "AuditTrail_storeId_actorId_id_idx" ON "AuditTrail" ("storeId", "actorId", "id");
CREATE INDEX "AuditTrail_storeId_requestId_idx" ON "AuditTrail" ("storeId", "requestId");

-- Redact recursively before persistence, including nested event/product JSON.
CREATE FUNCTION bonamassa_audit_safe(value JSONB) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE result JSONB; item RECORD;
BEGIN
  IF value IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(value) = 'object' THEN
    result := '{}'::jsonb;
    FOR item IN SELECT * FROM jsonb_each(value) LOOP
      IF lower(item.key) ~ '(password|token|secret|authorization|cookie|codehash|sessionkey|credential)'
        OR lower(item.key) IN ('bytes', 'email', 'phone', 'customer', 'address', 'recipient', 'note', 'reference', 'reason') THEN
        result := result || jsonb_build_object(item.key, '[REDACTED]');
      ELSE result := result || jsonb_build_object(item.key, public.bonamassa_audit_safe(item.value)); END IF;
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(value) = 'array' THEN
    SELECT COALESCE(jsonb_agg(public.bonamassa_audit_safe(v)), '[]'::jsonb) INTO result FROM jsonb_array_elements(value) v;
    RETURN result;
  END IF;
  RETURN value;
END $$;

CREATE FUNCTION bonamassa_audit_diff(a JSONB, b JSONB, prefix TEXT DEFAULT '') RETURNS TEXT[]
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE result TEXT[] := '{}'; k TEXT; label TEXT;
BEGIN
  IF jsonb_typeof(a) = 'object' AND jsonb_typeof(b) = 'object' THEN
    FOR k IN SELECT jsonb_object_keys(a) UNION SELECT jsonb_object_keys(b) LOOP
      IF (a->k) IS DISTINCT FROM (b->k) THEN
        label := CASE WHEN prefix = '' THEN k ELSE prefix || '.' || k END;
        IF jsonb_typeof(a->k) = 'object' AND jsonb_typeof(b->k) = 'object' THEN
          result := result || public.bonamassa_audit_diff(a->k, b->k, label);
        ELSE result := array_append(result, label); END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN ARRAY(SELECT DISTINCT v FROM unnest(result) v ORDER BY v);
END $$;

CREATE FUNCTION bonamassa_capture_change() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE old_row JSONB; new_row JSONB; row_data JSONB; context JSONB;
  store_id UUID; fields TEXT[]; actor_id UUID; actor_name TEXT; actor_role TEXT;
BEGIN
  old_row := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END;
  new_row := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END;
  row_data := COALESCE(new_row, old_row);
  IF TG_OP = 'UPDATE' AND old_row = new_row THEN RETURN NEW; END IF;
  -- Sliding expiry is a read-side heartbeat, not a business change.
  IF TG_TABLE_NAME = 'Session' AND TG_OP = 'UPDATE'
    AND (old_row - ARRAY['expiresAt','lastActivityAt']) = (new_row - ARRAY['expiresAt','lastActivityAt']) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'Store' THEN store_id := (row_data->>'id')::uuid;
  ELSIF row_data ? 'storeId' THEN store_id := (row_data->>'storeId')::uuid;
  ELSIF TG_TABLE_NAME = 'OrderEvent' THEN
    SELECT "storeId" INTO store_id FROM public."Order" WHERE id = (row_data->>'orderId')::uuid;
  ELSE SELECT "storeId" INTO store_id FROM public."User" WHERE id = (row_data->>'userId')::uuid;
  END IF;
  IF store_id IS NULL AND row_data ? 'userId' THEN
    SELECT "storeId" INTO store_id FROM public."AuditTrail"
      WHERE "tableName" = 'User' AND "recordId" = row_data->>'userId'
      ORDER BY id DESC LIMIT 1;
  END IF;
  IF store_id IS NULL THEN RAISE EXCEPTION 'Audit requires a store for %', TG_TABLE_NAME; END IF;
  context := COALESCE(NULLIF(current_setting('bonamassa.audit', true), '')::jsonb, '{}'::jsonb);
  IF context->'actor'->>'storeId' = store_id::text THEN
    actor_id := (context->'actor'->>'id')::uuid;
    actor_name := context->'actor'->>'name'; actor_role := context->'actor'->>'role';
  END IF;
  fields := public.bonamassa_audit_diff(COALESCE(old_row,'{}'::jsonb), COALESCE(new_row,'{}'::jsonb));
  INSERT INTO public."AuditTrail" (
    "storeId", "tableName", "recordId", operation, "actorId", "actorName", "actorRole", "sharedAccount",
    origin, "clientSource", "requestId", "sessionId", action, method, path, ip, "userAgent", "keyHash",
    "databaseUser", "transactionId", "changedFields", "before", "after", "createdAt"
  ) VALUES (
    store_id, TG_TABLE_NAME, row_data->>'id', TG_OP, actor_id, left(actor_name,80), left(actor_role,20), COALESCE(actor_role IN ('ATTENDANT','KITCHEN'),false),
    COALESCE(context->>'origin','SQL'), left(context->>'clientSource',40), (context->>'requestId')::uuid,
    (context->'actor'->>'sessionId')::uuid, left(context->>'action',160), left(context->>'method',10),
    left(context->>'path',300), left(context->>'ip',100), left(context->>'userAgent',300), left(context->>'keyHash',64),
    session_user, txid_current()::text, fields, public.bonamassa_audit_safe(old_row), public.bonamassa_audit_safe(new_row),
    clock_timestamp() AT TIME ZONE 'UTC'
  );
  RETURN COALESCE(NEW, OLD);
END $$;

DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['Store','User','Product','ProductImage','Promotion','Order','OrderEvent','Session','VerificationCode','StaffInvitation','Audit'] LOOP
    EXECUTE format('CREATE TRIGGER capture_audit BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION bonamassa_capture_change()', table_name);
  END LOOP;
END $$;

CREATE FUNCTION bonamassa_audit_immutable() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'AuditTrail is append-only'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "AuditTrail"
FOR EACH STATEMENT EXECUTE FUNCTION bonamassa_audit_immutable();
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "AuditTrail" FROM PUBLIC;

-- TRUNCATE bypasses row triggers; reject it for audited business tables.
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['Store','User','Product','ProductImage','Promotion','Order','OrderEvent','Session','VerificationCode','StaffInvitation','Audit'] LOOP
    EXECUTE format('CREATE TRIGGER prevent_untracked_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION bonamassa_audit_immutable()', table_name);
  END LOOP;
END $$;
