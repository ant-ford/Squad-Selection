# HKFC Squad Selection App – Ranking-Based Ability System (Implementation Specification)

## Objective

Replace the current manually maintained ability rating system (A+, A, A−, B+, B, B−, etc.) with a ranking-based system.

The ranking system becomes the sole source of truth for player ability assessment.

All ability grades, team rankings, and positional rankings must be automatically derived from a single maintained ranking.

The goal is to make player assessment simpler, more consistent, and easier to maintain for coaches.

---

# Core Principles

## Single Source of Truth

The only coach-maintained assessment value is:

**Section Rank**

Every active player has a unique rank from:

```text
1 ... N
```

where:

- Rank 1 = strongest player
- Rank N = lowest ranked active player

No other ability-related field may be manually edited.

---

## Active Player Definition

A player participates in ranking calculations only when:

```text
Active = true
```

Only active players are included in:

- Section Rank
- Team Rank
- Positional Rank
- Ability Group Assignment
- Ability Sub-Group Assignment

Players with:

```text
Active = false
```

must be excluded from all ranking and ability calculations.

---

# Data Integrity Rules

The following rules must always be true.

## Rule 1 – Contiguous Ranking

For N active players:

```text
Section Rank = 1 ... N
```

The ranking must always be a complete permutation of integers.

Invalid examples:

```text
1,2,4
```

```text
1,2,2
```

No gaps and no duplicates are permitted.

---

## Rule 2 – Rank Movement

When a player is moved from:

```text
Old Rank = R_old
New Rank = R_new
```

the system must automatically shift affected players.

### Moving Up

If:

```text
R_new < R_old
```

all players between:

```text
R_new ... (R_old - 1)
```

shift down by +1.

### Moving Down

If:

```text
R_new > R_old
```

all players between:

```text
(R_old + 1) ... R_new
```

shift up by -1.

---

## Rule 3 – Player Becomes Inactive

When:

```text
Active = false
```

the player is removed from the ranking.

All lower-ranked active players shift upward by one position.

Example:

```text
Rank 15 becomes inactive
```

then:

```text
16 → 15
17 → 16
18 → 17
...
```

---

## Rule 4 – New Active Player

A newly activated player is automatically assigned:

```text
Section Rank = N + 1
```

where N is the current number of active players.

The player is placed at the bottom of the ranking until manually adjusted.

---

## Rule 5 – Rank Validation

Section Rank must always satisfy:

```text
1 <= Section Rank <= Active Player Count
```

Invalid ranks must be rejected.

Examples:

```text
0
-1
999 (when only 170 active players exist)
```

---

# Derived Rankings

## Team Rank

Team Rank is automatically calculated.

Algorithm:

1. Select all active players assigned to the same registered team.
2. Sort by Section Rank ascending.
3. Assign Team Rank sequentially from 1.

Example:

| Player | Team | Team Rank |
|----------|----------|----------|
| Player A | B Team | 1 |
| Player B | B Team | 2 |
| Player C | B Team | 3 |

Team Rank is read-only.

---

## Positional Rank

Positional Rank is automatically calculated.

Algorithm:

1. Select all active players with the same Primary Position.
2. Sort by Section Rank ascending.
3. Assign Positional Rank sequentially from 1.

Example:

| Player | Position | Positional Rank |
|----------|----------|----------|
| Player A | Defender | 1 |
| Player B | Defender | 2 |
| Player C | Defender | 3 |

Positional Rank is read-only.

---

# Ability Group Configuration

Administrators control top-level ability groups.

Create a configuration table:

```text
ability_group_configuration
```

| Group | Capacity |
|---------|---------|
| A | configurable |
| B | configurable |
| C | configurable |
| D | configurable |
| E | configurable |
| F | configurable |
| G | configurable |
| H | residual / balancing group |

Groups A–G have administrator-defined capacities.

Group H automatically contains all remaining active players.

Example:

| Group | Capacity |
|---------|---------|
| A | 12 |
| B | 20 |
| C | 24 |
| D | 24 |
| E | 24 |
| F | 24 |
| G | 20 |
| H | Remaining Players |

---

## Configuration Validation

The total configured capacities of Groups A–G must not exceed the active player count.

