ALTER TABLE "HostRoom" ALTER COLUMN "maxParticipants" SET DEFAULT 6;
UPDATE "HostRoom" SET "maxParticipants" = 6 WHERE "maxParticipants" = 2;
