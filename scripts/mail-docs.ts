import { writeFileSync } from "node:fs";
import { catalogDocs } from "../src/lib/mail-templates.js";

writeFileSync("docs/mail-variables.md", catalogDocs());