If:

```text
A+B+C+D+E+F+G > Active Players
```

the configuration must be rejected.

---

# Ability Assignment

Ability Groups are derived from Section Rank.

Example:

```text
A = first 12 players
B = next 20 players
C = next 24 players
...
```

Group H contains all remaining players.

---

# Ability Sub-Group Assignment

Each top-level group is divided into:

```text
+
Neutral
-
```

Examples:

```text
A+
A
A-

B+
B
B-
```

---

## Sub-Group Constraints

The following must always be true:

```text
Neutral >= Plus
Neutral >= Minus
```

Sub-groups should be as evenly balanced as possible.

---

## Sub-Group Algorithm

For a group containing:

```text
N_G
```

players:

```text
k = floor(N_G / 3)
r = N_G mod 3
```

### If r = 0

```text
Plus = k
Neutral = k
Minus = k
```

### If r = 1

```text
Plus = k
Neutral = k + 1
Minus = k
```

### If r = 2

```text
Plus = k + 1
Neutral = k + 1
Minus = k
```

---

## Ability Fields

The following fields are calculated only:

```text
ability_group
ability_sub_group
ability_display
```

Examples:

```text
A+
B
C-
```

These fields must never be manually editable.

---

# Coach Ranking Interface

Create a dedicated Ranking screen within the Coaches Dashboard.

The interface should work well on desktop and tablet devices.

---

## Display Columns

Show:

- Section Rank
- Player Name
- Primary Position
- Registered Team
- Ability Badge

Example:

```text
1  John Smith   DEF   A Team   A+
2  David Wong   MID   A Team   A+
3  Alex Chan    DEF   A Team   A
```

---

## Ranking Controls

Support all of the following methods:

### Drag and Drop

Reorder players by dragging.

### Move Up / Move Down

Incremental movement controls.

### Move To Rank

Direct numerical entry.

Example:

```text
Move Player To Rank 12
```

### Move Relative To Another Player

Example:

```text
Move Above John Smith
Move Below David Wong
```

---

# Filters

Provide:

- Search
- Team Filter
- Position Filter

---

## Critical Filter Behaviour

Team and Position views are filtered views of the same Section Rank.

They are NOT independent rankings.

Any ranking action performed in a filtered view must modify the underlying Section Rank.

Example:

Current Section Ranking:

```text
15 Alex (DEF)
16 David (MID)
17 Chris (GK)
22 Ben (DEF)
```

Coach views only Defenders.

Coach moves:

```text
Ben above Alex
```

Result:

```text
15 Ben
16 Alex
17 David
18 Chris
...
```

Players outside the filter may shift as a result.

This behaviour is intentional.

---

# Visual Indicators

## Tier Dividers

Display visual separators showing ability boundaries.

Examples:

```text
--- End A+ ---
--- End A ---
--- End A- ---
```

Dividers must update automatically when rankings change.

---

## Live Preview

When rankings change:

- Ability badges update immediately
- Ability groups update immediately
- Tier dividers update immediately

No page refresh required.

---

## Recent Rank Change Indicator

If simple to implement without significant performance overhead:

Display rank movement over the previous 30 days.

Examples:

```text
John Smith ▲5
David Wong ▼3
```

This is a desirable enhancement but should not compromise simplicity or performance.

---

# Concurrency & Data Integrity

Data integrity is more important than real-time synchronization.

All rank updates must execute inside a single database transaction.

The system must never allow:

- Duplicate ranks
- Missing ranks
- Corrupted ranking sequences

If a user submits a ranking change against stale data:

- Reject the update, OR
- Refresh rankings and require the user to retry

Either approach is acceptable.

---

# Airtable Changes

Add:

```text
ability_group_configuration
```

table.

Add or update player fields:

```text
section_rank
team_rank
positional_rank
ability_group
ability_sub_group
ability_display
```

Only:

```text
section_rank
```

is directly maintained.

All other ranking and ability fields are calculated.

---

# Out of Scope

Do not implement:

- Potential Ratings
- Development Ratings
- Percentile-Based Ability Bands
- Draft Rankings
- Approval Workflows
- Historical Ranking Snapshots
- Audit Trail Features

Focus only on the ranking-driven ability system described above.