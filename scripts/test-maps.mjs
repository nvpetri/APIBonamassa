// Deterministic ORS-shaped fixture, restricted to isolated CI and loopback.
import http from "node:http";
if (process.env.APP_ENV !== "test")
  throw new Error("Maps fixture requires APP_ENV=test");
http
  .createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    const url = new URL(req.url, "http://127.0.0.1:3031");
    if (req.method === "GET" && url.pathname === "/geocode/search") {
      const parts = (url.searchParams.get("text") ?? "")
        .split(",")
        .map((part) => part.trim());
      if (parts.length !== 7 || !/^\d+$/.test(parts[1])) {
        res.writeHead(200).end('{"features":[]}');
        return;
      }
      const [street, housenumber, , locality, region_a, postalcode] = parts;
      res.end(
        JSON.stringify({
          features: [
            {
              geometry: {
                type: "Point",
                coordinates: [-46.63 + Number(housenumber) / 100000, -23.55],
              },
              properties: {
                layer: "address",
                confidence: 1,
                country_a: "BRA",
                street,
                housenumber,
                locality,
                region_a,
                postalcode,
              },
            },
          ],
        }),
      );
    } else if (
      req.method === "POST" &&
      url.pathname === "/v2/directions/driving-car/json"
    ) {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 10000) {
          res.writeHead(413).end("{}");
          return;
        }
      }
      try {
        const { coordinates } = JSON.parse(body);
        const distance = Math.round(
          Math.abs(coordinates[1][0] - coordinates[0][0]) * 10000000,
        );
        res.end(
          JSON.stringify({
            routes: [{ summary: { distance, duration: distance / 10 } }],
          }),
        );
      } catch {
        res.writeHead(400).end("{}");
      }
    } else {
      res.writeHead(404).end("{}");
    }
  })
  .listen(3031, "127.0.0.1");
