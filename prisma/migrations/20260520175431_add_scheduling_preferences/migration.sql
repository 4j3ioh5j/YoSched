-- CreateTable
CREATE TABLE "scheduling_preferences" (
    "id" TEXT NOT NULL,
    "prefer3DayWeekends" BOOLEAN NOT NULL DEFAULT true,
    "prefer4DayWeekends" BOOLEAN NOT NULL DEFAULT true,
    "preferSequentialOff" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "scheduling_preferences_pkey" PRIMARY KEY ("id")
);
