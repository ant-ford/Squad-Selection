import type { Env } from "../../env";
import { db, eq, inList } from "../supabase";
import type { TeamsRepo } from "../teams";
import type { OfficersRepo, Office } from "../officers";
import type { MatchesRepo, MatchPatch, SelectionChangeResult } from "../matches";
import type { MatchCardsRepo } from "../matchCards";
import type { AvailabilityExceptionsRepo, AvailabilityOutcome } from "../availabilityExceptions";
import type { AvailabilityRulesRepo } from "../availabilityRules";
import type { AbilityGroupsRepo } from "../abilityGroups";
import type { RankingEventsRepo, RankingEventRow } from "../rankingEvents";
import {
  toAbilityGroup, toException, toMatch, toMatchCard, toRule, toTeam,
  type AbilityGroupRow, type ExceptionRow, type MatchCardRow, type MatchRow, type RuleRow, type TeamRow,
} from "./mappers";

export function supabaseTeams(env: Env): TeamsRepo {
  const d = db(env);
  return {
    async listActive() {
      return (await d.select<TeamRow>("api_teams", "select=*&active=is.true")).map(toTeam);
    },
    async listAll() {
      return (await d.select<TeamRow>("api_teams", "select=*")).map(toTeam);
    },
    async setAutoSelectPlayers(teamId, playerIds) {
      await d.rpc("set_team_people", { p_team: teamId, p_role: "auto_select", p_people: playerIds });
    },
  };
}

interface OfficeViewRow { id: string; office: Office; designation: string | null; status: string; member: string | null }

export function supabaseOfficers(env: Env): OfficersRepo {
  const d = db(env);
  const rowsFor = async (offices: readonly Office[], activeOnly: boolean) => {
    const rows = await d.select<OfficeViewRow>(
      "api_offices",
      `select=*&office=${inList(offices)}${activeOnly ? "&status=eq.Active" : ""}&order=id`,
    );
    // In the order the offices were asked for.
    return offices.flatMap((office) => rows.filter((r) => r.office === office));
  };
  return {
    async listActive(offices) {
      return (await rowsFor(offices, true)).map((r) => ({
        office: r.office,
        designation: r.designation ?? "",
        memberIds: r.member ? [r.member] : [],
      }));
    },
    async listAllMembers(offices) {
      return (await rowsFor(offices, false)).map((r) => ({ id: r.id, office: r.office, memberIds: r.member ? [r.member] : [] }));
    },
  };
}

/** Matches columns written directly; selections go through set_match_selection. */
const MATCH_COLUMNS = { autoSelectEnabled: "auto_select_enabled", homeKit: "home_kit", awayKit: "away_kit" } as const;

export function supabaseMatches(env: Env): MatchesRepo {
  const d = db(env);
  const list = async (query: string) => (await d.select<MatchRow>("api_matches", `select=*&${query}`)).map(toMatch);
  return {
    async getById(id) {
      const row = await d.one<MatchRow>("api_matches", `select=*&id=${eq(id)}`);
      return row ? toMatch(row) : null;
    },

    async update(id, patch: MatchPatch) {
      const columns: Record<string, unknown> = {};
      for (const [key, column] of Object.entries(MATCH_COLUMNS)) {
        const value = patch[key as keyof typeof MATCH_COLUMNS];
        // A blank kit is "not decided", stored as null (the column allows only Blue or White).
        if (value !== undefined) columns[column] = value === "" ? null : value;
      }
      if (Object.keys(columns).length) {
        const rows = await d.update("matches", `api_id=${eq(id)}`, columns);
        if (rows.length === 0) throw new Error(`No match ${id}`);
      }
      if (patch.selectedPlayersHome) await d.rpc("set_match_selection", { p_match: id, p_side: "home", p_people: patch.selectedPlayersHome });
      if (patch.selectedPlayersAway) await d.rpc("set_match_selection", { p_match: id, p_side: "away", p_people: patch.selectedPlayersAway });
    },

    async applySelectionChanges(id, change) {
      const r = await d.rpc<SelectionChangeResult & { otherVersion?: number | null }>("apply_squad_changes", {
        p_match: id,
        p_side: change.side,
        p_add: change.add,
        p_remove: change.remove,
        p_version: change.version,
        p_actor: change.actorId ?? null,
        p_source: change.source,
      });
      return r.status === "ok" ? { ...r, otherVersion: r.otherVersion ?? null } : r;
    },

    listForSeason: (season) => list(season ? `season=${eq(season)}` : "order=id"),
    listScheduled: () => list("match_status=eq.Scheduled"),
    async listPlayedForSeasons(seasons) {
      if (seasons.length === 0) return [];
      return list(`match_status=eq.Played&season=${inList(seasons)}`);
    },
    async listResultsForSeasons(seasons) {
      if (seasons.length === 0) return [];
      const rows = await d.select<MatchRow>(
        "api_matches",
        `select=id,match_date,season,competition_type,home_team,home_score,away_team,away_score,venue&match_status=eq.Played&season=${inList(seasons)}`,
      );
      return rows.map((r) => ({ ...toMatch(r), matchStatus: "Played" }));
    },
  };
}

