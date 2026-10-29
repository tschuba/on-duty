import { userPseudonym } from "../src/lib/user-pseudonym.js";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: pnpm ops:pseudonym <userId>");
  process.exit(1);
}
console.log(userPseudonym(userId));
