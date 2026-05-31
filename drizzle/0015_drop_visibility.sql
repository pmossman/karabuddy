-- safe-migration: contract — shipped before the expand/contract guard existed (B85).
-- Co-deployed with the code that stopped reading replays.visibility; future
-- column drops must ship as a separate contract deploy (see docs/adr/0005).
ALTER TABLE "replays" DROP COLUMN "visibility";