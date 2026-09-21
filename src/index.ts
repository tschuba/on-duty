import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

const app = new Hono();

app.use("/css/*", serveStatic({ root: "./public" }));
app.use("/fonts/*", serveStatic({ root: "./public" }));

app.get("/", (c) =>
  c.html(`<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>on-duty</title>
  <link rel="stylesheet" href="/css/app.css">
</head>
<body class="bg-base-100 min-h-screen flex items-center justify-center">
  <div class="text-center">
    <h1 class="text-4xl font-bold text-primary" style="font-family: var(--font-heading)">on-duty</h1>
    <p class="mt-2 opacity-70">Mitglieder-Datenbank Freiwillige Feuerwehr Altenhammer</p>
  </div>
</body>
</html>`)
);

serve({ fetch: app.fetch, port: 3000 }, () => console.log("http://localhost:3000"));
