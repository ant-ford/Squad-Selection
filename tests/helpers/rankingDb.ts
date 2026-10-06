import type { PlayerRow } from "../../worker/src/data/supabase/mappers";
import { fakePostgrest, type FakePostgrest, type PgRow, type PostgrestOptions } from "./postgrest";
import { recId } from "./factories";

/**
 * The ranking screens' Supabase tables behind fakePostgrest, for tests that
 * run the REAL Supabase repositories (data/supabase/people.ts, squad.ts)
 * rather than the in-memory ones, so the SQL functions a ranking write
 * calls (update_people_ranks, insert_ranking_events) can be asserted on
 * with pg.rpcCalls().
 *
 * People: one array serves both names the People repository uses. Reads go
 * to the api_players view, keyed by `id` (the api id); writes PATCH the
 * people table, filtered on `api_id`. Each row carries both keys, with the
 * same value, so a write is seen by the next read as it is in Postgres.
 *
 * The two SQL functions are reimplemented as the migration defines them
 * (supabase/migrations/20260929170000_api_views.sql): update_people_ranks
 * patches only the columns its jsonb carries and fails the whole call on an
 * unknown person; insert_ranking_events resolves player/actor through
 * person_uuid(), which fails on an unknown person.
 */

export type PersonRow = PlayerRow & { api_id: string; email_lower: string | null };

/** A People row as api_players has it (snake_case), keyed by recId(label). Unset columns are null/false. */
export function personRow(label: string, cols: Partial<PersonRow> = {}): PersonRow {
  const id = cols.id ?? recId(label);
  const email = cols.email === undefined ? `${label.toLowerCase()}@hkfc.com` : cols.email;
  return {
    id,
    api_id: id,
    preferred_name: label,
    given_names: null,
    surname: null,
    shirt_no_value: null,
    email,
    email_lower: email ? email.toLowerCase() : null,
    mobile_no: null,
    active: false,
    registered_team: null,
    selected_team_sos: null,
    selected_team_eos: null,
    playing_position: null,
    playing_ability: null,
    is_visiting_player: false,
    is_suspended: false,
    matches_to_serve: null,
    ever_registered_to_premier: false,
    u21_eligible: false,
    player_coach: [],
    section_rank: null,
    rank_updated_at: null,
    status: null,
    applicant_stage: null,
    sports_background: null,
    selection_comments: null,
    opt_in_only: false,
    date_of_birth: null,
    photo_file_id: null,
    ...cols,
  };
}

/** A Teams row as api_teams has it. */
export function teamRow(name: string, rank: number, cols: PgRow = {}): PgRow {
  return {
    id: recId(`Team${name}`),
    team_name: name,
    team_rank: rank,
    is_premier: false,
    target_squad_size: 16,
    active: true,
    coach: [],
    team_captain: [],
    section_captain: [],
    auto_select_players: [],
    ...cols,
  };
}

/** A ranking_events row as api_ranking_events has it. */
export function rankingEventRow(cols: PgRow & { id: string }): PgRow {
  return {
    player: null,
    actor: null,
    actor_email: null,
    kind: "move",
    old_rank: null,
    new_rank: null,
    justification: null,
    occurred_at: null,
    ...cols,
  };
}

const RANK_COLUMNS: Record<string, string> = {
  sectionRank: "section_rank",
  playingAbility: "playing_ability",
  rankUpdatedAt: "rank_updated_at",
  active: "active",
  optInOnly: "opt_in_only",
};

const noPerson = (id: unknown) =>
  new Response(JSON.stringify({ code: "P0002", message: `No person ${id}` }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });

let eventSeq = 0;

export interface RankingDb {
  pg: FakePostgrest;
  /** api_players and people: the same array. */
  people: PersonRow[];
  events: PgRow[];
  abilityGroups: PgRow[];
  teams: PgRow[];
}

/**
 * Installs fakePostgrest with People, Teams, ranking events and the ability
 * group config. `handlers` are passed through (to inject failures).
 */
export function rankingDb(seed: {
  people?: PersonRow[];
  events?: PgRow[];
  abilityGroups?: PgRow[];
  teams?: PgRow[];
  handlers?: PostgrestOptions["handlers"];
} = {}): RankingDb {
  const people: PersonRow[] = [...(seed.people ?? [])];
  const events: PgRow[] = [...(seed.events ?? [])];
  const abilityGroups: PgRow[] = [...(seed.abilityGroups ?? [])];
  const teams: PgRow[] = [...(seed.teams ?? [])];
  const find = (id: unknown) => people.find((r) => r.api_id === id);

  const pg = fakePostgrest({
    tables: {
      api_players: people as unknown as PgRow[],
      // The Active list for reference data (api_players_lite): the same rows.
      api_players_lite: people as unknown as PgRow[],
      people: people as unknown as PgRow[],
      api_teams: teams,
      api_ranking_events: events,
      ability_group_config: abilityGroups,
    },
    handlers: seed.handlers,
    defaults: {
      ability_group_config: (row) => ({ id: `group-${String(row.group_name)}`, api_id: `group-${String(row.group_name)}`, is_residual: false, ...row }),
    },
    rpc: {
      update_people_ranks: ({ p }: { p: Record<string, unknown>[] }) => {
        // One transaction: an unknown person fails the call before anything is written.
        for (const w of p) if (!find(w.id)) return noPerson(w.id);
        for (const w of p) {
          const row = find(w.id)! as unknown as Record<string, unknown>;
          for (const [key, column] of Object.entries(RANK_COLUMNS)) if (key in w) row[column] = w[key];
        }
        return null;
      },
      insert_ranking_events: ({ p }: { p: Record<string, unknown>[] }) => {
        for (const w of p) {
          if (!find(w.playerId)) return noPerson(w.playerId);
          if (w.actorId != null && !find(w.actorId)) return noPerson(w.actorId);
        }
        for (const w of p) {
          events.push({
            id: `00000000-0000-4000-a000-${String(++eventSeq).padStart(12, "0")}`,
            player: w.playerId,
            actor: w.actorId ?? null,
            actor_email: w.actorEmail || null,
            kind: w.kind,
            old_rank: w.oldRank ?? null,
            new_rank: w.newRank ?? null,
            justification: w.justification || null,
            occurred_at: w.timestamp,
          });
        }
        return null;
      },
    },
  });
  return { pg, people, events, abilityGroups, teams };
}
