/**
 * Minimal placeholder so `node tests/frontend` succeeds when no real tests exist.
 * Remove this file once you add real frontend tests.
 */
import { fileURLToPath } from "node:url";

const invokedPath = process.argv.length > 1 ? process.argv[1] : undefined;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath && invokedPath === modulePath) {
  console.log("No frontend tests; skipping.");
}
