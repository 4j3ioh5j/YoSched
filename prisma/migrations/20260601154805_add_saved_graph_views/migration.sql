-- CreateTable
CREATE TABLE "saved_graph_views" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "ownerId" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_graph_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_graph_views_ownerId_idx" ON "saved_graph_views"("ownerId");

-- CreateIndex
CREATE INDEX "saved_graph_views_isShared_idx" ON "saved_graph_views"("isShared");

-- AddForeignKey
ALTER TABLE "saved_graph_views" ADD CONSTRAINT "saved_graph_views_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
