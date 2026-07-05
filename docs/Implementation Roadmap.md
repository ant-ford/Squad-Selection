# HKFC Squad Selection App - Implementation Roadmap

## Purpose

This document describes the functional requirements, workflows, data concepts and implementation sequence for the HKFC Squad Selection App.

It is intended to guide Airtable design, Make.com automation design and phased application development.

This document deliberately avoids implementation-specific instructions for Zite, Airtable or Make.com. Those should be generated separately after the design is agreed.

---

# Core Design Principles

## Coaches Are The Primary Users

The application exists primarily to help coaches assemble legal and competitive squads.

Players provide availability information, but the primary workflow is squad selection.

---

## Minimise Player Administration

Players should be assumed available unless they indicate otherwise.

The application should minimise the number of actions required from players and favour:

* Defaults
* Bulk actions
* Exception management

over repeated weekly updates.

---

## Record Efficient Design

The application should avoid generating records for every possible player-match combination.

The system should only create records when:

* A player is unavailable or maybe available
* A coach selects a player
* A match appearance occurs

This minimises Airtable record usage and improves scalability across multiple seasons.

---

## Eligibility First

At every stage the system should respect HKHA competition rules.

Players may only be considered for fixtures for which they are eligible.

Players should never see fixtures they are not eligible to play.

---

# User Roles

## Player

Can:

* View eligible fixtures
* Update availability
* Add availability notes
* View selection status

Cannot:

* Edit other players
* Build squads
* Override selections

---

## Coach

Can:

* View all assigned teams
* Manage player availability
* Build squads
* Select and release players
* View recommendations
* View play-up tracking

A coach may also act as a captain if required.

No separate captain role is required within the application.

---

## Admin

Can:

* Manage system configuration
* Run synchronisation processes
* Override data
* Access all teams

---

# Core Data Concepts

## People

Stores player and coach information.

Includes:

* Name
* Email
* Mobile
* Registered Team
* Playing Position
* Player Ability
* Active Status
* Role

Player Ability values:

A+, A, B+, B, C+, C, D+, D, E+, E, F+, F, G+, G, H+, H

Player Ability is the primary indicator of player strength.

Registered Team should not be used as the sole indicator of playing standard.

---

## Teams

Stores team information.

Includes:

* Team Name
* Team Rank
* Target Squad Size
* Coach Assignments

Team hierarchy should be configurable.

Do not hardcode assumptions about team structure.

---

## Matches

Stores all fixtures.

Includes:

* Date
* Time
* Venue
* Opposition
* Competition
* Team
* Home/Away
* Season

Fixtures will be synchronised automatically.

---

## Availability Exceptions

Stores only exceptions to the default assumption that players are available.

One record represents one player for one match.

No record means:

Available

Availability Status values:

* Maybe
* Unavailable

Optional Notes may be recorded.

Examples:

* Travelling
* Arriving late
* Leaving early
* Work commitment

This approach minimises Airtable record usage.

---

## Squad Selections

Stores players selected by coaches.

One record represents one player selected for one match.

Selection Status values:

* Reserve
* Selected

No record means:

Not Selected

This table is used for:

* Squad building
* Call-up management
* Selection conflict prevention

---

## Match Cards

Stores actual match participation.

Used for:

* Play-up tracking
* Appearance history
* Competition compliance

Match Cards remain the source of truth for who actually played.

---

# Availability Workflow

## Default Behaviour

Players are assumed available.

No availability record is required for available players.

---

## Player Actions

Players may:

* Mark unavailable
* Mark maybe
* Add notes

Examples:

"In Japan until Saturday evening"

"Available but arriving directly from work"

These actions create Availability Exception records.

---

## Bulk Actions

The system should support bulk updates where practical.

Examples:

* Unavailable during a holiday period
* Available for all upcoming fixtures

The goal is to minimise repetitive updates.

---

# Squad Selection Workflow

## Coach Workflow

For each fixture a coach should be able to:

* View eligible players
* Filter by position
* Filter by availability
* View player ability
* View play-up history
* Select players
* Remove players

Selection actions create Squad Selection records.

---

## Selection Protection

When a player is selected:

* They should be clearly identified as selected
* They should be excluded from recommendation pools for other teams
* Coaches should be able to manually release them if required

The system should minimise accidental double-selection.

---

## Squad Status

Fixtures should display:

* Target Squad Size
* Selected Count
* Availability Summary
* Shortfall Count

Example:

Target Squad: 14

Selected: 11

Shortfall: 3

---

# Recommendation Engine

## Purpose

Assist coaches when teams are short of players.

Recommendations should support coach decision making but should not automatically select players.

---

## Eligibility Filters

Recommendations should only consider players who are:

* Available
* Eligible to play
* Active
* Not already selected elsewhere

Availability is determined by the absence of an Unavailable Availability Exception.

---

## Recommendation Weighting

Availability is a filter, not a scoring factor.

Recommended weighting:

* Ability Rating: 50%
* Position Match: 20%
* Play-Up Count: 20%
* Team Distance: 10%

---

## Goalkeeper Handling

Goalkeepers may be registered differently from outfield players for competition administration purposes.

Recommendations should rely primarily on:

* Player Ability
* Availability
* Play-Up History

rather than Registered Team alone.

---

# Play-Up Tracking

## Purpose

Monitor compliance with HKHA regulations.

---

## Tracking Source

Play-ups should be calculated from Match Cards.

Not from squad selections.

Only actual appearances count.

---

## Monitoring

Coaches should be able to view:

* Total play-ups per player
* Warning thresholds
* Players approaching limits

---

## Re-Registration Support

The system should identify players who may require re-registration based on competition rules.

The application should provide visibility only.

It should not automatically change registrations.

---

# Coach Dashboard

The coach dashboard should provide visibility across teams.

Examples:

* Availability counts
* Selected counts
* Squad shortages
* Play-up warnings
* Recommendation candidates

The dashboard should help coaches quickly identify where intervention is required.

---

# Administration

Administrative functions should include:

* Fixture synchronisation
* Data validation
* Season rollover support
* Manual overrides
* Reporting

Administrative workflows should minimise direct Airtable maintenance.

---

# Future Enhancements

The following are explicitly out of scope for the initial build:

* WhatsApp Business integration
* Automated player approval workflows
* Advanced AI selection recommendations
* Automatic re-registration processing
* Calendar integration

Calendar integration may be added in a future phase and should support generating calendar invitations for selected players.