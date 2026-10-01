import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { config } from "./config";
import { digest } from "./db";
import {
  addressSchema,
  deliveryBandsSchema,
  ensure,
  RuleError,
} from "./domain";

export const pointSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
type Address = z.infer<typeof addressSchema>;
export type Point = z.infer<typeof pointSchema>;
export type DeliveryBand = z.infer<typeof deliveryBandsSchema>[number];
export type DeliveryStore = {
  address: unknown;
  location: unknown;
  deliveryPricingMode: string;
  deliveryBands: unknown;
  deliveryFee: number;
};
export const deliverySnapshotSchema = z.object({
  pricingMode: z.enum(["FLAT", "DISTANCE"]),
  distanceMeters: z.number().int().nonnegative().nullable(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  origin: z
    .object({ address: addressSchema, location: pointSchema.nullable() })
    .nullable(),
  destination: pointSchema.nullable(),
  band: z
    .object({
      upToMeters: z.number().int().positive(),
      fee: z.number().int().nonnegative(),
    })
    .nullable(),
  provider: z.literal("OPENROUTESERVICE").nullable(),
  configHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type DeliverySnapshot = z.infer<typeof deliverySnapshotSchema>;

export function deliveryHash(store: DeliveryStore) {
  return digest({
    mode: store.deliveryPricingMode,
    address: store.address,
    location: store.location,
    ...(store.deliveryPricingMode === "DISTANCE"
      ? { bands: store.deliveryBands }
      : { fee: store.deliveryFee }),
  });
}
export function distanceFee(distanceMeters: number, bands: DeliveryBand[]) {
  ensure(
    Number.isInteger(distanceMeters) && distanceMeters >= 0,
    "INVALID_DISTANCE",
    "Distância inválida.",
  );
  const band = deliveryBandsSchema
    .parse(bands)
    .find((b) => distanceMeters <= b.upToMeters);
  ensure(
    band,
    "OUTSIDE_DELIVERY_AREA",
    "Este endereço está além da última faixa de entrega. Escolha retirada ou fale com a pizzaria.",
    422,
  );
  return band;
}
export function deliveryDto(value: unknown) {
  const parsed = deliverySnapshotSchema.safeParse(value);
  if (!parsed.success) return null;
  const { configHash: _hash, ...delivery } = parsed.data;
  return delivery;
}
export function deliverySettings(store: DeliveryStore) {
  return {
    address: store.address,
    location: store.location,
    deliveryPricingMode: store.deliveryPricingMode,
    deliveryBands: store.deliveryBands,
  };
}
export function snapshotFee(
  store: DeliveryStore,
  snapshot: DeliverySnapshot | null,
) {
  ensure(
    snapshot && snapshot.configHash === deliveryHash(store),
    "DELIVERY_CHANGED",
    "O endereço da pizzaria ou as taxas mudaram. Faça uma nova cotação.",
    409,
  );
  if (store.deliveryPricingMode === "FLAT") return store.deliveryFee;
  ensure(
    snapshot.distanceMeters !== null &&
      snapshot.destination &&
      snapshot.origin?.location,
    "DELIVERY_NOT_CONFIGURED",
    "Configure o endereço da pizzaria e as cinco faixas de entrega.",
    409,
  );
  return distanceFee(
    snapshot.distanceMeters,
    deliveryBandsSchema.parse(store.deliveryBands),
  ).fee;
}

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const streetName = (text: string) =>
  normalize(text.replace(/^(rua|r\.?|avenida|av\.?|travessa|tv\.?)\s+/i, ""));
const regions: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};
const geocodeResponse = z.object({
  features: z.array(
    z.object({
      geometry: z.object({
        type: z.literal("Point"),
        coordinates: z.tuple([z.number(), z.number()]),
      }),
      properties: z.object({
        confidence: z.number(),
        layer: z.string(),
        country_a: z.string(),
        housenumber: z.string().optional(),
        street: z.string().optional(),
        locality: z.string().optional(),
        localadmin: z.string().optional(),
        region: z.string().optional(),
        region_a: z.string().optional(),
        postalcode: z.string().optional(),
      }),
    }),
  ),
});
export function geocodePoint(value: unknown, address: Address): Point {
  const result = geocodeResponse.safeParse(value);
  ensure(
    result.success,
    "MAPS_UNAVAILABLE",
    "O serviço de mapas respondeu de forma inválida. Tente novamente.",
    503,
  );
  const candidates = result.data.features
    .filter(
      ({ properties: p }) =>
        p.layer === "address" &&
        p.confidence >= 0.8 &&
        p.country_a === "BRA" &&
        normalize(p.housenumber ?? "") === normalize(address.number) &&
        streetName(p.street ?? "") === streetName(address.street) &&
        [p.locality, p.localadmin].some(
          (city) => city && normalize(city) === normalize(address.city),
        ) &&
        [p.region_a, p.region].some(
          (region) =>
            region &&
            [address.state, regions[address.state]].some(
              (expected) =>
                expected && normalize(region) === normalize(expected),
            ),
        ) &&
        (!p.postalcode ||
          p.postalcode.replace(/\D/g, "") === address.postalCode),
    )
    .map(
      ({
        geometry: {
          coordinates: [longitude, latitude],
        },
      }) => {
        const point = pointSchema.safeParse({ latitude, longitude });
        ensure(
          point.success,
          "MAPS_UNAVAILABLE",
          "O serviço de mapas retornou coordenadas inválidas.",
          503,
        );
        return point.data;
      },
    );
  // Do not price from a city/street/CEP centroid or pick one of conflicting buildings.
  ensure(
    candidates.length &&
      candidates.every(
        (p) =>
          Math.abs(p.latitude - candidates[0].latitude) < 0.0005 &&
          Math.abs(p.longitude - candidates[0].longitude) < 0.0005,
      ),
    "ADDRESS_NOT_LOCATED",
    "Não foi possível localizar este endereço com precisão. Confira rua, número, cidade, UF e CEP.",
    422,
  );
  return candidates[0];
}

@Injectable()
export class DeliveryMaps {
  private readonly env = config();
  private readonly cache = new Map<string, { until: number; value: unknown }>();
  private readonly pending = new Map<string, Promise<unknown>>();
  get configured() {
    return Boolean(this.env.MAPS_API_KEY);
  }
  private async cached<T>(
    key: string,
    ttl: number,
    run: () => Promise<T>,
  ): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value as T;
    if (this.pending.has(key)) return this.pending.get(key) as Promise<T>;
    ensure(
      this.pending.size < 25,
      "MAPS_BUSY",
      "O cálculo de entrega está ocupado. Tente novamente em alguns instantes.",
      503,
    );
    const pending = run()
      .then((value) => {
        this.cache.delete(key);
        while (this.cache.size >= 1000)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { until: Date.now() + ttl, value });
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, pending);
    return pending;
  }
  private async request(
    path: string,
    params?: Record<string, string>,
    body?: unknown,
  ) {
    ensure(
      this.configured,
      "MAPS_NOT_CONFIGURED",
      "O serviço de mapas ainda não foi configurado pela pizzaria.",
      503,
    );
    const url = new URL(path, this.env.MAPS_API_URL);
    if (params) {
      Object.entries(params).forEach(([key, value]) =>
        url.searchParams.set(key, value),
      );
      url.searchParams.set("api_key", this.env.MAPS_API_KEY!);
    }
    try {
      const response = await fetch(url, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: this.env.MAPS_API_KEY!,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (body && [400, 404].includes(response.status))
        throw new RuleError(
          "ROUTE_NOT_FOUND",
          "Não foi encontrado um trajeto de entrega para este endereço. Confira o destino ou escolha retirada.",
          422,
        );
      ensure(
        response.ok,
        "MAPS_UNAVAILABLE",
        "O serviço de mapas está indisponível ou atingiu seu limite. Tente novamente ou escolha retirada.",
        503,
      );
      return await response.json();
    } catch (error) {
      if (error instanceof RuleError) throw error;
      throw new RuleError(
        "MAPS_UNAVAILABLE",
        "Não foi possível consultar o serviço de mapas. Tente novamente ou escolha retirada.",
        503,
      );
    }
  }
  geocode(address: Address): Promise<Point> {
    const identity = {
      street: address.street,
      number: address.number,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
    };
    return this.cached(`geo:${digest(identity)}`, 24 * 3600_000, async () =>
      geocodePoint(
        await this.request("geocode/search", {
          text: `${address.street}, ${address.number}, ${address.neighborhood}, ${address.city}, ${address.state}, ${address.postalCode}, Brasil`,
          "boundary.country": "BRA",
          layers: "address",
          size: "5",
        }),
        address,
      ),
    );
  }
  route(
    origin: Point,
    destination: Point,
  ): Promise<{ distanceMeters: number; durationSeconds: number }> {
    return this.cached(
      `route:${digest({ origin, destination })}`,
      3600_000,
      async () => {
        const response = await this.request(
          "v2/directions/driving-car/json",
          undefined,
          {
            coordinates: [
              [origin.longitude, origin.latitude],
              [destination.longitude, destination.latitude],
            ],
            preference: "shortest",
            units: "m",
            instructions: false,
            geometry: false,
          },
        );
        const result = z
          .object({
            routes: z
              .array(
                z.object({
                  summary: z.object({
                    distance: z.number().finite().nonnegative(),
                    duration: z.number().finite().nonnegative(),
                  }),
                }),
              )
              .min(1),
          })
          .safeParse(response);
        ensure(
          result.success,
          "MAPS_UNAVAILABLE",
          "O serviço de mapas não retornou a distância do trajeto. Tente novamente.",
          503,
        );
        return {
          distanceMeters: Math.ceil(result.data.routes[0].summary.distance),
          durationSeconds: Math.ceil(result.data.routes[0].summary.duration),
        };
      },
    );
  }
  async resolve(
    store: DeliveryStore,
    address: Address,
  ): Promise<DeliverySnapshot> {
    const origin = store.address
      ? {
          address: addressSchema.parse(store.address),
          location: store.location ? pointSchema.parse(store.location) : null,
        }
      : null;
    const base = {
      pricingMode: store.deliveryPricingMode as "FLAT" | "DISTANCE",
      origin,
      configHash: deliveryHash(store),
    };
    if (store.deliveryPricingMode === "FLAT")
      return {
        ...base,
        distanceMeters: null,
        durationSeconds: null,
        destination: null,
        band: null,
        provider: null,
      };
    ensure(
      store.deliveryPricingMode === "DISTANCE" && origin?.location,
      "DELIVERY_NOT_CONFIGURED",
      "Configure o endereço da pizzaria e as cinco faixas de entrega.",
      409,
    );
    const bands = deliveryBandsSchema.parse(store.deliveryBands);
    const destination = await this.geocode(address);
    const route = await this.route(origin.location, destination);
    return {
      ...base,
      ...route,
      destination,
      band: distanceFee(route.distanceMeters, bands),
      provider: "OPENROUTESERVICE",
    };
  }
}
