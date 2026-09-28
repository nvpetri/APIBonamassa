// Disposable mailbox for CI only. Never started by production commands or exposed by the API.
import http from "node:http";
if (process.env.APP_ENV !== "test")
  throw new Error("Mailbox requires APP_ENV=test");
const messages = [];
http
  .createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    const url = new URL(req.url, "http://127.0.0.1:3030");
    if (req.method === "POST" && url.pathname === "/emails") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 100_000) {
          res.writeHead(413).end("{}");
          return;
        }
      }
      const mail = JSON.parse(body);
      messages.push(mail);
      if (messages.length > 1000) messages.shift();
      res.end(JSON.stringify({ id: String(messages.length) }));
    } else if (req.method === "GET" && url.pathname === "/messages") {
      res.end(
        JSON.stringify(
          messages.filter((mail) =>
            mail.to.includes(url.searchParams.get("to")),
          ),
        ),
      );
    } else {
      res.writeHead(404).end("{}");
    }
  })
  .listen(3030, "127.0.0.1");
