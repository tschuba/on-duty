import { describe, expect, it } from "vitest";

// Gemeinsamer Vertrag für Detailseiten (siehe docs/style-guide.md „Detail-Seiten“):
// nur Lesen → /:id ohne „Bearbeiten“; mit Schreibrecht → Button auf /:id, /:id/edit
// erreichbar; ohne Schreibrecht → /:id/edit redirectet auf /:id.
// Neue Seite im Umfang = ein Eintrag in DETAIL_PAGES (siehe detail-pages.test.ts) +
// ein Fixture-Setup, das readPermissions/writePermissions scharf schaltet und einen
// abrufbaren Datensatz garantiert.
export function testDetailPageContract(page: {
  name: string;
  request: (path: string) => Promise<Response> | Response;
  idPath: string; // z. B. "/m1" — relativer Pfad zur Router-Instanz
  editPath: string; // z. B. "/m1/edit"
  editHref: string; // z. B. "/members/m1/edit" — absoluter Link, wie er im HTML steht
  redirectLocation: string; // z. B. "/members/m1" — Location-Header von /:id/edit ohne Schreibrecht
  setPermissions: (perms: string[]) => void;
  readPermissions: string[];
  writePermissions: string[];
  ensureRecord: () => void;
}) {
  describe(`${page.name}: Detailseiten-Vertrag`, () => {
    it("nur Lesen: /:id ohne Bearbeiten-Button", async () => {
      page.ensureRecord();
      page.setPermissions(page.readPermissions);
      const html = await (await page.request(page.idPath)).text();
      expect(html).not.toContain(`href="${page.editHref}"`);
    });

    it("mit Schreibrecht: /:id zeigt den Bearbeiten-Button auf /:id/edit", async () => {
      page.ensureRecord();
      page.setPermissions(page.writePermissions);
      const html = await (await page.request(page.idPath)).text();
      expect(html).toContain(`href="${page.editHref}"`);
    });

    it("ohne Schreibrecht: /:id/edit redirectet auf /:id", async () => {
      page.ensureRecord();
      page.setPermissions(page.readPermissions);
      const res = await page.request(page.editPath);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(page.redirectLocation);
    });
  });
}
