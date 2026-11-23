-- Card #477: the font the PDF (month print and year export) embeds. Additive; the default keeps
-- every existing install printing in Archivo Narrow, as before.
ALTER TABLE "scheduling_preferences" ADD COLUMN "printPdfFont" TEXT NOT NULL DEFAULT 'archivo-narrow';
