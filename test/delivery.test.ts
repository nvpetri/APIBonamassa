import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  DeliveryMaps,
  distanceFee,
  geocodePoint,
  deliveryHash,
  snapshotFee,
} from "../src/delivery";
import { deliveryBandsSchema, storeSchema } from "../src/domain";

const address = {
  street: "Rua São João",
  number: "10",
  neighborhood: "Centro",
  city: "São Paulo",
  state: "SP",
  postalCode: "01001000",
  reference: "",
};
const bands = [2000, 4000, 6000, 8000, 10000].map((upToMeters, i) => ({
  upToMeters,
  fee: i * 200,
}));
const feature = {
  geometry: { type: "Point", coordinates: [-46.63, -23.55] },
  properties: {
    confidence: 1,
    layer: "address",
    country_a: "BRA",
    housenumber: "10",
    street: "Rua São João",
    locality: "São Paulo",
    region_a: "SP",
    postalcode: "01001000",
  },
};

test("cinco faixas crescentes incluem seu limite exato e não cobram fora da área", () => {
  assert.equal(distanceFee(0, bands).fee, 0);
  assert.equal(distanceFee(2000, bands).fee, 0);
  assert.equal(distanceFee(2001, bands).fee, 200);
  assert.equal(distanceFee(10000, bands).fee, 800);
  assert.throws(() => distanceFee(10001, bands), {
    code: "OUTSIDE_DELIVERY_AREA",
  });
  for (const invalid of [
    bands.slice(1),
    [...bands, bands[4]],
    bands.map((b, i) => (i === 2 ? { ...b, upToMeters: 4000 } : b)),
    bands.map((b) => ({ ...b, fee: -1 })),
  ])
    assert.equal(deliveryBandsSchema.safeParse(invalid).success, false);
  assert.equal(
    storeSchema.safeParse({
      expectedVersion: 1,
      name: "Bonamassa",
      deliveryFee: 700,
      driverFee: 800,
      location: { latitude: 1, longitude: 2 },
    }).success,
    false,
  );
});

test("geocoder rejects centroid, wrong building/city and conflicting candidates", () => {
  assert.deepEqual(geocodePoint({ features: [feature] }, address), {
    latitude: -23.55,
    longitude: -46.63,
  });
  for (const change of [
    { confidence: 0.5 },
    { layer: "street" },
    { housenumber: "100" },
    { street: "Rua São Jorge" },
    { locality: "Outra cidade" },
    { country_a: "USA" },
    { postalcode: "99999999" },
  ])
    assert.throws(
      () =>
        geocodePoint(
          {
            features: [
              { ...feature, properties: { ...feature.properties, ...change } },
            ],
          },
          address,
        ),
      { code: "ADDRESS_NOT_LOCATED" },
    );
  assert.throws(
    () =>
      geocodePoint(
        {
          features: [
            feature,
            {
              ...feature,
              geometry: { type: "Point", coordinates: [-46.6, -23.5] },
            },
          ],
        },
        address,
      ),
    { code: "ADDRESS_NOT_LOCATED" },
  );
});

test("provider uses longitude/latitude, bounds failures and shares cached requests", async () => {
  let calls = 0,
    status = 200;
  const server = createServer(async (req, res) => {
    calls++;
    assert.equal(req.headers.authorization, "test-only-maps-key");
    const url = new URL(req.url!, "http://localhost");
    res.writeHead(status, { "Content-Type": "application/json" });
    if (req.method === "GET") {
      assert.equal(url.pathname, "/geocode/search");
      assert.equal(url.searchParams.get("boundary.country"), "BRA");
      assert.equal(url.searchParams.get("api_key"), "test-only-maps-key");
      res.end(JSON.stringify({ features: [feature] }));
    } else {
      let body = "";
      for await (const part of req) body += part;
      const data = JSON.parse(body);
      assert.equal(url.pathname, "/v2/directions/driving-car/json");
      assert.deepEqual(data.coordinates[0], [-46.63, -23.55]);
      assert.equal(data.preference, "shortest");
      res.end(
        JSON.stringify({
          routes: [{ summary: { distance: 2000.1, duration: 300.1 } }],
        }),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const old = { ...process.env };
  try {
    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost/test",
      MAPS_API_KEY: "test-only-maps-key",
      MAPS_API_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
    });
    const maps = new DeliveryMaps();
    const points = await Promise.all([
      maps.geocode(address),
      maps.geocode(address),
    ]);
    assert.equal(calls, 1);
    await maps.geocode({
      ...address,
      complement: "Apto 2",
      reference: "Outra referência",
    });
    assert.equal(calls, 1);
    const store = {
      address,
      location: points[0],
      deliveryPricingMode: "DISTANCE",
      deliveryBands: bands,
      deliveryFee: 700,
    };
    const snapshot = await maps.resolve(store, address);
    assert.equal(calls, 2);
    assert.equal(snapshot.distanceMeters, 2001);
    assert.equal(snapshot.durationSeconds, 301);
    assert.equal(snapshotFee(store, snapshot), 200);
    assert.throws(
      () =>
        snapshotFee(
          { ...store, deliveryBands: bands.map((b) => ({ ...b, fee: 500 })) },
          snapshot,
        ),
      { code: "DELIVERY_CHANGED" },
    );
    assert.notEqual(
      deliveryHash(store),
      deliveryHash({ ...store, address: { ...address, number: "11" } }),
    );
    await maps.resolve(store, address);
    assert.equal(calls, 2);
    status = 429;
    await assert.rejects(
      () => maps.route(points[0], { latitude: -23.56, longitude: -46.64 }),
      { code: "MAPS_UNAVAILABLE" },
    );
    status = 404;
    await assert.rejects(
      () => maps.route(points[0], { latitude: -23.57, longitude: -46.65 }),
      { code: "ROUTE_NOT_FOUND" },
    );
    delete process.env.MAPS_API_KEY;
    const unconfigured = new DeliveryMaps();
    const flat = await unconfigured.resolve(
      { ...store, deliveryPricingMode: "FLAT" },
      address,
    );
    assert.equal(flat.distanceMeters, null);
    await assert.rejects(() => unconfigured.resolve(store, address), {
      code: "MAPS_NOT_CONFIGURED",
    });
  } finally {
    process.env = old;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
