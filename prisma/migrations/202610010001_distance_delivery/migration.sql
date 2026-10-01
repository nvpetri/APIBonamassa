-- Existing stores keep flat delivery until their manager enables distance pricing.
ALTER TABLE "Store" ADD COLUMN "address" JSONB,
  ADD COLUMN "location" JSONB,
  ADD COLUMN "deliveryPricingMode" VARCHAR(8) NOT NULL DEFAULT 'FLAT',
  ADD COLUMN "deliveryBands" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Order" ADD COLUMN "deliverySnapshot" JSONB;
ALTER TABLE "Store" ADD CONSTRAINT "Store_deliveryPricingMode_check"
  CHECK ("deliveryPricingMode" IN ('FLAT', 'DISTANCE'));
ALTER TABLE "Store" ADD CONSTRAINT "Store_distance_settings_check"
  CHECK ("deliveryPricingMode" <> 'DISTANCE' OR
    ("address" IS NOT NULL AND "location" IS NOT NULL AND
     jsonb_typeof("address") = 'object' AND jsonb_typeof("location") = 'object' AND
     jsonb_typeof("deliveryBands") = 'array' AND jsonb_array_length("deliveryBands") = 5));
-- Keep new coordinates out of before/after audit copies; retain changed field names.
CREATE OR REPLACE FUNCTION bonamassa_audit_safe(value JSONB) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE result JSONB; item RECORD;
BEGIN
  IF value IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(value) = 'object' THEN
    result := '{}'::jsonb;
    FOR item IN SELECT * FROM jsonb_each(value) LOOP
      IF lower(item.key) ~ '(password|token|secret|authorization|cookie|codehash|sessionkey|credential)'
        OR lower(item.key) IN ('bytes', 'email', 'phone', 'customer', 'address', 'recipient', 'note', 'reference', 'reason', 'location', 'destination', 'latitude', 'longitude') THEN
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

