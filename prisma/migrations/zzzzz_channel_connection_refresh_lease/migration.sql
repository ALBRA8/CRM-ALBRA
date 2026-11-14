-- Durable, fail-closed lease metadata for TikTok OAuth token rotation.
-- Expired "refreshing" leases must NOT be reclaimed automatically: the provider
-- may already have rotated the refresh token before a worker crashed.
ALTER TABLE "ChannelConnection" ADD COLUMN "refreshState" TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE "ChannelConnection" ADD COLUMN "refreshLeaseToken" TEXT;
ALTER TABLE "ChannelConnection" ADD COLUMN "refreshLeaseExpiresAt" DATETIME;
ALTER TABLE "ChannelConnection" ADD COLUMN "refreshFencingVersion" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "ChannelConnection_refreshState_refreshLeaseExpiresAt_idx"
  ON "ChannelConnection"("refreshState", "refreshLeaseExpiresAt");
