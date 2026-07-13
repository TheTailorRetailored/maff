import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const source = await readFile(new URL("../src/auth/oidcProvider.tsx", import.meta.url), "utf8")
const match = source.match(/export const SPA_OIDC_SCOPE = "([^"]+)"/)

assert.ok(match, "SPA_OIDC_SCOPE must remain an explicit reviewed scope string")
assert.equal(match[1], "openid profile email maff:read maff:write maff:review")
assert.equal(match[1].split(/\s+/).includes("offline_access"), false, "browser sessions must not request Keycloak offline tokens")

console.log("SPA OIDC scope regression check passed")
