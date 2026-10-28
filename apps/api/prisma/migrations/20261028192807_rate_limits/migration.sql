-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "window_expires_at" TIMESTAMPTZ NOT NULL,
    "blocked_until" TIMESTAMPTZ,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limits_window_expires_at_idx" ON "rate_limits"("window_expires_at");
