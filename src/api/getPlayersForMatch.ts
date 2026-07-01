import { z } from 'zod';
import { createEndpoint, ZiteError, Teams, Matches, People, MatchCards, AvailabilityExceptions, SquadSelections } from 'zite-integrations-backend-sdk';

const blockSchema = z.object({ rule: z.string(), reason: z.string() });
const conflictSchema = z.object({ type: z.string(), team: z.string(), matchId: z.string() });

const playerSchema = z.object({
  id: z.string(),
  preferredName: z.string(),
  registeredTeam: z.string(),
  playingPosition: z.string(),
  playingAbility: z.string(),
  availabilityStatus: z.string(),
  playerNotes: z.string(),
  playUpCount: z.number(),
  eligibilityStatus: z.string(),
  blocks: z.array(blockSchema),
  warnings: z.array(blockSchema),
  conflicts: z.array(conflictSchema),
  selectionStatus: z.string(),
  selectionId: z.string(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Returns all active players annotated with eligibility for a specific match',
  inputSchema: z.object({ matchId: z.string() }),
  outputSchema: z.object({
    match: z.object({
      id: z.string(),
      date: z.string(),
      homeTeam: z.string(),
      awayTeam: z.string(),
      hkfcTeam: z.string(),
      opponent: z.string(),
      division: z.string(),
      venue: z.string(),
      targetSquadSize: z.number(),
      selectedCount: z.number(),
      reserveCount: z.number(),
    }),
    players: z.array(playerSchema),
  }),
  execute: async ({ input }) => {
    // 1. Fetch teams (cache)
    const teamsResult = await Teams.findAll({ filters: { active: true } });
    const teams = teamsResult.records;
    const teamRankMap = new Map(teams.map(t => [t.teamName || '', t.teamRank || 99]));
    const teamsByName = new Map(teams.map(t => [t.teamName || '', t]));

    // 2. Fetch the target match
    const match = await Matches.findOne({ id: input.matchId });
    if (!match) throw new ZiteError({ code: 'NOT_FOUND', message: 'Match not found' });

    const home = match.homeTeam || '';
    const away = match.awayTeam || '';
    const hkfcTeam = teamRankMap.has(home) ? home : away;
    const opponent = hkfcTeam === home ? away : home;
    const targetTeamRank = teamRankMap.get(hkfcTeam) || 99;
    const targetTeam = teamsByName.get(hkfcTeam);
    const matchDate = (match.date || '').slice(0, 10);

    // 3. Fetch active players with pagination
    let allPlayers: Awaited<ReturnType<typeof People.findAll>>['records'] = [];
    const p1 = await People.findAll({ filters: { active: true }, limit: 100 });
    allPlayers = p1.records;
    if (p1.hasMore) {
      const p2 = await People.findAll({ filters: { active: true }, limit: 100, offset: p1.offset });
      allPlayers = [...allPlayers, ...p2.records];
    }

    // 4. Fetch same-day matches for conflict detection
    const allMatches = await Matches.findAll({ filters: { matchStatus: 'Scheduled' }, limit: 100 });
    const sameDayMatches = allMatches.records.filter(m =>
      m.id !== match.id && (m.date || '').slice(0, 10) === matchDate
    );
    const sameDayMatchIds = new Set(sameDayMatches.map(m => m.id));
    sameDayMatchIds.add(match.id);

    // 5. Fetch squad selections for same-day matches + this match
    const selectionsResult = await SquadSelections.findAll({ filters: {}, limit: 100 });
    const allSelections = selectionsResult.records;
    const thisMatchSelections = allSelections.filter(s => {
      const mId = Array.isArray(s.match) ? s.match[0] : s.match;
      return mId === match.id;
    });
    const sameDaySelections = allSelections.filter(s => {
      const mId = Array.isArray(s.match) ? s.match[0] : s.match;
      return mId && sameDayMatchIds.has(mId) && mId !== match.id;
    });

    // 6. Fetch availability exceptions for this match
    const exceptionsResult = await AvailabilityExceptions.findAll({ filters: {}, limit: 100 });
    const allExceptions = exceptionsResult.records;
    const thisMatchExceptions = allExceptions.filter(e => {
      const mId = Array.isArray(e.match) ? e.match[0] : e.match;
      return mId === match.id;
    });
    const sameDayExceptions = allExceptions.filter(e => {
      const mId = Array.isArray(e.match) ? e.match[0] : e.match;
      return mId && sameDayMatchIds.has(mId);
    });

    // Build lookup maps
    const exceptionByPlayer = new Map<string, typeof thisMatchExceptions[0]>();
    for (const e of thisMatchExceptions) {
      const pId = Array.isArray(e.player) ? e.player[0] : e.player;
      if (pId) exceptionByPlayer.set(pId, e);
    }

    const selectionByPlayer = new Map<string, typeof thisMatchSelections[0]>();
    for (const s of thisMatchSelections) {
      const pId = Array.isArray(s.player) ? s.player[0] : s.player;
      if (pId) selectionByPlayer.set(pId, s);
    }

    // Same-day selections by player (for conflicts)
    const sameDaySelByPlayer = new Map<string, { type: string; team: string; matchId: string }[]>();
    for (const s of sameDaySelections) {
      const pId = Array.isArray(s.player) ? s.player[0] : s.player;
      if (!pId) continue;
      const mId = Array.isArray(s.match) ? s.match[0] : s.match;
      const sdMatch = sameDayMatches.find(m => m.id === mId);
      const sdHome = sdMatch?.homeTeam || '';
      const sdAway = sdMatch?.awayTeam || '';
      const sdTeam = teamRankMap.has(sdHome) ? sdHome : sdAway;
      const existing = sameDaySelByPlayer.get(pId) || [];
      existing.push({
        type: s.selectionStatus === 'Reserve' ? 'reserve' : 'selected',
        team: sdTeam,
        matchId: mId || '',
      });
      sameDaySelByPlayer.set(pId, existing);
    }

    // Same-day availability (for higher-team priority check)
    const sameDayUnavailByPlayerMatch = new Map<string, Set<string>>();
    for (const e of sameDayExceptions) {
      if (e.availabilityStatus !== 'Unavailable') continue;
      const pId = Array.isArray(e.player) ? e.player[0] : e.player;
      const mId = Array.isArray(e.match) ? e.match[0] : e.match;
      if (!pId || !mId) continue;
      const existing = sameDayUnavailByPlayerMatch.get(pId) || new Set();
      existing.add(mId);
      sameDayUnavailByPlayerMatch.set(pId, existing);
    }

    // Build player list with eligibility
    const selectedCount = thisMatchSelections.filter(s => s.selectionStatus === 'Selected').length;
    const reserveCount = thisMatchSelections.filter(s => s.selectionStatus === 'Reserve').length;

    const players = allPlayers.map(p => {
      const blocks: { rule: string; reason: string }[] = [];
      const warnings: { rule: string; reason: string }[] = [];
      const conflicts = sameDaySelByPlayer.get(p.id) || [];

      // Profile completeness (first check)
      const missingFields: string[] = [];
      if (!p.registeredTeam) missingFields.push('team');
      if (!p.playingPosition) missingFields.push('position');
      if (!p.playingAbility) missingFields.push('ability');
      if (missingFields.length > 0) {
        blocks.push({ rule: 'profile', reason: `Profile incomplete: ${missingFields.join(', ')}` });
      }

      // Suspension
      if (p.isSuspended || (p.matchesToServe && p.matchesToServe > 0)) {
        const msg = p.matchesToServe ? `Suspended — ${p.matchesToServe} matches to serve` : 'Suspended';
        blocks.push({ rule: '16', reason: msg });
      }

      // Higher-to-lower movement (7.2a)
      const playerTeamRank = teamRankMap.get(p.registeredTeam || '') || 99;
      if (p.registeredTeam && playerTeamRank < targetTeamRank) {
        blocks.push({ rule: '7.2a', reason: 'Higher-to-lower movement blocked' });
      }

      // Visiting player — fixed team (6.4)
      if (p.isVisitingPlayer && p.registeredTeam && p.registeredTeam !== hkfcTeam) {
        blocks.push({ rule: '6.4', reason: 'Visiting player — fixed to registered team' });
      }

      // Same-day higher team priority (7.1)
      if (blocks.length === 0 && playerTeamRank > targetTeamRank) {
        // Check if player has a higher-ranked team fixture today and is NOT unavailable for it
        for (const sdm of sameDayMatches) {
          const sdHome = sdm.homeTeam || '';
          const sdAway = sdm.awayTeam || '';
          const sdTeam = teamRankMap.has(sdHome) ? sdHome : sdAway;
          const sdTeamRank = teamRankMap.get(sdTeam) || 99;
          if (sdTeamRank < targetTeamRank) {
            const unavailMatches = sameDayUnavailByPlayerMatch.get(p.id) || new Set();
            if (!unavailMatches.has(sdm.id)) {
              blocks.push({ rule: '7.1', reason: `Available for ${sdTeam} today` });
              break;
            }
          }
        }
      }

      // Availability
      const exception = exceptionByPlayer.get(p.id);
      const availabilityStatus = exception?.availabilityStatus || 'Available';
      const playerNotes = exception?.playerNotes || '';

      // Selection status for this match
      const selection = selectionByPlayer.get(p.id);
      const selectionStatus = selection?.selectionStatus || '';

      const eligibilityStatus = blocks.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'eligible';

      return {
        id: p.id,
        preferredName: p.preferredName || p.givenNames || p.surname || 'Unknown',
        registeredTeam: p.registeredTeam || '',
        playingPosition: p.playingPosition || '',
        playingAbility: p.playingAbility || '',
        availabilityStatus,
        playerNotes,
        playUpCount: 0, // TODO: compute from Match Cards in Phase 3 enhancement
        eligibilityStatus,
        blocks,
        warnings,
        conflicts,
        selectionStatus,
        selectionId: selection?.id || '',
      };
    });

    // Sort: selected first, then by ability
    const abilityOrder = ['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','E+','E','E-','F+','F','F-','G+','G','G-','H+','H','H-'];
    players.sort((a, b) => {
      // Selected first
      if (a.selectionStatus && !b.selectionStatus) return -1;
      if (!a.selectionStatus && b.selectionStatus) return 1;
      // Then eligible before blocked
      if (a.eligibilityStatus !== b.eligibilityStatus) {
        if (a.eligibilityStatus === 'blocked') return 1;
        if (b.eligibilityStatus === 'blocked') return -1;
      }
      // Then by ability
      const aIdx = abilityOrder.indexOf(a.playingAbility);
      const bIdx = abilityOrder.indexOf(b.playingAbility);
      return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
    });

    return {
      match: {
        id: match.id,
        date: match.date || '',
        homeTeam: home,
        awayTeam: away,
        hkfcTeam,
        opponent,
        division: match.division || '',
        venue: match.venue || '',
        targetSquadSize: targetTeam?.targetSquadSize || 16,
        selectedCount,
        reserveCount,
      },
      players,
    };
  },
});
