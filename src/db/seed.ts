import { db } from "./index.js";
import { anniversaryYears, memberRoles } from "./schema/index";

const roles = [
  { id: "erster-vorstand", title: "1. Vorstand", grantsActiveStatus: false },
  { id: "zweiter-vorstand", title: "2. Vorstand", grantsActiveStatus: false },
  { id: "schriftfuehrer", title: "Schriftführer", grantsActiveStatus: false },
  { id: "kassier", title: "Kassier", grantsActiveStatus: false },
  { id: "beisitzer", title: "Beisitzer", grantsActiveStatus: false },
  { id: "erster-kommandant", title: "1. Kommandant", grantsActiveStatus: true },
  { id: "zweiter-kommandant", title: "2. Kommandant", grantsActiveStatus: true },
  { id: "gruppenfuehrer", title: "Gruppenführer", grantsActiveStatus: true },
  { id: "maschinist", title: "Maschinist", grantsActiveStatus: true },
  { id: "jugendfeuerwehrwart", title: "Jugendfeuerwehrwart", grantsActiveStatus: false },
  { id: "stellv-jugendfeuerwehrwart", title: "Stellv. Jugendfeuerwehrwart", grantsActiveStatus: false },
  { id: "aktives-mitglied", title: "Aktives Mitglied", grantsActiveStatus: true },
  { id: "passives-mitglied", title: "Passives Mitglied", grantsActiveStatus: false },
  { id: "ehrenkommandant", title: "Ehrenkommandant", grantsActiveStatus: false },
  { id: "ehrenvorstand", title: "Ehrenvorstand", grantsActiveStatus: false },
  { id: "ehrenmitglied", title: "Ehrenmitglied", grantsActiveStatus: false },
];

const years = [25, 40, 50, 60, 65, 70, 75, 80, 85, 90, 95, 100].map((year) => ({ year }));

await db.insert(memberRoles).values(roles).onConflictDoNothing();
await db.insert(anniversaryYears).values(years).onConflictDoNothing();

console.log(`Seeded ${roles.length} Rollen, ${years.length} Jubiläumsjahre.`);
process.exit(0);
