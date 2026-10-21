-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "DeviceIdentity" (
    "id" UUID NOT NULL,
    "nickname" VARCHAR(24) NOT NULL,
    "secretHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostRoom" (
    "id" UUID NOT NULL,
    "ownerDeviceId" UUID NOT NULL,
    "maxParticipants" INTEGER NOT NULL DEFAULT 2,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteToken" (
    "hostRoomId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InviteToken_pkey" PRIMARY KEY ("hostRoomId")
);

-- CreateIndex
CREATE UNIQUE INDEX "HostRoom_ownerDeviceId_key" ON "HostRoom"("ownerDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "InviteToken_tokenHash_key" ON "InviteToken"("tokenHash");

-- AddForeignKey
ALTER TABLE "HostRoom" ADD CONSTRAINT "HostRoom_ownerDeviceId_fkey" FOREIGN KEY ("ownerDeviceId") REFERENCES "DeviceIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteToken" ADD CONSTRAINT "InviteToken_hostRoomId_fkey" FOREIGN KEY ("hostRoomId") REFERENCES "HostRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
