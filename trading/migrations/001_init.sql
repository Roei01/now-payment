-- Core schema for paper portfolios and the dormant live portfolio.
-- Money is NUMERIC; append-only tables are protected by triggers.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (% not allowed)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- users & auth
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL UNIQUE,
  password_hash    text NOT NULL,
  role             text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'viewer')),
  totp_secret_enc  text,
  totp_enabled     boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash       text PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  ip               text,
  user_agent       text
);

CREATE TABLE login_attempts (
  id        bigserial PRIMARY KEY,
  email     text NOT NULL,
  ip        text,
  success   boolean NOT NULL,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_recent ON login_attempts (email, at DESC);

-- ------------------------------------------------------------- system control
CREATE TABLE system_state (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

CREATE TABLE heartbeats (
  component    text PRIMARY KEY,
  last_beat_at timestamptz NOT NULL,
  details      jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE job_runs (
  id           bigserial PRIMARY KEY,
  job          text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'OK', 'FAILED', 'SKIPPED')),
  details      jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX job_runs_job ON job_runs (job, started_at DESC);

CREATE TABLE audit_events (
  id       bigserial PRIMARY KEY,
  actor    text NOT NULL,
  action   text NOT NULL,
  target   text,
  details  jsonb NOT NULL DEFAULT '{}',
  ip       text,
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE incidents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity     text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  kind         text NOT NULL,
  message      text NOT NULL,
  details      jsonb NOT NULL DEFAULT '{}',
  portfolio_id uuid,
  dedupe_key   text,
  opened_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  text
);
CREATE UNIQUE INDEX incidents_open_dedupe ON incidents (dedupe_key) WHERE resolved_at IS NULL AND dedupe_key IS NOT NULL;

CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key      text NOT NULL UNIQUE,
  kind            text NOT NULL,
  severity        text NOT NULL DEFAULT 'INFO',
  subject         text NOT NULL,
  body            text NOT NULL,
  recipient       text,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED')),
  attempts        int NOT NULL DEFAULT 0,
  last_error      text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX notifications_due ON notifications (status, next_attempt_at);

CREATE TABLE cost_ledger (
  id          bigserial PRIMARY KEY,
  category    text NOT NULL CHECK (category IN ('AI', 'DATA', 'INFRA', 'EMAIL', 'OTHER')),
  provider    text NOT NULL,
  model       text,
  amount_usd  numeric(14, 6) NOT NULL,
  amount_ils  numeric(14, 6) NOT NULL,
  fx_rate     numeric(12, 6) NOT NULL,
  units       jsonb NOT NULL DEFAULT '{}',
  reference   text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cost_ledger_month ON cost_ledger (occurred_at);
CREATE TRIGGER cost_ledger_append_only BEFORE UPDATE OR DELETE ON cost_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ------------------------------------------------------------------- assets
CREATE TABLE assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol           text NOT NULL,
  exchange         text NOT NULL,
  market           text NOT NULL DEFAULT 'US' CHECK (market IN ('US', 'TASE')),
  asset_class      text NOT NULL CHECK (asset_class IN ('STOCK', 'ETF')),
  name             text NOT NULL,
  currency         text NOT NULL DEFAULT 'USD',
  price_unit       text NOT NULL DEFAULT 'USD' CHECK (price_unit IN ('USD', 'ILS', 'ILA')),
  sector           text NOT NULL DEFAULT 'UNKNOWN',
  is_leveraged     boolean NOT NULL DEFAULT false,
  is_inverse       boolean NOT NULL DEFAULT false,
  crypto_exposure  boolean NOT NULL DEFAULT false,
  fractionable     boolean NOT NULL DEFAULT false,
  verified         boolean NOT NULL DEFAULT false,
  verified_source  text,
  verified_at      timestamptz,
  active           boolean NOT NULL DEFAULT true,
  cik              text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, exchange)
);

CREATE TABLE fx_rates (
  id          bigserial PRIMARY KEY,
  base        text NOT NULL,
  quote       text NOT NULL,
  rate        numeric(14, 8) NOT NULL,
  source      text NOT NULL,
  as_of       timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fx_rates_lookup ON fx_rates (base, quote, as_of DESC);

-- -------------------------------------------------------------- market data
CREATE TABLE market_data_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL,
  feed        text,
  as_of       timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  simulated   boolean NOT NULL DEFAULT false,
  status      text NOT NULL CHECK (status IN ('OK', 'PARTIAL', 'STALE', 'FAILED')),
  stats       jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX market_data_batches_recent ON market_data_batches (ingested_at DESC);

CREATE TABLE market_bars (
  asset_id     uuid NOT NULL REFERENCES assets(id),
  timeframe    text NOT NULL,
  ts           timestamptz NOT NULL,
  open         numeric(18, 6) NOT NULL,
  high         numeric(18, 6) NOT NULL,
  low          numeric(18, 6) NOT NULL,
  close        numeric(18, 6) NOT NULL,
  volume       numeric(20, 2) NOT NULL DEFAULT 0,
  provider     text NOT NULL,
  adjusted     boolean NOT NULL DEFAULT false,
  ingested_at  timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL,
  PRIMARY KEY (asset_id, timeframe, ts, provider)
);

CREATE TABLE market_quotes (
  id           bigserial PRIMARY KEY,
  batch_id     uuid NOT NULL REFERENCES market_data_batches(id),
  asset_id     uuid NOT NULL REFERENCES assets(id),
  bid          numeric(18, 6),
  ask          numeric(18, 6),
  last         numeric(18, 6) NOT NULL,
  published_at timestamptz NOT NULL,
  ingested_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX market_quotes_asset ON market_quotes (asset_id, published_at DESC);

CREATE TABLE research_artifacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,
  asset_id      uuid REFERENCES assets(id),
  source        text NOT NULL,
  source_url    text,
  title         text NOT NULL,
  published_at  timestamptz,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  available_at  timestamptz NOT NULL DEFAULT now(),
  content_hash  text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  UNIQUE (kind, content_hash)
);

-- ------------------------------------------------------ strategies & versions
CREATE TABLE strategies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE strategy_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id       uuid NOT NULL REFERENCES strategies(id),
  version           int NOT NULL,
  parent_version_id uuid REFERENCES strategy_versions(id),
  params            jsonb NOT NULL,
  universe          text[] NOT NULL,
  horizon_days      int NOT NULL,
  rules             jsonb NOT NULL,
  requires_ai       boolean NOT NULL DEFAULT false,
  change_reason     text NOT NULL,
  supporting_data   jsonb NOT NULL DEFAULT '{}',
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (strategy_id, version)
);
CREATE TRIGGER strategy_versions_immutable BEFORE UPDATE OR DELETE ON strategy_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE model_prompt_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role        text NOT NULL,
  model       text NOT NULL,
  prompt_hash text NOT NULL,
  prompt_text text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role, model, prompt_hash)
);
CREATE TRIGGER model_prompt_versions_immutable BEFORE UPDATE OR DELETE ON model_prompt_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- -------------------------------------------------------------- portfolios
CREATE TABLE portfolios (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE,
  name                  text NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('PAPER', 'LIVE', 'BENCHMARK')),
  market                text NOT NULL DEFAULT 'US',
  base_currency         text NOT NULL DEFAULT 'USD',
  execution_venue       text NOT NULL CHECK (execution_venue IN ('INTERNAL_SIM', 'ALPACA_PAPER', 'ALPACA_LIVE', 'NONE')),
  status                text NOT NULL,
  run_id                uuid NOT NULL DEFAULT gen_random_uuid(),
  initial_capital_ils   numeric(18, 4),
  initial_fx_rate       numeric(14, 8),
  fx_rate_source        text,
  fx_rate_as_of         timestamptz,
  fx_conversion_cost_bps numeric(8, 2) NOT NULL DEFAULT 0,
  initial_capital_usd   numeric(18, 6),
  risk_budget_pct       numeric(6, 4) NOT NULL DEFAULT 0.30,
  auto_promote          boolean NOT NULL DEFAULT false,
  status_before_pause   text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  started_at            timestamptz,
  CHECK (kind <> 'PAPER' OR status IN ('ACTIVE', 'PAUSED')),
  CHECK (kind <> 'BENCHMARK' OR status IN ('ACTIVE', 'PAUSED')),
  CHECK (kind <> 'LIVE' OR status IN ('DORMANT', 'ELIGIBLE', 'ARMED', 'PILOT', 'ACTIVE', 'PAUSED'))
);

