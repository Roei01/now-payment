-- Every portfolio run is bound to the market-data source it started on. A run is
-- never silently continued on a different source and never reset automatically:
-- starting a new run is an explicit, audited owner decision that archives the old one.

ALTER TABLE portfolios ADD COLUMN data_source text;
ALTER TABLE portfolios ADD COLUMN archived_at timestamptz;
ALTER TABLE portfolios ADD COLUMN replaced_by uuid REFERENCES portfolios(id);
ALTER TABLE portfolios ADD COLUMN run_number int NOT NULL DEFAULT 1;

-- Existing funded portfolios: infer the source from their first performance row.
UPDATE portfolios p SET data_source = CASE
    WHEN EXISTS (SELECT 1 FROM performance_daily pd WHERE pd.portfolio_id = p.id AND pd.simulated_data) THEN 'simulated'
    WHEN EXISTS (SELECT 1 FROM performance_daily pd WHERE pd.portfolio_id = p.id) THEN 'alpaca'
    ELSE NULL END;

ALTER TABLE portfolios DROP CONSTRAINT portfolios_check;
ALTER TABLE portfolios DROP CONSTRAINT portfolios_check1;
ALTER TABLE portfolios ADD CONSTRAINT portfolios_paper_status CHECK (kind <> 'PAPER' OR status IN ('ACTIVE', 'PAUSED', 'ARCHIVED'));
ALTER TABLE portfolios ADD CONSTRAINT portfolios_benchmark_status CHECK (kind <> 'BENCHMARK' OR status IN ('ACTIVE', 'PAUSED', 'ARCHIVED'));