export function supabaseMatchCards(env: Env): MatchCardsRepo {
  const d = db(env);
  return {
    async listForSeason(season, opts = {}) {
      const filters = [season ? `season=${eq(season)}` : "", opts.cardedOnly ? "cards=neq.{}" : ""].filter(Boolean).join("&");
      return (await d.select<MatchCardRow>("api_match_cards", `select=*${filters ? `&${filters}` : ""}`)).map(toMatchCard);
    },
  };
}

const toOutcome = (o: Partial<AvailabilityOutcome> | null): AvailabilityOutcome => ({
  updated: o?.updated ?? 0,
  results: o?.results ?? [],
  before: o?.before ?? [],
  seasons: o?.seasons ?? [],
});

export function supabaseAvailabilityExceptions(env: Env): AvailabilityExceptionsRepo {
  const d = db(env);
  /** The columns a targeted answers read needs: not season or updated_at. */
  const EXCEPTION_COLUMNS = "id,player,match,availability_status,note";
  /** Match ids per request, so the URL stays well inside PostgREST's limits. */
  const IDS_PER_READ = 100;
  // match=in.(...) is an index lookup per match (matches_api_id_key, then
  // availability_exceptions_match_idx); chunks are read in parallel.
  const byMatches = async (matchIds: string[], extra: string) => {
    const chunks: string[][] = [];
    for (let i = 0; i < matchIds.length; i += IDS_PER_READ) chunks.push(matchIds.slice(i, i + IDS_PER_READ));
    const rows = await Promise.all(
      chunks.map((ids) => d.select<ExceptionRow>("api_availability_exceptions", `select=${EXCEPTION_COLUMNS}${extra}&match=${inList(ids)}`)),
    );
    return rows.flat().map(toException);
  };
  return {
    async listForMatches(matchIds) {
      if (matchIds.length === 0) return [];
      return byMatches(matchIds, "");
    },
    async listForPlayer(playerId, matchIds) {
      if (!playerId || matchIds.length === 0) return [];
      return byMatches(matchIds, `&player=${eq(playerId)}`);
    },
    async listForSeasons(seasons) {
      if (seasons.length === 0) return [];
      return (await d.select<ExceptionRow>("api_availability_exceptions", `select=*&season=${inList(seasons)}`)).map(toException);
    },
    // One call, one transaction, a few hundred bytes: the database reads the
    // player's row for each match and decides store-or-delete under a
    // per-player lock, so two taps on different isolates cannot interleave.
    async set({ playerId, matchIds, status, notes, updatedById }) {
      return toOutcome(await d.rpc<AvailabilityOutcome>("set_availability", {
        p_player: playerId, p_matches: matchIds, p_status: status, p_notes: notes ?? null, p_updated_by: updatedById ?? null,
      }));
    },
    async setForDate({ playerId, date, status, notes }) {
      return toOutcome(await d.rpc<AvailabilityOutcome>("set_availability_for_date", {
        p_player: playerId, p_date: date, p_status: status, p_notes: notes ?? null,
      }));
    },
  };
}

export function supabaseAvailabilityRules(env: Env): AvailabilityRulesRepo {
  const d = db(env);
  return {
    async listAll() {
      return (await d.select<RuleRow>("api_availability_rules", "select=*")).map(toRule);
    },
    async create(rule) {
      const id = await d.rpc<string>("create_availability_rule", { p: rule });
      const row = await d.one<RuleRow>("api_availability_rules", `select=*&id=${eq(id)}`);
      if (!row) throw new Error("The new rule could not be read back");
      return toRule(row);
    },
    async delete(id) {
      await d.remove("availability_rules", `api_id=${eq(id)}`);
    },
  };
}

export function supabaseAbilityGroups(env: Env): AbilityGroupsRepo {
  const d = db(env);
  return {
    async list() {
      return (await d.select<AbilityGroupRow>("ability_group_config", "select=api_id,group_name,capacity,is_residual")).map(toAbilityGroup);
    },
    async saveCapacities(capacities) {
      // A group without a row is created (not residual); an existing row keeps its residual flag.
      await d.upsert(
        "ability_group_config",
        Object.entries(capacities).map(([group_name, capacity]) => ({ group_name, capacity })),
        "group_name",
      );
    },
  };
}

interface RankingEventViewRow {
  id: string; player: string | null; actor: string | null; actor_email: string | null; kind: string;
  old_rank: number | null; new_rank: number | null; justification: string | null; occurred_at: string | null;
}

export function supabaseRankingEvents(env: Env): RankingEventsRepo {
  const d = db(env);
  return {
    async create(events) {
      if (events.length === 0) return;
      await d.rpc("insert_ranking_events", { p: events });
    },
    async listNewestFirst() {
      const rows = await d.select<RankingEventViewRow>("api_ranking_events", "select=*&order=occurred_at.desc");
      return rows.map((r): RankingEventRow => ({
        id: r.id,
        playerId: r.player ?? "",
        actorId: r.actor ?? undefined,
        actorEmail: r.actor_email ?? "",
        kind: r.kind || "move",
        oldRank: r.old_rank,
        newRank: r.new_rank,
        justification: r.justification ?? "",
        timestamp: r.occurred_at ?? "",
      }));
    },
  };
}
