CREATE TYPE "VerificationPurpose" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP WHERE "emailVerifiedAt" IS NULL;

CREATE TABLE "VerificationCode" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "purpose" "VerificationPurpose" NOT NULL,
  "codeHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VerificationCode_userId_purpose_createdAt_idx" ON "VerificationCode"("userId", "purpose", "createdAt");
CREATE INDEX "VerificationCode_expiresAt_idx" ON "VerificationCode"("expiresAt");
ALTER TABLE "VerificationCode" ADD CONSTRAINT "VerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
