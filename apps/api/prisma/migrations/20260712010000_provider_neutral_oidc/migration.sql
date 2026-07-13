-- Preserve Auth0 identities while allowing the same user to link issuer-scoped Keycloak subjects.
ALTER TABLE "User" ALTER COLUMN "auth0Sub" DROP NOT NULL;

CREATE TABLE "UserIdentity" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "issuer" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserIdentity_issuer_subject_key" ON "UserIdentity"("issuer", "subject");
CREATE INDEX "UserIdentity_userId_idx" ON "UserIdentity"("userId");
ALTER TABLE "UserIdentity" ADD CONSTRAINT "UserIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
