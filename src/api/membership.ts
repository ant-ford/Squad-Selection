import { apiGet, apiPost } from '@/lib/apiClient';
import type { BoardColumn } from '@shared/membershipStages';
import type { InsightFact, TeamSquad } from '@shared/membershipInsights';

/** Mirrors worker/src/membership.ts ApplicantCard. */
export interface ApplicantCard {
  id: string;
  name: string;
  surname: string;
  givenNames: string;
  photo?: string;
  stage: string;
  column: BoardColumn;
  status: string;
  membershipNo?: string;
  joinDate?: string;
  commitmentEndDate?: string;
  appliedOn?: string;
  stageSince?: string;
  /** Days in the current stage, or since applying when the stage date is unknown. */
  days: number | null;
  waitingOn: string | null;
  canApprove: boolean;
  mobileNo?: string;
  applicantType?: string;
  categoryType?: string;
  gender?: string;
  playingPosition?: string;
  team?: string;
  sponsor?: string;
  sportsBackground?: string;
  personalInterest?: string;
  tourInterest: string[];
  qualifiedUmpire?: string;
  qualifiedCoach?: string;
  playingLevel: string[];
  selectionComments?: string;
  applicationForm: { url: string; filename: string }[];
}

export interface MembershipBoard {
  columns: { pipeline: string[]; parked: string[] };
  cards: ApplicantCard[];
  /** False until the base has a Stage Updated At field. */
  hasStageDates: boolean;
  generatedAt: string;
}

export interface ApproveInput {
  personId: string;
  joinDate: string;
  commitmentEndDate: string;
  membershipNo: string;
  /** The officer saw who else has this number and is going ahead. */
  sharedNumberAcknowledged?: boolean;
}

export interface NumberHolder {
  id: string;
  name: string;
  status: string;
}

export interface MembershipInsightsData {
  facts: InsightFact[];
  teams: TeamSquad[];
  hasStageDates: boolean;
  generatedAt: string;
}

export function getMembershipInsights(): Promise<MembershipInsightsData> {
  return apiGet<MembershipInsightsData>('/api/membership/insights');
}

export function getMembershipBoard(): Promise<MembershipBoard> {
  return apiGet<MembershipBoard>('/api/membership/board');
}

/** Everyone but `excludeId` who already has this Membership No. */
export async function getNumberHolders(membershipNo: string, excludeId: string): Promise<NumberHolder[]> {
  const { holders } = await apiGet<{ holders: NumberHolder[] }>('/api/membership/number-holders', {
    membershipNo,
    exclude: excludeId,
  });
  return holders;
}

export function approveApplicant(input: ApproveInput): Promise<{ success: true }> {
  return apiPost('/api/membership/approve', input);
}

/**
 * Fetches the active-members CSV and hands it to the browser as a download.
 * A byte-order mark goes first so Excel reads the file as UTF-8.
 */
export async function downloadActiveMembers(): Promise<number> {
  const { filename, csv, count } = await apiGet<{ filename: string; csv: string; count: number }>(
    '/api/membership/active-members',
  );
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // After the click has been handled; revoking synchronously can cancel it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return count;
}
