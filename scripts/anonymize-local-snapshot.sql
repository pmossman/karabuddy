-- Anonymize the LOCAL dev snapshot for screenshots — replaces real team names,
-- karabast handles, account names, tournament names, and custom replay titles
-- with deterministic fakes. LOCAL ONLY (Docker :5434). Reversible: re-run
-- `npm run db:pull-snapshot` to restore real prod data.
--
-- Consistency: one karabast handle → one fake handle EVERYWHERE it appears
-- (replays.players jsonb, match_players, tags, tournament entrants), so a
-- matchup and a member list never disagree.
--
-- Preserves PARKER_EMAIL below so the test sign-in keeps mapping to your data.
\set PARKER_EMAIL 'parkermos@gmail.com'

BEGIN;

-- ---- Fake-word arrays (module-level via a one-row CTE reused below) ----
-- adj/noun for handles + teams; first/last for account names.

-- 1) Unified karabast-handle map: every distinct handle across all surfaces.
DROP TABLE IF EXISTS _anon_handle;
CREATE TEMP TABLE _anon_handle AS
WITH all_handles AS (
  SELECT DISTINCT username AS real FROM match_players WHERE username IS NOT NULL AND username <> ''
  UNION
  SELECT DISTINCT e.elem->>'username'
    FROM replays r, jsonb_array_elements(r.players) AS e(elem)
    WHERE jsonb_typeof(r.players) = 'array' AND e.elem->>'username' IS NOT NULL AND e.elem->>'username' <> ''
  UNION
  SELECT DISTINCT author_name FROM tags WHERE author_name IS NOT NULL AND author_name <> ''
  UNION
  SELECT DISTINCT display_name FROM tournament_entrants WHERE display_name IS NOT NULL AND display_name <> ''
),
numbered AS (SELECT real, (row_number() OVER (ORDER BY real)) - 1 AS n FROM all_handles)
SELECT real,
  (ARRAY['Ace','Echo','Rogue','Crimson','Shadow','Vapor','Iron','Nova','Storm','Razor','Ghost','Solar','Lunar','Drift','Onyx','Vector','Pulse','Cobalt','Ember','Frost'])[1 + (n % 20)]
  || (ARRAY['Runner','Bantha','Falcon','Striker','Pilot','Saber','Wing','Trooper','Ranger','Hunter','Drake','Comet','Nomad','Scout','Raptor','Warden','Blade','Fang','Talon','Crest'])[1 + ((n / 20) % 20)]
  || (n + 1)::text AS fake
FROM numbered;

-- 2) Account-name map (users.name) — separate namespace from handles.
DROP TABLE IF EXISTS _anon_user;
CREATE TEMP TABLE _anon_user AS
SELECT id, (row_number() OVER (ORDER BY id)) - 1 AS n FROM users;

-- 3) Team-name map.
DROP TABLE IF EXISTS _anon_team;
CREATE TEMP TABLE _anon_team AS
SELECT slug, (row_number() OVER (ORDER BY slug)) - 1 AS n FROM teams;

-- 4) Tournament-name map.
DROP TABLE IF EXISTS _anon_tourney;
CREATE TEMP TABLE _anon_tourney AS
SELECT id, (row_number() OVER (ORDER BY id)) - 1 AS n FROM tournaments;

-- ===== Apply =====

-- Teams: "<Adjective> <Group>" (n < 400 stays unique on the pair).
UPDATE teams t SET name =
  (ARRAY['Crimson','Shadow','Iron','Nova','Storm','Azure','Golden','Silver','Scarlet','Jade','Onyx','Cobalt','Ember','Frost','Solar','Lunar','Vapor','Drift','Echo','Rogue'])[1 + (a.n % 20)]
  || ' ' ||
  (ARRAY['Squadron','Battalion','Syndicate','Coalition','Brigade','Cell','Order','Vanguard','Legion','Cohort','Alliance','Collective','Cadre','Division','Outfit','Crew','Circle','Guild','Pack','Wing'])[1 + ((a.n / 20) % 20)]
FROM _anon_team a WHERE a.slug = t.slug;

-- Account display names: "<First> <Last>".
UPDATE users u SET name =
  (ARRAY['Jordan','Casey','Riley','Morgan','Avery','Quinn','Reese','Sage','Drew','Skyler','Hayden','Rowan','Emerson','Finley','Harper','Kai','Logan','Parker','Remy','Tatum'])[1 + (a.n % 20)]
  || ' ' ||
  (ARRAY['Lee','Hart','Vance','Cole','Reed','Pike','Knox','Frost','Vega','Marsh','Stone','Webb','Cross','Hale','Lane','Ford','Day','Wells','Bishop','Crane'])[1 + ((a.n / 20) % 20)]
FROM _anon_user a WHERE a.id = u.id AND u.name IS NOT NULL;

-- Emails: fake, EXCEPT Parker's (preserve sign-in mapping).
UPDATE users u SET email = 'user' || (a.n + 1) || '@example.com'
FROM _anon_user a WHERE a.id = u.id AND u.email <> :'PARKER_EMAIL';

-- Tournament names.
UPDATE tournaments t SET name =
  (ARRAY['Practice','Weekly','Open','Invitational','Regional','Casual','Ladder','Showdown'])[1 + (a.n % 8)]
  || ' Event ' || (a.n + 1)::text
FROM _anon_tourney a WHERE a.id = t.id;

-- karabast handles, everywhere, via the one map.
UPDATE match_players mp SET username = h.fake FROM _anon_handle h WHERE h.real = mp.username;
UPDATE tags tg SET author_name = h.fake FROM _anon_handle h WHERE h.real = tg.author_name;
UPDATE tournament_entrants te SET display_name = h.fake FROM _anon_handle h WHERE h.real = te.display_name;

-- replays.players jsonb: rewrite each element's `username` from the same map,
-- preserving array order; non-username fields (leader/base) untouched.
UPDATE replays r SET players = sub.new_players
FROM (
  SELECT r2.slug,
    jsonb_agg(
      CASE WHEN h.fake IS NOT NULL THEN jsonb_set(e.elem, '{username}', to_jsonb(h.fake)) ELSE e.elem END
      ORDER BY e.ord
    ) AS new_players
  FROM replays r2,
       jsonb_array_elements(r2.players) WITH ORDINALITY AS e(elem, ord)
       LEFT JOIN _anon_handle h ON h.real = e.elem->>'username'
  WHERE jsonb_typeof(r2.players) = 'array'
  GROUP BY r2.slug
) sub
WHERE r.slug = sub.slug;

-- Custom replay titles can embed names → clear (viewer falls back to matchup text).
UPDATE replays SET display_name = NULL WHERE display_name IS NOT NULL;

-- Deck names occasionally embed a person's name → genericize to the archetype-free placeholder.
UPDATE tournament_entrants SET deck_name = NULL WHERE deck_name IS NOT NULL;

COMMIT;

-- Quick verification samples.
SELECT 'teams' AS t, string_agg(name, ', ' ORDER BY name) FROM (SELECT name FROM teams ORDER BY name LIMIT 6) s;
SELECT 'users' AS t, string_agg(name, ', ') FROM (SELECT name FROM users WHERE name IS NOT NULL ORDER BY id LIMIT 6) s;
SELECT 'players' AS t, (players->0->>'username') || ' vs ' || (players->1->>'username') FROM replays WHERE jsonb_array_length(players) >= 2 LIMIT 3;
