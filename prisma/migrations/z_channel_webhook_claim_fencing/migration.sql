-- Prevent stale webhook handlers from completing a newer lease.
ALTER TABLE "ChannelWebhookEvent" ADD COLUMN "claimToken" TEXT;