CREATE TABLE live_state_transitions (
  id           bigserial PRIMARY KEY,
  portfolio_id uuid NOT NULL REFERENCES portfolios(id),
  from_status  text NOT NULL,
  to_status    text NOT NULL,
  reason       text NOT NULL,
  actor        text NOT NULL,
  mfa_verified boolean NOT NULL DEFAULT false,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER live_state_transitions_append_only BEFORE UPDATE OR DELETE ON live_state_transitions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE strategy_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id        uuid NOT NULL REFERENCES portfolios(id),
  strategy_version_id uuid NOT NULL REFERENCES strategy_versions(id),
  assigned_at         timestamptz NOT NULL DEFAULT now(),
  unassigned_at       timestamptz,
  reason              text NOT NULL,
  assigned_by         text NOT NULL
);
CREATE UNIQUE INDEX strategy_assignments_one_active ON strategy_assignments (portfolio_id) WHERE unassigned_at IS NULL;

CREATE TABLE broker_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id     uuid REFERENCES portfolios(id),
  provider         text NOT NULL,
  environment      text NOT NULL CHECK (environment IN ('paper', 'live')),
  key_env_var      text NOT NULL,
  secret_env_var   text NOT NULL,
  account_ref      text,
  status           text NOT NULL DEFAULT 'UNVERIFIED' CHECK (status IN ('UNVERIFIED', 'OK', 'ERROR', 'DISABLED')),
  last_sync_at     timestamptz,
  last_error       text,
  details          jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE live_policy_versions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id           uuid NOT NULL REFERENCES portfolios(id),
  version                int NOT NULL,
  market                 text NOT NULL DEFAULT 'US',
  max_capital_usd        numeric(18, 2) NOT NULL,
  pilot_fraction         numeric(6, 4) NOT NULL,
  allowed_symbols        text[] NOT NULL,
  max_position_pct       numeric(6, 4) NOT NULL,
  max_order_usd          numeric(18, 2) NOT NULL,
  risk_budget_pct        numeric(6, 4) NOT NULL,
  strategy_switch_policy text NOT NULL CHECK (strategy_switch_policy IN ('MANUAL', 'AUTO_WITHIN_GATE')),
  auto_promote           boolean NOT NULL DEFAULT false,
  notes                  text,
  signed_by              text NOT NULL,
  mfa_verified           boolean NOT NULL,
  signed_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, version)
);
CREATE TRIGGER live_policy_versions_immutable BEFORE UPDATE OR DELETE ON live_policy_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- -------------------------------------------------------- decision pipeline
CREATE TABLE decision_cycles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'OK', 'SKIPPED', 'FAILED')),
  batch_id      uuid REFERENCES market_data_batches(id),
  market_open   boolean,
  notes         jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE signals (
  id                  bigserial PRIMARY KEY,
  cycle_id            uuid NOT NULL REFERENCES decision_cycles(id),
  portfolio_id        uuid NOT NULL REFERENCES portfolios(id),
  strategy_version_id uuid NOT NULL REFERENCES strategy_versions(id),
  asset_id            uuid REFERENCES assets(id),
  kind                text NOT NULL,
  value               numeric(20, 8),
  payload             jsonb NOT NULL DEFAULT '{}',
  data_as_of          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE decisions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id            uuid REFERENCES decision_cycles(id),
  portfolio_id        uuid NOT NULL REFERENCES portfolios(id),
  strategy_version_id uuid REFERENCES strategy_versions(id),
  action              text NOT NULL CHECK (action IN ('BUY', 'SELL', 'HOLD', 'REBALANCE')),
  status              text NOT NULL CHECK (status IN ('PROPOSED', 'APPROVED', 'REJECTED', 'DEFERRED', 'EXECUTED', 'PARTIAL', 'NO_ACTION', 'EXPIRED')),
  data_as_of          timestamptz,
  rationale           text NOT NULL,
  evidence            jsonb NOT NULL DEFAULT '{}',
  ai_output           jsonb,
  model_version       text,
  prompt_version_id   uuid REFERENCES model_prompt_versions(id),
  policy_version      text NOT NULL,
  valid_until         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decisions_portfolio ON decisions (portfolio_id, created_at DESC);

CREATE TABLE risk_checks (
  id              bigserial PRIMARY KEY,
  decision_id     uuid NOT NULL REFERENCES decisions(id),
  proposal        jsonb NOT NULL,
  result          text NOT NULL CHECK (result IN ('ALLOW', 'REJECT', 'RESIZE')),
  reasons         jsonb NOT NULL DEFAULT '[]',
  metrics         jsonb NOT NULL DEFAULT '{}',
  policy_version  text NOT NULL,
  checked_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id     uuid NOT NULL REFERENCES portfolios(id),
  decision_id      uuid REFERENCES decisions(id),
  asset_id         uuid NOT NULL REFERENCES assets(id),
  side             text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  qty              numeric(20, 8) NOT NULL CHECK (qty > 0),
  order_type       text NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT')),
  limit_price      numeric(18, 6),
  time_in_force    text NOT NULL DEFAULT 'DAY' CHECK (time_in_force IN ('DAY')),
  client_order_id  text NOT NULL UNIQUE,
  broker_order_id  text,
  venue            text NOT NULL,
  status           text NOT NULL CHECK (status IN ('PENDING_SUBMIT', 'SUBMITTED', 'ACCEPTED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'UNKNOWN')),
  filled_qty       numeric(20, 8) NOT NULL DEFAULT 0,
  avg_fill_price   numeric(18, 6),
  reserved_cash    numeric(18, 6) NOT NULL DEFAULT 0,
  est_price        numeric(18, 6) NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  submitted_at     timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_open ON orders (portfolio_id, status);

CREATE TABLE order_events (
  id          bigserial PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES orders(id),
  event_type  text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER order_events_append_only BEFORE UPDATE OR DELETE ON order_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE fills (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES orders(id),
  broker_fill_id text NOT NULL,
  qty            numeric(20, 8) NOT NULL CHECK (qty > 0),
  price          numeric(18, 6) NOT NULL CHECK (price > 0),
  fee            numeric(18, 6) NOT NULL DEFAULT 0,
  occurred_at    timestamptz NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, broker_fill_id)
);
CREATE TRIGGER fills_append_only BEFORE UPDATE OR DELETE ON fills
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE ledger_entries (
  id           bigserial PRIMARY KEY,
  portfolio_id uuid NOT NULL REFERENCES portfolios(id),
  entry_type   text NOT NULL CHECK (entry_type IN ('INITIAL_DEPOSIT', 'BUY', 'SELL', 'FEE', 'DIVIDEND', 'FX_COST', 'RECONCILE_ADJUSTMENT', 'SPLIT')),
  asset_id     uuid REFERENCES assets(id),
  qty_delta    numeric(20, 8) NOT NULL DEFAULT 0,
  cash_delta   numeric(18, 6) NOT NULL DEFAULT 0,
  price        numeric(18, 6),
  currency     text NOT NULL DEFAULT 'USD',
  order_id     uuid REFERENCES orders(id),
  fill_id      uuid UNIQUE REFERENCES fills(id),
  reference    text,
  memo         text,
  occurred_at  timestamptz NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_portfolio ON ledger_entries (portfolio_id, occurred_at);
CREATE UNIQUE INDEX ledger_entries_reference ON ledger_entries (portfolio_id, reference) WHERE reference IS NOT NULL;
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Internal paper venue: its own book so the adapter contract (submit / lookup / reconcile)
-- is exercised the same way as for an external broker.
CREATE TABLE sim_broker_orders (
  client_order_id text PRIMARY KEY,
  broker_order_id text NOT NULL UNIQUE,
  account         text NOT NULL,
  symbol          text NOT NULL,
  side            text NOT NULL,
  qty             numeric(20, 8) NOT NULL,
  order_type      text NOT NULL,
  limit_price     numeric(18, 6),
  status          text NOT NULL,
  filled_qty      numeric(20, 8) NOT NULL DEFAULT 0,
  fills           jsonb NOT NULL DEFAULT '[]',
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  session_date    date NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE positions_snapshots (
  id           bigserial PRIMARY KEY,
  portfolio_id uuid NOT NULL REFERENCES portfolios(id),
  as_of        timestamptz NOT NULL,
  cash_usd     numeric(18, 6) NOT NULL,
  value_usd    numeric(18, 6) NOT NULL,
  positions    jsonb NOT NULL
);
CREATE INDEX positions_snapshots_recent ON positions_snapshots (portfolio_id, as_of DESC);

CREATE TABLE performance_daily (
  portfolio_id        uuid NOT NULL REFERENCES portfolios(id),
  date                date NOT NULL,
  strategy_version_id uuid REFERENCES strategy_versions(id),
  value_usd           numeric(18, 6) NOT NULL,
  cash_usd            numeric(18, 6) NOT NULL,
  fx_rate             numeric(14, 8) NOT NULL,
  value_ils           numeric(18, 6) NOT NULL,
  invested_pct        numeric(8, 4) NOT NULL,
  net_return_pct      numeric(12, 6) NOT NULL,
  return_ils_pct      numeric(12, 6) NOT NULL,
  loss_from_initial_pct numeric(12, 6) NOT NULL,
  peak_value_usd      numeric(18, 6) NOT NULL,
  drawdown_pct        numeric(12, 6) NOT NULL,
  fees_cum_usd        numeric(18, 6) NOT NULL,
  realized_pnl_usd    numeric(18, 6) NOT NULL,
  unrealized_pnl_usd  numeric(18, 6) NOT NULL,
  trades_cum          int NOT NULL,
  simulated_data      boolean NOT NULL DEFAULT false,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (portfolio_id, date)
);

-- --------------------------------------------------------- learning & gates
CREATE TABLE forecast_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id         uuid NOT NULL REFERENCES decisions(id),
  portfolio_id        uuid NOT NULL REFERENCES portfolios(id),
  asset_id            uuid REFERENCES assets(id),
  strategy_version_id uuid REFERENCES strategy_versions(id),
  model_version       text,
  prompt_version_id   uuid REFERENCES model_prompt_versions(id),
  horizon_days        int NOT NULL,
  price_at_forecast   numeric(18, 6),
  benchmark_at_forecast numeric(18, 6),
  value_low           numeric(18, 6),
  value_base          numeric(18, 6),
  value_high          numeric(18, 6),
  scenarios           jsonb NOT NULL DEFAULT '{}',
  failure_conditions  jsonb NOT NULL DEFAULT '[]',
  sources             jsonb NOT NULL DEFAULT '[]',
  data_as_of          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  due_at              timestamptz NOT NULL
);
CREATE TRIGGER forecast_snapshots_immutable BEFORE UPDATE OR DELETE ON forecast_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE forecast_outcomes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id         uuid NOT NULL UNIQUE REFERENCES forecast_snapshots(id),
  evaluated_at        timestamptz NOT NULL DEFAULT now(),
  price_at_horizon    numeric(18, 6),
  return_pct          numeric(12, 6),
  benchmark_return_pct numeric(12, 6),
  excess_return_pct   numeric(12, 6),
  within_range        boolean,
  classification      text NOT NULL CHECK (classification IN ('THESIS_SUPPORTED', 'THESIS_CONTRADICTED', 'MARKET_DRIVEN', 'DATA_ERROR', 'EXECUTION_FAILURE', 'NO_PRICE')),
  notes               text
);

CREATE TABLE research_lessons (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text                        text NOT NULL,
  tags                        text[] NOT NULL DEFAULT '{}',
  supporting_decision_ids     uuid[] NOT NULL DEFAULT '{}',
  contradicting_decision_ids  uuid[] NOT NULL DEFAULT '{}',
  sample_size                 int NOT NULL DEFAULT 0,
  validity_conditions         text,
  status                      text NOT NULL DEFAULT 'CANDIDATE' CHECK (status IN ('CANDIDATE', 'APPROVED', 'RETIRED')),
  created_by                  text NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE strategy_experiments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_version_id uuid NOT NULL REFERENCES strategy_versions(id),
  hypothesis          text NOT NULL,
  data_range          jsonb NOT NULL DEFAULT '{}',
  cost_assumptions    jsonb NOT NULL DEFAULT '{}',
  success_criteria    jsonb NOT NULL,
  status              text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'TESTING', 'PASSED', 'FAILED', 'ABANDONED')),
  results             jsonb NOT NULL DEFAULT '{}',
  leakage_notes       text,
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE backtest_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_version_id uuid NOT NULL REFERENCES strategy_versions(id),
  experiment_id       uuid REFERENCES strategy_experiments(id),
  split               text NOT NULL CHECK (split IN ('DEV', 'TEST', 'FULL')),
  start_date          date NOT NULL,
  end_date            date NOT NULL,
  cost_model          jsonb NOT NULL,
  result              jsonb NOT NULL,
  result_hash         text NOT NULL,
  simulated_data      boolean NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE promotion_evaluations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id        uuid NOT NULL REFERENCES portfolios(id),
  strategy_version_id uuid NOT NULL REFERENCES strategy_versions(id),
  decision            text NOT NULL CHECK (decision IN ('PASS', 'FAIL', 'INSUFFICIENT_DATA')),
  metrics             jsonb NOT NULL,
  checks              jsonb NOT NULL,
  gate_policy         jsonb NOT NULL,
  evaluated_at        timestamptz NOT NULL DEFAULT now()
);
